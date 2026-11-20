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
    """Le <pasta>/*.md e devolve [{name, description, tools, prompt}].

    'prompt' e o corpo do .md (o que vem depois do cabecalho entre ---)."""
    pasta = Path(pasta)
    agentes = []
    if not pasta.is_dir():
        return agentes
    for arq in sorted(pasta.glob("*.md")):
        meta = {"name": arq.stem, "description": "", "tools": "", "model": ""}
        try:
            texto = arq.read_text(encoding="utf-8")
        except OSError:
            continue
        corpo = texto
        if texto.startswith("---") and texto.count("---") >= 2:
            _, cab, corpo = texto.split("---", 2)
            for linha in cab.splitlines():
                if ":" in linha:
                    k, v = linha.split(":", 1)
                    k = k.strip().lower()
                    if k in meta:
                        meta[k] = v.strip().strip("`")
        meta["prompt"] = corpo.strip()
        agentes.append(meta)
    return agentes


# caracteres que o cmd.exe interpreta (quando o claude e um .cmd do npm): viram \uXXXX no JSON
_CMD_ESPECIAIS = {c: "\\u%04x" % ord(c) for c in "&|<>^%!'`"}


def _definicao_json(agente):
    """JSON para --agents so com o agente atual: {name: {description, prompt, tools}}.

    Assim o claude -p acha o agente mesmo quando a pasta (path_agent) nao e o
    .claude/agents do cwd. Os caracteres especiais do cmd.exe dentro dos textos
    viram \\uXXXX (JSON valido e seguro na linha de comando do Windows)."""
    if not agente:
        return None
    d = {"description": agente.get("description") or agente["name"],
         "prompt": agente.get("prompt") or ""}
    tools = [t.strip() for t in str(agente.get("tools") or "").split(",") if t.strip()]
    if tools:
        d["tools"] = tools
    texto = json.dumps({agente["name"]: d}, ensure_ascii=True, separators=(",", ":"))
    # so troca dentro das strings: as aspas da estrutura do JSON ficam como estao
    partes = re.split(r'("(?:[^"\\]|\\.)*")', texto)
    for i in range(1, len(partes), 2):
        miolo = partes[i][1:-1].replace('\\"', "\\u0022")   # aspas internas ja vem como \"
        miolo = "".join(_CMD_ESPECIAIS.get(c, c) for c in miolo)
        partes[i] = '"' + miolo + '"'
    return "".join(partes)


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


FERRAMENTAS_EDICAO = ("Edit", "Write", "MultiEdit", "NotebookEdit")


def _tokens_de(usage):
    """{entrada, saida, cache} a partir do 'usage' da API (cache = leitura + criacao)."""
    u = usage or {}
    n = lambda k: int(u.get(k) or 0)  # noqa: E731
    return {"entrada": n("input_tokens"), "saida": n("output_tokens"),
            "cache": n("cache_read_input_tokens") + n("cache_creation_input_tokens")}


