"""agents0.7 - app desktop com um escritorio em pixel art.

Uso:
    python home.py            (ou dist/AgentBranch.exe)
    python home.py --debug    (abre as ferramentas de desenvolvedor da janela)

A janela (pywebview) mostra o front em front/ (HTML + Canvas). O backend em
terminalContact.py roda cada agente em um processo `claude -p` e roteia as
mensagens FIPA-ACL entre eles; a interface busca os eventos a cada 150 ms e
mostra ao vivo qual agente esta trabalhando.
"""

import json
import os
import re
import sys
import threading
import time
from pathlib import Path

if getattr(sys, "frozen", False):
    EXE_DIR = Path(sys.executable).resolve().parent
    RES_DIR = Path(getattr(sys, "_MEIPASS", EXE_DIR))
else:
    EXE_DIR = RES_DIR = Path(__file__).resolve().parent


def _achar_projeto():
    """Pasta com .env ou .claude/agents (a do exe, o cwd ou acima de dist/)."""
    for d in (EXE_DIR, Path.cwd(), EXE_DIR.parent, EXE_DIR.parent.parent):
        if (d / ".env").is_file() or (d / ".claude" / "agents").is_dir():
            return d
    return EXE_DIR


BASE_DIR = _achar_projeto()
try:
    import dotenv
    dotenv.load_dotenv(BASE_DIR / ".env")
except ImportError:
    pass

from terminalContact import PASTA_MEMORIA, PASTA_RELATORIOS, TerminalContact  # noqa: E402


def _pasta_agentes():
    """Pasta dos agentes: variavel path_agent do .env (relativa ao BASE_DIR) ou .claude/agents."""
    valor = (os.environ.get("path_agent") or "").strip().strip("\"'").strip()
    if not valor:
        return BASE_DIR / ".claude" / "agents"
    pasta = Path(valor).expanduser()
    return pasta if pasta.is_absolute() else (BASE_DIR / pasta)


AGENTS_DIR = _pasta_agentes()
MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]
EFFORTS = ["low", "medium", "high", "xhigh", "max"]
PERMS = ["acceptEdits", "bypassPermissions"]
AGENTE_PADRAO = "agent-007"
CONFIG_FILE = BASE_DIR / ".agentbranch.json"


_CONFIG_LOCK = threading.Lock()

RE_NOME_AGENTE = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")
RE_COR = re.compile(r"^#[0-9a-fA-F]{6}$")
RE_JOB_ID = re.compile(r"^[A-Za-z0-9_-]+$")
CORES_SKIN = ("skin", "hair", "shirt", "pants", "shoe", "tie")
HAIR_STYLES = ("short", "messy", "long", "bun", "curly", "bald", "slick")
ACESSORIOS = ("glasses", "sunglasses", "suit", "hoodie", "headphones", "labcoat",
              "beard", "badge", "hardhat", "cardigan")
# modelo proprio do agente (frontmatter "model:"); vazio/inherit = o escolhido na tela
MODELOS_AGENTE = ("", "inherit", "opus", "sonnet", "haiku", "fable") + tuple(MODELS)
FERRAMENTAS = ("Read", "Grep", "Glob", "Edit", "Write", "MultiEdit", "NotebookEdit", "Bash",
               "PowerShell", "WebFetch", "WebSearch", "TodoWrite")
TEMAS = ("escritorio", "espiao", "gotica")
LIXEIRA = BASE_DIR / ".lixeira-agentes"
MAX_MD = 200_000   # tamanho maximo do .md de um agente (bytes)


def _ler_config():
    """Conteudo do .agentbranch.json ({'pasta', 'skins'}) ou {}."""
    try:
        dados = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        return dados if isinstance(dados, dict) else {}
    except (OSError, ValueError):
        return {}


def _gravar_config(mudar):
    """Le, aplica mudar(dados) e grava, tudo sob o lock (nao perde 'pasta' nem 'skins')."""
    with _CONFIG_LOCK:
        dados = _ler_config()
        mudar(dados)
        try:
            CONFIG_FILE.write_text(json.dumps(dados, ensure_ascii=False, indent=2),
                                   encoding="utf-8")
            return True
        except OSError:
            return False


def _carregar_pasta():
    """Ultima pasta de trabalho salva; BASE_DIR se nao houver ou nao existir."""
    pasta = _ler_config().get("pasta")
    try:
        if isinstance(pasta, str) and pasta and Path(pasta).is_dir():
            return str(Path(pasta).resolve())
    except OSError:
        pass
    return str(BASE_DIR)


