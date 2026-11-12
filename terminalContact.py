"""Backend: roda os agentes do Claude Code e roteia as mensagens entre eles.

Cada agente roda no SEU PROPRIO processo `claude -p`. Para falar com outro
agente, ele termina a resposta com uma mensagem FIPA-ACL, por exemplo:

    (request :sender agent-007 :receiver agent-coder :content "...")

O roteador (executar_tarefa) le essa mensagem e acorda o destinatario. Assim o
"agente ao vivo" e sempre o processo que esta rodando agora, e cada troca de
mensagem vira um evento que a interface recebe em tempo real.
"""

import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path

try:
    import dotenv
    dotenv.load_dotenv()
except ImportError:
    pass

ERRO_PREFIX = "[ERRO]"
USUARIO = "usuario"
MAX_SALTOS = 14

PERFORMATIVAS = ("request", "inform", "failure", "refuse", "agree", "query-ref",
                 "query-if", "propose", "cfp", "confirm", "not-understood")
_ALIAS_USUARIO = {"usuario", "usuário", "user", "humano", "human", "cliente"}
_RE_INICIO = re.compile(r"\(\s*(" + "|".join(map(re.escape, PERFORMATIVAS)) + r")\b", re.I)
_RE_CHAVE = re.compile(r"(?:^|\s):(sender|receiver|content|reply-with|in-reply-to|"
                       r"conversation-id|language|ontology|reply-by)\s+", re.I)


# --------------------------------------------------------------------- agentes
def ler_agentes(pasta):
    """Le .claude/agents/*.md e devolve [{name, description, tools}]."""
    pasta = Path(pasta)
    agentes = []
    if not pasta.is_dir():
        return agentes
    for arq in sorted(pasta.glob("*.md")):
        meta = {"name": arq.stem, "description": "", "tools": ""}
        try:
            texto = arq.read_text(encoding="utf-8")
        except OSError:
            continue
        if texto.startswith("---"):
            cab = texto.split("---", 2)[1] if texto.count("---") >= 2 else ""
            for linha in cab.splitlines():
                if ":" in linha:
                    k, v = linha.split(":", 1)
                    k = k.strip().lower()
                    if k in meta:
                        meta[k] = v.strip().strip("`")
        agentes.append(meta)
    return agentes


# ------------------------------------------------------------------- FIPA-ACL
def _limpar_valor(v):
    v = v.strip()
    v = re.sub(r"\)\s*`*\s*$", "", v).strip()          # parentese final do bloco
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
    return v.replace('\\"', '"').strip()


def _norm_agente(v):
    v = _limpar_valor(v).strip("'\"`*[]() .,;").lower()
    return USUARIO if v in _ALIAS_USUARIO else v


def parse_fipa(texto):
    """Encontra mensagens FIPA-ACL no texto (de forma tolerante)."""
    texto = texto or ""
    achados = list(_RE_INICIO.finditer(texto))
    msgs = []
    for i, m in enumerate(achados):
        fim = achados[i + 1].start() if i + 1 < len(achados) else len(texto)
        bloco = texto[m.start():fim]
        ultimo = bloco.rfind(")")
        if ultimo > 0:
            bloco = bloco[:ultimo + 1]
        corpo = bloco[m.end() - m.start():]
        partes = _RE_CHAVE.split(corpo)
        campos = {}
        for j in range(1, len(partes) - 1, 2):
            campos[partes[j].lower()] = partes[j + 1]
        if "receiver" not in campos:
            continue
        msgs.append({
            "performative": m.group(1).lower(),
            "sender": _norm_agente(campos.get("sender", "")),
            "receiver": _norm_agente(campos["receiver"]),
            "content": _limpar_valor(campos.get("content", "")),
            "raw": bloco.strip(),
        })
    return msgs


def _escolher_mensagem(msgs, atual, nomes):
    """A ultima mensagem enviada pelo agente atual para um destino valido."""
    for m in reversed(msgs):
        if m["sender"] not in ("", atual):
            continue
        if m["receiver"] == USUARIO or (m["receiver"] in nomes and m["receiver"] != atual):
            return m
    return None


def _sem_fipa(texto):
    """Texto sem os blocos FIPA (para mostrar a resposta final mais limpa)."""
    achados = list(_RE_INICIO.finditer(texto or ""))
    return (texto[:achados[-1].start()].rstrip(" \n`") if achados else texto).strip()


# ----------------------------------------------------------- processo do Claude
def _resumo_ferramenta(nome, entrada):
    entrada = entrada or {}
    for chave in ("file_path", "path", "pattern", "command", "url", "query", "description"):
        if entrada.get(chave):
            valor = str(entrada[chave]).replace("\n", " ").strip()
            if chave in ("file_path", "path"):
                valor = valor.replace("\\", "/").split("/")[-1] or valor
            return valor[:70]
    return ""


