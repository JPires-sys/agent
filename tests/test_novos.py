"""Testes de path_agent, --agents, tokens, FIPA obrigatorio, criar agente/skin e .docx.

Sem pytest: python tests/test_novos.py
"""
import io
import json
import os
import shutil
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from xml.dom import minidom

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
import home  # noqa: E402
import relatorio  # noqa: E402
import terminalContact as tc  # noqa: E402

TMP = Path(tempfile.mkdtemp())
falhas = []


def caso(nome):
    def deco(f):
        try:
            f()
            print(f"OK   {nome}")
        except Exception as e:
            falhas.append(nome)
            print(f"FAIL {nome}: {type(e).__name__}: {e}")
        return f
    return deco


# ------------------------------------------------------------ 1) path_agent
@caso("_pasta_agentes: aspas, relativo, absoluto e sem a variavel")
def _():
    antes = os.environ.get("path_agent")
    try:
        os.environ["path_agent"] = '"minha/pasta"'
        assert home._pasta_agentes() == home.BASE_DIR / "minha" / "pasta"
        os.environ["path_agent"] = "  'outra'  "
        assert home._pasta_agentes() == home.BASE_DIR / "outra"
        os.environ["path_agent"] = f'"{TMP}"'
        assert home._pasta_agentes() == TMP
        os.environ["path_agent"] = '  ""  '
        assert home._pasta_agentes() == home.BASE_DIR / ".claude" / "agents"
        del os.environ["path_agent"]
        assert home._pasta_agentes() == home.BASE_DIR / ".claude" / "agents"
    finally:
        if antes is None:
            os.environ.pop("path_agent", None)
        else:
            os.environ["path_agent"] = antes


# --------------------------------------------------------- 2) --agents JSON
@caso("_definicao_json: JSON valido e sem & % < | ' > ^ ! ` crus")
def _():
    ag = {"name": "agent-x", "description": 'diz "oi" & 100% <b> | pipe',
          "tools": "Read, Edit ,, Bash", "prompt": "linha1\nuse 'aspas' ^ ! `x` > y"}
    texto = tc._definicao_json(ag)
    for c in "&%<>|^!'`":
        assert c not in texto, f"{c!r} cru no JSON: {texto}"
    d = json.loads(texto)
    assert d == {"agent-x": {"description": ag["description"], "prompt": ag["prompt"],
                             "tools": ["Read", "Edit", "Bash"]}}, d
    assert "\\u0026" in texto and "\\u0025" in texto and "\\u003c" in texto \
        and "\\u007c" in texto and "\\u0022" in texto
    assert tc._definicao_json(None) is None
    sem = json.loads(tc._definicao_json({"name": "b"}))
    assert sem == {"b": {"description": "b", "prompt": ""}}, sem


@caso("ler_agentes devolve 'prompt' (corpo do .md)")
def _():
    d = TMP / "ags"
    d.mkdir()
    (d / "agent-a.md").write_text("---\nname: agent-a\ndescription: A\ntools: Read\n---\n\ncorpo aqui\n",
                                  encoding="utf-8")
    a = tc.ler_agentes(d)
    assert a == [{"name": "agent-a", "description": "A", "tools": "Read", "model": "",
                  "prompt": "corpo aqui"}], a


# ---------------------------------------------------- 3) stream-json falso
class ProcFalso:
    def __init__(self, linhas):
        self.stdin = io.StringIO()
        self.stdout = iter(json.dumps(x) + "\n" for x in linhas)
        self.stderr = io.StringIO("")
        self.returncode = 0

    def wait(self):
        return 0


def _resultado(texto, sid, usage):
    return {"type": "result", "result": texto, "is_error": False, "session_id": sid,
            "total_cost_usd": 0.01, "duration_ms": 5, "usage": usage}