def _salvar_pasta(pasta):
    _gravar_config(lambda d: d.update(pasta=pasta))


def _salvar_skin_cfg(nome, skin):
    def mudar(d):
        skins = d.get("skins") if isinstance(d.get("skins"), dict) else {}
        skins[nome] = skin
        d["skins"] = skins
    return _gravar_config(mudar)


def _carregar_skins():
    skins = _ler_config().get("skins")
    return skins if isinstance(skins, dict) else {}


def _validar_skin(skin):
    """Skin limpa (so cores #rrggbb, hairStyle e acc de listas fixas) ou None."""
    if not isinstance(skin, dict):
        return None
    limpa = {}
    for k in CORES_SKIN:
        v = skin.get(k)
        if v is None or v == "":
            continue
        if not isinstance(v, str) or not RE_COR.fullmatch(v):
            return None
        limpa[k] = v.lower()
    hs = skin.get("hairStyle")
    if hs is not None:
        if hs not in HAIR_STYLES:
            return None
        limpa["hairStyle"] = hs
    acc = skin.get("acc") or []
    if not isinstance(acc, list) or any(a not in ACESSORIOS for a in acc):
        return None
    limpa["acc"] = list(dict.fromkeys(acc))
    return limpa


def _uma_linha(v, n):
    v = str(v or "").strip()
    return None if ("\n" in v or "\r" in v or len(v) > n) else v