def executar_agente(prompt, model, effort, agent, emit, resume=None,
                    perm="acceptEdits", job=None, cwd=None):
    """Roda um agente e emite eventos ao vivo. Retorna dict com o resultado."""
    cmd = ["claude", "-p", "--output-format", "stream-json", "--verbose",
           "--model", model, "--effort", effort, "--agent", agent,
           "--permission-mode", perm]
    if resume:
        cmd += ["--resume", resume]
    # delegacao so pelo roteador (assim todo acionamento aparece ao vivo)
    cmd += ["--disallowedTools", "Agent", "Task"]
    saida = {"texto": "", "ok": False, "session_id": resume, "custo": 0.0, "duracao": 0}
    try:
        proc = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace",
            cwd=cwd or os.getenv("route_terminal") or None,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except FileNotFoundError:
        saida["texto"] = f"{ERRO_PREFIX} comando 'claude' nao encontrado no PATH."
        return saida
    except Exception as erro:
        saida["texto"] = f"{ERRO_PREFIX} {erro}"
        return saida

    if job is not None:
        job["proc"] = proc
    erros = []
    threading.Thread(target=lambda: erros.append(proc.stderr.read()), daemon=True).start()
    try:
        proc.stdin.write(prompt)
        proc.stdin.close()
    except OSError:
        pass

    ultimo_pensar = 0.0
    final, is_error = None, False
    for linha in proc.stdout:
        linha = linha.strip()
        if not linha:
            continue
        try:
            ev = json.loads(linha)
        except json.JSONDecodeError:
            continue
        tipo = ev.get("type")
        if tipo == "system" and ev.get("subtype") == "init":
            saida["session_id"] = ev.get("session_id") or saida["session_id"]
        elif tipo == "assistant":
            for bloco in (ev.get("message") or {}).get("content") or []:
                bt = bloco.get("type")
                if bt == "tool_use":
                    nome = bloco.get("name", "")
                    emit({"tipo": "ferramenta", "agente": agent, "ferramenta": nome,
                          "texto": _resumo_ferramenta(nome, bloco.get("input"))})
                elif bt == "text" and bloco.get("text", "").strip():
                    primeira = bloco["text"].strip().splitlines()[0]
                    if not _RE_INICIO.match(primeira):
                        emit({"tipo": "fala", "agente": agent, "texto": primeira[:120]})
                elif bt == "thinking" and time.time() - ultimo_pensar > 3:
                    ultimo_pensar = time.time()
                    emit({"tipo": "pensando", "agente": agent})
        elif tipo == "result":
            final = ev.get("result")
            is_error = bool(ev.get("is_error"))
            saida["session_id"] = ev.get("session_id") or saida["session_id"]
            saida["custo"] = float(ev.get("total_cost_usd") or 0)
            saida["duracao"] = int(ev.get("duration_ms") or 0)
    proc.wait()
    if job is not None:
        job["proc"] = None

    if job is not None and job.get("cancelado"):
        saida["texto"] = f"{ERRO_PREFIX} tarefa cancelada."
    elif proc.returncode != 0 or final is None:
        detalhe = "".join(erros).strip() or final or "sem resposta do Claude"
        saida["texto"] = f"{ERRO_PREFIX} {detalhe[:2000]}"
    else:
        saida["texto"] = f"{ERRO_PREFIX} {final}" if is_error else final
        saida["ok"] = not is_error
    return saida


# ------------------------------------------------------------------- roteador
def _montar_prompt(atual, msg, tarefa, conversa, agentes):
    equipe = "\n".join(f"- {a['name']}: {a['description']}" for a in agentes
                       if a["name"] != atual)
    hist = []
    for i, c in enumerate(conversa[-12:], 1):
        conteudo = c["content"].replace("\n", " ")
        if len(conteudo) > 400:
            conteudo = conteudo[:400] + "..."
        hist.append(f"{i}. {c['sender']} -> {c['receiver']} ({c['performative']}): {conteudo}")
    return f"""Voce e o {atual}. Voce faz parte de uma equipe de agentes ligada por um roteador em Python.
Cada agente roda num processo separado. A UNICA forma de falar com outro agente e terminar
a sua resposta com uma mensagem FIPA-ACL. Nao use a ferramenta Agent/Task.

== MENSAGEM RECEBIDA ==
({msg['performative']}
  :sender {msg['sender']}
  :receiver {atual}
  :content "{msg['content']}")

== PEDIDO ORIGINAL DO USUARIO ==
{tarefa}

== CONVERSA ATE AGORA ==
{chr(10).join(hist) or '(inicio)'}

== EQUIPE ==
{equipe}

== COMO RESPONDER ==
1. Faca a sua parte com as suas ferramentas.
2. Termine com EXATAMENTE UMA mensagem FIPA-ACL, como ultima coisa da resposta:
   - passar trabalho:   (request :sender {atual} :receiver <agente> :content "<o que fazer + contexto necessario>")
   - devolver resultado: (inform :sender {atual} :receiver {msg['sender']} :content "<resultado>")
   - nao conseguiu:      (failure :sender {atual} :receiver {msg['sender']} :content "<motivo>")
   - encerrar e responder o usuario: (inform :sender {atual} :receiver usuario :content "<resposta final>")
   Quem fala com o usuario e quem recebeu o pedido dele. Dentro do :content use aspas simples.
"""