def _rodar_job(roteiro, agentes_md):
    """roteiro(agente, n, cmd) -> lista de eventos stream-json. Devolve (log, cmds)."""
    pasta = TMP / f"job{time.time_ns()}"
    (pasta / "ags").mkdir(parents=True)
    for nome in agentes_md:
        (pasta / "ags" / f"{nome}.md").write_text(
            f"---\nname: {nome}\ndescription: desc {nome}\n---\n\nfaca & 50%\n", encoding="utf-8")
    cont, cmds = {}, []

    def popen(cmd, **kw):
        ag = cmd[cmd.index("--agent") + 1]
        cont[ag] = cont.get(ag, 0) + 1
        cmds.append(cmd)
        return ProcFalso(roteiro(ag, cont[ag], cmd))
    orig = tc.subprocess.Popen
    tc.subprocess.Popen = popen
    try:
        t = tc.TerminalContact(pasta / "ags", cwd=str(pasta))
        jid = t.enviar("pedido", "m", "low", agentes_md[0])
        limite = time.time() + 10
        while t.jobs[jid]["status"] == "running" and time.time() < limite:
            time.sleep(0.05)
        assert t.jobs[jid]["status"] != "running", "tarefa nao terminou"
        time.sleep(0.05)
        return t.jobs[jid]["log"], cmds
    finally:
        tc.subprocess.Popen = orig


@caso("tokens: mesmo message.id nao conta 2x; result.usage em agente_fim; tarefa_fim soma; Edit tem 'arquivo'")
def _():
    def roteiro(ag, n, cmd):
        return [
            {"type": "system", "subtype": "init", "session_id": "s1"},
            {"type": "assistant", "message": {"id": "m1", "usage": {"input_tokens": 10, "output_tokens": 5},
                                              "content": [{"type": "tool_use", "name": "Edit",
                                                           "input": {"file_path": "src/x.py"}}]}},
            {"type": "assistant", "message": {"id": "m1", "usage": {"input_tokens": 10, "output_tokens": 7,
                                                                    "cache_read_input_tokens": 3}}},
            {"type": "assistant", "message": {"id": "m1", "usage": {"input_tokens": 10, "output_tokens": 7,
                                                                    "cache_read_input_tokens": 3}}},
            _resultado('feito\n(inform :sender agent-a :receiver usuario :content "ok")', "s1",
                       {"input_tokens": 100, "output_tokens": 50, "cache_read_input_tokens": 20,
                        "cache_creation_input_tokens": 5}),
        ]
    log, cmds = _rodar_job(roteiro, ["agent-a"])
    tks = [e for e in log if e["tipo"] == "tokens"]
    soma = {k: sum(e[k] for e in tks) for k in ("entrada", "saida", "cache")}
    assert soma == {"entrada": 10, "saida": 7, "cache": 3}, (soma, tks)
    fim_ag = [e for e in log if e["tipo"] == "agente_fim"]
    assert len(fim_ag) == 1 and fim_ag[0]["tokens"] == {"entrada": 100, "saida": 50, "cache": 25}, fim_ag
    fim = [e for e in log if e["tipo"] == "tarefa_fim"][0]
    assert fim["ok"] and fim["tokens"] == {"entrada": 100, "saida": 50, "cache": 25}, fim
    ed = [e for e in log if e["tipo"] == "ferramenta" and e["ferramenta"] == "Edit"][0]
    assert Path(ed["arquivo"]).as_posix().endswith("src/x.py") and Path(ed["arquivo"]).is_absolute(), ed
    c = cmds[0]
    defn = json.loads(c[c.index("--agents") + 1])
    assert defn["agent-a"]["prompt"] == "faca & 50%", defn
    assert "&" not in c[c.index("--agents") + 1]


