"""Testes da pasta de trabalho (sem pytest): python tests/test_pasta.py"""
import json
import shutil
import sys
import tempfile
import threading
import time
import types
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
import home  # noqa: E402
import terminalContact  # noqa: E402

TMP = Path(tempfile.mkdtemp())
CFG_ORIGINAL = home.CONFIG_FILE
home.CONFIG_FILE = TMP / "cfg.json"
falhas = []
Api = home.Api


def caso(nome):
    def deco(f):
        try:
            if home.CONFIG_FILE.exists():
                home.CONFIG_FILE.unlink()
            f()
            print(f"OK   {nome}")
        except Exception as e:
            falhas.append(nome)
            print(f"FAIL {nome}: {type(e).__name__}: {e}")
        return f
    return deco


@caso("json ausente -> BASE_DIR")
def _():
    assert Api().config()["pasta"] == str(home.BASE_DIR)


@caso("json invalido -> BASE_DIR")
def _():
    home.CONFIG_FILE.write_text("{nao e json", encoding="utf-8")
    assert home._carregar_pasta() == str(home.BASE_DIR)
    home.CONFIG_FILE.write_text("[1, 2]", encoding="utf-8")  # lista, sem .get
    assert home._carregar_pasta() == str(home.BASE_DIR)


@caso("pasta salva apagada -> BASE_DIR")
def _():
    d = TMP / "sumiu"
    d.mkdir()
    home.CONFIG_FILE.write_text(json.dumps({"pasta": str(d)}), encoding="utf-8")
    d.rmdir()
    assert Api().config()["pasta"] == str(home.BASE_DIR)


@caso("set_pasta('') e None -> erro, cwd intacto")
def _():
    api = Api()
    antes = api._tc.cwd
    assert api.set_pasta("") == {"erro": "nenhuma pasta informada"}
    assert api.set_pasta("   ") == {"erro": "nenhuma pasta informada"}
    assert api.set_pasta(None) == {"erro": "nenhuma pasta informada"}
    assert api._tc.cwd == antes and not home.CONFIG_FILE.exists()


@caso("set_pasta(inexistente) -> erro, cwd intacto, nao grava")
def _():
    api = Api()
    antes = api._tc.cwd
    r = api.set_pasta(str(TMP / "nao_existe"))
    assert r.get("erro", "").startswith("pasta inexistente:"), r
    assert api._tc.cwd == antes and not home.CONFIG_FILE.exists()


@caso("set_pasta(arquivo, nao pasta) -> erro")
def _():
    f = TMP / "arq.txt"
    f.write_text("x")
    assert "erro" in Api().set_pasta(str(f))


@caso("set_pasta(valida) -> cwd, config e json; nova Api carrega")
def _():
    d = TMP / "trabalho"
    d.mkdir(exist_ok=True)
    api = Api()
    r = api.set_pasta(str(d))
    esperado = str(d.resolve())
    assert r == {"pasta": esperado}, r
    assert api._tc.cwd == esperado and api.config()["pasta"] == esperado
    assert json.loads(home.CONFIG_FILE.read_text(encoding="utf-8")) == {"pasta": esperado}
    assert Api()._tc.cwd == esperado


@caso("send usa o cwd novo no executar_tarefa e no Popen")
def _():
    d = TMP / "envio"
    d.mkdir(exist_ok=True)
    api = Api()
    api.set_pasta(str(d))
    capt, pronto = {}, threading.Event()
    orig_popen = terminalContact.subprocess.Popen

    def fake_popen(cmd, **kw):
        capt["popen_cwd"] = kw.get("cwd")
        pronto.set()
        raise FileNotFoundError  # nao chama o claude de verdade
    terminalContact.subprocess.Popen = fake_popen
    orig_et = terminalContact.executar_tarefa

    def espiao(*a, **kw):
        capt["tarefa_cwd"] = kw.get("cwd")
        return orig_et(*a, **kw)
    terminalContact.executar_tarefa = espiao
    try:
        agente = api.config()["defaultAgent"]
        r = api.send({"prompt": "oi", "agent": agente})
        assert "job" in r, r
        assert pronto.wait(5), "Popen nao foi chamado"
        time.sleep(0.2)
    finally:
        terminalContact.subprocess.Popen = orig_popen
        terminalContact.executar_tarefa = orig_et
    esperado = str(d.resolve())
    assert capt.get("tarefa_cwd") == esperado, capt
    assert capt.get("popen_cwd") == esperado, capt


@caso("send com prompt vazio -> erro")
def _():
    assert Api().send({"prompt": "  ", "agent": "agent-007"}) == {"erro": "prompt vazio"}


@caso("escolher_pasta sem janela -> '' ; cancelado -> '' ; escolha -> caminho")
def _():
    fake = types.SimpleNamespace(windows=[], FOLDER_DIALOG=20)
    sys.modules["webview"] = fake
    api = Api()
    assert api.escolher_pasta() == ""
    janela = types.SimpleNamespace(create_file_dialog=lambda *a, **k: None)
    fake.windows = [janela]
    assert api.escolher_pasta() == ""
    janela.create_file_dialog = lambda *a, **k: ("C:/x",)
    assert api.escolher_pasta() == "C:/x"
    janela.create_file_dialog = lambda *a, **k: "C:/y"
    assert api.escolher_pasta() == "C:/y"
    del sys.modules["webview"]


home.CONFIG_FILE = CFG_ORIGINAL
shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{'TODOS OK' if not falhas else 'FALHAS: ' + ', '.join(falhas)}")
sys.exit(1 if falhas else 0)
