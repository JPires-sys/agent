"""Relatorio de uma tarefa em Word (.docx) ou texto (.txt), sem dependencias.

gerar_docx(job) recebe a copia da tarefa (TerminalContact.copia_job, com o
'log' de eventos) e devolve os bytes de um .docx com:
  1. a conversa completa entre os agentes (hora, de, para, performativa, texto);
  2. o relatorio: pedido, status, resposta final, cadeia, o que cada agente fez
     (a ultima mensagem dele), arquivos alterados, ferramentas por agente,
     custo e tokens por agente e o total.
"""

import io
import re
import time
import zipfile
from xml.sax.saxutils import escape

# caracteres que o XML 1.0 nao aceita (controle e surrogates soltos)
_RE_INVALIDO = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff￾￿]")

_CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_EDICAO = ("Edit", "Write", "MultiEdit", "NotebookEdit")


def _limpar(texto):
    texto = str("" if texto is None else texto).replace("\r\n", "\n").replace("\r", "\n")
    return _RE_INVALIDO.sub("", texto.replace("\t", "    "))


def _run(texto, negrito=False, tamanho=None, cor=None):
    """Um w:r; cada quebra de linha vira <w:br/>."""
    props = ""
    if negrito or tamanho or cor:
        props = "<w:rPr>" + ("<w:b/>" if negrito else "") + \
                (f'<w:color w:val="{cor}"/>' if cor else "") + \
                (f'<w:sz w:val="{int(tamanho) * 2}"/>' if tamanho else "") + "</w:rPr>"
    linhas = _limpar(texto).split("\n")
    corpo = "<w:br/>".join(f'<w:t xml:space="preserve">{escape(l)}</w:t>' for l in linhas)
    return f"<w:r>{props}{corpo}</w:r>"


def _par(*runs, espaco=120):
    return f'<w:p><w:pPr><w:spacing w:after="{espaco}"/></w:pPr>{"".join(runs)}</w:p>'


def _titulo(texto, tamanho=16):
    return _par(_run(texto, negrito=True, tamanho=tamanho, cor="1F3864"), espaco=200)


def _campo(rotulo, valor):
    return _par(_run(f"{rotulo}: ", negrito=True), _run(valor))


def _hora(t):
    try:
        return time.strftime("%d/%m/%Y %H:%M:%S", time.localtime(float(t)))
    except (TypeError, ValueError, OverflowError, OSError):
        return "?"


def _fmt_tokens(tk):
    tk = tk or {}
    return (f"entrada {int(tk.get('entrada') or 0):,} · saida {int(tk.get('saida') or 0):,}"
            f" · cache {int(tk.get('cache') or 0):,}").replace(",", ".")


def resumir(job):
    """Agrupa o log da tarefa (separado do XML para poder testar)."""
    log = job.get("log") or []
    conversa = [e for e in log if e.get("tipo") == "mensagem"]
    cadeia = []
    for m in conversa:
        if not cadeia:
            cadeia.append(m.get("de", "?"))
        if cadeia[-1] != m.get("para"):
            cadeia.append(m.get("para", "?"))
    ultima, ferramentas, arquivos, gastos, cobrancas = {}, {}, [], {}, {}
    for e in log:
        tipo, ag = e.get("tipo"), e.get("agente")
        if tipo == "mensagem" and e.get("de") != "usuario":
            ultima[e.get("de")] = e
        elif tipo == "ferramenta":
            por = ferramentas.setdefault(ag, {})
            por[e.get("ferramenta", "?")] = por.get(e.get("ferramenta", "?"), 0) + 1
            if e.get("ferramenta") in _EDICAO:
                caminho = e.get("arquivo") or e.get("texto") or "?"
                if caminho not in [a for a, _ in arquivos]:
                    arquivos.append((caminho, ag))
        elif tipo == "agente_fim":
            g = gastos.setdefault(ag, {"custo": 0.0, "entrada": 0, "saida": 0, "cache": 0,
                                       "rodadas": 0})
            g["custo"] += float(e.get("custo") or 0)
            g["rodadas"] += 1
            for k in ("entrada", "saida", "cache"):
                g[k] += int((e.get("tokens") or {}).get(k) or 0)
        elif tipo == "fipa_cobrar":
            cobrancas[ag] = cobrancas.get(ag, 0) + 1
    total = {"custo": sum(g["custo"] for g in gastos.values())}
    for k in ("entrada", "saida", "cache"):
        total[k] = sum(g[k] for g in gastos.values())
    return {"conversa": conversa, "cadeia": cadeia, "ultima": ultima,
            "ferramentas": ferramentas, "arquivos": arquivos, "gastos": gastos,
            "total": total, "cobrancas": cobrancas}