def executar_agente(prompt, model, effort, agent, emit, resume=None,
                    perm="acceptEdits", job=None, cwd=None, definicao=None):
    """Roda um agente e emite eventos ao vivo. Retorna dict com o resultado.

    definicao: JSON de _definicao_json (vai em --agents, para achar o agente
    fora do .claude/agents do cwd)."""
    cmd = ["claude", "-p", "--output-format", "stream-json", "--verbose",
           "--model", model, "--effort", effort, "--agent", agent,
           "--permission-mode", perm]
    if definicao:
        cmd += ["--agents", definicao]
    if resume:
        cmd += ["--resume", resume]
    # delegacao so pelo roteador (assim todo acionamento aparece ao vivo)
    cmd += ["--disallowedTools", "Agent", "Task"]
    saida = {"texto": "", "ok": False, "session_id": resume, "custo": 0.0, "duracao": 0,
             "tokens": {"entrada": 0, "saida": 0, "cache": 0}}
    vistos = {}   # message.id -> ultimo usage ja contado (o mesmo id vem em varios eventos)
    try:
        proc = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace",
            cwd=cwd or None,
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
            mensagem = ev.get("message") or {}
            if mensagem.get("usage"):
                agora = _tokens_de(mensagem["usage"])
                antes = vistos.get(mensagem.get("id") or id(mensagem),
                                   {"entrada": 0, "saida": 0, "cache": 0})
                delta = {k: max(0, agora[k] - antes[k]) for k in agora}
                vistos[mensagem.get("id") or id(mensagem)] = {k: max(agora[k], antes[k]) for k in agora}
                if any(delta.values()):
                    for k in delta:
                        saida["tokens"][k] += delta[k]
                    emit(dict(delta, tipo="tokens", agente=agent))
            for bloco in mensagem.get("content") or []:
                bt = bloco.get("type")
                if bt == "tool_use":
                    nome = bloco.get("name", "")
                    entrada = bloco.get("input") or {}
                    ev_f = {"tipo": "ferramenta", "agente": agent, "ferramenta": nome,
                            "texto": _resumo_ferramenta(nome, entrada)}
                    if nome in FERRAMENTAS_EDICAO:
                        caminho = entrada.get("file_path") or entrada.get("notebook_path") or ""
                        if caminho:   # caminho completo (relativo conta do cwd do agente)
                            p = Path(str(caminho))
                            ev_f["arquivo"] = str(p if p.is_absolute() or not cwd else Path(cwd) / p)
                    emit(ev_f)
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
            if ev.get("usage"):   # o total do result e o valor oficial deste processo
                saida["tokens"] = _tokens_de(ev["usage"])
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


# ------------------------------------------------------- memoria e economia
PASTA_MEMORIA = ".agentbranch"
ARQ_MEMORIA = "memoria.md"
PASTA_RELATORIOS = "relatorios"
MAX_ENTRADAS = 30          # tarefas guardadas no arquivo
MEMORIA_NO_PROMPT = 2500   # caracteres da memoria enviados aos agentes
_IGNORAR = {".git", "node_modules", "__pycache__", "dist", "build", ".venv", "venv",
            PASTA_MEMORIA, ".idea", ".vscode", ".codex"}


def _relativo(caminho, cwd):
    """Caminho relativo ao cwd (com /), ou o proprio caminho se estiver fora dele."""
    if not caminho:
        return ""
    try:
        return Path(caminho).resolve().relative_to(Path(cwd).resolve()).as_posix()
    except (ValueError, OSError, TypeError):
        return str(caminho).replace("\\", "/")


def _entradas(texto):
    partes = [e.strip() for e in ("\n" + texto).split("\n## ") if e.strip()]
    return ["## " + e for e in partes]


def ler_memoria(cwd, limite=MEMORIA_NO_PROMPT):
    """Ultimas anotacoes das tarefas anteriores nesta pasta (ou "")."""
    try:
        texto = (Path(cwd) / PASTA_MEMORIA / ARQ_MEMORIA).read_text(encoding="utf-8")
    except (OSError, TypeError):
        return ""
    escolhidas, tamanho = [], 0
    for e in reversed(_entradas(texto)):   # as mais novas primeiro, ate o limite
        if tamanho + len(e) > limite:
            break
        escolhidas.insert(0, e)
        tamanho += len(e)
    return "\n\n".join(escolhidas)


def gravar_memoria(cwd, tarefa, conversa, final, ok, arquivos):
    """Anota a tarefa em .agentbranch/memoria.md (feito pelo Python: custa 0 tokens)."""
    if not cwd:
        return
    pasta = Path(cwd) / PASTA_MEMORIA
    arq = pasta / ARQ_MEMORIA

    def um(t, n):
        return " ".join(str(t or "").split())[:n]

    cadeia = " -> ".join([conversa[0]["sender"]] + [c["receiver"] for c in conversa]) if conversa else ""
    entrada = (f"## {time.strftime('%Y-%m-%d %H:%M')} - {'ok' if ok else 'ERRO'}\n"
               f"- Pedido: {um(tarefa, 300)}\n- Cadeia: {cadeia}\n"
               f"- Arquivos alterados: {', '.join(sorted(arquivos)) or 'nenhum'}\n"
               f"- Resultado: {um(final, 600)}")
    try:
        pasta.mkdir(exist_ok=True)
        antigo = arq.read_text(encoding="utf-8") if arq.exists() else ""
        entradas = _entradas(antigo)[-(MAX_ENTRADAS - 1):]
        arq.write_text("\n\n".join(entradas + [entrada]) + "\n", encoding="utf-8")
    except OSError:
        pass


