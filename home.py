"""Agent Branch - app desktop (tkinter) com escritorio pixelado estilo The Office.

Uso:
    python home.py
    (ou dist/AgentBranch.exe, colocado na pasta que contem .claude/agents e .env)

Le .claude/agents e .env a partir da pasta do exe (ou do script) / cwd.
O Claude roda em thread (terminalContact.TerminalContact) para nao travar a UI.
"""

import os
import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import ttk

if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys.executable).resolve().parent
else:
    BASE_DIR = Path(__file__).resolve().parent


def _resolver_base():
    # prefere a pasta do exe/script; se nao tiver agentes, tenta o cwd
    for d in (BASE_DIR, Path.cwd()):
        if (d / ".claude" / "agents").is_dir():
            return d
    return BASE_DIR


BASE_DIR = _resolver_base()
os.chdir(BASE_DIR)
try:
    import dotenv
    dotenv.load_dotenv(BASE_DIR / ".env")
except Exception:
    pass

from terminalContact import ERRO_PREFIX, TerminalContact  # noqa: E402

AGENTS_DIR = BASE_DIR / ".claude" / "agents"
MODELS = ["claude-opus-5-5", "claude-sonnet-4-5", "claude-haiku-4-5", "fable"]
EFFORTS = ["low", "medium", "high", "xhigh", "max"]

# paleta pixel
BG = "#1b1b2f"
FLOOR_A, FLOOR_B = "#c9b48a", "#bfa97d"
WALL = "#7d8fa6"
DESK, DESK_D = "#8b5a2b", "#5e3b1a"
CRT_BG, CRT_FG = "#0b1a0b", "#39ff14"
PANEL, PANEL_D = "#2e2e4a", "#22223a"
TXT = "#f4f1de"
ACCENT = "#e07a5f"
SHIRTS = ["#3d5a80", "#81b29a", "#e07a5f", "#f2cc8f", "#9b5de5", "#00bbf9"]
FONT = ("Courier New", 10, "bold")
PX = 4  # tamanho do "pixel"


