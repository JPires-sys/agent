"""Agent Branch - app desktop com um escritorio em pixel art.

Uso:
    python home.py            (ou dist/AgentBranch.exe)
    python home.py --debug    (abre as ferramentas de desenvolvedor da janela)

A janela (pywebview) mostra o front em front/ (HTML + Canvas). O backend em
terminalContact.py roda cada agente em um processo `claude -p` e roteia as
mensagens FIPA-ACL entre eles; a interface busca os eventos a cada 150 ms e
mostra ao vivo qual agente esta trabalhando.
"""

import json
import sys
from pathlib import Path

if getattr(sys, "frozen", False):
    EXE_DIR = Path(sys.executable).resolve().parent
    RES_DIR = Path(getattr(sys, "_MEIPASS", EXE_DIR))
else:
    EXE_DIR = RES_DIR = Path(__file__).resolve().parent


def _achar_projeto():
    """Pasta que contem .claude/agents (a do exe, o cwd ou acima de dist/)."""
    for d in (EXE_DIR, Path.cwd(), EXE_DIR.parent, EXE_DIR.parent.parent):
        if (d / ".claude" / "agents").is_dir():
            return d
    return EXE_DIR


BASE_DIR = _achar_projeto()
try:
    import dotenv
    dotenv.load_dotenv(BASE_DIR / ".env")
except ImportError:
    pass

from terminalContact import TerminalContact  # noqa: E402

AGENTS_DIR = BASE_DIR / ".claude" / "agents"
MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]
EFFORTS = ["low", "medium", "high", "xhigh", "max"]
PERMS = ["acceptEdits", "bypassPermissions"]
AGENTE_PADRAO = "agent-007"
CONFIG_FILE = BASE_DIR / ".agentbranch.json"


def _carregar_pasta():
    """Ultima pasta de trabalho salva; BASE_DIR se nao houver ou nao existir."""
    try:
        pasta = json.loads(CONFIG_FILE.read_text(encoding="utf-8")).get("pasta")
        if pasta and Path(pasta).is_dir():
            return str(Path(pasta).resolve())
    except (OSError, ValueError, AttributeError):
        pass
    return str(BASE_DIR)


def _salvar_pasta(pasta):
    try:
        CONFIG_FILE.write_text(json.dumps({"pasta": pasta}, ensure_ascii=False, indent=2),
                               encoding="utf-8")
    except OSError:
        pass


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
                "defaultAgent": padrao, "base": str(BASE_DIR), "pasta": self._tc.cwd}

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
        "Agent Branch", html=montar_html(), js_api=api, width=1440, height=900,
        min_size=(1000, 640), background_color="#0d0d16",
    )
    janela.events.closed += api._encerrar
    webview.start(debug="--debug" in sys.argv)


if __name__ == "__main__":
    main()