def mapa_projeto(cwd, max_arquivos=80):
    """Lista compacta dos arquivos da pasta, para os agentes nao precisarem procurar."""
    if not cwd:
        return ""
    raiz, linhas, total = Path(cwd), [], 0
    try:
        for atual, pastas, arquivos in os.walk(raiz):
            pastas[:] = sorted(d for d in pastas if d not in _IGNORAR)
            for nome in sorted(arquivos):
                total += 1
                if len(linhas) < max_arquivos:
                    f = Path(atual) / nome
                    try:
                        kb = max(1, f.stat().st_size // 1024)
                    except OSError:
                        kb = 0
                    linhas.append(f"{f.relative_to(raiz).as_posix()} ({kb} KB)")
    except OSError:
        return ""
    if total > len(linhas):
        linhas.append(f"... e mais {total - len(linhas)} arquivos")
    return "\n".join(linhas)


_ECONOMIA = """== ECONOMIA DE TOKENS (obrigatorio) ==
- Comece pela MEMORIA e pelo MAPA abaixo. Nao use Glob/ls para descobrir o que ja esta no mapa.
- Leia so o que a sua parte exige. Prefira Grep e leitura parcial (offset/limit) a ler arquivo inteiro.
- Nao releia um arquivo que voce ja leu nesta conversa, nem o que outro agente ja resumiu.
- Resposta curta: sem repetir o pedido, sem copiar codigo no texto. :content com ate ~120 palavras."""


# ------------------------------------------------------------------- roteador
def _prompt_curto(atual, msg):
    """Para um agente que ja participou desta tarefa (sessao retomada com --resume)."""
    return f"""== NOVA MENSAGEM RECEBIDA ==
({msg['performative']}
  :sender {msg['sender']}
  :receiver {atual}
  :content "{msg['content']}")

Voce ja tem o contexto desta tarefa: nao releia arquivos. Continue e termine com UMA mensagem
FIPA-ACL (request para outro agente, inform/failure para {msg['sender']}, ou inform para usuario)."""


MAX_COBRAR_FIPA = 2   # quantas vezes o roteador pede de novo a mensagem FIPA-ACL


def _prompt_cobrar_fipa(atual, msg, tentativa):
    """Retomada da sessao quando o agente terminou sem mensagem FIPA-ACL valida."""
    return f"""== ROTEADOR: FALTOU A MENSAGEM FIPA-ACL (tentativa {tentativa} de {MAX_COBRAR_FIPA}) ==
A sua ultima resposta nao terminou com uma mensagem FIPA-ACL valida, entao ninguem a recebeu.
A comunicacao entre os agentes e OBRIGATORIAMENTE em FIPA-ACL. Nao refaca o trabalho:
responda SO com UMA mensagem, por exemplo:
(inform :sender {atual} :receiver {msg['sender']} :content "<resultado>")
ou (request :sender {atual} :receiver <agente> :content "<o que fazer>")
ou (failure :sender {atual} :receiver {msg['sender']} :content "<motivo>")
O :receiver precisa ser um agente da equipe (diferente de voce) ou usuario."""


def _montar_prompt(atual, msg, tarefa, conversa, agentes, memoria="", mapa=""):
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

{_ECONOMIA}

== MEMORIA (tarefas anteriores nesta pasta) ==
{memoria or '(vazia)'}

== MAPA DA PASTA ==
{mapa or '(vazia)'}

== COMO RESPONDER ==
1. Faca a sua parte com as suas ferramentas.
2. Termine com EXATAMENTE UMA mensagem FIPA-ACL, como ultima coisa da resposta:
   - passar trabalho:   (request :sender {atual} :receiver <agente> :content "<o que fazer + contexto necessario>")
   - devolver resultado: (inform :sender {atual} :receiver {msg['sender']} :content "<resultado>")
   - nao conseguiu:      (failure :sender {atual} :receiver {msg['sender']} :content "<motivo>")
   - encerrar e responder o usuario: (inform :sender {atual} :receiver usuario :content "<resposta final>")
   Quem fala com o usuario e quem recebeu o pedido dele. Dentro do :content use aspas simples.
"""


_APELIDOS_MODELO = {"opus": "claude-opus-5-5", "sonnet": "claude-sonnet-5-5",
                    "haiku": "claude-haiku-5-5", "fable": "claude-fable-5-1"}


def modelo_do_agente(agente, padrao):
    """Modelo do frontmatter do agente (apelido ou id completo); senao o padrao da tela."""
    m = str((agente or {}).get("model") or "").strip().lower()
    if not m or m == "inherit":
        return padrao
    if m in _APELIDOS_MODELO:
        return _APELIDOS_MODELO[m]
    return m if re.fullmatch(r"claude-[a-z0-9.-]+", m) else padrao


def executar_tarefa(tarefa, model, effort, agente_inicial, emit, agentes,
                    perm="acceptEdits", job=None, cwd=None, max_saltos=MAX_SALTOS):
    """Roda a cadeia de agentes. Retorna (ok, resposta_final, custo_total)."""
    nomes = {a["name"] for a in agentes}
    por_nome = {a["name"]: a for a in agentes}
    sessoes, conversa = {}, []
    msg = {"performative": "request", "sender": USUARIO, "receiver": agente_inicial,
           "content": tarefa}
    conversa.append(msg)
    emit({"tipo": "mensagem", "de": USUARIO, "para": agente_inicial,
          "performativa": "request", "conteudo": tarefa})
    atual, custo = agente_inicial, 0.0
    memoria, mapa, alterados = ler_memoria(cwd), mapa_projeto(cwd), set()
    emit_ui = emit

    def emit(ev):  # anota os arquivos editados para a memoria
        if ev.get("tipo") == "ferramenta" and ev.get("ferramenta") in FERRAMENTAS_EDICAO:
            alterados.add(_relativo(ev.get("arquivo"), cwd) or ev.get("texto") or "?")
        emit_ui(ev)

    def rodar(prompt_agente):
        nonlocal custo
        r = executar_agente(prompt_agente, modelo_do_agente(por_nome.get(atual), model), effort,
                            atual, emit, resume=sessoes.get(atual),
                            perm=perm, job=job, cwd=cwd,
                            definicao=_definicao_json(por_nome.get(atual)))
        custo += r["custo"]
        if r["session_id"]:
            sessoes[atual] = r["session_id"]
        emit({"tipo": "agente_fim", "agente": atual, "ok": r["ok"], "custo": r["custo"],
              "duracao": r["duracao"], "tokens": r["tokens"]})
        return r

    def fim(ok, texto, resumo=None):
        gravar_memoria(cwd, tarefa, conversa, resumo or texto, ok, alterados)
        return ok, texto, custo

    for salto in range(1, max_saltos + 1):
        if job is not None and job.get("cancelado"):
            return fim(False, f"{ERRO_PREFIX} tarefa cancelada.")
        emit({"tipo": "ao_vivo", "agente": atual, "de": msg["sender"], "salto": salto})
        prompt = (_prompt_curto(atual, msg) if atual in sessoes else
                  _montar_prompt(atual, msg, tarefa, conversa, agentes, memoria, mapa))
        r = rodar(prompt)
        if not r["ok"]:
            return fim(False, r["texto"])

        resp = _escolher_mensagem(parse_fipa(r["texto"]), atual, nomes)
        tentativa, texto_sem = 0, r["texto"]
        # FIPA-ACL e obrigatorio: sem mensagem valida, cobra o agente na mesma sessao
        while resp is None and tentativa < MAX_COBRAR_FIPA and sessoes.get(atual):
            if job is not None and job.get("cancelado"):
                return fim(False, f"{ERRO_PREFIX} tarefa cancelada.")
            tentativa += 1
            emit({"tipo": "fipa_cobrar", "agente": atual, "tentativa": tentativa})
            r = rodar(_prompt_cobrar_fipa(atual, msg, tentativa))
            if not r["ok"]:
                return fim(False, r["texto"])
            resp = _escolher_mensagem(parse_fipa(r["texto"]), atual, nomes)
        if resp is None:
            # nao respondeu em FIPA-ACL: o roteador devolve um failure para quem pediu
            resp = {"performative": "failure", "sender": atual, "receiver": msg["sender"],
                    "content": (f"{atual} nao respondeu em FIPA-ACL. Resposta sem mensagem: "
                                + (_sem_fipa(texto_sem)[:2500] or "(sem texto)"))}
        resp["sender"] = atual
        conversa.append(resp)
        emit({"tipo": "mensagem", "de": atual, "para": resp["receiver"],
              "performativa": resp["performative"], "conteudo": resp["content"]})
        if resp["receiver"] == USUARIO:
            texto = _sem_fipa(texto_sem)
            final = resp["content"] if len(texto) < 40 else f"{texto}\n\n---\n{resp['content']}"
            return fim(resp["performative"] != "failure", final, resp["content"])
        msg, atual = resp, resp["receiver"]

    return fim(False, f"{ERRO_PREFIX} limite de {max_saltos} trocas entre agentes atingido.")


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
            job = self.jobs.get(job_id)
            if job is not None:   # log completo da tarefa (para o relatorio .docx)
                job.setdefault("log", []).append(ev)
            if len(self.eventos) > 4000:
                del self.eventos[:1000]

    def poll(self, desde=0):
        with self.lock:
            return [e for e in self.eventos if e["seq"] > desde]

    def enviar(self, prompt, model, effort, agent, perm="acceptEdits"):
        job_id = f"t{len(self.jobs) + 1}"
        job = {"id": job_id, "prompt": prompt, "agente": agent, "model": model,
               "effort": effort, "status": "running", "resposta": None,
               "criado": time.time(), "proc": None, "cancelado": False, "custo": 0.0,
               "tokens": {"entrada": 0, "saida": 0, "cache": 0}, "log": []}
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
        tokens = {"entrada": 0, "saida": 0, "cache": 0}
        with self.lock:
            for ev in job.get("log", []):
                if ev.get("tipo") == "agente_fim":
                    for k in tokens:
                        tokens[k] += int((ev.get("tokens") or {}).get(k) or 0)
        duracao = int((time.time() - t0) * 1000)
        job.update(status="done" if ok else "error", resposta=resposta, custo=custo,
                   tokens=tokens, duracao=duracao)
        job["arquivo"] = self._gravar_relatorio(job)
        emit({"tipo": "tarefa_fim", "ok": ok, "resposta": resposta, "custo": custo,
              "duracao": duracao, "tokens": tokens, "arquivo": job["arquivo"]})

    def _gravar_relatorio(self, job):
        """Gera .agentbranch/relatorios/relatorio-<id>.docx na pasta de trabalho.
        Retorna o caminho ou None (nunca levanta: o relatorio e um extra)."""
        if not self.cwd:
            return None
        try:
            import relatorio as rel
            pasta = Path(self.cwd) / PASTA_MEMORIA / PASTA_RELATORIOS
            pasta.mkdir(parents=True, exist_ok=True)
            arq = pasta / f"relatorio-{job['id']}.docx"
            arq.write_bytes(rel.gerar_docx(self.copia_job(job["id"])))
            return str(arq)
        except Exception:
            return None

    def copia_job(self, job_id):
        """Copia da tarefa (sem o processo), com o log copiado sob o lock."""
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return None
            copia = {k: v for k, v in job.items() if k not in ("proc", "log")}
            copia["log"] = [dict(e) for e in job.get("log", [])]
        return copia

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
        return [{k: v for k, v in j.items() if k not in ("proc", "log")}
                for j in self.jobs.values()]