def listar_agentes():
    if not AGENTS_DIR.is_dir():
        return []
    return sorted(p.stem for p in AGENTS_DIR.glob("*.md"))


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Dunder Mifflin - Agent Branch")
        self.configure(bg=BG)
        self.geometry("1100x720")
        self.minsize(900, 600)
        self.contato = TerminalContact()
        self.agentes = listar_agentes() or ["(nenhum agente)"]
        self.ocupados = set()
        self.jobs = []
        self.frame_anim = 0
        self._tw_job = None
        self._build()
        self.after(120, self._animar)

    # ---------------- layout ----------------
    def _build(self):
        top = tk.Label(self, text="DUNDER MIFFLIN  ::  AGENT BRANCH", bg=BG, fg=ACCENT,
                       font=("Courier New", 16, "bold"))
        top.pack(fill="x", pady=(8, 4))

        corpo = tk.Frame(self, bg=BG)
        corpo.pack(fill="both", expand=True, padx=8, pady=4)

        esquerda = tk.Frame(corpo, bg=BG)
        esquerda.pack(side="left", fill="both", expand=True)
        self.canvas = tk.Canvas(esquerda, bg=FLOOR_A, highlightthickness=4,
                                highlightbackground=PANEL_D, height=300)
        self.canvas.pack(fill="both", expand=True)
        self.canvas.bind("<Configure>", lambda e: self._desenhar())
        self.canvas.bind("<Button-1>", self._clique_canvas)

        # monitor CRT
        crt = tk.Frame(esquerda, bg="#444", bd=6, relief="ridge")
        crt.pack(fill="both", expand=True, pady=(8, 0))
        self.crt = tk.Text(crt, bg=CRT_BG, fg=CRT_FG, insertbackground=CRT_FG,
                           font=("Consolas", 10), wrap="word", height=12, bd=0)
        sb = tk.Scrollbar(crt, command=self.crt.yview)
        self.crt.configure(yscrollcommand=sb.set, state="disabled")
        sb.pack(side="right", fill="y")
        self.crt.pack(fill="both", expand=True)
        self._crt_set("> SISTEMA PRONTO. Escolha um agente e envie uma tarefa.\n")

        direita = tk.Frame(corpo, bg=PANEL, width=330, bd=4, relief="ridge")
        direita.pack(side="right", fill="y", padx=(8, 0))
        direita.pack_propagate(False)

        def rot(t):
            tk.Label(direita, text=t, bg=PANEL, fg=TXT, font=FONT, anchor="w").pack(
                fill="x", padx=8, pady=(8, 2))

        tk.Label(direita, text="NOVA TAREFA", bg=PANEL, fg=ACCENT,
                 font=("Courier New", 13, "bold")).pack(pady=(8, 0))
        rot("PROMPT")
        self.prompt = tk.Text(direita, height=7, bg=PANEL_D, fg=TXT, insertbackground=TXT,
                              font=("Consolas", 10), wrap="word", bd=2, relief="sunken")
        self.prompt.pack(fill="x", padx=8)
        self.prompt.bind("<Control-Return>", lambda e: (self.enviar(), "break")[1])

        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TCombobox", fieldbackground=PANEL_D, background=PANEL,
                        foreground=TXT, arrowcolor=TXT)
        self.var_model = tk.StringVar(value=MODELS[0])
        self.var_effort = tk.StringVar(value="medium")
        self.var_agent = tk.StringVar(value=self.agentes[0])
        for titulo, var, vals in (("MODELO", self.var_model, MODELS),
                                  ("ESFORCO", self.var_effort, EFFORTS),
                                  ("AGENTE", self.var_agent, self.agentes)):
            rot(titulo)
            cb = ttk.Combobox(direita, textvariable=var, values=vals, state="readonly",
                              font=FONT)
            cb.pack(fill="x", padx=8)
        self.var_agent.trace_add("write", lambda *a: self._desenhar())

        self.btn = tk.Button(direita, text="ENVIAR  (Ctrl+Enter)", command=self.enviar,
                             bg=ACCENT, fg="black", activebackground="#f4a261",
                             font=("Courier New", 11, "bold"), bd=4, relief="raised")
        self.btn.pack(fill="x", padx=8, pady=10)

        rot("HISTORICO")
        hist = tk.Frame(direita, bg=PANEL)
        hist.pack(fill="both", expand=True, padx=8, pady=(0, 8))
        self.lista = tk.Listbox(hist, bg=PANEL_D, fg=TXT, font=("Consolas", 9),
                                selectbackground=ACCENT, bd=2, activestyle="none")
        sbl = tk.Scrollbar(hist, command=self.lista.yview)
        self.lista.configure(yscrollcommand=sbl.set)
        sbl.pack(side="right", fill="y")
        self.lista.pack(fill="both", expand=True)
        self.lista.bind("<<ListboxSelect>>", self._ver_job)

    # ---------------- desenho pixelado ----------------
    def _px(self, x, y, w, h, cor, tag="cena"):
        self.canvas.create_rectangle(x, y, x + w * PX, y + h * PX, fill=cor, width=0, tags=tag)

    def _desenhar(self):
        c = self.canvas
        c.delete("all")
        W, H = c.winfo_width(), c.winfo_height()
        tile = 32
        for y in range(0, H, tile):
            for x in range(0, W, tile):
                cor = FLOOR_A if (x // tile + y // tile) % 2 == 0 else FLOOR_B
                c.create_rectangle(x, y, x + tile, y + tile, fill=cor, width=0)
        c.create_rectangle(0, 0, W, 50, fill=WALL, width=0)
        c.create_rectangle(0, 50, W, 56, fill="#5b6b80", width=0)
        c.create_text(W // 2, 25, text="DUNDER MIFFLIN PAPER COMPANY", fill="white",
                      font=("Courier New", 12, "bold"))
        # janelas
        for wx in range(20, W - 60, 180):
            c.create_rectangle(wx, 8, wx + 50, 42, fill="#a8dadc", outline="#3d405b", width=3)

        self.mesas = {}
        n = len(self.agentes)
        cols = max(1, min(n, max(1, (W - 20) // 200)))
        for i, nome in enumerate(self.agentes):
            col, lin = i % cols, i // cols
            cx = int((col + 0.5) * W / cols)
            cy = 120 + lin * 150
            self._mesa(cx, cy, nome, SHIRTS[i % len(SHIRTS)])

    def _mesa(self, cx, cy, nome, camisa):
        c = self.canvas
        sel = nome == self.var_agent.get()
        ocupado = nome in self.ocupados
        bob = (self.frame_anim % 2) * PX if ocupado else 0
        x0 = cx - 15 * PX
        # personagem (atras da mesa)
        px0 = cx - 4 * PX
        py0 = cy - 14 * PX - bob
        self._px(px0 + PX, py0, 6, 2, "#3b2416")          # cabelo
        self._px(px0 + PX, py0 + 2 * PX, 6, 5, "#f1c27d")  # rosto
        self._px(px0 + 2 * PX, py0 + 4 * PX, 1, 1, "black")
        self._px(px0 + 5 * PX, py0 + 4 * PX, 1, 1, "black")
        self._px(px0, py0 + 7 * PX, 8, 7, camisa)          # corpo
        self._px(px0 + 3 * PX + 2, py0 + 7 * PX, 1, 5, "#222")  # gravata
        # mesa
        self._px(x0, cy, 30, 3, DESK)
        self._px(x0, cy + 3 * PX, 30, 6, DESK_D)
        # monitor
        mx = x0 + 18 * PX
        self._px(mx, cy - 8 * PX, 9, 7, "#333")
        tela = CRT_FG if (ocupado and self.frame_anim % 2) else ("#1d4d1d" if ocupado else "#0b1a0b")
        self._px(mx + PX, cy - 7 * PX, 7, 5, tela)
        self._px(mx + 3 * PX, cy - PX, 3, 1, "#333")
        # caneca
        self._px(x0 + 3 * PX, cy - 3 * PX, 3, 3, "white")
        borda = ACCENT if sel else PANEL_D
        tw = len(nome) * 8 + 16
        c.create_rectangle(cx - tw // 2, cy + 40, cx + tw // 2, cy + 58, fill=borda,
                           outline="black", width=2, tags=("cena", f"ag:{nome}"))
        c.create_text(cx, cy + 49, text=nome + (" ..." if ocupado else ""),
                      fill="white", font=FONT)
        c.create_rectangle(x0 - 6, cy - 60, x0 + 30 * PX + 6, cy + 60, outline="",
                           fill="", tags=f"ag:{nome}")

    def _clique_canvas(self, ev):
        for item in self.canvas.find_overlapping(ev.x, ev.y, ev.x, ev.y):
            for t in self.canvas.gettags(item):
                if t.startswith("ag:") and t[3:] in self.agentes:
                    self.var_agent.set(t[3:])
                    return

    def _animar(self):
        self.frame_anim += 1
        if self.ocupados:
            self._desenhar()
        self.after(400, self._animar)

    # ---------------- CRT ----------------
    def _crt_set(self, texto):
        self.crt.configure(state="normal")
        self.crt.delete("1.0", "end")
        self.crt.insert("end", texto)
        self.crt.configure(state="disabled")

    def _typewriter(self, texto, i=0):
        if i == 0:
            if self._tw_job:
                self.after_cancel(self._tw_job)
            self._crt_set("")
        passo = 6
        self.crt.configure(state="normal")
        self.crt.insert("end", texto[i:i + passo])
        self.crt.see("end")
        self.crt.configure(state="disabled")
        if i + passo < len(texto):
            self._tw_job = self.after(12, self._typewriter, texto, i + passo)
        else:
            self._tw_job = None

    # ---------------- envio ----------------
    def enviar(self):
        prompt = self.prompt.get("1.0", "end").strip()
        agent = self.var_agent.get()
        if not prompt:
            self._crt_set("> [ERRO] o prompt esta vazio.\n")
            return
        if agent not in listar_agentes():
            self._crt_set(f"> [ERRO] agente invalido: {agent}\n")
            return
        job = {"prompt": prompt, "agent": agent, "model": self.var_model.get(),
               "effort": self.var_effort.get(), "status": "running", "resposta": None,
               "created": time.time()}
        self.jobs.append(job)
        self.ocupados.add(agent)
        self.prompt.delete("1.0", "end")
        self._atualizar_lista()
        self._crt_set(f"> {agent} ({job['model']}/{job['effort']}) trabalhando...\n> {prompt}\n")
        self._desenhar()
        threading.Thread(target=self._rodar, args=(job,), daemon=True).start()

    def _rodar(self, job):
        try:
            resp = self.contato.enviar(prompt=job["prompt"], effort=job["effort"],
                                       model=job["model"], agent=job["agent"])
            if resp is None:
                status, resp = "error", f"{ERRO_PREFIX} o Claude nao retornou resposta."
            elif resp.startswith(ERRO_PREFIX):
                status = "error"
            else:
                status = "done"
        except Exception as erro:
            status, resp = "error", f"{ERRO_PREFIX} {erro}"
        self.after(0, self._concluir, job, status, resp)

    def _concluir(self, job, status, resp):
        job["status"], job["resposta"] = status, resp
        if not any(j["status"] == "running" and j["agent"] == job["agent"] for j in self.jobs):
            self.ocupados.discard(job["agent"])
        self._atualizar_lista()
        self._desenhar()
        self._typewriter(f"> [{job['agent']}] {status.upper()}\n\n{resp}")

    def _atualizar_lista(self):
        self.lista.delete(0, "end")
        icone = {"running": "...", "done": "OK ", "error": "ERR"}
        for j in reversed(self.jobs):
            hora = time.strftime("%H:%M", time.localtime(j["created"]))
            self.lista.insert("end", f"[{icone[j['status']]}] {hora} {j['agent']}: {j['prompt'][:30]}")

    def _ver_job(self, _ev):
        sel = self.lista.curselection()
        if not sel:
            return
        j = list(reversed(self.jobs))[sel[0]]
        if j["status"] == "running":
            self._crt_set(f"> {j['agent']} ainda trabalhando...\n> {j['prompt']}\n")
        else:
            self._typewriter(f"> {j['prompt']}\n\n{j['resposta']}")


def main():
    App().mainloop()


if __name__ == "__main__":
    main()
