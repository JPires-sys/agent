"""Escritorio em pixel art animado. Clique num personagem para zoom; clique/ESC volta."""
import math
import sys

try:
    import pygame
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pygame"])
    import pygame

LW, LH = 160, 120
SCALE = 4
W, H = LW * SCALE, LH * SCALE

# Paleta moderna: neutros quentes + acentos teal/coral/mostarda
PAREDE = (232, 226, 216)
PAREDE_SOMBRA = (214, 206, 194)
SALVIA = (205, 222, 214)
RODAPE = (245, 242, 236)
PISO_A, PISO_B = (186, 150, 112), (176, 140, 103)
MADEIRA = (205, 170, 125)
MADEIRA_ESC = (160, 125, 88)
METAL = (55, 60, 68)
TEAL = (64, 145, 140)
CORAL = (232, 120, 98)
MOSTARDA = (240, 195, 90)
OFFWHITE = (250, 248, 244)
CONTORNO = (40, 38, 44)


def escurecer(c, f=0.75):
    return tuple(int(v * f) for v in c)


def clarear(c, f=0.25):
    return tuple(int(v + (255 - v) * f) for v in c)


def sombra(s, x, y, w, h, alpha=60):
    """Sombra eliptica suave (duas camadas translucidas)."""
    for i, a in ((2, alpha // 2), (0, alpha)):
        sf = pygame.Surface((w + i * 2, h + i), pygame.SRCALPHA)
        pygame.draw.ellipse(sf, (30, 25, 35, a), sf.get_rect())
        s.blit(sf, (x - w // 2 - i, y - h // 2 - i // 2))


class Personagem:
    def __init__(self, x, y, cor, cabelo, modo, x2=None, pele=(236, 196, 160),
                 calca=(52, 58, 78), estilo="curto"):
        self.x, self.y = float(x), float(y)
        self.x0, self.x2 = x, x2
        self.cor, self.cabelo, self.modo = cor, cabelo, modo
        self.pele, self.calca, self.estilo = pele, calca, estilo
        self.dir = 1

    def update(self, t):
        if self.modo == "andar":
            self.x += 0.4 * self.dir
            if self.x > self.x2 or self.x < self.x0:
                self.dir *= -1

    def rect(self):
        return pygame.Rect(int(self.x) - 4, int(self.y) - 18, 9, 19)

    def centro(self):
        return self.x, self.y - 8

    def draw(self, s, t):
        x, y = int(self.x), int(self.y)
        dy = 0
        if self.modo == "balancar":
            dy = int(round(math.sin(t * 3)))
        elif self.modo == "andar":
            dy = -(int(t * 8) % 2)
        sombra(s, x + 1, y + 1, 10, 3)
        sapato = (35, 32, 38)
        # pernas e sapatos
        if self.modo == "andar":
            p = int(t * 8) % 2
            pygame.draw.rect(s, self.calca, (x - 2, y - 5, 2, 5 - p))
            pygame.draw.rect(s, self.calca, (x + 1, y - 5, 2, 4 + p))
            pygame.draw.rect(s, sapato, (x - 2, y - p, 3, 1))
            pygame.draw.rect(s, sapato, (x + 1, y, 3, 1))
        else:
            pygame.draw.rect(s, self.calca, (x - 2, y - 5, 5, 5))
            s.set_at((x, y - 3), escurecer(self.calca))
            pygame.draw.rect(s, sapato, (x - 2, y, 2, 1))
            pygame.draw.rect(s, sapato, (x + 1, y, 2, 1))
        # tronco: camisa com luz/sombra, gola e cinto
        ty = y - 12 + dy
        pygame.draw.rect(s, self.cor, (x - 3, ty, 7, 7))
        pygame.draw.rect(s, escurecer(self.cor), (x + 2, ty, 2, 7))
        pygame.draw.rect(s, clarear(self.cor), (x - 3, ty, 1, 6))
        s.set_at((x - 1, ty), OFFWHITE)
        s.set_at((x, ty), OFFWHITE)
        pygame.draw.rect(s, (40, 40, 48), (x - 3, ty + 6, 7, 1))
        # bracos
        if self.modo == "digitar":
            off = int(t * 10) % 2
            pygame.draw.rect(s, escurecer(self.cor, 0.85), (x - 4, ty + 1, 1, 4))
            pygame.draw.rect(s, escurecer(self.cor, 0.85), (x + 4, ty + 1, 1, 4))
            s.set_at((x - 4, ty + 4 + off), self.pele)
            s.set_at((x + 4, ty + 5 - off), self.pele)
        else:
            sw = int(round(math.sin(t * 8))) if self.modo == "andar" else 0
            pygame.draw.rect(s, escurecer(self.cor, 0.85), (x - 4, ty + 1, 1, 4 + sw))
            pygame.draw.rect(s, escurecer(self.cor, 0.85), (x + 4, ty + 1, 1, 4 - sw))
            s.set_at((x - 4, ty + 5 + sw), self.pele)
            s.set_at((x + 4, ty + 5 - sw), self.pele)
        # pescoco e cabeca
        hy = y - 17 + dy
        s.set_at((x, ty - 1), escurecer(self.pele, 0.9))
        pygame.draw.rect(s, self.pele, (x - 2, hy, 6, 5))
        s.set_at((x - 2, hy + 4), escurecer(self.pele, 0.9))
        # cabelo (curto / longo / coque) com reflexo
        c = self.cabelo
        pygame.draw.rect(s, c, (x - 2, hy - 1, 6, 2))
        if self.estilo == "longo":
            pygame.draw.rect(s, c, (x - 3, hy, 1, 6))
            pygame.draw.rect(s, c, (x + 4, hy, 1, 6))
        elif self.estilo == "coque":
            pygame.draw.rect(s, c, (x, hy - 3, 3, 2))
        else:
            s.set_at((x - 3, hy), c)
            s.set_at((x + 4, hy), c)
        s.set_at((x - 1, hy - 1), clarear(c, 0.3))
        # olhos e bochecha
        olho = x + (1 if self.dir > 0 else -1)
        if int(t * 2) % 6 != 0:  # piscar
            s.set_at((olho, hy + 2), (30, 28, 34))
            s.set_at((olho + 2, hy + 2), (30, 28, 34))
        s.set_at((olho + (3 if self.dir > 0 else -1), hy + 3), (240, 160, 150))


def desenhar_cenario(s, t):
    # parede com meia-parede salvia e rodape claro
    s.fill(PAREDE)
    pygame.draw.rect(s, PAREDE_SOMBRA, (0, 0, LW, 3))
    pygame.draw.rect(s, SALVIA, (0, 40, LW, 15))
    pygame.draw.rect(s, escurecer(SALVIA, 0.93), (0, 40, LW, 1))
    pygame.draw.rect(s, RODAPE, (0, 55, LW, 3))
    pygame.draw.rect(s, PAREDE_SOMBRA, (0, 57, LW, 1))
    # piso de tacos de madeira desencontrados
    for j in range(58, LH, 5):
        off = 0 if (j // 5) % 2 else 8
        for i in range(-off, LW, 16):
            c = PISO_A if ((i + off) // 16) % 2 else PISO_B
            pygame.draw.rect(s, c, (i, j, 16, 5))
            pygame.draw.line(s, escurecer(c, 0.9), (i, j), (i, j + 4))
        pygame.draw.line(s, escurecer(PISO_B, 0.92), (0, j), (LW, j))
    # tapete
    pygame.draw.rect(s, (90, 100, 120), (30, 96, 100, 18), border_radius=2)
    pygame.draw.rect(s, (110, 122, 145), (33, 99, 94, 12), border_radius=1)
    pygame.draw.line(s, CORAL, (36, 105), (124, 105))
    # janela ampla: moldura fina, ceu em degrade, skyline
    pygame.draw.rect(s, METAL, (58, 8, 44, 30))
    for k in range(26):
        a = k / 26
        pygame.draw.line(s, (int(150 + 80 * a), int(195 + 35 * a), int(235 + 10 * a)),
                         (60, 10 + k), (99, 10 + k))
    pygame.draw.rect(s, (200, 215, 225), (64, 28, 6, 8))
    pygame.draw.rect(s, (185, 200, 215), (72, 24, 5, 12))
    pygame.draw.rect(s, (205, 218, 228), (86, 26, 8, 10))
    s.set_clip(pygame.Rect(60, 10, 40, 26))
    nx = 60 + int(t * 3) % 48 - 6
    pygame.draw.ellipse(s, (252, 252, 255), (nx, 14, 10, 4))
    pygame.draw.ellipse(s, (252, 252, 255), (nx + 3, 12, 6, 4))
    s.set_clip(None)
    pygame.draw.rect(s, METAL, (79, 10, 1, 26))
    pygame.draw.rect(s, RODAPE, (56, 38, 48, 2))  # peitoril
    # quadro abstrato
    sombra(s, 24, 32, 22, 3, 40)
    pygame.draw.rect(s, OFFWHITE, (13, 12, 22, 18))
    pygame.draw.rect(s, CONTORNO, (13, 12, 22, 18), 1)
    pygame.draw.circle(s, CORAL, (20, 20), 4)
    pygame.draw.rect(s, TEAL, (23, 17, 8, 9))
    pygame.draw.rect(s, MOSTARDA, (17, 24, 6, 3))
    # prateleira flutuante com livros e suculenta
    pygame.draw.rect(s, MADEIRA, (118, 26, 30, 2))
    pygame.draw.rect(s, MADEIRA_ESC, (118, 28, 30, 1))
    pygame.draw.rect(s, TEAL, (121, 19, 3, 7))
    pygame.draw.rect(s, CORAL, (124, 20, 2, 6))
    pygame.draw.rect(s, MOSTARDA, (126, 18, 3, 8))
    pygame.draw.rect(s, OFFWHITE, (136, 22, 5, 4))
    pygame.draw.rect(s, (80, 150, 90), (137, 19, 3, 3))
    # luminaria pendente com halo
    pygame.draw.line(s, METAL, (40, 0), (40, 6))
    pygame.draw.polygon(s, CONTORNO, [(36, 9), (44, 9), (42, 6), (38, 6)])
    halo = pygame.Surface((24, 14), pygame.SRCALPHA)
    pygame.draw.ellipse(halo, (255, 235, 180, 45), halo.get_rect())
    s.blit(halo, (28, 8))
    # planta em vaso de ceramica
    sombra(s, 145, 71, 12, 3)
    pygame.draw.rect(s, OFFWHITE, (140, 62, 10, 9), border_radius=2)
    pygame.draw.rect(s, (220, 214, 204), (147, 62, 3, 9))
    for k, (dx, dy) in enumerate([(-4, -6), (0, -11), (4, -7), (-2, -14), (5, -12), (1, -8)]):
        sw = int(round(math.sin(t * 2 + k)))
        verde = (60, 140, 90) if k % 2 else (80, 165, 105)
        pygame.draw.ellipse(s, verde, (143 + dx + sw, 62 + dy, 4, 7))


def desenhar_mesa(s, x, y, t, fase):
    sombra(s, x + 13, y + 15, 30, 4)
    # tampo de madeira clara com reflexo e borda
    pygame.draw.rect(s, MADEIRA, (x, y, 26, 3))
    pygame.draw.line(s, clarear(MADEIRA, 0.3), (x, y), (x + 25, y))
    pygame.draw.rect(s, MADEIRA_ESC, (x, y + 3, 26, 1))
    # pes metalicos finos
    pygame.draw.rect(s, METAL, (x + 2, y + 4, 1, 10))
    pygame.draw.rect(s, METAL, (x + 23, y + 4, 1, 10))
    pygame.draw.line(s, METAL, (x + 2, y + 13), (x + 23, y + 13))
    # monitor widescreen de borda fina
    pygame.draw.rect(s, CONTORNO, (x + 6, y - 11, 14, 9), border_radius=1)
    pygame.draw.rect(s, METAL, (x + 12, y - 2, 2, 2))
    pygame.draw.rect(s, METAL, (x + 10, y - 1, 6, 1))
    on = (int(t * 3 + fase) % 4) != 0
    pygame.draw.rect(s, (34, 40, 56) if on else (20, 22, 30), (x + 7, y - 10, 12, 7))
    if on:  # "codigo" com syntax highlight
        cores = (TEAL, CORAL, MOSTARDA)
        for li in range(3):
            w = 2 + (int(t * 5 + li + fase) % 8)
            pygame.draw.rect(s, cores[li], (x + 8, y - 9 + li * 2, min(w, 10), 1))
    # teclado e caneca com vapor
    pygame.draw.rect(s, (220, 220, 225), (x + 8, y - 1, 8, 1))
    pygame.draw.rect(s, OFFWHITE, (x + 21, y - 3, 3, 3))
    s.set_at((x + 24, y - 2), OFFWHITE)
    vy = int(t * 4 + fase) % 3
    s.set_at((x + 22, y - 5 - vy), (235, 235, 240))


def main():
    pygame.init()
    tela = pygame.display.set_mode((W, H))
    pygame.display.set_caption("Escritorio Pixel - clique num personagem")
    s = pygame.Surface((LW, LH))
    clock = pygame.time.Clock()
    mesas = [(15, 78), (60, 78), (105, 78)]
    pessoas = [
        Personagem(28, 84, CORAL, (70, 42, 30), "digitar", estilo="longo"),
        Personagem(73, 84, TEAL, (30, 28, 32), "balancar", pele=(190, 140, 105)),
        Personagem(118, 84, MOSTARDA, (140, 85, 45), "digitar",
                   pele=(150, 105, 75), estilo="coque"),
        Personagem(20, 112, (120, 110, 170), (225, 195, 120), "andar", x2=135,
                   calca=(70, 64, 60)),
    ]
    alvo = None
    zoom, cx, cy = 1.0, LW / 2, LH / 2
    t = 0.0
    while True:
        dt = clock.tick(30) / 1000
        t += dt
        for e in pygame.event.get():
            if e.type == pygame.QUIT:
                pygame.quit(); return
            if e.type == pygame.KEYDOWN and e.key == pygame.K_ESCAPE:
                alvo = None
            if e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
                if alvo is not None:
                    alvo = None
                else:
                    # converte clique da tela para coordenada logica
                    mx, my = e.pos
                    vw, vh = LW / zoom, LH / zoom
                    lx = cx - vw / 2 + mx / W * vw
                    ly = cy - vh / 2 + my / H * vh
                    for p in pessoas:
                        if p.rect().inflate(4, 4).collidepoint(lx, ly):
                            alvo = p
                            break
        for p in pessoas:
            p.update(t)
        # camera suave
        tz, tx, ty = (3.0, *alvo.centro()) if alvo else (1.0, LW / 2, LH / 2)
        k = min(1, dt * 5)
        zoom += (tz - zoom) * k
        cx += (tx - cx) * k
        cy += (ty - cy) * k
        vw, vh = LW / zoom, LH / zoom
        cx = max(vw / 2, min(LW - vw / 2, cx))
        cy = max(vh / 2, min(LH - vh / 2, cy))

        desenhar_cenario(s, t)
        for i, (mx, my) in enumerate(mesas):
            desenhar_mesa(s, mx, my, t, i * 1.3)
        for p in sorted(pessoas, key=lambda p: p.y):
            p.draw(s, t)

        r = pygame.Rect(int(cx - vw / 2), int(cy - vh / 2), max(1, int(vw)), max(1, int(vh)))
        r.clamp_ip(s.get_rect())
        vista = s.subsurface(r)
        tela.blit(pygame.transform.scale(vista, (W, H)), (0, 0))
        pygame.display.flip()


if __name__ == "__main__":
    main()