class Api:
    """Metodos chamados pelo JavaScript (window.pywebview.api.*)."""

    def __init__(self):
        self._tc = TerminalContact(AGENTS_DIR, cwd=_carregar_pasta())

    def config(self):
        agentes = self._tc.agentes()
        nomes = [a["name"] for a in agentes]
        padrao = AGENTE_PADRAO if AGENTE_PADRAO in nomes else (nomes[0] if nomes else "")
        agentes.sort(key=lambda a: (a["name"] != AGENTE_PADRAO, a["name"]))
        return {"agents": agentes, "models": MODELS, "efforts": EFFORTS, "perms": PERMS,
                "defaultAgent": padrao, "base": str(BASE_DIR), "pasta": self._tc.cwd,
                "agentsDir": str(AGENTS_DIR), "skins": _carregar_skins(),
                "hairStyles": list(HAIR_STYLES), "accessories": list(ACESSORIOS),
                "tools": list(FERRAMENTAS), "agentModels": [m for m in MODELOS_AGENTE if m],
                "tema": _ler_config().get("tema") if _ler_config().get("tema") in TEMAS else TEMAS[0]}

    # -------------------------------------------------------------- agentes
    def _campos(self, data):
        """Valida os campos do formulario. Retorna (campos, None) ou (None, erro)."""
        data = data or {}
        nome = str(data.get("name", "")).strip()
        if not RE_NOME_AGENTE.fullmatch(nome):   # fullmatch: '$' sozinho aceita '\n' no fim
            return None, "nome invalido: use 2-41 caracteres a-z, 0-9 e '-' (comecando por letra/numero)"
        descricao = _uma_linha(data.get("description"), 400)
        tools = _uma_linha(data.get("tools"), 300)
        modelo = _uma_linha(data.get("model"), 40)
        if descricao is None or tools is None or modelo is None:
            return None, "descricao, ferramentas e modelo devem ter uma linha so"
        if "---" in descricao or "---" in tools:   # quebraria o cabecalho do .md
            return None, "descricao e ferramentas nao podem conter '---'"
        if not descricao:
            return None, "descricao vazia"
        if modelo not in MODELOS_AGENTE:
            return None, f"modelo invalido: {modelo}"
        prompt = str(data.get("prompt") or "").strip()
        if not prompt:
            return None, "instrucoes (prompt) vazias"
        if len(prompt.encode("utf-8")) > MAX_MD:
            return None, "instrucoes grandes demais"
        skin = data.get("skin")
        if skin:
            skin = _validar_skin(skin)
            if skin is None:
                return None, "skin invalida"
        return {"name": nome, "description": descricao, "tools": tools, "model": modelo,
                "prompt": prompt, "skin": skin or None}, None

    @staticmethod
    def _md(c, extras=None):
        """Texto do .md: cabecalho (name, description, tools, model + extras) e o corpo."""
        cab = [f"name: {c['name']}", f"description: {c['description']}"]
        if c.get("tools"):
            cab.append(f"tools: {c['tools']}")
        if c.get("model") and c["model"] != "inherit":
            cab.append(f"model: {c['model']}")
        for k, v in (extras or {}).items():   # chaves que o formulario nao conhece (ex.: color)
            cab.append(f"{k}: {v}")
        return "---\n" + "\n".join(cab) + "\n---\n\n" + c["prompt"] + "\n"

    @staticmethod
    def _arquivo(nome):
        """Caminho do .md do agente, ou None se o nome for invalido."""
        nome = str(nome or "").strip()
        if not RE_NOME_AGENTE.fullmatch(nome):
            return None
        return AGENTS_DIR / f"{nome}.md"

    @staticmethod
    def _extras(texto):
        """Chaves do cabecalho alem de name/description/tools/model (preservadas ao salvar)."""
        extras = {}
        if texto.startswith("---") and texto.count("---") >= 2:
            for linha in texto.split("---", 2)[1].splitlines():
                if ":" in linha:
                    k, v = linha.split(":", 1)
                    k = k.strip()
                    if k and k.lower() not in ("name", "description", "tools", "model") \
                            and "\n" not in v and "---" not in v:
                        extras[k] = v.strip()
        return extras

    def criar_agente(self, data):
        """Cria AGENTS_DIR/<name>.md (nao sobrescreve). Retorna {'agente'} ou {'erro'}."""
        c, erro = self._campos(data)
        if erro:
            return {"erro": erro}
        try:
            AGENTS_DIR.mkdir(parents=True, exist_ok=True)
            with open(AGENTS_DIR / f"{c['name']}.md", "x", encoding="utf-8") as f:
                f.write(self._md(c))
        except FileExistsError:
            return {"erro": f"ja existe um agente chamado {c['name']}"}
        except OSError as erro:
            return {"erro": f"nao consegui criar o arquivo: {erro}"}
        if c["skin"]:
            self.salvar_skin(c["name"], c["skin"])
        return {"agente": self._agente(c["name"]), "skin": c["skin"]}

    def _agente(self, nome):
        return next((a for a in self._tc.agentes() if a["name"] == nome), None)

    def ler_agente(self, nome):
        """{'agente': {..., 'raw': texto do .md}} ou {'erro'}."""
        arq = self._arquivo(nome)
        if not arq or not arq.is_file():
            return {"erro": f"agente nao encontrado: {nome}"}
        try:
            raw = arq.read_text(encoding="utf-8")
        except OSError as erro:
            return {"erro": f"nao consegui ler: {erro}"}
        a = self._agente(nome) or {"name": nome}
        return {"agente": dict(a, raw=raw, arquivo=str(arq))}

    def salvar_agente(self, data):
        """Edita um agente (e renomeia se o nome mudar). Sem 'original' = criar."""
        data = data or {}
        original = str(data.get("original") or "").strip()
        if not original:
            return self.criar_agente(data)
        antigo = self._arquivo(original)
        if not antigo or not antigo.is_file():
            return {"erro": f"agente nao encontrado: {original}"}
        c, erro = self._campos(data)
        if erro:
            return {"erro": erro}
        novo = AGENTS_DIR / f"{c['name']}.md"
        if c["name"] != original and novo.exists():
            return {"erro": f"ja existe um agente chamado {c['name']}"}
        try:
            extras = self._extras(antigo.read_text(encoding="utf-8"))
            novo.write_text(self._md(c, extras), encoding="utf-8")
            if c["name"] != original:
                antigo.unlink()
        except OSError as erro:
            return {"erro": f"nao consegui salvar: {erro}"}
        if c["name"] != original:   # a skin acompanha o novo nome
            skins = _carregar_skins()
            if original in skins:
                _gravar_config(lambda d: d.get("skins", {}).pop(original, None))
                if not c["skin"]:
                    c["skin"] = skins[original]
        if c["skin"]:
            self.salvar_skin(c["name"], c["skin"])
        return {"agente": self._agente(c["name"]), "skin": c["skin"], "original": original}

    def salvar_arquivo_agente(self, nome, texto):
        """Grava o .md cru (editor avancado). O cabecalho precisa ter name = nome do arquivo."""
        arq = self._arquivo(nome)
        if not arq or not arq.is_file():
            return {"erro": f"agente nao encontrado: {nome}"}
        texto = str(texto or "").replace("\r\n", "\n")
        if len(texto.encode("utf-8")) > MAX_MD:
            return {"erro": "arquivo grande demais"}
        if not texto.startswith("---") or texto.count("---") < 2:
            return {"erro": "o arquivo precisa comecar com o cabecalho entre --- e ---"}
        cab = {}
        for linha in texto.split("---", 2)[1].splitlines():
            if ":" in linha:
                k, v = linha.split(":", 1)
                cab[k.strip().lower()] = v.strip()
        if cab.get("name") != nome:
            return {"erro": f"no cabecalho, 'name:' precisa ser {nome} (para renomear use o formulario)"}
        if not cab.get("description"):
            return {"erro": "o cabecalho precisa de 'description:'"}
        if cab.get("model", "") not in MODELOS_AGENTE:
            return {"erro": f"modelo invalido: {cab.get('model')}"}
        try:
            arq.write_text(texto if texto.endswith("\n") else texto + "\n", encoding="utf-8")
        except OSError as erro:
            return {"erro": f"nao consegui salvar: {erro}"}
        return {"agente": self._agente(nome)}

    def excluir_agente(self, nome):
        """Move o .md para .lixeira-agentes/ (da para recuperar). Nao apaga o ultimo agente."""
        arq = self._arquivo(nome)
        if not arq or not arq.is_file():
            return {"erro": f"agente nao encontrado: {nome}"}
        if len(self._tc.agentes()) <= 1:
            return {"erro": "nao da para excluir o ultimo agente"}
        destino = LIXEIRA / f"{nome}-{time.strftime('%Y%m%d-%H%M%S')}.md"
        try:
            LIXEIRA.mkdir(exist_ok=True)
            arq.replace(destino)
        except OSError as erro:
            return {"erro": f"nao consegui mover para a lixeira: {erro}"}
        _gravar_config(lambda d: d.get("skins", {}).pop(nome, None) if isinstance(d.get("skins"), dict) else None)
        return {"excluido": nome, "lixeira": str(destino)}

    def set_tema(self, tema):
        tema = str(tema or "")
        if tema not in TEMAS:
            return {"erro": f"mapa invalido: {tema}"}
        _gravar_config(lambda d: d.update(tema=tema))
        return {"tema": tema}

    def salvar_skin(self, nome, skin):
        """Grava a skin do agente em .agentbranch.json. Retorna {'skin'} ou {'erro'}."""
        nome = str(nome or "").strip()
        if not (RE_NOME_AGENTE.fullmatch(nome) or nome == "usuario"):
            return {"erro": "nome invalido"}
        limpa = _validar_skin(skin)
        if limpa is None:
            return {"erro": "skin invalida"}
        if not _salvar_skin_cfg(nome, limpa):
            return {"erro": "nao consegui salvar .agentbranch.json"}
        return {"skin": limpa}

    def relatorio(self, job_id, formato="docx"):
        """Gera o relatorio (.docx ou .txt) e pergunta onde salvar. {'arquivo'} ou {'erro'}."""
        formato = "txt" if str(formato).lower() == "txt" else "docx"
        import relatorio as rel
        job = self._tc.jobs.get(str(job_id))
        if not job:
            return {"erro": "tarefa nao encontrada"}
        if job.get("status") == "running":
            return {"erro": "a tarefa ainda esta rodando"}
        try:
            copia = self._tc.copia_job(job["id"])
            dados = rel.gerar_txt(copia).encode("utf-8") if formato == "txt" else rel.gerar_docx(copia)
        except Exception as erro:
            return {"erro": f"falha ao gerar o relatorio: {erro}"}
        import webview
        if not webview.windows:
            return {"erro": "janela indisponivel"}
        tipo = getattr(webview, "SAVE_DIALOG", None)
        if tipo is None:
            tipo = webview.FileDialog.SAVE
        escolha = webview.windows[0].create_file_dialog(
            tipo, directory=self._tc.cwd or str(BASE_DIR),
            save_filename=f"relatorio-{job['id']}.{formato}",
            file_types=("Texto (*.txt)",) if formato == "txt" else ("Word (*.docx)",))
        if not escolha:
            return {"erro": "cancelado"}
        destino = str(escolha[0] if isinstance(escolha, (list, tuple)) else escolha)
        if not destino.lower().endswith("." + formato):
            destino += "." + formato
        try:
            Path(destino).write_bytes(dados)
        except OSError as erro:
            return {"erro": f"nao consegui salvar: {erro}"}
        return {"arquivo": destino}

    def abrir_relatorio(self, job_id):
        """Abre o .docx gerado automaticamente em .agentbranch/relatorios/. {'arquivo'} ou {'erro'}."""
        job_id = str(job_id or "")
        if not RE_JOB_ID.match(job_id):
            return {"erro": "id invalido"}
        job = self._tc.jobs.get(job_id)
        if not job:
            return {"erro": "tarefa nao encontrada"}
        if job.get("status") == "running":
            return {"erro": "a tarefa ainda esta rodando"}
        if not self._tc.cwd:
            return {"erro": "sem pasta de trabalho"}
        base = (Path(self._tc.cwd) / PASTA_MEMORIA / PASTA_RELATORIOS).resolve()
        arq = (base / f"relatorio-{job_id}.docx").resolve()
        if base not in arq.parents or not arq.is_file():
            return {"erro": "relatorio nao encontrado (use o botao DOCX para salvar)"}
        try:
            os.startfile(str(arq))  # noqa: S606 - so abre o arquivo validado acima
        except (OSError, AttributeError) as erro:
            return {"erro": f"nao consegui abrir: {erro}", "arquivo": str(arq)}
        return {"arquivo": str(arq)}

    def escolher_pasta(self):
        """Abre o seletor de pasta nativo. Retorna o caminho ou "" se cancelado."""
        import webview
        if not webview.windows:
            return ""
        escolha = webview.windows[0].create_file_dialog(
            webview.FOLDER_DIALOG, directory=self._tc.cwd or str(BASE_DIR))
        if not escolha:
            return ""
        return str(escolha[0] if isinstance(escolha, (list, tuple)) else escolha)

    def set_pasta(self, caminho):
        """Define a pasta de trabalho (cwd do claude -p). Vale para os proximos envios."""
        caminho = str(caminho or "").strip()
        if not caminho:
            return {"erro": "nenhuma pasta informada"}
        pasta = Path(caminho).expanduser()
        if not pasta.is_dir():
            return {"erro": f"pasta inexistente: {caminho}"}
        self._tc.cwd = str(pasta.resolve())
        _salvar_pasta(self._tc.cwd)
        return {"pasta": self._tc.cwd}

    def send(self, data):
        data = data or {}
        prompt = str(data.get("prompt", "")).strip()
        agente = str(data.get("agent", ""))
        if not prompt:
            return {"erro": "prompt vazio"}
        if agente not in {a["name"] for a in self._tc.agentes()}:
            return {"erro": f"agente invalido: {agente}"}
        model = data.get("model") if data.get("model") in MODELS else MODELS[0]
        effort = data.get("effort") if data.get("effort") in EFFORTS else "medium"
        perm = data.get("perm") if data.get("perm") in PERMS else PERMS[0]
        return {"job": self._tc.enviar(prompt, model, effort, agente, perm=perm)}

    def cancel(self, job_id):
        return self._tc.cancelar(str(job_id))

    def poll(self, desde=0):
        try:
            desde = int(desde or 0)
        except (TypeError, ValueError):
            desde = 0
        return self._tc.poll(desde)

    def history(self):
        return self._tc.historico()

    def _encerrar(self):
        for job_id in list(self._tc.jobs):
            self._tc.cancelar(job_id)


def montar_html():
    """index.html com CSS e JS embutidos (funciona igual no exe)."""
    front = RES_DIR / "front"
    html = (front / "index.html").read_text(encoding="utf-8")
    # avisa o front que esta no app desktop (ele espera a ponte do pywebview em vez de ir para o modo demo)
    html = html.replace("<head>", "<head>\n<script>window.__AGENTS_DESKTOP__ = true;</script>", 1)
    css = (front / "style.css").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>\n{css}\n</style>")
    for nome in ("game.js", "app.js"):
        js = (front / nome).read_text(encoding="utf-8")
        html = html.replace(f'<script src="{nome}"></script>', f"<script>\n{js}\n</script>")
    return html


def main():
    try:
        import webview
    except ImportError:
        print("Falta o pywebview. Instale com:  pip install pywebview")
        sys.exit(1)
    api = Api()
    janela = webview.create_window(
        "agents0.7", html=montar_html(), js_api=api, width=1440, height=900,
        min_size=(1000, 640), background_color="#0d0d16",
    )
    janela.events.closed += api._encerrar
    webview.start(debug="--debug" in sys.argv)


if __name__ == "__main__":
    main()