def executar_tarefa(tarefa, model, effort, agente_inicial, emit, agentes,
                    perm="acceptEdits", job=None, cwd=None, max_saltos=MAX_SALTOS):
    """Roda a cadeia de agentes. Retorna (ok, resposta_final, custo_total)."""
    nomes = {a["name"] for a in agentes}
    sessoes, conversa = {}, []
    msg = {"performative": "request", "sender": USUARIO, "receiver": agente_inicial,
           "content": tarefa}
    conversa.append(msg)
    emit({"tipo": "mensagem", "de": USUARIO, "para": agente_inicial,
          "performativa": "request", "conteudo": tarefa})
    atual, custo = agente_inicial, 0.0

    for salto in range(1, max_saltos + 1):
        if job is not None and job.get("cancelado"):
            return False, f"{ERRO_PREFIX} tarefa cancelada.", custo
        emit({"tipo": "ao_vivo", "agente": atual, "de": msg["sender"], "salto": salto})
        r = executar_agente(_montar_prompt(atual, msg, tarefa, conversa, agentes),
                            model, effort, atual, emit, resume=sessoes.get(atual),
                            perm=perm, job=job, cwd=cwd)
        custo += r["custo"]
        if r["session_id"]:
            sessoes[atual] = r["session_id"]
        emit({"tipo": "agente_fim", "agente": atual, "ok": r["ok"],
              "custo": r["custo"], "duracao": r["duracao"]})
        if not r["ok"]:
            return False, r["texto"], custo

        resp = _escolher_mensagem(parse_fipa(r["texto"]), atual, nomes)
        if resp is None:
            # esqueceu o FIPA: devolve automaticamente para quem pediu
            destino = msg["sender"]
            resp = {"performative": "inform", "sender": atual, "receiver": destino,
                    "content": _sem_fipa(r["texto"])[:3000] or "(sem texto)"}
        resp["sender"] = atual
        conversa.append(resp)
        emit({"tipo": "mensagem", "de": atual, "para": resp["receiver"],
              "performativa": resp["performative"], "conteudo": resp["content"]})
        if resp["receiver"] == USUARIO:
            texto = _sem_fipa(r["texto"])
            final = resp["content"] if len(texto) < 40 else f"{texto}\n\n---\n{resp['content']}"
            return resp["performative"] != "failure", final, custo
        msg, atual = resp, resp["receiver"]

    return False, f"{ERRO_PREFIX} limite de {max_saltos} trocas entre agentes atingido.", custo


class TerminalContact:
    """Fila de tarefas com eventos numerados (a interface busca com poll)."""

    def __init__(self, agents_dir, cwd=None):
        self.agents_dir = Path(agents_dir)
        self.cwd = cwd
        self.eventos = []
        self.seq = 0
        self.jobs = {}
        self.lock = threading.Lock()

    def agentes(self):
        return ler_agentes(self.agents_dir)

    def _emit(self, job_id, ev):
        with self.lock:
            self.seq += 1
            ev = dict(ev, seq=self.seq, job=job_id, t=time.time())
            self.eventos.append(ev)
            if len(self.eventos) > 4000:
                del self.eventos[:1000]

    def poll(self, desde=0):
        with self.lock:
            return [e for e in self.eventos if e["seq"] > desde]

    def enviar(self, prompt, model, effort, agent, perm="acceptEdits"):
        job_id = f"t{len(self.jobs) + 1}"
        job = {"id": job_id, "prompt": prompt, "agente": agent, "model": model,
               "effort": effort, "status": "running", "resposta": None,
               "criado": time.time(), "proc": None, "cancelado": False, "custo": 0.0}
        self.jobs[job_id] = job
        threading.Thread(target=self._rodar, args=(job, perm), daemon=True).start()
        return job_id

    def _rodar(self, job, perm):
        def emit(ev):
            self._emit(job["id"], ev)
        emit({"tipo": "tarefa_inicio", "agente": job["agente"], "prompt": job["prompt"]})
        t0 = time.time()
        try:
            ok, resposta, custo = executar_tarefa(
                job["prompt"], job["model"], job["effort"], job["agente"], emit,
                self.agentes(), perm=perm, job=job, cwd=self.cwd)
        except Exception as erro:  # nunca deixa a interface presa em "rodando"
            ok, resposta, custo = False, f"{ERRO_PREFIX} {erro}", 0.0
        job.update(status="done" if ok else "error", resposta=resposta, custo=custo)
        emit({"tipo": "tarefa_fim", "ok": ok, "resposta": resposta, "custo": custo,
              "duracao": int((time.time() - t0) * 1000)})

    def cancelar(self, job_id):
        job = self.jobs.get(job_id)
        if not job or job["status"] != "running":
            return False
        job["cancelado"] = True
        proc = job.get("proc")
        if proc and proc.poll() is None:
            proc.terminate()
        return True

    def historico(self):
        return [{k: v for k, v in j.items() if k != "proc"} for j in self.jobs.values()]