@caso("sem FIPA: fipa_cobrar 2x e failure do roteador para msg['sender']")
def _():
    def roteiro(ag, n, cmd):
        sid = f"s-{ag}"
        ini = {"type": "system", "subtype": "init", "session_id": sid}
        if ag == "agent-a" and n == 1:
            txt = '(request :sender agent-a :receiver agent-b :content "faz")'
        elif ag == "agent-a":
            txt = '(inform :sender agent-a :receiver usuario :content "recebi o failure")'
        else:
            txt = "fiz tudo mas esqueci a mensagem"
        return [ini, _resultado(txt, sid, {"input_tokens": 1, "output_tokens": 1})]
    log, cmds = _rodar_job(roteiro, ["agent-a", "agent-b"])
    cob = [e for e in log if e["tipo"] == "fipa_cobrar"]
    assert [(e["agente"], e["tentativa"]) for e in cob] == [("agent-b", 1), ("agent-b", 2)], cob
    rodadas_b = [c for c in cmds if c[c.index("--agent") + 1] == "agent-b"]
    assert len(rodadas_b) == 3 and "--resume" in rodadas_b[1] and "--resume" in rodadas_b[2]
    msgs = [(e["de"], e["para"], e["performativa"]) for e in log if e["tipo"] == "mensagem"]
    assert msgs == [("usuario", "agent-a", "request"), ("agent-a", "agent-b", "request"),
                    ("agent-b", "agent-a", "failure"), ("agent-a", "usuario", "inform")], msgs
    falha = [e for e in log if e["tipo"] == "mensagem" and e["performativa"] == "failure"][0]
    assert "nao respondeu em FIPA-ACL" in falha["conteudo"] and "esqueci" in falha["conteudo"], falha
    assert [e for e in log if e["tipo"] == "tarefa_fim"][0]["ok"] is True


@caso("sem FIPA do primeiro agente: failure vai para o usuario e tarefa falha")
def _():
    def roteiro(ag, n, cmd):
        return [{"type": "system", "subtype": "init", "session_id": "s"},
                _resultado("so texto", "s", {"input_tokens": 1, "output_tokens": 1})]
    log, _c = _rodar_job(roteiro, ["agent-a"])
    assert len([e for e in log if e["tipo"] == "fipa_cobrar"]) == 2
    ult = [e for e in log if e["tipo"] == "mensagem"][-1]
    assert (ult["de"], ult["para"], ult["performativa"]) == ("agent-a", "usuario", "failure"), ult
    assert [e for e in log if e["tipo"] == "tarefa_fim"][0]["ok"] is False


# ------------------------------------------------ 4) criar agente e skin
def _api_tmp():
    home.AGENTS_DIR = TMP / "novos_agentes"
    home.CONFIG_FILE = TMP / "cfg.json"
    home.LIXEIRA = TMP / "lixeira"
    return home.Api()


AG_ORIG, CFG_ORIG, LIX_ORIG = home.AGENTS_DIR, home.CONFIG_FILE, home.LIXEIRA


@caso("criar_agente recusa '../x', 'A', 'a\\n', '---' e '---' na descricao")
def _():
    api = _api_tmp()
    base = {"description": "faz x", "prompt": "instrucoes"}
    for nome in ("../x", "A", "a\n", "---", "", "ab/cd", "a" * 42):
        r = api.criar_agente(dict(base, name=nome))
        assert "erro" in r, (nome, r)
    assert "erro" in api.criar_agente(dict(base, name="ok-1", description="a --- b"))
    assert "erro" in api.criar_agente(dict(base, name="ok-1", description="a\nb"))
    assert "erro" in api.criar_agente(dict(base, name="ok-1", prompt="  "))
    assert "erro" in api.criar_agente(dict(base, name="ok-1", skin={"shirt": "red"}))
    assert not (TMP / "x.md").exists()
    assert not list(home.AGENTS_DIR.glob("*.md")) if home.AGENTS_DIR.exists() else True


@caso("criar_agente cria .md legivel e nao sobrescreve")
def _():
    api = _api_tmp()
    r = api.criar_agente({"name": "agent-novo", "description": "testa", "tools": "Read, Bash",
                          "prompt": "seja breve", "skin": {"shirt": "#AABBCC", "acc": ["glasses"]}})
    assert r.get("agente", {}).get("name") == "agent-novo", r
    arq = home.AGENTS_DIR / "agent-novo.md"
    original = arq.read_text(encoding="utf-8")
    lido = tc.ler_agentes(home.AGENTS_DIR)
    assert lido == [{"name": "agent-novo", "description": "testa", "tools": "Read, Bash",
                     "model": "", "prompt": "seja breve"}], lido
    r2 = api.criar_agente({"name": "agent-novo", "description": "outra", "prompt": "outra"})
    assert "erro" in r2 and arq.read_text(encoding="utf-8") == original, r2
    assert home._carregar_skins()["agent-novo"] == {"shirt": "#aabbcc", "acc": ["glasses"]}