def _documento(job):
    r = resumir(job)
    status = {"done": "concluida", "error": "com erro", "running": "rodando"}.get(
        job.get("status"), str(job.get("status") or "?"))
    p = [_titulo(f"agents0.7 - relatorio da tarefa {job.get('id', '?')}", 20),
         _campo("Gerado em", _hora(time.time())),
         _campo("Criada em", _hora(job.get("criado"))),
         _campo("Modelo / esforco", f"{job.get('model', '?')} / {job.get('effort', '?')}")]

    # 1) conversa completa
    p.append(_titulo("1. Conversa entre os agentes (FIPA-ACL)"))
    if not r["conversa"]:
        p.append(_par(_run("(nenhuma mensagem)")))
    for i, m in enumerate(r["conversa"], 1):
        p.append(_par(_run(f"{i}. [{_hora(m.get('t'))}] ", negrito=True),
                      _run(f"{m.get('de', '?')} -> {m.get('para', '?')} ", negrito=True),
                      _run(f"({m.get('performativa', '?')})", cor="7F7F7F"), espaco=40))
        p.append(_par(_run(m.get("conteudo") or "(vazio)")))

    # 2) relatorio
    p.append(_titulo("2. Relatorio do que foi feito"))
    p.append(_campo("Pedido", job.get("prompt") or ""))
    p.append(_campo("Status", status))
    p.append(_campo("Cadeia", " -> ".join(r["cadeia"]) or "(vazia)"))
    p.append(_par(_run("Resposta final:", negrito=True), espaco=40))
    p.append(_par(_run(job.get("resposta") or "(sem resposta)")))

    p.append(_titulo("O que cada agente fez e a logica aplicada", 13))
    if not r["ultima"]:
        p.append(_par(_run("(nenhum agente respondeu)")))
    for ag, m in r["ultima"].items():
        p.append(_par(_run(f"{ag} ", negrito=True),
                      _run(f"(ultima mensagem, {m.get('performativa', '?')} para "
                           f"{m.get('para', '?')})", cor="7F7F7F"), espaco=40))
        p.append(_par(_run(m.get("conteudo") or "(vazio)")))
    if r["cobrancas"]:
        p.append(_campo("Cobrancas de FIPA-ACL pelo roteador",
                        ", ".join(f"{a}: {n}x" for a, n in r["cobrancas"].items())))

    p.append(_titulo("Arquivos alterados", 13))
    if not r["arquivos"]:
        p.append(_par(_run("nenhum")))
    for caminho, ag in r["arquivos"]:
        p.append(_par(_run(f"- {caminho} "), _run(f"({ag})", cor="7F7F7F"), espaco=40))

    p.append(_titulo("Ferramentas por agente", 13))
    if not r["ferramentas"]:
        p.append(_par(_run("nenhuma")))
    for ag, por in r["ferramentas"].items():
        p.append(_campo(ag, ", ".join(f"{f} x{n}" for f, n in sorted(por.items()))))

    p.append(_titulo("Custo e tokens", 13))
    for ag, g in r["gastos"].items():
        p.append(_campo(ag, f"US$ {g['custo']:.4f} · {_fmt_tokens(g)} · {g['rodadas']} rodada(s)"))
    t = r["total"]
    custo_total = float(job.get("custo") or t["custo"])
    p.append(_par(_run("TOTAL: ", negrito=True),
                  _run(f"US$ {custo_total:.4f} · {_fmt_tokens(job.get('tokens') or t)}",
                       negrito=True)))

    corpo = "".join(p)
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<w:document xmlns:w="{_W}"><w:body>{corpo}'
            f'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
            f'<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" '
            f'w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>'
            f'</w:body></w:document>')