@caso("salvar_skin recusa cor/acc invalidos e mantem 'pasta'")
def _():
    api = _api_tmp()
    home.CONFIG_FILE.write_text(json.dumps({"pasta": "C:/qualquer"}), encoding="utf-8")
    assert "erro" in api.salvar_skin("agent-a", {"shirt": "red"})
    assert "erro" in api.salvar_skin("agent-a", {"shirt": "#12345"})
    assert "erro" in api.salvar_skin("agent-a", {"acc": ["coroa"]})
    assert "erro" in api.salvar_skin("agent-a", {"acc": "glasses"})
    assert "erro" in api.salvar_skin("agent-a", {"hairStyle": "moicano"})
    assert "erro" in api.salvar_skin("../x", {"shirt": "#000000"})
    r = api.salvar_skin("agent-a", {"shirt": "#00FF00", "acc": ["hoodie", "hoodie"], "x": "y"})
    assert r == {"skin": {"shirt": "#00ff00", "acc": ["hoodie"]}}, r
    d = json.loads(home.CONFIG_FILE.read_text(encoding="utf-8"))
    assert d["pasta"] == "C:/qualquer" and d["skins"]["agent-a"]["shirt"] == "#00ff00", d


# ------------------------------------------------------------- 5) .docx
@caso("gerar_docx: controle e '<&' geram XML valido")
def _():
    sujo = "a\x00b\x01c\x1b<&>\"'\ttab\r\nfim\ud800"
    job = {"id": "t1", "prompt": sujo, "status": "done", "resposta": sujo, "model": "m",
           "effort": "low", "criado": time.time(), "custo": 0.5,
           "tokens": {"entrada": 1, "saida": 2, "cache": 3},
           "log": [{"tipo": "mensagem", "de": "usuario", "para": "agent-a", "performativa": "request",
                    "conteudo": sujo, "t": time.time()},
                   {"tipo": "mensagem", "de": "agent-a", "para": "usuario<&", "performativa": "inform",
                    "conteudo": "ok <b>&amp;", "t": "lixo"},
                   {"tipo": "ferramenta", "agente": "agent-a", "ferramenta": "Edit",
                    "arquivo": "C:/p/<&>.py"},
                   {"tipo": "agente_fim", "agente": "agent-a", "custo": 0.5,
                    "tokens": {"entrada": 1, "saida": 2, "cache": 3}},
                   {"tipo": "fipa_cobrar", "agente": "agent-a", "tentativa": 1}]}
    dados = relatorio.gerar_docx(job)
    z = zipfile.ZipFile(io.BytesIO(dados))
    assert set(z.namelist()) == {"[Content_Types].xml", "_rels/.rels", "word/document.xml"}
    for n in z.namelist():
        minidom.parseString(z.read(n))   # levanta erro se o XML for invalido
    texto = "".join(t.firstChild.data for t in
                    minidom.parseString(z.read("word/document.xml")).getElementsByTagName("w:t")
                    if t.firstChild)
    assert "abc<&>" in texto and "ok <b>&amp;" in texto and "C:/p/<&>.py" in texto, texto[:300]
    assert "\x00" not in texto and "\x1b" not in texto
    try:
        relatorio.gerar_docx(None)
        raise AssertionError("gerar_docx(None) nao levantou")
    except ValueError:
        pass


# ------------------------------------- 6) editar, renomear, excluir, txt
@caso("salvar_agente edita, renomeia (levando a skin) e preserva chaves extras")
def _():
    api = _api_tmp()
    base = {"name": "agent-ed", "description": "antes", "prompt": "corpo", "model": "haiku",
            "skin": {"shirt": "#112233", "acc": []}}
    assert "agente" in api.criar_agente(base)
    arq = home.AGENTS_DIR / "agent-ed.md"
    arq.write_text(arq.read_text(encoding="utf-8").replace("model: haiku", "model: haiku\ncolor: red"),
                   encoding="utf-8")
    r = api.salvar_agente(dict(base, original="agent-ed", name="agent-ed2", description="depois", skin=None))
    assert r.get("agente", {}).get("description") == "depois", r
    assert not arq.exists()
    texto = (home.AGENTS_DIR / "agent-ed2.md").read_text(encoding="utf-8")
    assert "model: haiku" in texto and "color: red" in texto, texto
    assert home._carregar_skins().get("agent-ed2", {}).get("shirt") == "#112233"
    assert "agent-ed" not in home._carregar_skins()
    assert "erro" in api.salvar_agente(dict(base, original="agent-ed2", model="gpt-9"))
    assert "erro" in api.salvar_agente(dict(base, original="nao-existe"))


@caso("salvar_arquivo_agente valida o cabecalho; excluir_agente move para a lixeira")
def _():
    api = _api_tmp()
    for n in ("agent-x1", "agent-x2"):
        api.criar_agente({"name": n, "description": "d", "prompt": "p"})
    assert "erro" in api.salvar_arquivo_agente("agent-x1", "sem cabecalho")
    assert "erro" in api.salvar_arquivo_agente("agent-x1", "---\nname: outro\ndescription: d\n---\nx")
    assert "erro" in api.salvar_arquivo_agente("agent-x1", "---\nname: agent-x1\n---\nx")
    r = api.salvar_arquivo_agente("agent-x1", "---\nname: agent-x1\ndescription: nova\n---\n\nnovo corpo")
    assert r.get("agente", {}).get("prompt") == "novo corpo", r
    assert api.ler_agente("agent-x1")["agente"]["raw"].startswith("---")
    assert "erro" in api.ler_agente("../x")
    r = api.excluir_agente("agent-x1")
    assert r.get("excluido") == "agent-x1" and Path(r["lixeira"]).is_file(), r
    assert not (home.AGENTS_DIR / "agent-x1.md").exists()
    restantes = [a["name"] for a in tc.ler_agentes(home.AGENTS_DIR)]
    for n in restantes[1:]:
        assert "excluido" in api.excluir_agente(n), n
    assert "erro" in api.excluir_agente(restantes[0])   # ultimo agente: nao exclui


@caso("modelo_do_agente: apelido, id completo, inherit e lixo")
def _():
    assert tc.modelo_do_agente({"model": "haiku"}, "X") == "claude-haiku-5-5"
    assert tc.modelo_do_agente({"model": "claude-opus-5-5"}, "X") == "claude-opus-5-5"
    assert tc.modelo_do_agente({"model": "inherit"}, "X") == "X"
    assert tc.modelo_do_agente({"model": "rm -rf"}, "X") == "X"
    assert tc.modelo_do_agente(None, "X") == "X"


@caso("gerar_txt tem pedido, cadeia, conversa e total")
def _():
    job = {"id": "t9", "prompt": "fazer x", "status": "done", "resposta": "feito", "model": "m",
           "effort": "low", "criado": time.time(), "custo": 0.25,
           "log": [{"tipo": "mensagem", "de": "usuario", "para": "agent-a", "performativa": "request",
                    "conteudo": "fazer x", "t": time.time()},
                   {"tipo": "mensagem", "de": "agent-a", "para": "usuario", "performativa": "inform",
                    "conteudo": "feito\nlinha 2", "t": time.time()},
                   {"tipo": "agente_fim", "agente": "agent-a", "custo": 0.25, "tokens": {"entrada": 3}}]}
    t = relatorio.gerar_txt(job)
    for trecho in ("agents0.7", "fazer x", "usuario -> agent-a -> usuario", "   linha 2", "TOTAL: US$ 0.2500"):
        assert trecho in t, (trecho, t)


home.AGENTS_DIR, home.CONFIG_FILE, home.LIXEIRA = AG_ORIG, CFG_ORIG, LIX_ORIG
shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{'TODOS OK' if not falhas else 'FALHAS: ' + ', '.join(falhas)}")
sys.exit(1 if falhas else 0)