def gerar_docx(job):
    """Bytes do .docx da tarefa (job = TerminalContact.copia_job)."""
    if not job:
        raise ValueError("tarefa vazia")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _CONTENT_TYPES)
        z.writestr("_rels/.rels", _RELS)
        z.writestr("word/document.xml", _documento(job).encode("utf-8"))
    return buf.getvalue()


def gerar_txt(job):
    """Mesmo conteudo do .docx em texto puro (UTF-8)."""
    if not job:
        raise ValueError("tarefa vazia")
    r = resumir(job)
    status = {"done": "concluida", "error": "com erro", "running": "rodando"}.get(
        job.get("status"), str(job.get("status") or "?"))
    L = []
    def h(t):
        L.extend(["", t.upper(), "=" * len(t)])
    L.append(f"agents0.7 - relatorio da tarefa {job.get('id', '?')}")
    L.append("#" * 60)
    L.append(f"Gerado em: {_hora(time.time())}")
    L.append(f"Criada em: {_hora(job.get('criado'))}")
    L.append(f"Modelo / esforco: {job.get('model', '?')} / {job.get('effort', '?')}")
    L.append(f"Status: {status}")
    h("Pedido")
    L.append(_limpar(job.get("prompt") or ""))
    h("Cadeia")
    L.append(" -> ".join(r["cadeia"]) or "(vazia)")
    h("Resposta final")
    L.append(_limpar(job.get("resposta") or "(sem resposta)"))
    h("Conversa entre os agentes (FIPA-ACL)")
    if not r["conversa"]:
        L.append("(nenhuma mensagem)")
    for i, m in enumerate(r["conversa"], 1):
        L.append(f"{i}. [{_hora(m.get('t'))}] {m.get('de', '?')} -> {m.get('para', '?')} "
                 f"({m.get('performativa', '?')})")
        L.extend("   " + linha for linha in _limpar(m.get("conteudo") or "(vazio)").split("\n"))
    h("O que cada agente fez")
    if not r["ultima"]:
        L.append("(nenhum agente respondeu)")
    for ag, m in r["ultima"].items():
        L.append(f"- {ag} ({m.get('performativa', '?')} para {m.get('para', '?')}):")
        L.extend("    " + linha for linha in _limpar(m.get("conteudo") or "(vazio)").split("\n"))
    if r["cobrancas"]:
        L.append("Cobrancas de FIPA-ACL: " + ", ".join(f"{a}: {n}x" for a, n in r["cobrancas"].items()))
    h("Arquivos alterados")
    L.extend([f"- {c} ({ag})" for c, ag in r["arquivos"]] or ["nenhum"])
    h("Ferramentas por agente")
    L.extend([f"- {ag}: " + ", ".join(f"{f} x{n}" for f, n in sorted(por.items()))
              for ag, por in r["ferramentas"].items()] or ["nenhuma"])
    h("Custo e tokens")
    for ag, g in r["gastos"].items():
        L.append(f"- {ag}: US$ {g['custo']:.4f} | {_fmt_tokens(g)} | {g['rodadas']} rodada(s)")
    t = r["total"]
    L.append(f"TOTAL: US$ {float(job.get('custo') or t['custo']):.4f} | {_fmt_tokens(job.get('tokens') or t)}")
    return "\n".join(L) + "\n"
