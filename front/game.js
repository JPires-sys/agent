/* Agent Branch - mundo em pixel art.
 * Mundo 60x40 tiles (16px). Renderiza num buffer de baixa resolucao e amplia
 * sem suavizacao. Camera com arrasto do mouse, zoom na roda e minimapa.
 * Os agentes andam pelo escritorio; quando um vira "ao vivo" ele corre ate o
 * computador dele e comeca a trabalhar.
 */
'use strict';
window.Game = (() => {
  const T = 16, MW = 60, MH = 40, WW = MW * T, WH = MH * T;
  let X = null;               // contexto 2d atual
  let NOW = 0;                // tempo em segundos

  // ------------------------------------------------------------------ util
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  function hash(x, y, s) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1013904223)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function R(x, y, w, h, c) { X.fillStyle = c; X.fillRect(Math.round(x), Math.round(y), w, h); }
  const _sc = new Map();
  function shade(hex, f) {
    const k = hex + '|' + f;
    let v = _sc.get(k);
    if (v) return v;
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    v = '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    _sc.set(k, v);
    return v;
  }
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  function ellipse(cx, cy, rx, ry, c) {
    for (let dy = -ry; dy <= ry; dy++) {
      const w = Math.round(rx * Math.sqrt(1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5))));
      R(cx - w, cy + dy, w * 2 + 1, 1, c);
    }
  }

  // ------------------------------------------------------------ fonte pixel
  const FONT = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
    E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
    I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
    M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
    Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
    Y: '101101010010010', Z: '111001010100111',
    0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
    4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010',
    8: '111101111101111', 9: '111101111001110',
    '.': '000000000000010', ',': '000000000010100', ':': '000010000010000', '!': '010010010000010',
    '?': '110001010000010', '-': '000000111000000', '_': '000000000000111', '/': '001001010100100',
    '(': '001010010010001', ')': '100010010010100', '+': '000010111010000', '=': '000111000111000',
    '>': '100010001010100', '<': '001010100010001', "'": '010010000000000', '"': '101101000000000',
    '#': '101111101111101', '%': '101001010100101', '*': '000101010101000', '[': '011010010010011',
    ']': '110010010010110', '@': '010101111100011', '&': '010101010101011', ' ': '000000000000000',
    '|': '010010010010010', ';': '000010000010100', '$': '011110010011110', '~': '000011110000000',
  };
  const normTxt = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const textW = (s) => Math.max(0, normTxt(s).length * 4 - 1);
  const _tc = new Map();
  function textCanvas(s, color) {
    s = normTxt(s);
    const k = s + '|' + color;
    let c = _tc.get(k);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = Math.max(1, s.length * 4 - 1); c.height = 5;
    const g = c.getContext('2d');
    g.fillStyle = color;
    for (let i = 0; i < s.length; i++) {
      const gl = FONT[s[i]] || FONT['?'];
      for (let b = 0; b < 15; b++) if (gl[b] === '1') g.fillRect(i * 4 + (b % 3), (b / 3) | 0, 1, 1);
    }
    if (_tc.size > 600) _tc.clear();
    _tc.set(k, c);
    return c;
  }
  function text(s, x, y, color) { X.drawImage(textCanvas(s, color), Math.round(x), Math.round(y)); }

  // icones 5x5 / 7x5 para baloes
  const ICONS = {
    heart: ['.r.r.', 'rrrrr', 'rrrrr', '.rrr.', '..r..'],
    note: ['..kkk', '..k.k', '..k.k', 'kkk.k', 'kk...'],
    coffee: ['.g.g.', 'g.g..', 'ccccc', 'cccc.', '.ccc.'],
    check: ['....G', '...G.', 'G.G..', '.G...', '.....'],
    cross: ['r...r', '.r.r.', '..r..', '.r.r.', 'r...r'],
    mail: ['yyyyyyy', 'yk...ky', 'y.k.k.y', 'y..k..y', 'yyyyyyy'],
    bulb: ['.yyy.', 'yyyyy', 'yyyyy', '.yyy.', '.kkk.'],
    bang: ['..r..', '..r..', '..r..', '.....', '..r..'],
    game: ['.....', 'kkkkk', 'k.k.k', 'kkkkk', '.....'],
    book: ['bbbb.', 'bwwb.', 'bwwb.', 'bbbb.', '.....'],
  };
  const ICOL = { r: '#e5484d', k: '#2a2440', g: '#9aa0b5', c: '#7a4a2a', G: '#2fb36b', y: '#f2b134', b: '#4a6fd8', w: '#ffffff' };
  function icon(name, x, y) {
    const rows = ICONS[name];
    if (!rows) return;
    for (let j = 0; j < rows.length; j++)
      for (let i = 0; i < rows[j].length; i++) { const ch = rows[j][i]; if (ch !== '.') R(x + i, y + j, 1, 1, ICOL[ch]); }
  }

  // ------------------------------------------------------------- paleta
  const CAP = '#2b2a3d', CAP_HI = '#46445f', CAP_LO = '#1d1c2b', BASEBOARD = '#4a3226';
  const ROOMS = {
    lobby: { x0: 1, y0: 2, x1: 13, y1: 21, floor: 'marble', wall: '#dccdb4', name: 'RECEPCAO' },
    office: { x0: 15, y0: 2, x1: 43, y1: 21, floor: 'carpet', wall: '#c4d0de', name: 'ESCRITORIO' },
    meeting: { x0: 45, y0: 2, x1: 58, y1: 11, floor: 'wood', wall: '#cfe2d4', name: 'REUNIAO' },
    server: { x0: 45, y0: 13, x1: 58, y1: 21, floor: 'server', wall: '#4a5568', name: 'SERVIDORES' },
    kitchen: { x0: 1, y0: 23, x1: 19, y1: 38, floor: 'tile', wall: '#f1dcc0', name: 'COPA' },
    lounge: { x0: 21, y0: 23, x1: 40, y1: 38, floor: 'wood2', wall: '#d9c9ea', name: 'LOUNGE' },
    garden: { x0: 42, y0: 23, x1: 58, y1: 38, floor: 'grass', wall: '#9a5b45', name: 'JARDIM' },
  };

  // ------------------------------------------------------------ mapa
  const grid = (v) => Array.from({ length: MH }, () => Array(MW).fill(v));
  const floor = grid(null), wall = grid(0), solid = grid(false), roomOf = grid(null), door = grid(false);
  const inside = (tx, ty) => tx >= 0 && ty >= 0 && tx < MW && ty < MH;
  for (const [k, r] of Object.entries(ROOMS))
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { floor[y][x] = r.floor; roomOf[y][x] = k; }
  function setWall(x, y, kind) { if (inside(x, y)) { wall[y][x] = kind; solid[y][x] = true; } }
  function hw(y, x0, x1, kind) { for (let x = x0; x <= x1; x++) setWall(x, y, kind); }
  function vw(x, y0, y1, kind) { for (let y = y0; y <= y1; y++) setWall(x, y, kind); }
  function openDoor(x, y) { wall[y][x] = 0; solid[y][x] = false; door[y][x] = true; }
  hw(0, 0, MW - 1, 'top'); hw(1, 0, MW - 1, 'top');
  vw(0, 2, 39, 'v'); vw(59, 2, 21, 'v'); vw(59, 22, 39, 'hedge');
  hw(39, 0, 41, 'v'); hw(39, 42, 59, 'hedge');
  vw(14, 2, 21, 'v'); vw(44, 2, 11, 'glass'); vw(44, 12, 21, 'v');
  hw(12, 45, 58, 'h'); hw(22, 0, 59, 'h');
  vw(20, 23, 38, 'v'); vw(41, 23, 38, 'glass');
  [[14, 9], [14, 10], [44, 6], [44, 7], [44, 17], [44, 18], [6, 22], [7, 22], [28, 22], [29, 22], [30, 22], [31, 22],
    [20, 30], [20, 31], [41, 30], [41, 31]].forEach(([x, y]) => openDoor(x, y));
  // piso das portas/vidros = piso vizinho
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (floor[y][x]) continue;
    const viz = [[x - 1, y], [x, y - 1], [x + 1, y], [x, y + 1]].find(([a, b]) => inside(a, b) && floor[b][a] && !wall[b][a]);
    if (viz) { floor[y][x] = floor[viz[1]][viz[0]]; roomOf[y][x] = roomOf[viz[1]][viz[0]]; }
  }
  const walkable = (tx, ty) => inside(tx, ty) && !solid[ty][tx];
  function block(tx, ty, w = 1, h = 1) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (inside(tx + i, ty + j)) solid[ty + j][tx + i] = true; }

  // ---------------------------------------------------------- entidades
  const ents = [], pois = [], desks = [], flats = [], wallDyn = [], lights = [];
  function ent(x0, y0, w, h, base, draw) { const e = { x0, y0, x1: x0 + w, y1: y0 + h, base, draw }; ents.push(e); return e; }
  function addPoi(p) {
    p.busy = null; p.w = p.w || 1; p.dur = p.dur || [5, 10];
    p.fx = p.fx != null ? p.fx : p.tx * T + 8; p.fy = p.fy != null ? p.fy : p.ty * T + 11;
    p.at = p.at || [p.tx, p.ty];
    pois.push(p);
    return p;
  }
  const job = { list: [] };                      // tarefas para o kanban
  const fx = { brewUntil: 0, coolerUntil: 0, printUntil: 0, vendUntil: 0, pingBall: 0 };

  // -------------------------------------------------------- moveis: desenho
  function shadowRect(x, y, w) { R(x, y, w, 1, 'rgba(20,12,30,0.22)'); R(x + 1, y + 1, w - 2, 1, 'rgba(20,12,30,0.12)'); }
  function plant(tx, ty, kind) {
    block(tx, ty);
    const x = tx * T, y = ty * T, k = kind || ['ficus', 'snake', 'bush', 'monstera'][(hash(tx, ty, 2) * 4) | 0];
    const pot = ['#d9744a', '#e9e4d8', '#5a6b8a', '#3d3b4f'][(hash(tx, ty, 4) * 4) | 0];
    ent(x - 4, y - 26, 24, 44, y + 15, (t) => {
      const sw = Math.round(Math.sin(t * 1.3 + tx) * 0.8);
      shadowRect(x + 2, y + 15, 12);
      R(x + 3, y + 8, 10, 7, pot); R(x + 2, y + 7, 12, 2, shade(pot, 0.15)); R(x + 11, y + 9, 2, 6, shade(pot, -0.2));
      R(x + 4, y + 7, 8, 1, '#4a3226');
      const G1 = '#3e9e5f', G2 = '#2c7a48', G3 = '#5cc27a';
      if (k === 'snake') {
        for (let i = 0; i < 5; i++) { const lx = x + 4 + i * 2, h = 10 + ((i * 7) % 5) * 2; R(lx + (i % 2 ? sw : 0), y + 7 - h, 2, h, i % 2 ? G1 : G2); R(lx, y + 7 - h, 1, 2, '#d8e88a'); }
      } else if (k === 'bush') {
        ellipse(x + 8 + sw, y + 1, 7, 6, G2); ellipse(x + 7 + sw, y, 6, 5, G1); R(x + 4 + sw, y - 3, 3, 2, G3); R(x + 9 + sw, y - 1, 2, 2, G3);
        R(x + 5, y + 2, 1, 1, '#ff9ecf'); R(x + 10, y - 2, 1, 1, '#ffd166');
      } else if (k === 'monstera') {
        R(x + 7, y - 4, 2, 11, G2);
        [[-6, -12, 7, 5], [3, -14, 7, 5], [-5, -5, 6, 4], [4, -7, 7, 4], [-1, -18, 6, 4]].forEach(([a, b, w, h], i) => {
          const s = i % 2 ? sw : -sw; R(x + 8 + a + s, y + b, w, h, i % 2 ? G1 : G2); R(x + 8 + a + s + 1, y + b + 1, w - 3, 1, G3); R(x + 8 + a + s + (w >> 1), y + b + h - 1, 1, 1, shade(G2, -0.3));
        });
      } else {
        R(x + 7, y - 6, 2, 13, '#7a5236');
        ellipse(x + 8 + sw, y - 12, 7, 7, G2); ellipse(x + 7 + sw, y - 13, 6, 6, G1);
        for (let i = 0; i < 7; i++) R(x + 3 + ((i * 5) % 10) + sw, y - 18 + ((i * 3) % 11), 2, 1, G3);
      }
    });
  }
  function chairUp(cx, cy, col) { // cadeira de costas (vista de tras)
    R(cx - 5, cy - 1, 3, 1, '#1d1c2b'); R(cx + 2, cy - 1, 3, 1, '#1d1c2b'); R(cx - 1, cy, 2, 1, '#1d1c2b');
    R(cx - 1, cy - 3, 2, 2, '#4a4a60');
    R(cx - 4, cy - 7, 8, 5, col); R(cx - 4, cy - 7, 8, 1, shade(col, 0.3)); R(cx + 2, cy - 6, 2, 4, shade(col, -0.25));
    R(cx - 3, cy - 6, 1, 3, shade(col, 0.15)); R(cx - 5, cy - 4, 1, 2, shade(col, -0.3)); R(cx + 4, cy - 4, 1, 2, shade(col, -0.3));
  }
  function chairDown(cx, cy, col) { // cadeira de frente
    R(cx - 5, cy - 14, 10, 8, shade(col, -0.1)); R(cx - 5, cy - 14, 10, 1, shade(col, 0.2)); R(cx - 4, cy - 12, 8, 5, col);
    R(cx - 5, cy - 6, 10, 3, col); R(cx - 5, cy - 6, 10, 1, shade(col, 0.25));
    R(cx - 5, cy - 3, 1, 3, '#3a2a22'); R(cx + 4, cy - 3, 1, 3, '#3a2a22');
  }
  const SCREEN_CODE = ['#7ee787', '#79c0ff', '#ff7b72', '#d2a8ff', '#ffa657', '#e6edf3'];
  function drawScreen(x, y, w, h, a, t) { // conteudo do monitor
    if (!a) { R(x, y, w, h, '#0c1018'); if (Math.sin(t * 2) > 0) R(x + w - 2, y + h - 2, 1, 1, '#2f7d4f'); return; }
    const st = a.screen();
    if (st === 'work') {
      R(x, y, w, h, '#0d1117');
      const sc = Math.floor(t * 6);
      for (let i = 0; i < h - 1; i += 2) {
        const li = sc + i, ind = (hash(li, 1, a.idx) * 3) | 0, len = 2 + ((hash(li, 2, a.idx) * (w - 5)) | 0);
        R(x + 1 + ind, y + 1 + i, Math.min(len, w - 2 - ind), 1, SCREEN_CODE[(hash(li, 3, a.idx) * 6) | 0]);
      }
      if ((t * 3) % 1 > 0.5) R(x + 1 + ((sc * 3) % (w - 3)), y + h - 2, 1, 1, '#ffffff');
    } else if (st === 'wait') {
      R(x, y, w, h, '#161b2e');
      const k = Math.floor(t * 2) % 2;
      R(x + (w >> 1) - 2, y + 1, 5, 1, '#ffd166'); R(x + (w >> 1) - 2, y + h - 2, 5, 1, '#ffd166');
      R(x + (w >> 1) - 1, y + 2 + k, 3, 1, '#ffd166'); R(x + (w >> 1), y + 3, 1, h - 6, '#ffd166');
    } else if (st === 'ok' || st === 'fail') {
      R(x, y, w, h, st === 'ok' ? '#0f2a1b' : '#2a0f16');
      icon(st === 'ok' ? 'check' : 'cross', x + (w >> 1) - 2, y + (h >> 1) - 2);
    } else if (st === 'idle') {
      R(x, y, w, h, '#14182a');
      const bx = Math.floor(Math.abs(((t * 5 + a.idx * 3) % ((w - 2) * 2)) - (w - 2))), by = Math.floor(Math.abs(((t * 3.3 + a.idx) % ((h - 2) * 2)) - (h - 2)));
      R(x + clamp(bx, 0, w - 2), y + clamp(by, 0, h - 2), 2, 1, a.st.shirt);
    } else {
      R(x, y, w, h, '#0c1018');
      R(x + 1, y + 1, w - 2, 2, '#2a3550'); R(x + 1, y + 4, (w - 2) >> 1, 1, '#3a4670'); R(x + 1, y + 6, w - 4, 1, '#3a4670');
    }
  }
  function addDesk(tx, ty) {
    block(tx, ty, 2, 1);
    const x = tx * T, y = ty * T, i = desks.length;
    const d = { tx, ty, i, chairX: x + 16, chairY: y + 22, agent: null, mug: ['#f4f1e8', '#e5484d', '#4a6fd8', '#ffd166'][i % 4] };
    desks.push(d);
    lights.push({ x: x + 16, y: y - 5, r: 22, c: 'rgba(120,200,255,', when: () => d.agent && d.agent.screen() === 'work' });
    ent(x - 6, y - 26, 44, 44, y + 16, (t) => {
      shadowRect(x, y + 16, 32);
      R(x, y - 3, 32, 1, '#d9a36d'); R(x, y - 2, 32, 10, '#c48a55');
      for (let k = 0; k < 3; k++) R(x + 2 + k * 11, y - 1 + k * 3, 6, 1, '#b97f4c');
      R(x, y + 8, 32, 1, '#7a4f2e'); R(x, y + 9, 32, 7, '#a26c3d');
      R(x + 2, y + 10, 10, 5, '#8f5d33'); R(x + 2, y + 12, 10, 1, '#734a29'); R(x + 6, y + 11, 2, 1, '#d8c5a0'); R(x + 6, y + 13, 2, 1, '#d8c5a0');
      R(x + 29, y + 9, 2, 7, '#6e4426'); R(x + 1, y + 15, 30, 1, '#6e4426');
      // monitor
      R(x + 14, y + 1, 4, 3, '#2a2d3a'); R(x + 11, y + 3, 10, 2, '#3a3e50');
      R(x + 7, y - 13, 18, 14, '#1f2230'); R(x + 7, y - 13, 18, 1, '#454a60'); R(x + 24, y - 12, 1, 13, '#14161f');
      drawScreen(x + 8, y - 12, 16, 11, d.agent, t);
      R(x + 23, y - 12, 2, 2, '#ffd166'); R(x + 7, y - 4, 2, 2, '#7ee787');
      // teclado, mouse, caneca, decoracao
      R(x + 9, y + 4, 14, 3, '#d9d6e2'); for (let k = 0; k < 6; k++) R(x + 10 + k * 2, y + 5, 1, 1, '#a9a6b8');
      R(x + 25, y + 4, 2, 3, '#eceaf2'); R(x + 25, y + 4, 2, 1, '#ffffff');
      R(x + 2, y, 4, 4, d.mug); R(x + 6, y + 1, 1, 2, d.mug); R(x + 2, y, 4, 1, '#3a2418');
      if (d.agent && d.agent.coffeeUntil > NOW && Math.sin(t * 3) > -0.2) { R(x + 3, y - 3 - ((t * 4) % 2 | 0), 1, 1, 'rgba(255,255,255,0.6)'); R(x + 4, y - 5 - ((t * 4 + 1) % 2 | 0), 1, 1, 'rgba(255,255,255,0.45)'); }
      const dv = i % 4;
      if (dv === 0) { R(x + 27, y - 4, 4, 4, '#e9e4d8'); R(x + 27, y - 8, 1, 4, '#3e9e5f'); R(x + 29, y - 9, 1, 5, '#2c7a48'); R(x + 28, y - 7, 2, 2, '#5cc27a'); }
      else if (dv === 1) { R(x + 28, y - 1, 3, 1, '#3a3e50'); R(x + 29, y - 9, 1, 8, '#3a3e50'); R(x + 26, y - 11, 5, 3, '#ffd166'); R(x + 27, y - 8, 3, 1, '#fff3c4'); }
      else if (dv === 2) { R(x + 26, y - 2, 5, 5, '#f8f4e8'); R(x + 26, y - 3, 5, 1, '#e5e0d0'); R(x + 27, y - 4, 4, 1, '#f8f4e8'); R(x + 27, y, 3, 1, '#c8c2b0'); }
      else { R(x + 27, y - 6, 4, 6, '#3a3e50'); R(x + 28, y - 5, 2, 3, '#79c0ff'); R(x + 27, y, 4, 1, '#2a2d3a'); }
    });
    ent(x + 8, y + 10, 18, 14, d.chairY, () => chairUp(d.chairX, d.chairY, '#5a6690'));
    return d;
  }

  // ---------------------------------------------------- construcao do mundo
  // ESCRITORIO: 3 fileiras x 5 mesas
  [5, 10, 15].forEach((ty) => [17, 22, 27, 32, 37].forEach((tx) => addDesk(tx, ty)));
  // arquivos e impressora
  [[15, 2], [16, 2]].forEach(([tx, ty]) => {
    block(tx, ty); const x = tx * T, y = ty * T;
    ent(x, y - 14, 16, 30, y + 15, () => {
      shadowRect(x + 1, y + 15, 14); R(x + 1, y - 12, 14, 27, '#8d97a8'); R(x + 1, y - 12, 14, 2, '#aab3c2'); R(x + 13, y - 10, 2, 25, '#6d7688');
      for (let k = 0; k < 3; k++) { R(x + 2, y - 8 + k * 8, 11, 7, '#9aa4b5'); R(x + 6, y - 6 + k * 8, 4, 1, '#55607a'); R(x + 3, y - 3 + k * 8, 3, 1, '#f8f4e8'); }
    });
  });
  (() => { // impressora
    const tx = 41, ty = 2; block(tx, ty, 2, 1); const x = tx * T, y = ty * T;
    ent(x, y - 12, 32, 28, y + 15, (t) => {
      shadowRect(x + 1, y + 15, 30); R(x + 2, y + 2, 28, 13, '#6d7688'); R(x + 3, y + 3, 26, 1, '#8d97a8');
      R(x + 5, y - 8, 22, 10, '#e9e7ef'); R(x + 5, y - 8, 22, 2, '#ffffff'); R(x + 7, y - 4, 18, 2, '#2b2a3d'); R(x + 22, y - 6, 3, 1, '#7ee787');
      R(x + 22, y - 6, 1, 1, Math.sin(t * 4) > 0 ? '#7ee787' : '#2f7d4f');
      const p = fx.printUntil - NOW;
      if (p > 0) { const out = Math.round((1 - p / 2.5) * 9); R(x + 9, y - 4 + 2 - out, 14, out + 2, '#ffffff'); R(x + 11, y - 2 - out + 3, 9, 1, '#9aa0b5'); }
      R(x + 8, y + 6, 16, 2, '#4a5266');
    });
    addPoi({ tx: 41, ty: 3, dir: 'u', pose: 'stand', dur: [3, 5], w: 0.6, room: 'office' });
  })();
  // quadro branco movel e mesa de pe
  (() => {
    const tx = 19, ty = 19; block(tx, ty, 2, 1); const x = tx * T, y = ty * T;
    ent(x, y - 22, 32, 40, y + 15, (t) => {
      shadowRect(x + 2, y + 15, 28); R(x + 4, y + 8, 2, 7, '#8d97a8'); R(x + 26, y + 8, 2, 7, '#8d97a8'); R(x + 2, y + 14, 6, 1, '#55607a'); R(x + 24, y + 14, 6, 1, '#55607a');
      R(x + 1, y - 20, 30, 28, '#aab3c2'); R(x + 2, y - 19, 28, 26, '#fbfbfd');
      R(x + 4, y - 16, 12, 1, '#4a6fd8'); R(x + 4, y - 13, 18, 1, '#9aa0b5'); R(x + 4, y - 10, 9, 1, '#9aa0b5');
      R(x + 18, y - 9, 8, 6, '#e5484d'); R(x + 19, y - 8, 6, 4, '#fbfbfd');
      const n = Math.floor((t * 0.7) % 8); for (let k = 0; k < n; k++) R(x + 4 + k * 2, y - 5 + ((k * 3) % 4), 2, 1, '#2fb36b');
      R(x + 2, y + 6, 28, 1, '#8d97a8');
    });
    addPoi({ tx: 19, ty: 20, fx: 19 * T + 12, dir: 'u', pose: 'draw', dur: [6, 10], w: 0.8, room: 'office' });
    const sx = 35, sy = 19; block(sx, sy, 3, 1); const X0 = sx * T, Y0 = sy * T;
    ent(X0, Y0 - 6, 48, 22, Y0 + 15, () => {
      shadowRect(X0 + 1, Y0 + 15, 46); R(X0 + 2, Y0 + 6, 2, 9, '#3a3e50'); R(X0 + 44, Y0 + 6, 2, 9, '#3a3e50');
      R(X0, Y0 - 2, 48, 8, '#e9e4d8'); R(X0, Y0 - 2, 48, 1, '#ffffff'); R(X0, Y0 + 6, 48, 2, '#bdb6a5');
      R(X0 + 6, Y0 - 4, 10, 4, '#3a3e50'); R(X0 + 7, Y0 - 3, 8, 2, '#79c0ff'); R(X0 + 5, Y0, 12, 2, '#55607a');
      R(X0 + 30, Y0, 4, 3, '#ffffff'); R(X0 + 22, Y0 - 1, 5, 3, '#ffd166');
    });
    addPoi({ tx: 36, ty: 20, dir: 'u', pose: 'play', dur: [5, 9], w: 0.7, room: 'office' });
    addPoi({ tx: 38, ty: 20, dir: 'u', pose: 'stand', dur: [4, 8], w: 0.5, room: 'office' });
  })();
  [[21, 2], [26, 2], [36, 2], [43, 9], [43, 14], [15, 20], [43, 20], [25, 20], [31, 20]].forEach(([a, b]) => plant(a, b));
  // janelas do escritorio (olhar a vista)
  [[17, 2], [37, 2]].forEach(([a, b]) => addPoi({ tx: a, ty: b, dir: 'u', pose: 'stand', dur: [4, 8], w: 0.5, room: 'office', icon: 'heart' }));
  // aspirador: base de carga
  (() => { const x = 42 * T, y = 21 * T; ent(x, y, 16, 16, y + 2, () => { R(x + 3, y + 8, 10, 6, '#3a3e50'); R(x + 3, y + 8, 10, 1, '#55607a'); R(x + 7, y + 10, 2, 1, '#7ee787'); }); })();

  // RECEPCAO
  (() => {
    const tx = 3, ty = 6; block(tx, ty, 6, 1); const x = tx * T, y = ty * T;
    // robo recepcionista (atras do balcao)
    ent(x + 30, y - 22, 20, 24, y - 1, (t) => {
      const rx = x + 40, ry = y - 4 + Math.round(Math.sin(t * 2) * 1);
      R(rx - 1, ry - 18, 2, 3, '#8d97a8'); R(rx - 1, ry - 20, 2, 2, Math.sin(t * 5) > 0 ? '#e5484d' : '#7a2a30');
      R(rx - 6, ry - 15, 12, 10, '#d9dde8'); R(rx - 6, ry - 15, 12, 1, '#ffffff'); R(rx + 4, ry - 14, 2, 9, '#aab3c2');
      R(rx - 5, ry - 12, 10, 4, '#1d2235'); const bl = (t % 4) < 0.15;
      R(rx - 3, ry - 11, 2, bl ? 1 : 2, '#4cc9f0'); R(rx + 1, ry - 11, 2, bl ? 1 : 2, '#4cc9f0');
      R(rx - 4, ry - 4, 8, 6, '#aab3c2'); R(rx - 2, ry - 2, 4, 1, '#4cc9f0');
    });
    ent(x - 2, y - 14, 100, 32, y + 16, (t) => {
      shadowRect(x, y + 16, 96);
      R(x, y - 4, 96, 3, '#f1ece2'); R(x, y - 4, 96, 1, '#ffffff'); R(x, y - 1, 96, 1, '#bdb6a5');
      R(x, y, 96, 16, '#7a4f2e'); R(x, y, 96, 2, '#8f5d33');
      for (let k = 0; k < 6; k++) R(x + 3 + k * 16, y + 4, 10, 9, '#6a4426');
      R(x + 28, y + 6, 40, 5, '#2b2a3d'); text('RECEPCAO', x + 33, y + 6, '#ffd166');
      R(x + 6, y - 10, 12, 7, '#2a2d3a'); R(x + 11, y - 3, 2, 1, '#3a3e50');
      R(x + 76, y - 7, 6, 4, '#f4f1e8'); R(x + 78, y - 8, 2, 1, '#f4f1e8');
      R(x + 86, y - 6, 4, 3, '#4a6fd8'); R(x + 86, y - 13, 1, 7, '#3e9e5f'); R(x + 88, y - 14, 1, 8, '#2c7a48');
      R(x + 85, y - 15, 2, 2, '#ff9ecf'); R(x + 88, y - 16, 2, 2, '#ffd166'); R(x + 90, y - 13, 2, 2, '#e5484d');
      R(x + 60, y - 6, 5, 3, '#ffd166'); R(x + 61, y - 7, 3, 1, '#c9a13a');
    });
  })();
  (() => { // sofa da recepcao (de frente) + mesa de centro
    const tx = 2, ty = 13; block(tx, ty, 3, 1); const x = tx * T, y = ty * T, C = '#4a6fd8';
    ent(x - 2, y - 12, 52, 30, y + 6, () => {
      shadowRect(x, y + 14, 48); R(x, y - 10, 48, 11, shade(C, -0.15)); R(x, y - 10, 48, 1, shade(C, 0.2));
      for (let k = 0; k < 3; k++) { R(x + 3 + k * 14, y - 8, 13, 8, C); R(x + 3 + k * 14, y - 8, 13, 1, shade(C, 0.25)); R(x + 3 + k * 14, y, 13, 6, shade(C, 0.08)); R(x + 3 + k * 14, y, 13, 1, shade(C, 0.3)); }
      R(x, y - 4, 3, 13, shade(C, -0.25)); R(x + 45, y - 4, 3, 13, shade(C, -0.25)); R(x, y + 6, 48, 6, shade(C, -0.3)); R(x + 2, y + 12, 2, 2, '#2a1d14'); R(x + 44, y + 12, 2, 2, '#2a1d14');
    });
    for (let k = 0; k < 3; k++) addPoi({ tx: 2 + k, ty: 14, fx: x + 10 + k * 14, fy: y + 10, dir: 'd', pose: 'sit', seat: 'front', dur: [6, 14], room: 'lobby', w: 0.6 });
    block(2, 15, 3, 1);
    ent(x, 15 * T - 2, 48, 18, 15 * T + 12, () => {
      const Y = 15 * T; shadowRect(x + 4, Y + 12, 40); R(x + 4, Y, 40, 7, '#3a2a22'); R(x + 4, Y, 40, 1, '#5a4236'); R(x + 6, Y + 7, 2, 5, '#2a1d14'); R(x + 40, Y + 7, 2, 5, '#2a1d14');
      R(x + 10, Y + 1, 8, 4, '#e5484d'); R(x + 11, Y + 2, 6, 1, '#f8f4e8'); R(x + 22, Y + 1, 7, 5, '#ffd166'); R(x + 34, Y + 1, 4, 4, '#f4f1e8');
    });
  })();
  (() => { // poltronas e revistas
    const x = 7 * T, y = 13 * T; block(7, 13);
    ent(x - 2, y - 12, 20, 28, y + 6, () => { const C = '#2fb36b'; shadowRect(x, y + 14, 16); R(x + 1, y - 10, 14, 11, shade(C, -0.15)); R(x + 3, y - 8, 10, 8, C); R(x + 1, y, 14, 7, shade(C, 0.1)); R(x + 1, y, 14, 1, shade(C, 0.3)); R(x, y - 3, 2, 12, shade(C, -0.3)); R(x + 14, y - 3, 2, 12, shade(C, -0.3)); });
    addPoi({ tx: 7, ty: 14, fx: x + 8, fy: y + 10, dir: 'd', pose: 'sit', seat: 'front', dur: [6, 12], room: 'lobby', w: 0.5 });
    const mx = 10 * T, my = 13 * T; block(10, 13);
    ent(mx, my - 8, 16, 24, my + 14, () => { shadowRect(mx + 2, my + 14, 12); R(mx + 2, my, 12, 14, '#5a4236'); R(mx + 3, my - 6, 4, 8, '#e5484d'); R(mx + 7, my - 5, 3, 7, '#4a6fd8'); R(mx + 10, my - 7, 3, 9, '#ffd166'); });
    addPoi({ tx: 10, ty: 14, dir: 'u', pose: 'stand', dur: [3, 6], room: 'lobby', w: 0.4, then: { pose: 'read', dir: 'd', dur: [5, 9] } });
  })();
  (() => { // porta de entrada (parede esquerda) + cabideiro
    [17, 18].forEach((ty) => { wall[ty][0] = 'entry'; });
    const x = 13 * T, y = 7 * T; block(13, 7);
    ent(x, y - 20, 16, 36, y + 14, () => { shadowRect(x + 3, y + 14, 10); R(x + 7, y - 16, 2, 30, '#5a4236'); R(x + 3, y + 12, 10, 2, '#5a4236'); R(x + 3, y - 16, 10, 2, '#5a4236'); R(x + 2, y - 14, 4, 9, '#e5484d'); R(x + 10, y - 14, 4, 7, '#2b2a3d'); R(x + 9, y - 18, 5, 2, '#ffd166'); });
  })();
  [[1, 3], [12, 3], [1, 20], [12, 20]].forEach(([a, b]) => plant(a, b));

  // SALA DE REUNIAO
  (() => {
    const tx = 48, ty = 5; block(tx, ty, 8, 3); const x = tx * T, y = ty * T;
    ent(x - 2, y - 6, 132, 54, y + 46, (t) => {
      shadowRect(x + 2, y + 46, 124);
      R(x + 4, y - 4, 120, 44, '#8f5d33'); R(x, y, 128, 36, '#8f5d33'); R(x + 4, y - 4, 120, 1, '#c48a55'); R(x, y, 2, 36, '#a26c3d');
      R(x + 4, y - 2, 120, 40, '#a26c3d'); for (let k = 0; k < 6; k++) R(x + 8 + k * 19, y + 4 + (k % 3) * 9, 12, 1, '#8f5d33');
      R(x + 4, y + 38, 120, 4, '#6e4426'); R(x + 10, y + 42, 3, 4, '#4a2e1a'); R(x + 115, y + 42, 3, 4, '#4a2e1a');
      R(x + 50, y + 10, 18, 11, '#3a3e50'); R(x + 51, y + 11, 16, 8, '#79c0ff'); R(x + 51, y + 11 + ((t * 2) % 7 | 0), 8, 1, '#ffffff'); R(x + 48, y + 21, 22, 2, '#55607a');
      R(x + 90, y + 8, 4, 5, '#bfe6ff'); R(x + 96, y + 9, 4, 5, '#bfe6ff'); R(x + 92, y + 22, 6, 5, '#f4f1e8'); R(x + 20, y + 20, 10, 7, '#ffffff'); R(x + 22, y + 22, 6, 1, '#9aa0b5');
    });
    [49, 52, 55].forEach((cx) => {
      const px = cx * T + 8, py = 4 * T + 14; block(cx, 4);
      ent(px - 6, py - 16, 12, 18, py, () => chairDown(px, py, '#3a3e50'));
      addPoi({ tx: cx, ty: 3, fx: px, fy: py, dir: 'd', pose: 'sit', seat: 'front', dur: [8, 16], room: 'meeting', w: 0.5 });
      const qy = 8 * T + 12; block(cx, 8);
      ent(px - 6, qy - 12, 12, 14, qy, () => chairUp(px, qy, '#3a3e50'));
      addPoi({ tx: cx, ty: 9, fx: px, fy: qy, dir: 'u', pose: 'sitBack', seat: 'back', dur: [8, 16], room: 'meeting', w: 0.5 });
    });
    addPoi({ tx: 47, ty: 2, dir: 'u', pose: 'draw', dur: [6, 12], room: 'meeting', w: 0.8 });
    plant(58, 2, 'monstera'); plant(58, 10, 'snake'); plant(45, 11, 'bush');
  })();

  // SERVIDORES
  (() => {
    const racks = [];
    [14, 18].forEach((ty) => { for (let tx = 46; tx <= 52; tx++) racks.push([tx, ty]); });
    racks.forEach(([tx, ty]) => {
      block(tx, ty); const x = tx * T, y = ty * T;
      ent(x, y - 20, 16, 36, y + 15, (t) => {
        shadowRect(x, y + 15, 16); R(x, y - 18, 16, 33, '#1b1e28'); R(x, y - 18, 16, 1, '#3a3e50'); R(x + 14, y - 17, 2, 32, '#11131a');
        for (let k = 0; k < 7; k++) {
          const ry = y - 16 + k * 4; R(x + 2, ry, 11, 3, '#262a38'); R(x + 2, ry, 11, 1, '#30354a');
          for (let l = 0; l < 3; l++) { const on = hash(tx * 7 + l, k, Math.floor(t * (3 + l) + tx)) > 0.45; R(x + 3 + l * 2, ry + 1, 1, 1, on ? ['#7ee787', '#79c0ff', '#ffa657'][l] : '#1d2a22'); }
          R(x + 10, ry + 1, 2, 1, '#11131a');
        }
      });
    });
    lights.push({ x: 49.5 * T, y: 16.5 * T, r: 70, c: 'rgba(80,140,255,', when: () => true });
    block(56, 14, 2, 1);
    ent(56 * T, 14 * T - 22, 32, 38, 15 * T - 1, (t) => {
      const x = 56 * T, y = 14 * T; shadowRect(x, y + 15, 32); R(x + 1, y - 20, 30, 35, '#d9dde8'); R(x + 1, y - 20, 30, 1, '#ffffff'); R(x + 28, y - 19, 3, 34, '#aab3c2');
      for (let k = 0; k < 6; k++) R(x + 4, y - 16 + k * 3, 22, 1, '#8d97a8');
      R(x + 6, y + 2, 18, 8, '#1d2235'); text('18C', x + 9, y + 4, '#4cc9f0');
      if (Math.sin(t * 6) > 0) R(x + 4, y + 12, 2, 1, '#7ee787');
    });
    block(56, 19); ent(56 * T, 19 * T - 6, 16, 22, 20 * T - 1, () => { const x = 56 * T, y = 19 * T; shadowRect(x + 1, y + 15, 14); R(x + 1, y - 4, 14, 19, '#2b2a3d'); R(x + 3, y - 2, 10, 4, '#1d2235'); R(x + 4, y - 1, 6, 2, '#7ee787'); R(x + 3, y + 4, 10, 1, '#46445f'); });
    [[48, 16], [51, 16]].forEach(([a, b]) => addPoi({ tx: a, ty: b, dir: 'u', pose: 'play', dur: [5, 9], room: 'server', w: 0.5 }));
    addPoi({ tx: 50, ty: 17, dir: 'd', pose: 'phone', dur: [4, 7], room: 'server', w: 0.4 });
  })();

  // COPA
  (() => {
    const tx = 2, ty = 23; block(tx, ty, 10, 1); const x = tx * T, y = ty * T;
    ent(x, y - 14, 160, 30, y + 15, (t) => {
      R(x, y - 2, 160, 4, '#e9e4d8'); R(x, y - 2, 160, 1, '#ffffff'); R(x, y + 2, 160, 13, '#5a8f7b'); R(x, y + 2, 160, 1, '#6fa58f');
      for (let k = 0; k < 10; k++) { R(x + 2 + k * 16, y + 4, 12, 9, '#4f7f6c'); R(x + 7 + k * 16, y + 8, 2, 1, '#d8c5a0'); }
      R(x + 1, y + 15, 158, 1, 'rgba(20,12,30,0.25)');
      // fruteira
      R(x + 3, y - 5, 10, 3, '#c48a55'); R(x + 4, y - 7, 3, 3, '#e5484d'); R(x + 7, y - 8, 3, 3, '#ffd166'); R(x + 9, y - 6, 3, 3, '#2fb36b');
      // pia
      R(x + 33, y - 2, 24, 3, '#aab3c2'); R(x + 35, y - 1, 20, 2, '#7d8799'); R(x + 44, y - 8, 2, 6, '#c9ced8'); R(x + 44, y - 8, 5, 2, '#c9ced8');
      // cafeteira
      const cx = x + 82; R(cx, y - 14, 14, 14, '#2b2a3d'); R(cx, y - 14, 14, 2, '#46445f'); R(cx + 2, y - 10, 10, 4, '#1d1c2b'); R(cx + 3, y - 9, 2, 1, fx.brewUntil > NOW ? '#7ee787' : '#e5484d');
      R(cx + 5, y - 5, 4, 4, '#f4f1e8');
      if (fx.brewUntil > NOW) { R(cx + 6, y - 6, 2, 2 + ((t * 8) % 2 | 0), '#5a3418'); if (Math.random() < 0.3) puff(cx + 7, y - 16, 'steam'); }
      // micro-ondas
      const mx = x + 112; R(mx, y - 11, 20, 10, '#d9dde8'); R(mx + 2, y - 9, 12, 6, '#2b2a3d'); R(mx + 15, y - 9, 3, 2, '#1d2235'); text(((new Date().getHours()) % 12 + 1).toString(), mx + 15, y - 9, '#7ee787');
      // chaleira e torradeira
      R(x + 140, y - 7, 7, 6, '#e5484d'); R(x + 141, y - 8, 5, 1, '#2b2a3d'); R(x + 150, y - 6, 8, 5, '#aab3c2'); R(x + 151, y - 7, 2, 1, '#2b2a3d'); R(x + 155, y - 7, 2, 1, '#2b2a3d');
    });
    addPoi({ tx: 7, ty: 24, fx: 7 * T + 8, dir: 'u', pose: 'stand', dur: [2.5, 3], room: 'kitchen', w: 1.4, kind: 'coffee', then: { pose: 'drink', dir: 'd', dur: [5, 9] } });
    addPoi({ tx: 4, ty: 24, fx: 4 * T + 12, dir: 'u', pose: 'stand', dur: [3, 5], room: 'kitchen', w: 0.4 });
    addPoi({ tx: 9, ty: 24, fx: 9 * T + 4, dir: 'u', pose: 'stand', dur: [3, 6], room: 'kitchen', w: 0.4 });
    // geladeira
    block(13, 23, 2, 1);
    ent(13 * T, 23 * T - 26, 32, 42, 24 * T - 1, () => {
      const x0 = 13 * T, y0 = 23 * T; shadowRect(x0 + 1, y0 + 15, 30); R(x0 + 2, y0 - 24, 28, 39, '#e9edf4'); R(x0 + 2, y0 - 24, 28, 1, '#ffffff'); R(x0 + 27, y0 - 23, 3, 38, '#c4cad6');
      R(x0 + 2, y0 - 10, 26, 1, '#aab3c2'); R(x0 + 22, y0 - 20, 2, 7, '#8d97a8'); R(x0 + 22, y0 - 6, 2, 9, '#8d97a8');
      R(x0 + 6, y0 - 20, 3, 3, '#e5484d'); R(x0 + 11, y0 - 18, 4, 3, '#ffd166'); R(x0 + 7, y0 - 4, 6, 7, '#ffffff'); R(x0 + 8, y0 - 3, 4, 1, '#4a6fd8');
    });
    addPoi({ tx: 13, ty: 24, fx: 13 * T + 14, dir: 'u', pose: 'stand', dur: [3, 5], room: 'kitchen', w: 0.6, icon: 'heart' });
    // maquina de lanches
    block(16, 23, 2, 1);
    ent(16 * T, 23 * T - 28, 32, 44, 24 * T - 1, (t) => {
      const x0 = 16 * T, y0 = 23 * T; shadowRect(x0 + 1, y0 + 15, 30); R(x0 + 1, y0 - 26, 30, 41, '#e5484d'); R(x0 + 1, y0 - 26, 30, 2, '#ff7b72'); R(x0 + 28, y0 - 24, 3, 39, '#b8353b');
      R(x0 + 3, y0 - 22, 19, 28, '#1d2235');
      const cols = ['#ffd166', '#4cc9f0', '#7ee787', '#ff9ecf', '#ffa657'];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) R(x0 + 4 + c * 5, y0 - 20 + r * 7, 3, 4, cols[(r * 4 + c) % 5]);
      R(x0 + 3, y0 - 22, 19, 1, 'rgba(255,255,255,0.4)');
      R(x0 + 23, y0 - 20, 4, 6, '#2b2a3d'); R(x0 + 24, y0 - 19, 2, 1, Math.sin(t * 3) > 0 ? '#7ee787' : '#2f7d4f');
      R(x0 + 3, y0 + 8, 19, 5, '#2b2a3d'); if (fx.vendUntil > NOW) R(x0 + 10, y0 + 9, 4, 3, '#4cc9f0');
    });
    addPoi({ tx: 16, ty: 24, fx: 16 * T + 12, dir: 'u', pose: 'stand', dur: [2.5, 4], room: 'kitchen', w: 0.6, kind: 'vend', then: { pose: 'drink', dir: 'd', dur: [4, 7] } });
    // bebedouro
    block(18, 23);
    ent(18 * T, 23 * T - 24, 16, 40, 24 * T - 1, (t) => {
      const x0 = 18 * T, y0 = 23 * T; shadowRect(x0 + 2, y0 + 15, 12); R(x0 + 3, y0 - 6, 10, 21, '#e9edf4'); R(x0 + 3, y0 - 6, 10, 1, '#ffffff'); R(x0 + 11, y0 - 5, 2, 20, '#c4cad6');
      R(x0 + 6, y0 + 2, 3, 2, '#4a6fd8'); R(x0 + 4, y0 - 21, 8, 14, 'rgba(120,190,255,0.75)'); R(x0 + 5, y0 - 23, 6, 2, 'rgba(120,190,255,0.85)'); R(x0 + 5, y0 - 20, 1, 10, 'rgba(255,255,255,0.6)');
      const n = fx.coolerUntil > NOW ? 4 : 1; for (let k = 0; k < n; k++) R(x0 + 7 + (k % 2), y0 - 9 - (((t * 9 + k * 3) % 11) | 0), 1, 1, '#ffffff');
    });
    addPoi({ tx: 18, ty: 24, dir: 'u', pose: 'stand', dur: [2, 3], room: 'kitchen', w: 1, kind: 'cooler', then: { pose: 'drink', dir: 'd', dur: [3, 6] } });
    // mesas com cadeiras
    [[4, 29], [11, 29], [4, 34], [11, 34]].forEach(([tx2, ty2], n) => {
      block(tx2, ty2, 2, 1); const x0 = tx2 * T, y0 = ty2 * T, TC = ['#f1ece2', '#ffd9a0', '#cfe2d4', '#d9c9ea'][n];
      ent(x0 - 2, y0 - 4, 36, 22, y0 + 14, () => {
        shadowRect(x0 + 2, y0 + 14, 28); R(x0 + 1, y0 - 2, 30, 9, TC); R(x0 + 1, y0 - 2, 30, 1, '#ffffff'); R(x0 + 1, y0 + 7, 30, 2, shade(TC, -0.25));
        R(x0 + 14, y0 + 9, 4, 5, '#55607a'); R(x0 + 10, y0 + 13, 12, 1, '#3a3e50');
        R(x0 + 6, y0, 4, 3, '#f4f1e8'); R(x0 + 20, y0 + 1, 5, 3, '#e5484d');
      });
      const c1 = { x: x0 + 8, y: (ty2 - 1) * T + 14 }, c2 = { x: x0 + 24, y: (ty2 + 1) * T + 10 };
      block(tx2, ty2 - 1); block(tx2 + 1, ty2 + 1);
      ent(c1.x - 6, c1.y - 16, 12, 18, c1.y, () => chairDown(c1.x, c1.y, '#c48a55'));
      ent(c2.x - 6, c2.y - 12, 12, 14, c2.y, () => chairUp(c2.x, c2.y, '#c48a55'));
      addPoi({ tx: tx2 - 1, ty: ty2 - 1, fx: c1.x, fy: c1.y, dir: 'd', pose: 'sit', seat: 'front', dur: [8, 16], room: 'kitchen', w: 0.5, icon: 'coffee' });
      addPoi({ tx: tx2 + 2, ty: ty2 + 1, fx: c2.x, fy: c2.y, dir: 'u', pose: 'sitBack', seat: 'back', dur: [8, 16], room: 'kitchen', w: 0.5 });
    });
    plant(1, 37, 'bush'); plant(1, 23, 'snake');
    [[17, 38, '#4a6fd8'], [18, 38, '#2fb36b'], [19, 38, '#8d97a8']].forEach(([a, b, c]) => {
      block(a, b); const x0 = a * T, y0 = b * T;
      ent(x0, y0 - 4, 16, 20, y0 + 14, () => { shadowRect(x0 + 3, y0 + 14, 10); R(x0 + 3, y0 - 1, 10, 15, c); R(x0 + 2, y0 - 3, 12, 3, shade(c, 0.2)); R(x0 + 6, y0 + 4, 4, 4, shade(c, -0.25)); });
    });
  })();

  // LOUNGE
  (() => {
    // rack da TV
    block(26, 23, 3, 1);
    ent(26 * T, 23 * T - 4, 48, 20, 24 * T - 1, (t) => {
      const x0 = 26 * T, y0 = 23 * T; shadowRect(x0 + 1, y0 + 15, 46); R(x0 + 1, y0 + 2, 46, 13, '#3a2a22'); R(x0 + 1, y0 + 2, 46, 1, '#5a4236');
      R(x0 + 4, y0 + 5, 18, 7, '#2a1d14'); R(x0 + 26, y0 + 5, 18, 7, '#2a1d14');
      R(x0 + 8, y0 - 1, 12, 3, '#e9edf4'); R(x0 + 9, y0, 2, 1, Math.sin(t * 2) > 0 ? '#4cc9f0' : '#79c0ff'); R(x0 + 30, y0, 4, 3, '#2b2a3d'); R(x0 + 36, y0, 4, 3, '#2b2a3d');
    });
    // sofa de costas (vira para a TV)
    block(25, 28, 5, 1);
    const sx = 25 * T, sy = 28 * T, SC = '#e07a5f';
    ent(sx - 4, sy - 8, 88, 26, sy + 16, () => {
      shadowRect(sx - 2, sy + 16, 84); R(sx - 3, sy - 4, 5, 18, shade(SC, -0.2)); R(sx + 78, sy - 4, 5, 18, shade(SC, -0.2));
      R(sx - 3, sy - 4, 5, 2, shade(SC, 0.15)); R(sx + 78, sy - 4, 5, 2, shade(SC, 0.15));
      R(sx, sy + 2, 80, 3, shade(SC, 0.15)); R(sx, sy + 5, 80, 10, SC); R(sx, sy + 15, 80, 1, shade(SC, -0.35));
      for (let k = 1; k < 5; k++) R(sx + k * 16, sy + 6, 1, 8, shade(SC, -0.15));
      R(sx + 2, sy + 15, 2, 2, '#2a1d14'); R(sx + 76, sy + 15, 2, 2, '#2a1d14');
    });
    for (let k = 0; k < 5; k++) addPoi({ tx: 25 + k, ty: 29, fx: sx + 8 + k * 16, fy: sy + 9, dir: 'u', pose: 'sitBack', seat: 'back', dur: [10, 22], room: 'lounge', w: 0.5, icon: 'note' });
    // estante
    block(31, 23, 4, 1);
    ent(31 * T, 23 * T - 26, 64, 42, 24 * T - 1, () => {
      const x0 = 31 * T, y0 = 23 * T; shadowRect(x0, y0 + 15, 64); R(x0, y0 - 24, 64, 39, '#6e4426'); R(x0, y0 - 24, 64, 2, '#8f5d33');
      const cores = ['#e5484d', '#4a6fd8', '#ffd166', '#2fb36b', '#9b5de5', '#f4f1e8', '#ffa657', '#4cc9f0'];
      for (let s = 0; s < 4; s++) {
        const by = y0 - 21 + s * 9; R(x0 + 2, by, 60, 8, '#3a2418'); R(x0 + 2, by + 8, 60, 1, '#8f5d33');
        let bx = x0 + 3;
        while (bx < x0 + 59) {
          const w = 2 + ((hash(bx, s, 5) * 2) | 0), h = 5 + ((hash(bx, s, 6) * 3) | 0), c = cores[(hash(bx, s, 7) * 8) | 0];
          if (hash(bx, s, 8) < 0.12) { bx += 4; continue; }
          R(bx, by + 8 - h, w, h, c); R(bx, by + 8 - h, w, 1, shade(c, 0.3)); bx += w + (hash(bx, s, 9) < 0.2 ? 1 : 0);
        }
      }
    });
    addPoi({ tx: 32, ty: 24, dir: 'u', pose: 'stand', dur: [2, 3], room: 'lounge', w: 0.8, then: { pose: 'read', dir: 'd', dur: [7, 14] } });
    // fliperamas
    [[37, '#9b5de5'], [38, '#4cc9f0']].forEach(([tx2, C]) => {
      block(tx2, 23); const x0 = tx2 * T, y0 = 23 * T;
      ent(x0, y0 - 28, 16, 44, 24 * T - 1, (t) => {
        shadowRect(x0, y0 + 15, 16); R(x0 + 1, y0 - 26, 14, 41, shade(C, -0.35)); R(x0 + 1, y0 - 26, 14, 5, C); R(x0 + 3, y0 - 25, 10, 3, Math.sin(t * 5 + tx2) > 0 ? '#ffd166' : '#ffa657');
        R(x0 + 2, y0 - 19, 12, 10, '#11131a');
        const ph = Math.floor(t * 4 + tx2);
        for (let k = 0; k < 4; k++) R(x0 + 3 + ((ph + k * 3) % 9), y0 - 18 + k * 2, 2, 1, ['#7ee787', '#ff7b72', '#79c0ff', '#ffd166'][k]);
        R(x0 + 7, y0 - 11, 2, 1, '#ffffff');
        R(x0 + 1, y0 - 8, 14, 4, shade(C, -0.15)); R(x0 + 4, y0 - 8, 2, 2, '#e5484d'); R(x0 + 9, y0 - 7, 1, 1, '#ffd166'); R(x0 + 11, y0 - 7, 1, 1, '#7ee787');
        R(x0 + 3, y0 + 2, 10, 6, shade(C, -0.25));
      });
      lights.push({ x: x0 + 8, y: y0 - 14, r: 18, c: 'rgba(160,120,255,', when: () => true });
      addPoi({ tx: tx2, ty: 24, dir: 'u', pose: 'play', dur: [8, 16], room: 'lounge', w: 0.9, icon: 'game' });
    });
    // ping-pong
    block(31, 31, 5, 2);
    ent(31 * T - 4, 31 * T - 4, 88, 40, 33 * T - 1, (t) => {
      const x0 = 31 * T, y0 = 31 * T; shadowRect(x0 + 2, y0 + 31, 76);
      R(x0 + 4, y0 + 24, 2, 7, '#2b2a3d'); R(x0 + 74, y0 + 24, 2, 7, '#2b2a3d');
      R(x0, y0, 80, 22, '#1f7a5c'); R(x0, y0, 80, 1, '#ffffff'); R(x0, y0 + 21, 80, 1, '#ffffff'); R(x0, y0, 1, 22, '#ffffff'); R(x0 + 79, y0, 1, 22, '#ffffff'); R(x0, y0 + 11, 80, 1, 'rgba(255,255,255,0.6)');
      R(x0, y0 + 22, 80, 3, '#145a43');
      R(x0 + 39, y0 - 3, 2, 26, '#e9edf4'); R(x0 + 39, y0 - 3, 2, 1, '#ffffff');
      const L = pois.find((p) => p.kind === 'pingL'), Rr = pois.find((p) => p.kind === 'pingR');
      if (L && Rr && L.busy && Rr.busy && L.busy.inPose && Rr.busy.inPose) {
        const ph = (t * 1.2) % 2, k = ph < 1 ? ph : 2 - ph, bx = lerp(x0 + 3, x0 + 76, k), by = y0 + 8 + Math.sin(k * Math.PI * 3) * 6 - Math.abs(Math.sin(k * Math.PI * 2)) * 6;
        R(bx, by, 2, 2, '#ffffff'); R(bx, y0 + 14, 2, 1, 'rgba(0,0,0,0.25)');
      }
    });
    addPoi({ tx: 30, ty: 31, fx: 30 * T + 10, fy: 31 * T + 14, dir: 'r', pose: 'pingpong', dur: [10, 18], room: 'lounge', w: 0.7, kind: 'pingL' });
    addPoi({ tx: 36, ty: 32, fx: 36 * T + 6, fy: 32 * T + 6, dir: 'l', pose: 'pingpong', dur: [10, 18], room: 'lounge', w: 0.7, kind: 'pingR' });
    // puffs
    [[22, 36, '#ffd166'], [24, 37, '#4cc9f0'], [26, 36, '#9b5de5']].forEach(([a, b, C]) => {
      block(a, b); const x0 = a * T, y0 = b * T;
      ent(x0 - 2, y0 - 4, 20, 20, y0 + 5, () => { shadowRect(x0, y0 + 14, 16); ellipse(x0 + 8, y0 + 7, 8, 6, shade(C, -0.2)); ellipse(x0 + 8, y0 + 5, 7, 5, C); R(x0 + 4, y0 + 2, 4, 2, shade(C, 0.35)); });
      addPoi({ tx: a, ty: b - 1, fx: x0 + 8, fy: y0 + 9, dir: 'd', pose: hash(a, b, 1) > 0.5 ? 'sleep' : 'sit', seat: 'front', dur: [12, 25], room: 'lounge', w: 0.5 });
    });
    // aquario
    block(37, 36, 3, 1);
    const fishes = Array.from({ length: 5 }, (_, i) => ({ c: ['#ffa657', '#ffd166', '#ff7b72', '#79c0ff', '#ffffff'][i], s: rand(0.3, 0.7), o: rand(0, 6), y: rand(2, 12) }));
    ent(37 * T, 36 * T - 22, 48, 38, 37 * T - 1, (t) => {
      const x0 = 37 * T, y0 = 36 * T; shadowRect(x0, y0 + 15, 48); R(x0 + 1, y0, 46, 15, '#3a2a22'); R(x0 + 1, y0, 46, 1, '#5a4236');
      R(x0 + 1, y0 - 20, 46, 20, '#1e5f8a'); R(x0 + 2, y0 - 19, 44, 18, '#2f86b8'); R(x0 + 2, y0 - 19, 44, 3, '#4aa3df');
      R(x0 + 2, y0 - 4, 44, 3, '#e9d8a6'); R(x0 + 6, y0 - 10, 2, 6, '#2fb36b'); R(x0 + 8, y0 - 13, 2, 9, '#3e9e5f'); R(x0 + 38, y0 - 9, 2, 5, '#2fb36b');
      R(x0 + 28, y0 - 9, 6, 5, '#8d97a8'); R(x0 + 29, y0 - 11, 2, 2, '#8d97a8'); R(x0 + 30, y0 - 7, 2, 3, '#2b2a3d');
      fishes.forEach((f) => {
        const ph = (t * f.s + f.o) % 2, k = ph < 1 ? ph : 2 - ph, fxp = x0 + 4 + k * 38, dir = ph < 1 ? 1 : -1, fy0 = y0 - 18 + f.y + Math.round(Math.sin(t * 2 + f.o));
        R(fxp, fy0, 3, 2, f.c); R(fxp - dir * 2 + (dir > 0 ? 0 : 2), fy0, 1, 2, shade(f.c, -0.2));
      });
      for (let k = 0; k < 3; k++) R(x0 + 10 + k * 12, y0 - 5 - (((t * 6 + k * 4) % 14) | 0), 1, 1, 'rgba(255,255,255,0.8)');
      R(x0 + 1, y0 - 20, 46, 1, '#aab3c2'); R(x0 + 3, y0 - 17, 1, 12, 'rgba(255,255,255,0.35)');
    });
    lights.push({ x: 38.5 * T, y: 36 * T - 10, r: 26, c: 'rgba(80,170,255,', when: () => true });
    addPoi({ tx: 38, ty: 37, dir: 'u', pose: 'stand', dur: [5, 10], room: 'lounge', w: 0.7, icon: 'heart' });
    // luminarias de chao
    [[22, 24], [39, 29]].forEach(([a, b]) => {
      block(a, b); const x0 = a * T, y0 = b * T;
      ent(x0, y0 - 26, 16, 42, y0 + 14, () => { shadowRect(x0 + 4, y0 + 14, 8); R(x0 + 4, y0 + 12, 8, 2, '#2b2a3d'); R(x0 + 7, y0 - 16, 2, 28, '#2b2a3d'); R(x0 + 2, y0 - 24, 12, 8, '#f6e7c1'); R(x0 + 2, y0 - 24, 12, 1, '#fff6dd'); R(x0 + 3, y0 - 17, 10, 1, '#d9c69b'); });
      lights.push({ x: x0 + 8, y: y0 - 16, r: 46, c: 'rgba(255,210,140,', when: () => true });
    });
    plant(35, 23, 'monstera'); plant(21, 38, 'ficus'); plant(40, 23, 'snake'); plant(40, 38, 'bush');
  })();

  // JARDIM
  const trees = [];
  (() => {
    [[44, 26], [57, 25], [46, 37], [57, 36], [55, 29]].forEach(([a, b], i) => {
      block(a, b); trees.push([a, b]);
      const x0 = a * T + 8, y0 = b * T + 14, r = i === 4 ? 13 : 17;
      ent(x0 - r - 2, y0 - 48, r * 2 + 4, 56, y0, (t) => {
        const s = Math.round(Math.sin(t * 0.9 + i) * 1.2);
        ellipse(x0 + 2, y0, r - 5, 3, 'rgba(20,40,20,0.3)');
        R(x0 - 2, y0 - 16, 5, 16, '#6b4426'); R(x0 - 2, y0 - 16, 2, 16, '#875832'); R(x0 - 4, y0 - 2, 9, 2, '#6b4426');
        ellipse(x0 + s, y0 - 26, r, r - 4, '#2c7a48'); ellipse(x0 - 3 + s, y0 - 29, r - 4, r - 7, '#3e9e5f'); ellipse(x0 - 6 + s, y0 - 32, r - 9, r - 11, '#5cc27a');
        for (let k = 0; k < 6; k++) R(x0 - r + 4 + ((k * 7) % (r * 2 - 6)) + s, y0 - 36 + ((k * 5) % 18), 2, 2, k % 2 ? '#2c7a48' : '#78d48f');
        if (i === 1) for (let k = 0; k < 4; k++) R(x0 - 8 + k * 5 + s, y0 - 28 + (k % 2) * 6, 2, 2, '#e5484d');
      });
    });
    // banco
    block(47, 25, 3, 1);
    const bx = 47 * T, by = 25 * T;
    ent(bx - 2, by - 12, 52, 28, by + 4, () => {
      shadowRect(bx, by + 14, 48); R(bx, by - 10, 48, 2, '#a26c3d'); R(bx, by - 7, 48, 2, '#a26c3d'); R(bx, by - 10, 48, 1, '#c48a55');
      R(bx + 2, by - 10, 2, 16, '#2b2a3d'); R(bx + 44, by - 10, 2, 16, '#2b2a3d');
      R(bx, by - 2, 48, 3, '#c48a55'); R(bx, by + 1, 48, 2, '#a26c3d'); R(bx + 2, by + 3, 2, 10, '#2b2a3d'); R(bx + 44, by + 3, 2, 10, '#2b2a3d');
    });
    for (let k = 0; k < 3; k++) addPoi({ tx: 47 + k, ty: 26, fx: bx + 8 + k * 16, fy: by + 6, dir: 'd', pose: 'sit', seat: 'front', dur: [10, 20], room: 'garden', w: 0.6, icon: 'heart' });
    // canteiros de flores
    block(52, 24, 4, 1);
    flats.push((t) => {
      const x0 = 52 * T, y0 = 24 * T; R(x0, y0 + 2, 64, 13, '#6b4426'); R(x0, y0 + 2, 64, 2, '#875832'); R(x0 + 1, y0 + 4, 62, 9, '#4a2e1a');
      for (let k = 0; k < 14; k++) {
        const fx0 = x0 + 3 + k * 4 + Math.round(Math.sin(t * 1.5 + k) * 0.6), fy0 = y0 + 4 + (k % 3) * 2;
        R(fx0, fy0, 1, 4, '#2c7a48'); R(fx0 - 1, fy0 - 1, 3, 2, ['#ff9ecf', '#ffd166', '#e5484d', '#ffffff', '#9b5de5'][k % 5]); R(fx0, fy0, 1, 1, '#ffd166');
      }
    });
    addPoi({ tx: 51, ty: 24, dir: 'r', pose: 'water', dur: [6, 10], room: 'garden', w: 0.8 });
    // lago
    block(50, 32, 5, 4);
    const kois = Array.from({ length: 4 }, (_, i) => ({ c: ['#ffa657', '#ffffff', '#ff7b72', '#ffd166'][i], a: rand(0, 6), s: rand(0.3, 0.6), rx: rand(18, 30), ry: rand(8, 16) }));
    flats.push((t) => {
      const x0 = 50 * T, y0 = 32 * T, cx = x0 + 40, cy = y0 + 32;
      ellipse(cx, cy, 42, 33, '#8d97a8'); ellipse(cx, cy, 40, 31, '#6d7688'); ellipse(cx, cy, 37, 28, '#1e5f8a'); ellipse(cx, cy - 2, 34, 24, '#2f86b8');
      kois.forEach((k) => { const a = t * k.s + k.a, px = cx + Math.cos(a) * k.rx, py = cy + Math.sin(a) * k.ry; R(px, py, 3, 2, k.c); R(px - Math.sign(Math.cos(a + 1.57)) * 2, py, 1, 1, shade(k.c, -0.2)); });
      for (let k = 0; k < 3; k++) { const ph = (t * 0.6 + k / 3) % 1, rr = Math.round(ph * 10), rx0 = cx - 18 + k * 16, ry0 = cy - 6 + (k % 2) * 12; X.globalAlpha = 1 - ph; R(rx0 - rr, ry0, rr * 2, 1, '#bfe6ff'); X.globalAlpha = 1; }
      [[-20, -12], [14, 10], [22, -14]].forEach(([a, b], i) => { ellipse(cx + a, cy + b, 4, 2, '#2fb36b'); R(cx + a, cy + b - 1, 1, 1, i === 1 ? '#ff9ecf' : '#145a43'); });
      R(cx - 30, cy - 10, 1, 8, 'rgba(255,255,255,0.35)');
    });
    addPoi({ tx: 52, ty: 31, fx: 52 * T + 8, fy: 31 * T + 8, dir: 'd', pose: 'stand', dur: [6, 12], room: 'garden', w: 0.8, icon: 'heart' });
    addPoi({ tx: 49, ty: 33, dir: 'r', pose: 'stand', dur: [6, 12], room: 'garden', w: 0.6 });
    // postes
    [[43, 29], [56, 33]].forEach(([a, b]) => {
      block(a, b); const x0 = a * T, y0 = b * T;
      ent(x0, y0 - 30, 16, 46, y0 + 14, () => { shadowRect(x0 + 4, y0 + 14, 8); R(x0 + 5, y0 + 10, 6, 4, '#2b2a3d'); R(x0 + 7, y0 - 22, 2, 32, '#2b2a3d'); R(x0 + 4, y0 - 28, 8, 6, '#2b2a3d'); R(x0 + 5, y0 - 27, 6, 4, '#fff1c1'); });
      lights.push({ x: x0 + 8, y: y0 - 24, r: 52, c: 'rgba(255,220,150,', when: () => true });
    });
    addPoi({ tx: 45, ty: 27, dir: 'd', pose: 'stand', dur: [6, 10], room: 'garden', w: 0.5 });
  })();

  // ------------------------------------------------------------- piso e paredes
  const bg = document.createElement('canvas'); bg.width = WW; bg.height = WH;
  function buildBackground() {
    const g = bg.getContext('2d');
    const img = g.createImageData(WW, WH), D = img.data;
    const WOOD = ['#b98552', '#b07c4b', '#a87545'].map(rgb), WOOD2 = ['#8a5a3f', '#80533a', '#93623f'].map(rgb);
    for (let y = 0; y < WH; y++) {
      const ty = y >> 4;
      for (let x = 0; x < WW; x++) {
        const tx = x >> 4, ft = floor[ty][tx];
        let c;
        const n = hash(x, y, 3);
        if (ft === 'wood' || ft === 'wood2') {
          const pal = ft === 'wood' ? WOOD : WOOD2, row = y >> 2, off = (row % 3) * 16 + (row % 5) * 5, pl = Math.floor((x + off) / 48);
          c = pal[(hash(pl, row, 7) * 3) | 0].slice();
          if ((y & 3) === 3 || (x + off) % 48 === 0) c = c.map((v) => v * 0.72);
          else if (n < 0.08) c = c.map((v) => v * 0.9);
        } else if (ft === 'carpet') {
          c = [86, 98, 128];
          if ((x + y) % 6 === 0 && (x - y + 6000) % 6 === 0) c = [102, 116, 150];
          else if ((x + 3 + y) % 6 === 0 && (x - y + 6003) % 6 === 0) c = [76, 87, 115];
          if (n < 0.15) c = c.map((v) => v - 5);
        } else if (ft === 'marble') {
          c = (tx + ty) & 1 ? [230, 225, 214] : [214, 208, 195];
          if (x % 16 === 0 || y % 16 === 0) c = [188, 180, 166];
          else if (Math.abs(Math.sin(x * 0.21 + y * 0.13 + hash(tx, ty, 1) * 6)) < 0.05 && n < 0.7) c = c.map((v) => v - 22);
        } else if (ft === 'tile') {
          c = ((x >> 3) + (y >> 3)) & 1 ? [240, 233, 218] : [205, 219, 200];
          if (x % 8 === 0 || y % 8 === 0) c = [184, 174, 160];
        } else if (ft === 'server') {
          c = [52, 58, 72];
          if (x % 8 === 0 || y % 8 === 0) c = [38, 42, 54]; else if (x % 4 === 2 && y % 4 === 2) c = [74, 82, 100];
        } else if (ft === 'grass') {
          c = [96, 164, 86];
          if (n < 0.16) c = [82, 148, 74]; else if (n < 0.24) c = [116, 182, 100];
          if (hash(x >> 3, y >> 3, 6) < 0.3) c = c.map((v) => v - 8);
        } else c = [20, 20, 30];
        const i = (y * WW + x) * 4;
        D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    X = g;
    // tapetes e caminhos (planos)
    rug(23 * T, 26 * T + 4, 11 * T, 9 * T, '#7b3f61', '#e9c46a');
    rug(4 * T, 16 * T + 4, 6 * T, 4 * T, '#2a4d6b', '#e9e4d8');
    rug(1 * T + 2, 17 * T, 2 * T, 2 * T, '#5a4236', '#8a6a4a');
    rug(3 * T, 25 * T, 8 * T, 2 * T - 4, '#c8553d', '#f1ece2');
    for (let k = 0; k < 9; k++) { const sx = (42 + k) * T + 3, sy = 30 * T + 4 + (k % 2) * 8; stone(sx, sy); stone(sx + 7, sy + 10 - (k % 2) * 8); }
    for (let k = 0; k < 40; k++) { const fxp = 42 * T + hash(k, 1, 11) * 17 * T, fyp = 23 * T + hash(k, 2, 11) * 16 * T; if (!solid[(fyp / T) | 0][(fxp / T) | 0]) { R(fxp, fyp, 1, 1, ['#ffffff', '#ffd166', '#ff9ecf'][k % 3]); R(fxp, fyp + 1, 1, 1, '#3e8e46'); } }
    // cabos no chao dos servidores
    R(46 * T, 16 * T + 6, 7 * T, 2, '#2b2a3d'); R(53 * T, 15 * T, 2, 2 * T, '#2b2a3d');
    // paredes
    for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) drawWallTile(tx, ty);
    for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) if (door[ty][tx]) drawDoor(tx, ty);
    staticWallDeco();
  }
  function rug(x, y, w, h, c1, c2) {
    R(x, y, w, h, c1); R(x + 2, y + 2, w - 4, h - 4, c2); R(x + 4, y + 4, w - 8, h - 8, c1);
    for (let i = 8; i < w - 8; i += 8) { R(x + i, y + 4, 2, 2, c2); R(x + i, y + h - 6, 2, 2, c2); }
    for (let i = 8; i < h - 8; i += 8) { R(x + 4, y + i, 2, 2, c2); R(x + w - 6, y + i, 2, 2, c2); }
    if (w > 60) { const cx = x + (w >> 1), cy = y + (h >> 1); for (let r = 0; r < 4; r++) R(cx - 12 + r * 3, cy - r * 3, 24 - r * 6, r * 6 + 1, r % 2 ? c1 : c2); }
    for (let i = 0; i < w; i += 3) { R(x + i, y - 2, 1, 2, c2); R(x + i, y + h, 1, 2, c2); }
  }
  function stone(x, y) { R(x, y, 7, 5, '#a9a296'); R(x + 1, y - 1, 5, 1, '#a9a296'); R(x + 1, y, 5, 1, '#c8c1b4'); R(x, y + 5, 7, 1, '#7d776d'); }
  const wallCol = (tx, ty) => { const r = roomOf[ty] && roomOf[ty][tx]; return r ? ROOMS[r].wall : '#c4d0de'; };
  function isWall(tx, ty) { return inside(tx, ty) && !!wall[ty][tx]; }
  function drawWallTile(tx, ty) {
    const k = wall[ty][tx]; if (!k) return;
    const x = tx * T, y = ty * T;
    if (k === 'top') {
      if (ty === 1) return;
      const col = wallCol(tx, 2), pillar = tx === 0 || tx === 59 || tx === 14 || tx === 44;
      if (pillar) { R(x, 0, 16, 32, CAP); R(x + 2, 0, 1, 32, CAP_HI); R(x + 13, 0, 1, 32, CAP_LO); R(x, 28, 16, 4, BASEBOARD); return; }
      R(x, 0, 16, 4, CAP); R(x, 4, 16, 1, CAP_HI);
      R(x, 5, 16, 17, col); for (let i = 0; i < 4; i++) R(x + i * 4 + 1, 5, 1, 17, shade(col, -0.035));
      R(x, 22, 16, 1, shade(col, 0.3)); R(x, 23, 16, 5, shade(col, -0.16)); if (tx % 2 === 0) R(x, 23, 1, 5, shade(col, -0.28));
      R(x, 28, 16, 1, '#6b4a35'); R(x, 29, 16, 3, BASEBOARD);
      return;
    }
    if (k === 'h') {
      const below = roomOf[ty + 1] && roomOf[ty + 1][tx];
      R(x, y, 16, 4, CAP); R(x, y + 4, 16, 1, CAP_HI);
      if (below === 'garden') {
        R(x, y + 5, 16, 11, '#9a5b45');
        for (let r = 0; r < 3; r++) { R(x, y + 8 + r * 3, 16, 1, '#c9b8a4'); for (let i = (r % 2) * 4; i < 16; i += 8) R(x + i, y + 5 + r * 3, 1, 3, '#c9b8a4'); }
        if (hash(tx, ty, 3) < 0.5) { R(x + 3, y + 5, 2, 7, '#3e9e5f'); R(x + 2, y + 9, 2, 2, '#5cc27a'); }
        return;
      }
      const col = below ? ROOMS[below].wall : wallCol(tx, ty - 1);
      R(x, y + 5, 16, 8, col); for (let i = 0; i < 4; i++) R(x + i * 4 + 1, y + 5, 1, 8, shade(col, -0.035));
      R(x, y + 13, 16, 1, shade(col, 0.3)); R(x, y + 14, 16, 2, BASEBOARD);
      if (isWall(tx, ty - 1) && wall[ty - 1][tx] !== 'h') { R(x, y, 16, 4, CAP); }
      return;
    }
    if (k === 'v' || k === 'entry') {
      if (k === 'entry') {
        R(x, y, 16, 16, CAP); R(x + 3, y, 10, 16, 'rgba(170,215,255,0.55)'); R(x + 3, y, 1, 16, '#5a6b82'); R(x + 12, y, 1, 16, '#5a6b82'); R(x + 5, y + 3, 1, 8, 'rgba(255,255,255,0.7)');
        if (ty === 17) R(x + 3, y, 10, 1, '#5a6b82'); else R(x + 3, y + 15, 10, 1, '#5a6b82');
        R(x + 10, y + (ty === 17 ? 12 : 2), 2, 2, '#ffd166');
        return;
      }
      R(x, y, 16, 16, CAP); R(x + 2, y, 1, 16, CAP_HI); R(x + 13, y, 1, 16, CAP_LO);
      if (!isWall(tx, ty - 1)) R(x, y, 16, 1, CAP_HI);
      const below = inside(tx, ty + 1) && !wall[ty + 1][tx];
      if (below) { const col = wallCol(tx + (roomOf[ty + 1][tx] ? 0 : 1), ty + 1); R(x, y + 6, 16, 8, col); R(x, y + 6, 16, 1, shade(col, 0.3)); R(x, y + 14, 16, 2, BASEBOARD); }
      return;
    }
    if (k === 'glass') {
      R(x + 6, y, 4, 16, 'rgba(170,215,255,0.5)'); R(x + 6, y, 1, 16, '#5a6b82'); R(x + 9, y, 1, 16, '#5a6b82');
      R(x + 7, y + (ty % 3) * 4, 1, 5, 'rgba(255,255,255,0.75)');
      if (ty % 3 === 0) R(x + 6, y, 4, 1, '#5a6b82');
      if (!isWall(tx, ty + 1) || wall[ty + 1][tx] !== 'glass') R(x + 5, y + 12, 6, 4, '#5a6b82');
      return;
    }
    if (k === 'hedge') {
      R(x, y, 16, 16, '#2c6b3b');
      for (let i = 0; i < 5; i++) { const hx = (hash(tx, ty, i) * 11) | 0, hy = (hash(tx, ty, i + 9) * 10) | 0; R(x + hx, y + hy, 6, 5, '#3e8a4c'); R(x + hx + 1, y + hy, 3, 1, '#5cad66'); }
      if (hash(tx, ty, 21) < 0.5) R(x + 5, y + 6, 2, 2, '#ff9ecf');
      if (hash(tx, ty, 22) < 0.4) R(x + 11, y + 10, 2, 2, '#ffffff');
      R(x, y + 14, 16, 2, '#22532e');
    }
  }
  function drawDoor(tx, ty) {
    const x = tx * T, y = ty * T, vert = isWall(tx, ty - 1) || isWall(tx, ty + 1) ? (wall[ty - 1] && (wall[ty - 1][tx] === 'v' || wall[ty - 1][tx] === 'glass')) || (wall[ty + 1] && (wall[ty + 1][tx] === 'v' || wall[ty + 1][tx] === 'glass')) : false;
    if (vert) { R(x + 3, y, 10, 16, '#8a6a4a'); R(x + 3, y, 1, 16, '#6e5238'); R(x + 12, y, 1, 16, '#6e5238'); for (let i = 2; i < 16; i += 4) R(x + 4, y + i, 8, 1, '#7a5c40'); }
    else { R(x, y + 3, 16, 10, '#8a6a4a'); R(x, y + 3, 16, 1, '#6e5238'); R(x, y + 12, 16, 1, '#6e5238'); for (let i = 2; i < 16; i += 4) R(x + i, y + 4, 1, 8, '#7a5c40'); }
  }
  function frame(x, y, w, h, inner) { R(x - 1, y - 1, w + 2, h + 2, '#3a2a22'); R(x, y, w, h, inner); }
  function staticWallDeco() {
    // logo do escritorio
    R(424, 7, 96, 15, '#1d1c2b'); R(425, 8, 94, 13, '#2a2640'); R(425, 8, 94, 1, '#ff7a59');
    R(430, 11, 7, 7, '#ff7a59'); R(432, 13, 3, 3, '#2a2640'); text('AGENT BRANCH', 442, 12, '#f4f1de');
    // quadros
    frame(618, 8, 22, 13, '#8fd3ff'); R(618, 15, 22, 6, '#3e9e5f'); R(622, 11, 6, 5, '#ffffff'); R(620, 13, 10, 3, '#8d97a8'); R(630, 12, 8, 4, '#6d7688'); R(633, 9, 3, 3, '#ffd166');
    frame(178, 7, 30, 15, '#2a2640'); R(181, 10, 9, 9, '#ff7a59'); R(184, 13, 3, 3, '#2a2640'); text('AB', 193, 12, '#f4f1de');
    frame(62, 9, 18, 12, '#e9c46a'); R(65, 12, 6, 6, '#e07a5f'); R(72, 14, 5, 4, '#264653');
    // parede de baixo (copa / lounge)
    for (let k = 0; k < 9; k++) { const x = 2 * T + 6 + k * 17; R(x, 353, 15, 12, '#e9e4d8'); R(x, 353, 15, 1, '#ffffff'); R(x + 7, 353, 1, 12, '#c9c1b0'); R(x + 5, 359, 1, 2, '#8d97a8'); R(x + 9, 359, 1, 2, '#8d97a8'); }
    frame(23 * T, 355, 14, 9, '#ffd166'); R(23 * T + 3, 357, 8, 5, '#e5484d');
    frame(34 * T, 355, 12, 9, '#79c0ff'); R(34 * T + 2, 360, 8, 3, '#2fb36b');
    R(36 * T + 4, 354, 11, 11, '#2b2a3d'); ellipse(36 * T + 9, 359, 4, 4, '#f4f1e8'); ellipse(36 * T + 9, 359, 2, 2, '#e5484d'); R(36 * T + 9, 359, 1, 1, '#2b2a3d');
    // placa servidores
    R(53 * T, 197, 26, 9, '#ffd166'); text('SRV', 53 * T + 2, 199, '#2b2a3d'); R(53 * T + 15, 198, 9, 7, '#2b2a3d'); text('!', 53 * T + 18, 199, '#ffd166');
  }

  // ---------------------------------------------- elementos dinamicos da parede
  function sky(h) { // cor do ceu pela hora real
    const day = [[110, 190, 245], [190, 228, 255]], dusk = [[255, 140, 110], [255, 205, 150]], night = [[14, 20, 46], [36, 44, 86]];
    let a, b, k;
    if (h >= 7 && h < 17) return { top: day[0], bot: day[1], night: 0 };
    if (h >= 17 && h < 19) { k = (h - 17) / 2; a = day; b = dusk; }
    else if (h >= 19 && h < 20.5) { k = (h - 19) / 1.5; a = dusk; b = night; }
    else if (h >= 5 && h < 6) { k = h - 5; a = night; b = dusk; }
    else if (h >= 6 && h < 7) { k = h - 6; a = dusk; b = day; }
    else return { top: night[0], bot: night[1], night: 1 };
    const mix = (p, q) => p.map((v, i) => Math.round(lerp(v, q[i], k)));
    const nf = b === night ? k : a === night ? 1 - k : 0;
    return { top: mix(a[0], b[0]), bot: mix(a[1], b[1]), night: nf };
  }
  let SKY = sky(12);
  const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  function windowAt(x, y, w, h, t) {
    R(x - 2, y - 2, w + 4, h + 4, '#e9e4d8'); R(x - 2, y - 2, w + 4, 1, '#ffffff'); R(x - 3, y + h + 2, w + 6, 2, '#d8d0bf');
    const g = X.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, css(SKY.top)); g.addColorStop(1, css(SKY.bot));
    X.fillStyle = g; X.fillRect(x, y, w, h);
    if (SKY.night > 0.5) { for (let k = 0; k < 6; k++) if (Math.sin(t * 2 + k * 3 + x) > -0.3) R(x + ((hash(x, k, 1) * w) | 0), y + ((hash(x, k, 2) * (h - 3)) | 0), 1, 1, '#ffffff'); R(x + w - 6, y + 2, 3, 3, '#f4f1de'); }
    else { for (let k = 0; k < 2; k++) { const cx = x + ((t * (2 + k) + hash(x, k, 3) * 200) % (w + 16)) - 10, cy = y + 2 + k * 5; X.save(); X.beginPath(); X.rect(x, y, w, h); X.clip(); R(cx, cy, 9, 2, '#ffffff'); R(cx + 2, cy - 1, 4, 1, '#ffffff'); R(cx + 1, cy + 2, 7, 1, '#e3f1ff'); X.restore(); } R(x, y + h - 3, w, 3, SKY.night > 0.2 ? '#1d2440' : '#7fb06f'); R(x + 3, y + h - 6, 6, 3, SKY.night > 0.2 ? '#151a30' : '#4f8a5a'); R(x + w - 12, y + h - 8, 5, 5, SKY.night > 0.2 ? '#151a30' : '#4f8a5a'); }
    R(x + (w >> 1), y, 1, h, '#e9e4d8'); R(x, y + (h >> 1), w, 1, '#e9e4d8');
    R(x + 1, y + 1, 1, h - 2, 'rgba(255,255,255,0.35)');
  }
  wallDyn.push((t) => {
    [[24, 7, 22, 14], [250, 7, 30, 14], [570, 7, 30, 14], [660, 7, 30, 14], [906, 7, 22, 14]].forEach(([a, b, c, d]) => windowAt(a, b, c, d, t));
    // elevador
    const ex = 104, open = Math.max(0, Math.sin(t * 0.25)) > 0.85 ? 1 : 0;
    R(ex - 3, 4, 54, 26, '#8d97a8'); R(ex - 3, 4, 54, 1, '#c4cad6'); R(ex, 14, 48, 16, '#1d1c2b');
    const ow = open ? 9 : 0; R(ex, 14, 24 - ow, 16, '#aab3c2'); R(ex + 24 + ow, 14, 24 - ow, 16, '#aab3c2'); R(ex + 23 - ow, 14, 1, 16, '#6d7688'); R(ex + 24 + ow, 14, 1, 16, '#6d7688');
    R(ex + 17, 5, 14, 7, '#11131a'); text(String(1 + (Math.floor(t / 4) % 9)), ex + 19, 6, '#ffa657'); R(ex + 25, 7, 3, 1, Math.floor(t / 4) % 2 ? '#7ee787' : '#ffa657');
    R(ex + 50, 15, 3, 6, '#55607a'); R(ex + 51, 16, 1, 1, '#ffd166'); R(ex + 51, 19, 1, 1, '#ffd166');
    // relogio
    const cx = 548, cy = 14, d = new Date(), hh = (d.getHours() % 12 + d.getMinutes() / 60) / 12 * Math.PI * 2, mm = d.getMinutes() / 60 * Math.PI * 2;
    ellipse(cx, cy, 7, 7, '#2b2a3d'); ellipse(cx, cy, 6, 6, '#fbfbfd'); for (let k = 0; k < 4; k++) R(cx + Math.round(Math.sin(k * 1.57) * 5), cy - Math.round(Math.cos(k * 1.57) * 5), 1, 1, '#2b2a3d');
    for (let s = 0; s < 4; s++) R(cx + Math.round(Math.sin(mm) * s), cy - Math.round(Math.cos(mm) * s), 1, 1, '#2b2a3d');
    for (let s = 0; s < 3; s++) R(cx + Math.round(Math.sin(hh) * s), cy - Math.round(Math.cos(hh) * s), 1, 1, '#e5484d');
    // kanban
    const kx = 302, ky = 6; R(kx, ky, 100, 19, '#f8f6f0'); R(kx, ky, 100, 1, '#ffffff'); R(kx - 1, ky - 1, 102, 1, '#8d97a8'); R(kx - 1, ky + 19, 102, 1, '#8d97a8');
    R(kx + 33, ky + 1, 1, 17, '#d8d4c8'); R(kx + 66, ky + 1, 1, 17, '#d8d4c8');
    text('FAZER', kx + 7, ky + 1, '#9aa0b5'); text('FAZENDO', kx + 36, ky + 1, '#9aa0b5'); text('FEITO', kx + 74, ky + 1, '#9aa0b5');
    const cols = [[], [], []];
    for (let k = 0; k < 3; k++) cols[0].push('#ffd166');
    job.list.forEach((j) => cols[j.st === 'run' ? 1 : 2].push(j.st === 'run' ? '#ffd166' : j.st === 'ok' ? '#7ee787' : '#ff7b72'));
    cols.forEach((list, ci) => list.slice(-8).forEach((c, i) => { const sx = kx + 3 + ci * 33 + (i % 4) * 7, sy = ky + 8 + Math.floor(i / 4) * 5; R(sx, sy, 6, 4, c); R(sx, sy, 6, 1, shade(c, -0.15)); }));
    // quadro branco da reuniao
    const wx = 734; R(wx, 7, 66, 20, '#aab3c2'); R(wx + 1, 8, 64, 18, '#fbfbfd');
    R(wx + 4, 11, 20, 1, '#4a6fd8'); R(wx + 4, 14, 26, 1, '#9aa0b5'); R(wx + 4, 17, 14, 1, '#9aa0b5');
    R(wx + 36, 10, 10, 8, '#ffd166'); R(wx + 48, 12, 10, 8, '#7ee787'); R(wx + 42, 19, 1, 4, '#e5484d'); R(wx + 40, 22, 5, 1, '#e5484d');
    const wb = pois.find((p) => p.room === 'meeting' && p.pose === 'draw');
    const nn = wb && wb.busy ? Math.floor((t * 2) % 14) : 6; for (let k = 0; k < nn; k++) R(wx + 4 + k * 2, 21 + Math.round(Math.sin(k) * 1.5), 2, 1, '#2fb36b');
    R(wx + 1, 26, 64, 2, '#8d97a8');
    // TV da reuniao (grafico)
    const tvx = 842; R(tvx - 2, 6, 60, 22, '#11131a'); R(tvx, 8, 56, 18, '#0d1b2a');
    for (let k = 0; k < 7; k++) { const hgt = 3 + Math.round((Math.sin(t * 0.8 + k * 0.9) + 1) * 5); R(tvx + 4 + k * 7, 24 - hgt, 5, hgt, k % 2 ? '#79c0ff' : '#7ee787'); }
    R(tvx + 2, 24, 52, 1, '#3a4670'); text('KPI', tvx + 3, 10, '#ffa657');
    // TV do lounge
    const lx = 26 * T + 4, ly = 349; R(lx - 2, ly, 44, 17, '#11131a'); R(lx, ly + 2, 40, 13, '#1d2440');
    const sc = Math.floor(t * 0.2) % 3;
    if (sc === 0) { R(lx, ly + 10, 40, 5, '#3e9e5f'); R(lx + ((t * 8) % 40), ly + 9, 2, 2, '#ffffff'); R(lx + 4, ly + 5, 3, 5, '#ffd166'); R(lx + 33, ly + 5, 3, 5, '#ff7b72'); }
    else if (sc === 1) { for (let k = 0; k < 7; k++) R(lx + k * 6, ly + 2, 6, 13, ['#e5484d', '#ffa657', '#ffd166', '#7ee787', '#4cc9f0', '#4a6fd8', '#9b5de5'][k]); }
    else { R(lx, ly + 2, 40, 13, '#264653'); ellipse(lx + 20, ly + 9, 5 + Math.round(Math.sin(t * 3) * 2), 4, '#e9c46a'); }
  });

  // ------------------------------------------------------------ pathfinding
  function findPath(sx, sy, gx, gy) {
    if (!inside(gx, gy)) return null;
    if (sx === gx && sy === gy) return [];
    const N = MW * MH, g = new Float32Array(N).fill(1e9), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heap = [];
    const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = k * 2 + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const s = sy * MW + sx, goal = gy * MW + gx;
    g[s] = 0; push(Math.abs(gx - sx) + Math.abs(gy - sy), s);
    while (heap.length) {
      const [, cur] = pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % MW, cy = (cur / MW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!inside(nx, ny)) continue;
        const ni = ny * MW + nx;
        if (ni !== goal && solid[ny][nx]) continue;
        const ng = g[cur] + 1 + (door[ny][nx] ? 0.2 : 0);
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; push(ng + Math.abs(gx - nx) + Math.abs(gy - ny), ni); }
      }
    }
    if (came[goal] < 0) return null;
    const out = []; let c = goal;
    while (c !== s && c >= 0) { out.push([c % MW, (c / MW) | 0]); c = came[c]; }
    return out.reverse();
  }
  const tileOf = (x, y) => [clamp(Math.floor(x / T), 0, MW - 1), clamp(Math.floor((y - 2) / T), 0, MH - 1)];
  function nearestWalkable(tx, ty) {
    if (walkable(tx, ty)) return [tx, ty];
    for (let r = 1; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (walkable(tx + dx, ty + dy)) return [tx + dx, ty + dy];
    return [tx, ty];
  }

  // ----------------------------------------------------------- personagens
  const STYLES = {
    'agent-007': { skin: '#f0c8a0', hair: '#1e1b24', hairStyle: 'slick', shirt: '#262a40', pants: '#1d1f2e', shoe: '#0f0f14', acc: ['suit', 'sunglasses'], tie: '#d33a44' },
    'agent-decider': { skin: '#e7b48c', hair: '#6b3b2a', hairStyle: 'bun', shirt: '#8e5bd8', pants: '#3a3352', shoe: '#2a2030', acc: ['glasses', 'badge'] },
    'agent-architect': { skin: '#c98d5e', hair: '#2b211c', hairStyle: 'short', shirt: '#2aa198', pants: '#3d4a5c', shoe: '#3a2a22', acc: ['hardhat'] },
    'agent-coder': { skin: '#f3cfb0', hair: '#2d2a35', hairStyle: 'messy', shirt: '#3fae6a', pants: '#2f3445', shoe: '#e9e4d8', acc: ['hoodie', 'headphones'] },
    'agent-tester': { skin: '#8d5a3a', hair: '#151217', hairStyle: 'curly', shirt: '#ff8a3d', pants: '#384058', shoe: '#2a2030', acc: ['labcoat', 'glasses'] },
    'agent-reviewer': { skin: '#f1c49b', hair: '#a35a2a', hairStyle: 'short', shirt: '#3d7bd9', pants: '#2e3346', shoe: '#3a2a22', acc: ['beard', 'glasses'] },
    'agent-docs': { skin: '#f6d5b5', hair: '#d9a441', hairStyle: 'long', shirt: '#e3c08f', pants: '#5a4636', shoe: '#6b3b2a', acc: ['cardigan'] },
    usuario: { skin: '#e0a878', hair: '#4a3020', hairStyle: 'short', shirt: '#ff6f91', pants: '#33405a', shoe: '#e9e4d8', acc: [] },
  };
  function styleFor(name, i) {
    if (STYLES[name]) return STYLES[name];
    const h = (k) => hash(i + 3, k, name.length);
    return {
      skin: ['#f1c49b', '#e0a878', '#c68654', '#8d5a3a', '#f6d5b5'][(h(1) * 5) | 0], hair: ['#2b1b12', '#6b3e26', '#e0b04a', '#1a1a1a', '#a33b20', '#d9d2c5'][(h(2) * 6) | 0],
      hairStyle: ['short', 'messy', 'long', 'bun', 'curly', 'bald'][(h(3) * 6) | 0], shirt: ['#e07a5f', '#4cc9f0', '#9b5de5', '#f15bb5', '#00bbf9', '#90be6d'][(h(4) * 6) | 0],
      pants: '#2f3445', shoe: '#2a2030', acc: h(5) > 0.6 ? ['glasses'] : [],
    };
  }

  function drawPerson(px, py, st, o) {
    const x = Math.round(px), feet = Math.round(py), y = feet - Math.round(o.lift || 0);
    const pose = o.pose || 'stand', sit = pose === 'sit' || pose === 'sitBack' || pose === 'type' || pose === 'sleep';
    if (!sit) { const s = 1 - Math.min(0.6, (o.lift || 0) / 14); X.globalAlpha = s; R(x - 4, feet - 1, 9, 1, 'rgba(20,12,30,0.3)'); R(x - 5, feet, 11, 1, 'rgba(20,12,30,0.3)'); R(x - 3, feet + 1, 7, 1, 'rgba(20,12,30,0.22)'); X.globalAlpha = 1; }
    let d = o.dir || 'd';
    const mirror = d === 'l';
    if (mirror) { X.save(); X.translate(2 * x, 0); X.scale(-1, 1); d = 'r'; }
    const f = o.f | 0, k = o.k | 0, acc = st.acc || [];
    const has = (a) => acc.indexOf(a) >= 0;
    const L = x - 5, T0 = y - 22 + (sit ? 3 : 0) + (o.bob || 0), tt = T0 + 10;
    const skin = st.skin, skinD = shade(skin, -0.16), P = st.pants, PD = shade(P, -0.3), S = st.shoe || '#2a2030';
    let SH = st.shirt, SD = shade(SH, -0.22), SL = shade(SH, 0.2);
    if (has('labcoat')) { SH = '#f1f1f5'; SD = '#cfd0dc'; SL = '#ffffff'; }
    const H = st.hair, HD = shade(H, -0.3), HL = shade(H, 0.25);
    const eye = '#1b1726', mouth = '#9a4a4a';
    // pernas
    if (pose === 'sit' || pose === 'sleep') {
      if (d === 'd') { R(L + 2, y - 4, 2, 3, P); R(L + 6, y - 4, 2, 3, P); R(L + 1, y - 1, 3, 1, S); R(L + 6, y - 1, 3, 1, S); }
      else if (d === 'r') { R(L + 3, y - 5, 5, 2, P); R(L + 6, y - 3, 2, 2, P); R(L + 6, y - 1, 3, 1, S); }
    } else if (!sit) {
      if (d === 'r') {
        if (pose === 'walk' && f === 1) { R(L + 2, y - 6, 2, 4, PD); R(L + 1, y - 2, 3, 1, S); R(L + 5, y - 6, 2, 5, P); R(L + 5, y - 1, 3, 1, S); }
        else if (pose === 'walk' && f === 3) { R(L + 5, y - 6, 2, 5, PD); R(L + 5, y - 1, 3, 1, shade(S, -0.2)); R(L + 2, y - 6, 2, 4, P); R(L + 1, y - 2, 3, 1, S); }
        else { R(L + 3, y - 6, 3, 5, P); R(L + 3, y - 1, 4, 1, S); }
      } else {
        const lu = pose === 'walk' && f === 1, ru = pose === 'walk' && f === 3;
        R(L + 2, y - 6, 2, lu ? 4 : 5, P); R(L + 6, y - 6, 2, ru ? 4 : 5, d === 'u' ? P : PD); R(L + 4, y - 6, 2, 1, P);
        R(L + 1, lu ? y - 2 : y - 1, 3, 1, S); R(L + 6, ru ? y - 2 : y - 1, 3, 1, S);
      }
    }
    // capuz atras da cabeca
    if (has('hoodie') && d === 'd') R(L, T0 + 8, 10, 2, SD);
    // tronco
    if (d === 'r') { R(L + 2, tt, 6, 6, SH); R(L + 2, tt, 1, 6, SD); R(L + 7, tt, 1, 5, SL); R(L + 2, tt + 6, 6, 1, PD); }
    else {
      R(L + 1, tt, 8, 6, SH); R(L + 7, tt, 2, 6, SD); R(L + 2, tt, 1, 4, SL); R(L + 1, tt + 6, 8, 1, PD);
      if (has('labcoat') && !sit) { R(L + 1, y - 6, 2, 3, SH); R(L + 7, y - 6, 2, 3, SD); }
    }
    if (d === 'd') {
      if (has('suit')) { R(L + 3, tt, 4, 2, '#f2f2f2'); R(L + 4, tt + 2, 2, 1, '#f2f2f2'); R(L + 4, tt, 2, 1, shade(st.tie, -0.3)); R(L + 4, tt + 1, 2, 4, st.tie); R(L + 3, tt + 2, 1, 2, SD); R(L + 6, tt + 2, 1, 2, SD); }
      if (has('labcoat')) { R(L + 4, tt, 2, 6, st.shirt); R(L + 2, tt + 1, 1, 2, '#3a6ff7'); }
      if (has('hoodie')) { R(L + 4, tt + 1, 1, 2, '#eeeeee'); R(L + 5, tt + 1, 1, 2, '#eeeeee'); R(L + 2, tt + 3, 6, 2, SD); }
      if (has('cardigan')) { R(L + 4, tt, 2, 6, '#f3ead8'); R(L + 3, tt + 1, 1, 1, '#6b4a2a'); R(L + 3, tt + 3, 1, 1, '#6b4a2a'); }
      if (has('badge')) { R(L + 2, tt + 1, 1, 2, '#ffffff'); R(L + 2, tt + 1, 1, 1, '#4a6fd8'); }
    }
    if (d === 'u' && has('hoodie')) R(L + 1, T0 + 8, 8, 3, SD);
    // bracos
    const sw = pose === 'walk' ? [0, 1, 0, -1][f] : 0;
    const armL = (h, c) => R(L, tt, 1, h, c), armR = (h, c) => R(L + 9, tt, 1, h, c);
    if (d === 'r') {
      if (pose === 'water') { R(L + 5, tt + 1, 3, 2, SD); R(L + 8, tt + 1, 4, 3, '#4aa3df'); R(L + 8, tt + 1, 4, 1, '#79c0ff'); R(L + 12, tt, 2, 1, '#4aa3df'); R(L + 9, tt - 1, 2, 1, '#2b2a3d'); }
      else if (pose === 'pingpong') { const up = k % 2; R(L + 5, tt + 1, 3, 2, SD); R(L + 8, tt - 1 + up * 2, 3, 3, '#d64545'); R(L + 8, tt + 2 + up * 2, 1, 1, '#7a4a2a'); }
      else if (pose === 'sit' || pose === 'sleep') { R(L + 4, tt + 1, 2, 4, SD); R(L + 5, tt + 5, 2, 1, skin); }
      else { R(L + 4 + sw, tt + 1, 2, 4, SD); R(L + 4 + sw, tt + 5, 2, 1, skin); }
    } else if (pose === 'type' || pose === 'play') {
      const a = k % 2; R(L - 1, tt + 1, 1, 3, SH); R(L + 10, tt + 1, 1, 3, SD); R(L, tt - 1 - a, 1, 2, skin); R(L + 9, tt - 2 + a, 1, 2, skin);
    } else if (pose === 'draw') {
      armL(5, SH); R(L, tt + 5, 1, 1, skin); R(L + 9, tt - 5, 1, 5, SD); R(L + 9 + (k % 2), tt - 6, 1, 1, skin); R(L + 9 + (k % 2), tt - 7, 1, 1, '#2fb36b');
    } else if (pose === 'drink' && d === 'd') {
      armL(5, SH); R(L, tt + 5, 1, 1, skin);
      if (o.sip) { R(L + 8, tt - 1, 1, 2, SD); R(L + 5, T0 + 6, 3, 3, o.cup || '#f4f1e8'); R(L + 8, T0 + 7, 1, 1, o.cup || '#f4f1e8'); }
      else { R(L + 9, tt, 1, 3, SD); R(L + 8, tt + 2, 3, 3, o.cup || '#f4f1e8'); R(L + 11, tt + 3, 1, 1, o.cup || '#f4f1e8'); R(L + 8, tt + 2, 3, 1, '#5a3418'); }
    } else if (pose === 'read' && d === 'd') {
      armL(3, SH); armR(3, SD); const bc = o.book || '#4a6fd8';
      R(L + 1, tt + 2, 8, 4, bc); R(L + 2, tt + 2, 6, 1, '#f8f4e8'); R(L + 5, tt + 2, 1, 4, shade(bc, -0.3)); R(L, tt + 3, 1, 1, skin); R(L + 9, tt + 3, 1, 1, skin);
    } else if (pose === 'jump' || pose === 'cheer') {
      R(L, tt - 4, 1, 4, SH); R(L, tt - 5, 1, 1, skin); R(L + 9, tt - 4, 1, 4, SD); R(L + 9, tt - 5, 1, 1, skin);
    } else if (pose === 'facepalm') {
      armL(5, SH); R(L, tt + 5, 1, 1, skin); R(L + 8, tt - 1, 1, 2, SD); R(L + 4, T0 + 4, 4, 3, skin);
    } else if (pose === 'wave') {
      armL(5, SH); R(L, tt + 5, 1, 1, skin); R(L + 9, tt - 4 + (k % 2), 1, 4, SD); R(L + 9 + (k % 2), tt - 5, 1, 1, skin);
    } else if (pose === 'phone') {
      armL(5, SH); R(L, tt + 5, 1, 1, skin); R(L + 9, tt - 2, 1, 3, SD); R(L + 8, T0 + 4, 2, 2, skin); R(L + 9, T0 + 3, 1, 3, '#222233');
    } else if (sit) {
      armL(4, d === 'u' ? SD : SH); armR(4, d === 'u' ? SH : SD); if (d === 'd') { R(L + 1, tt + 4, 1, 1, skin); R(L + 8, tt + 4, 1, 1, skin); }
    } else {
      armL(5, d === 'u' ? SD : SH); R(L, tt + 5 + sw, 1, 1, skin); armR(5, d === 'u' ? SH : SD); R(L + 9, tt + 5 - sw, 1, 1, skin);
    }
    // cabeca
    const hy = T0, closed = o.blink || pose === 'sleep';
    if (d === 'd') {
      R(L + 1, hy + 2, 8, 7, skin); R(L + 8, hy + 3, 1, 5, skinD); R(L + 2, hy + 8, 6, 1, skinD);
      R(L, hy + 4, 1, 2, skin); R(L + 9, hy + 4, 1, 2, skinD); R(L + 4, hy + 9, 2, 1, skinD);
      if (o.happy) { R(L + 2, hy + 5, 1, 1, eye); R(L + 3, hy + 4, 1, 1, eye); R(L + 6, hy + 4, 1, 1, eye); R(L + 7, hy + 5, 1, 1, eye); }
      else if (closed) { R(L + 2, hy + 5, 2, 1, eye); R(L + 6, hy + 5, 2, 1, eye); }
      else { R(L + 3, hy + 4, 1, 2, eye); R(L + 6, hy + 4, 1, 2, eye); R(L + 3, hy + 4, 1, 1, '#4a4060'); }
      R(L + 2, hy + 6, 1, 1, '#f09a9a'); R(L + 7, hy + 6, 1, 1, '#f09a9a');
      if (o.happy) { R(L + 3, hy + 7, 4, 1, mouth); R(L + 4, hy + 8, 2, 1, mouth); }
      else R(L + 4, hy + 7, 2, o.talk ? 2 : 1, mouth);
      if (has('beard')) { R(L + 1, hy + 6, 1, 3, H); R(L + 8, hy + 6, 1, 3, H); R(L + 2, hy + 8, 6, 2, H); R(L + 3, hy + 7, 1, 1, H); R(L + 6, hy + 7, 1, 1, H); R(L + 4, hy + 8, 2, 1, mouth); }
    } else if (d === 'r') {
      R(L + 2, hy + 2, 7, 7, skin); R(L + 9, hy + 5, 1, 1, skin); R(L + 3, hy + 8, 5, 1, skinD); R(L + 4, hy + 4, 1, 2, skinD);
      if (closed) R(L + 7, hy + 5, 1, 1, eye); else R(L + 7, hy + 4, 1, 2, eye);
      R(L + 7, hy + 7, 1, 1, mouth); R(L + 8, hy + 6, 1, 1, '#f09a9a');
      if (has('beard')) { R(L + 4, hy + 6, 5, 3, H); R(L + 7, hy + 7, 1, 1, mouth); }
    } else {
      R(L + 1, hy + 2, 8, 7, skinD); R(L + 3, hy + 9, 4, 1, skinD); R(L, hy + 4, 1, 2, skinD); R(L + 9, hy + 4, 1, 2, skinD);
    }
    // cabelo
    const hs = st.hairStyle;
    if (d === 'd') {
      if (hs === 'bald') { R(L + 2, hy + 1, 6, 1, skin); R(L + 3, hy + 2, 2, 1, shade(skin, 0.3)); R(L, hy + 3, 1, 2, H); R(L + 9, hy + 3, 1, 2, H); }
      else if (hs === 'curly') { R(L, hy, 10, 3, H); R(L + 1, hy - 1, 2, 1, H); R(L + 4, hy - 1, 2, 1, H); R(L + 7, hy - 1, 2, 1, H); R(L, hy + 3, 1, 3, H); R(L + 9, hy + 3, 1, 3, H); R(L + 2, hy + 1, 1, 1, HL); R(L + 6, hy, 1, 1, HL); R(L + 4, hy + 2, 1, 1, HD); R(L + 1, hy + 3, 1, 1, H); R(L + 8, hy + 3, 1, 1, H); }
      else {
        R(L + 1, hy, 8, 1, H); R(L, hy + 1, 10, 2, H); R(L + 3, hy + 1, 2, 1, HL);
        if (hs === 'long') { R(L, hy + 3, 1, 9, H); R(L + 9, hy + 3, 1, 9, HD); R(L + 1, hy + 3, 2, 1, H); R(L + 7, hy + 3, 2, 1, H); }
        else if (hs === 'slick') { R(L, hy + 3, 1, 2, H); R(L + 9, hy + 3, 1, 2, H); R(L + 6, hy + 1, 1, 1, HL); }
        else { R(L, hy + 3, 1, 1, H); R(L + 9, hy + 3, 1, 1, H); R(L + 1, hy + 3, 3, 1, H); }
        if (hs === 'messy') { R(L + 1, hy - 1, 1, 1, H); R(L + 4, hy - 1, 2, 1, H); R(L + 8, hy - 1, 1, 1, H); R(L + 5, hy + 3, 2, 1, H); }
        if (hs === 'bun') { R(L + 3, hy - 2, 4, 2, H); R(L + 4, hy - 3, 2, 1, H); R(L + 4, hy - 2, 1, 1, HL); }
      }
    } else if (d === 'r') {
      if (hs === 'bald') { R(L + 3, hy + 1, 5, 1, skin); R(L + 1, hy + 4, 3, 3, H); }
      else {
        R(L + 2, hy, 6, 1, H); R(L + 1, hy + 1, 8, 2, H); R(L + 1, hy + 3, 3, 4, H); R(L + 8, hy + 3, 1, 1, H); R(L + 4, hy + 1, 2, 1, HL);
        if (hs === 'long') R(L + 1, hy + 3, 3, 9, H);
        if (hs === 'bun') { R(L - 1, hy + 1, 3, 3, H); }
        if (hs === 'messy') { R(L + 3, hy - 1, 1, 1, H); R(L + 6, hy - 1, 1, 1, H); }
        if (hs === 'curly') { R(L + 1, hy - 1, 7, 1, H); R(L, hy + 2, 2, 5, H); }
      }
    } else {
      if (hs === 'bald') { R(L + 1, hy, 8, 8, skin); R(L + 3, hy + 1, 2, 1, shade(skin, 0.3)); R(L, hy + 4, 10, 3, H); }
      else {
        R(L + 1, hy, 8, 1, H); R(L, hy + 1, 10, 7, H); R(L + 8, hy + 1, 2, 7, HD); R(L + 2, hy + 1, 3, 1, HL); R(L + 3, hy + 8, 4, 1, skinD);
        if (hs === 'long') R(L, hy + 8, 10, 4, H);
        if (hs === 'bun') { R(L + 3, hy - 2, 4, 2, H); R(L + 4, hy - 3, 2, 1, H); }
        if (hs === 'messy') { R(L + 1, hy - 1, 1, 1, H); R(L + 4, hy - 1, 2, 1, H); R(L + 8, hy - 1, 1, 1, H); }
        if (hs === 'curly') { R(L + 1, hy - 1, 2, 1, H); R(L + 4, hy - 1, 2, 1, H); R(L + 7, hy - 1, 2, 1, H); R(L + 3, hy + 4, 1, 1, HD); R(L + 6, hy + 2, 1, 1, HL); }
      }
    }
    // acessorios da cabeca
    if (has('glasses')) {
      if (d === 'd') { R(L + 2, hy + 4, 3, 2, '#2a2a3a'); R(L + 5, hy + 4, 3, 2, '#2a2a3a'); R(L + 3, hy + 4, 1, 1, '#bfe6ff'); R(L + 6, hy + 4, 1, 1, '#bfe6ff'); }
      else if (d === 'r') { R(L + 6, hy + 4, 3, 2, '#2a2a3a'); R(L + 7, hy + 4, 1, 1, '#bfe6ff'); R(L + 4, hy + 4, 2, 1, '#2a2a3a'); }
      else { R(L, hy + 4, 1, 1, '#2a2a3a'); R(L + 9, hy + 4, 1, 1, '#2a2a3a'); }
    }
    if (has('sunglasses')) {
      if (d === 'd') { R(L + 2, hy + 4, 6, 2, '#15151c'); R(L + 3, hy + 4, 1, 1, '#5a5a78'); R(L + 6, hy + 4, 1, 1, '#5a5a78'); }
      else if (d === 'r') R(L + 6, hy + 4, 3, 2, '#15151c');
    }
    if (has('headphones')) {
      const HP = '#e5484d', HPD = '#2b2a3d';
      if (d === 'r') { R(L + 2, hy - 1, 6, 1, HPD); R(L + 3, hy + 3, 3, 3, HP); }
      else { R(L, hy - 1, 10, 1, HPD); R(L - 1, hy + 3, 2, 3, HP); R(L + 9, hy + 3, 2, 3, HP); }
    }
    if (has('hardhat')) {
      if (d === 'r') { R(L + 1, hy - 1, 8, 3, '#f4c430'); R(L, hy + 2, 11, 1, '#d9a91c'); R(L + 3, hy - 1, 2, 1, '#ffe27a'); }
      else { R(L, hy - 1, 10, 3, '#f4c430'); R(L - 1, hy + 2, 12, 1, '#d9a91c'); R(L + 2, hy - 1, 3, 1, '#ffe27a'); R(L + 4, hy - 2, 2, 1, '#f4c430'); }
    }
    if (mirror) X.restore();
  }

  // ------------------------------------------------------------- particulas
  const parts = [];
  function puff(x, y, kind, n = 1) {
    for (let i = 0; i < n; i++) {
      const p = { x, y, vx: rand(-4, 4), vy: rand(-12, -6), life: 0, max: rand(1, 1.8), kind };
      if (kind === 'confetti') { p.vx = rand(-30, 30); p.vy = rand(-50, -20); p.c = pick(['#ff7a59', '#ffd166', '#7ee787', '#79c0ff', '#d2a8ff', '#ff9ecf']); p.max = rand(1.2, 2); }
      if (kind === 'z') { p.vx = rand(2, 5); p.vy = -6; p.max = 2.2; }
      if (kind === 'drop') { p.vx = rand(6, 12); p.vy = rand(-4, 2); p.max = 0.7; }
      if (kind === 'spark') { p.vx = rand(-24, 24); p.vy = rand(-24, 24); p.max = 0.5; }
      if (kind === 'heart' || kind === 'note') { p.vx = rand(-3, 3); p.vy = -9; p.max = 1.6; }
      parts.push(p);
    }
  }
  function updateParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt; if (p.life > p.max) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'confetti' || p.kind === 'drop') p.vy += 80 * dt;
    }
  }
  function drawParts() {
    for (const p of parts) {
      const a = 1 - p.life / p.max;
      X.globalAlpha = Math.max(0, a);
      if (p.kind === 'steam') R(p.x + Math.sin(p.life * 6) * 1.5, p.y, 1, 1, '#ffffff');
      else if (p.kind === 'confetti') R(p.x, p.y, 2, 1 + ((p.life * 10) % 2 | 0), p.c);
      else if (p.kind === 'z') text('Z', p.x, p.y, '#bfc6ff');
      else if (p.kind === 'drop') R(p.x, p.y, 1, 2, '#79c0ff');
      else if (p.kind === 'spark') R(p.x, p.y, 1, 1, '#ffd166');
      else if (p.kind === 'heart') icon('heart', p.x, p.y);
      else if (p.kind === 'note') icon('note', p.x, p.y);
      X.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- agentes
  const agents = new Map();
  let liveName = null;
  const WALK = 34, RUN = 125;
  class Agent {
    constructor(name, idx, desk) {
      this.name = name; this.idx = idx; this.st = styleFor(name, idx);
      this.short = name.replace(/^agent-/, '').toUpperCase();
      this.desk = desk; if (desk) desk.agent = this;
      const p = desk && idx % 2 === 0 ? null : pickPoi(this);
      const [tx, ty] = p ? p.at : nearestWalkable(20 + idx * 3, 8);
      this.x = tx * T + 8; this.y = ty * T + 11; this.dir = 'd';
      this.path = []; this.speed = WALK; this.walkDist = 0;
      this.state = 'idle'; this.timer = rand(0.2, 2.5); this.pose = 'stand';
      this.seat = null; this.poi = null; this.phase = null;
      this.mode = 'free'; this.waitFor = ''; this.bubble = null; this.action = '';
      this.flashUntil = 0; this.ok = true; this.coffeeUntil = 0; this.blinkAt = rand(1, 4); this.k = 0; this.kt = 0;
      this.onArrive = null; this.lastPoi = null; this.inPose = false; this.cup = '#f4f1e8'; this.book = pick(['#4a6fd8', '#e5484d', '#2fb36b', '#9b5de5']);
      if (desk && idx % 2 === 0) { this.sitDesk(); this.timer = rand(4, 14); }
      else if (p) { this.goPoi(p, true); }
    }
    screen() {
      if (this.mode === 'work') return 'work';
      if (this.mode === 'wait') return 'wait';
      if (this.flashUntil > NOW) return this.ok ? 'ok' : 'fail';
      if (this.seatedAtDesk()) return 'idle';
      return 'off';
    }
    seatedAtDesk() { return this.seat === 'desk' && !this.path.length; }
    tile() { return tileOf(this.x, this.y); }
    walkTo(tx, ty, fx, fy, then, run) {
      let [sx, sy] = this.tile();
      const pre = [];
      if (this.exitTile) { pre.push([this.exitTile[0] * T + 8, this.exitTile[1] * T + 11]); [sx, sy] = this.exitTile; this.exitTile = null; }
      const p = findPath(sx, sy, tx, ty);
      this.path = pre.concat((p || []).map(([a, b]) => [a * T + 8, b * T + 11]));
      if (!p) { this.x = tx * T + 8; this.y = ty * T + 11; }
      if (fx != null) this.path.push([fx, fy]);
      this.speed = run ? RUN : WALK; this.onArrive = then; this.state = 'walk'; this.pose = 'walk'; this.inPose = false; this.seat = null;
    }
    release() { if (this.poi) { this.poi.busy = null; this.poi = null; } this.inPose = false; }
    goPoi(p, instant) {
      this.release(); p.busy = this; this.poi = p; this.lastPoi = p;
      const arrive = () => {
        this.x = p.fx; this.y = p.fy; this.dir = p.dir; this.pose = p.pose; this.inPose = true; this.state = 'activity';
        this.exitTile = p.seat ? p.at : null; this.seat = p.seat || null;
        this.timer = rand(p.dur[0], p.dur[1]); this.phase = p.then || null; this.iconT = rand(2, 5);
        if (p.kind === 'coffee') { fx.brewUntil = NOW + this.timer; this.cup = pick(['#f4f1e8', '#e5484d', '#4a6fd8']); }
        if (p.kind === 'cooler') { fx.coolerUntil = NOW + this.timer; this.cup = '#dff3ff'; }
        if (p.kind === 'vend') { fx.vendUntil = NOW + this.timer; this.cup = pick(['#e5484d', '#4cc9f0', '#7ee787']); }
      };
      if (instant) { arrive(); this.timer = rand(1, p.dur[1]); return; }
      this.walkTo(p.at[0], p.at[1], p.fx, p.fy, arrive, false);
    }
    summon() {
      this.mode = 'work'; this.bubble = { icon: 'bang', until: NOW + 1.6 }; this.action = '';
      if (this.seatedAtDesk()) { this.pose = 'type'; this.state = 'desk'; return; }
      this.release();
      const d = this.desk;
      if (!d) { this.state = 'desk'; return; }
      puff(this.x, this.y - 24, 'spark', 6);
      this.walkTo(d.tx, d.ty + 1, d.chairX, d.chairY, () => this.sitDesk(), true);
    }
    sitDesk() {
      const d = this.desk; this.x = d.chairX; this.y = d.chairY; this.dir = 'u'; this.seat = 'desk'; this.exitTile = [d.tx, d.ty + 1];
      this.state = 'desk'; this.pose = this.mode === 'work' ? 'type' : 'sitBack'; this.inPose = true;
      if (this.mode !== 'work' && this.mode !== 'wait') { this.state = 'activity'; this.timer = rand(6, 12); }
    }
    waitFor_(other) {
      this.mode = 'wait'; this.waitFor = other; this.action = '';
      if (this.state !== 'walk') { this.pose = 'sitBack'; }
    }
    finish(ok) {
      this.mode = 'free'; this.waitFor = ''; this.action = ''; this.ok = ok; this.flashUntil = NOW + 4;
      this.bubble = { icon: ok ? 'check' : 'cross', until: NOW + 2.5 };
      if (this.state === 'walk' && this.onArrive && this.speed === RUN) { this.path = []; this.onArrive = null; }
      if (this.seat === 'desk' && this.exitTile) { this.x = this.exitTile[0] * T + 14; this.y = this.exitTile[1] * T + 14; this.exitTile = null; this.seat = null; }
      this.release(); this.path = [];
      this.state = 'cheer'; this.pose = ok ? 'jump' : 'facepalm'; this.dir = 'd'; this.timer = ok ? 2.2 : 2.4; this.cheerT = 0;
      if (ok) puff(this.x, this.y - 20, 'confetti', 18);
    }
    say(txt, secs = 4, iconName) { this.bubble = { text: txt, icon: iconName, until: NOW + secs }; }
    update(dt) {
      this.kt += dt; if (this.kt > (this.mode === 'work' ? 0.11 : 0.35)) { this.kt = 0; this.k++; }
      if (NOW > this.blinkAt) { this.blinkUntil = NOW + 0.13; this.blinkAt = NOW + rand(2, 5); }
      if (this.path.length) {
        const [tx, ty] = this.path[0], dx = tx - this.x, dy = ty - this.y, dist = Math.hypot(dx, dy), step = this.speed * dt;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'd' : 'u');
        if (dist <= step) { this.x = tx; this.y = ty; this.path.shift(); this.walkDist += dist; }
        else { this.x += (dx / dist) * step; this.y += (dy / dist) * step; this.walkDist += step; }
        this.pose = 'walk';
        if (this.speed === RUN && Math.random() < dt * 8) puff(this.x - (this.dir === 'r' ? 4 : this.dir === 'l' ? -4 : 0), this.y, 'steam');
        if (!this.path.length) { const cb = this.onArrive; this.onArrive = null; this.walkDist = 0; if (cb) cb(); else { this.state = 'idle'; this.pose = 'stand'; this.timer = rand(1, 3); } }
        return;
      }
      if (this.state === 'desk') { this.pose = this.mode === 'work' ? 'type' : 'sitBack'; if (this.mode === 'work' && Math.random() < dt * 0.4) puff(this.x + rand(-5, 5), this.y - 26, 'spark'); return; }
      if (this.state === 'cheer') {
        this.timer -= dt; this.cheerT += dt;
        if (this.timer < 0) { this.state = 'idle'; this.pose = 'stand'; this.timer = rand(0.5, 1.5); }
        return;
      }
      if (this.mode !== 'free') return;
      this.timer -= dt;
      if (this.state === 'activity') {
        if (this.poi) {
          this.iconT -= dt;
          if (this.iconT < 0) { this.iconT = rand(3, 7); const ic = this.poi.icon; if (ic) this.bubble = { icon: ic, until: NOW + 1.6 }; }
          if (this.pose === 'sleep' && Math.random() < dt * 0.7) puff(this.x + 3, this.y - 20, 'z');
          if (this.pose === 'water' && Math.random() < dt * 10) puff(this.x + (this.dir === 'l' ? -9 : 9), this.y - 12, 'drop');
          if (this.pose === 'play' && this.poi.icon === 'game' && Math.random() < dt * 0.3) puff(this.x, this.y - 28, 'note');
          if (this.pose === 'drink') this.sip = Math.sin(NOW * 1.2 + this.idx) > 0.6;
        }
        if (this.timer < 0) {
          if (this.phase) { const ph = this.phase; this.phase = null; this.pose = ph.pose; this.dir = ph.dir; this.timer = rand(ph.dur[0], ph.dur[1]); if (ph.pose === 'drink') this.coffeeUntil = NOW + 60; return; }
          this.release(); this.state = 'idle'; this.pose = 'stand'; this.timer = rand(0.3, 1.5);
          if (this.seat) { const e = this.exitTile; if (e) { this.x = e[0] * T + 8; this.y = e[1] * T + 11; } this.exitTile = null; this.seat = null; }
        }
        return;
      }
      if (this.state === 'idle' && this.timer < 0) {
        if (Math.random() < 0.18 && this.desk) { this.walkTo(this.desk.tx, this.desk.ty + 1, this.desk.chairX, this.desk.chairY, () => this.sitDesk(), false); return; }
        const p = pickPoi(this);
        if (p) this.goPoi(p); else this.timer = rand(1, 3);
      }
    }
    base() { return this.y + (this.seat === 'back' || this.seat === 'desk' ? -0.5 : this.seat === 'front' ? 0.5 : 0); }
    draw(t) {
      const sit = this.seat && !this.path.length;
      let lift = 0;
      if (this.state === 'cheer' && this.pose === 'jump') lift = Math.abs(Math.sin(this.cheerT * 7)) * 6;
      const bob = this.pose === 'type' ? (this.k % 4 === 0 ? 1 : 0) : this.pose === 'walk' ? (Math.floor(this.walkDist / 4) % 2 ? -1 : 0) : (sit ? 0 : Math.sin(t * 2 + this.idx) > 0.8 ? 1 : 0);
      drawPerson(this.x, this.y, this.st, {
        dir: this.dir, pose: this.pose, f: Math.floor(this.walkDist / 4) % 4, k: this.k, bob, lift,
        blink: this.blinkUntil > NOW, talk: this.mode === 'work' && this.k % 3 === 0 && this.pose !== 'type', happy: this.state === 'cheer' && this.ok,
        sip: this.sip, cup: this.cup, book: this.book,
      });
    }
  }
  function pickPoi(a) {
    const free = pois.filter((p) => !p.busy && p !== a.lastPoi);
    if (!free.length) return null;
    let tot = 0; free.forEach((p) => (tot += p.w));
    let r = Math.random() * tot;
    for (const p of free) { r -= p.w; if (r <= 0) return p; }
    return free[free.length - 1];
  }

  // usuario (visitante na recepcao)
  const user = { x: 6 * T + 8, y: 8 * T + 10, dir: 'u', pose: 'stand', k: 0, until: 0, st: STYLES.usuario };
  ent(user.x - 8, user.y - 30, 16, 32, user.y, (t) => {
    if (user.until > NOW) { user.k = Math.floor(t * 6); } else { user.pose = 'stand'; user.dir = 'u'; }
    drawPerson(user.x, user.y, user.st, { dir: user.dir, pose: user.pose, k: user.k, lift: user.pose === 'jump' ? Math.abs(Math.sin(t * 7)) * 5 : 0, happy: user.pose === 'jump' });
  });
  function userAct(pose, secs) { user.pose = pose; user.dir = 'd'; user.until = NOW + secs; }

  // gato e aspirador
  const cat = { x: 25 * T, y: 25 * T, path: [], state: 'sleep', timer: 8, dir: 'r', f: 0, spot: 0 };
  const CAT_SPOTS = [[24, 25], [47, 28], [8, 18], [30, 36], [52, 37], [36, 26]];
  function updateCat(dt) {
    if (cat.path.length) {
      const [tx, ty] = cat.path[0], dx = tx - cat.x, dy = ty - cat.y, dist = Math.hypot(dx, dy), step = 22 * dt;
      if (Math.abs(dx) > 0.3) cat.dir = dx > 0 ? 'r' : 'l';
      if (dist <= step) { cat.x = tx; cat.y = ty; cat.path.shift(); } else { cat.x += (dx / dist) * step; cat.y += (dy / dist) * step; }
      cat.f += step;
      if (!cat.path.length) { cat.state = 'sleep'; cat.timer = rand(12, 30); }
      return;
    }
    cat.timer -= dt;
    if (cat.state === 'sleep' && Math.random() < dt * 0.25) puff(cat.x + 4, cat.y - 8, 'z');
    if (cat.timer < 0) {
      cat.spot = (cat.spot + 1 + ((Math.random() * 3) | 0)) % CAT_SPOTS.length;
      const [gx, gy] = CAT_SPOTS[cat.spot], [sx, sy] = tileOf(cat.x, cat.y), p = findPath(sx, sy, gx, gy);
      if (p) { cat.path = p.map(([a, b]) => [a * T + 8, b * T + 12]); cat.state = 'walk'; } else cat.timer = 5;
    }
  }
  function drawCat(t) {
    const x = Math.round(cat.x), y = Math.round(cat.y), O = '#f4a259', D = '#c46f2c', W = '#fff4e6';
    R(x - 5, y, 11, 1, 'rgba(20,12,30,0.25)');
    if (cat.state === 'sleep') {
      ellipse(x, y - 3, 5, 3, O); R(x - 3, y - 5, 2, 1, D); R(x + 1, y - 6, 2, 1, D); R(x + 3, y - 4, 3, 3, O); R(x + 4, y - 6, 1, 1, O); R(x + 3, y - 3, 1, 1, '#1b1726');
      const tw = Math.round(Math.sin(t * 2) * 1); R(x - 6, y - 2 + tw, 3, 1, O); R(x - 6, y - 1, 1, 1, W);
      return;
    }
    X.save(); if (cat.dir === 'l') { X.translate(2 * x, 0); X.scale(-1, 1); }
    const s = Math.floor(cat.f / 3) % 2;
    R(x - 4, y - 6, 8, 4, O); R(x - 3, y - 6, 1, 3, D); R(x, y - 6, 1, 3, D); R(x - 4, y - 3, 8, 1, W);
    R(x - 4, y - 2 + s, 1, 2 - s, O); R(x + 2, y - 2 + (1 - s), 1, 1 + s, O); R(x - 2, y - 2 + (1 - s), 1, 1 + s, D); R(x + 3, y - 2 + s, 1, 2 - s, D);
    R(x + 3, y - 9, 4, 4, O); R(x + 3, y - 10, 1, 1, O); R(x + 6, y - 10, 1, 1, O); R(x + 5, y - 8, 1, 1, '#1b1726'); R(x + 6, y - 6, 1, 1, '#f09a9a');
    const tw = Math.round(Math.sin(t * 6) * 1); R(x - 6, y - 9 + tw, 1, 4, O); R(x - 5, y - 6, 1, 1, O);
    X.restore();
  }
  const bot = { x: 42 * T + 8, y: 21 * T + 12, path: [], timer: 6, angle: 0 };
  function updateBot(dt) {
    if (bot.path.length) {
      const [tx, ty] = bot.path[0], dx = tx - bot.x, dy = ty - bot.y, dist = Math.hypot(dx, dy), step = 16 * dt;
      if (dist <= step) { bot.x = tx; bot.y = ty; bot.path.shift(); } else { bot.x += (dx / dist) * step; bot.y += (dy / dist) * step; }
      bot.angle += dt * 6;
      if (!bot.path.length) bot.timer = rand(3, 8);
      return;
    }
    bot.timer -= dt;
    if (bot.timer < 0) {
      const rooms = ['office', 'office', 'lounge', 'lobby'], r = ROOMS[pick(rooms)];
      const gx = Math.floor(rand(r.x0, r.x1 + 1)), gy = Math.floor(rand(r.y0 + 1, r.y1 + 1));
      if (!walkable(gx, gy)) { bot.timer = 0.5; return; }
      const [sx, sy] = tileOf(bot.x, bot.y), p = findPath(sx, sy, gx, gy);
      if (p) bot.path = p.map(([a, b]) => [a * T + 8, b * T + 12]); else bot.timer = 2;
    }
  }
  function drawBot(t) {
    const x = Math.round(bot.x), y = Math.round(bot.y);
    ellipse(x, y - 1, 6, 3, 'rgba(20,12,30,0.25)'); ellipse(x, y - 3, 6, 3, '#3a3e50'); ellipse(x, y - 4, 5, 2, '#55607a');
    R(x - 1, y - 5, 2, 1, bot.path.length ? (Math.sin(t * 8) > 0 ? '#7ee787' : '#2f7d4f') : '#4cc9f0');
    if (bot.path.length) { const a = bot.angle; R(x + Math.round(Math.cos(a) * 6), y - 2 + Math.round(Math.sin(a) * 2), 1, 1, '#aab3c2'); }
  }
  // borboletas
  const flies = Array.from({ length: 4 }, (_, i) => ({ cx: rand(44, 57) * T, cy: rand(24, 37) * T, a: rand(0, 6), c: ['#ffd166', '#ff9ecf', '#79c0ff', '#ffffff'][i] }));
  function drawFlies(t) {
    for (const b of flies) {
      const x = b.cx + Math.sin(t * 0.7 + b.a) * 28 + Math.sin(t * 2.3 + b.a) * 6, y = b.cy + Math.cos(t * 0.5 + b.a) * 18 + Math.sin(t * 3 + b.a) * 3;
      const w = Math.sin(t * 18 + b.a) > 0;
      R(x, y, 1, 2, '#2b2a3d'); if (w) { R(x - 2, y - 1, 2, 2, b.c); R(x + 1, y - 1, 2, 2, b.c); } else { R(x - 1, y, 1, 1, b.c); R(x + 1, y, 1, 1, b.c); }
    }
  }

  // ------------------------------------------------------------- envelopes
  const letters = [];
  function posOf(name) {
    if (name === 'usuario') return [user.x, user.y - 20];
    const a = agents.get(name); return a ? [a.x, a.y - 24] : [WW / 2, WH / 2];
  }
  function sendLetter(from, to, perf) {
    letters.push({ from, to, t: 0, dur: 1.4, c: perf === 'request' ? '#ffd166' : perf === 'failure' || perf === 'refuse' ? '#ff7b72' : '#7ee787', perf });
  }
  function updateLetters(dt) {
    for (let i = letters.length - 1; i >= 0; i--) {
      const l = letters[i]; l.t += dt / l.dur;
      if (l.t >= 1) {
        const [x, y] = posOf(l.to); puff(x, y, 'spark', 10); letters.splice(i, 1);
        const a = agents.get(l.to); if (a && a.mode === 'work') a.bubble = { icon: 'mail', until: NOW + 1.5 };
      }
    }
  }
  function drawLetters() {
    for (const l of letters) {
      const [x0, y0] = posOf(l.from), [x1, y1] = posOf(l.to), k = l.t, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const dist = Math.hypot(x1 - x0, y1 - y0), arc = Math.min(60, 20 + dist * 0.15);
      const x = lerp(x0, x1, e), y = lerp(y0, y1, e) - Math.sin(k * Math.PI) * arc;
      for (let s = 1; s < 6; s++) { const kk = Math.max(0, k - s * 0.025), ee = kk < 0.5 ? 2 * kk * kk : 1 - Math.pow(-2 * kk + 2, 2) / 2; X.globalAlpha = 0.5 - s * 0.08; R(lerp(x0, x1, ee), lerp(y0, y1, ee) - Math.sin(kk * Math.PI) * arc, 2, 2, l.c); }
      X.globalAlpha = 1;
      R(x - 4, y - 3, 9, 7, '#2b2a3d'); R(x - 3, y - 2, 7, 5, l.c); R(x - 2, y - 2, 1, 1, '#2b2a3d'); R(x + 2, y - 2, 1, 1, '#2b2a3d'); R(x - 1, y - 1, 1, 1, '#2b2a3d'); R(x + 1, y - 1, 1, 1, '#2b2a3d'); R(x, y, 1, 1, '#2b2a3d');
    }
  }

  // --------------------------------------------------------------- render
  let canvas, ctx, buf, bctx, mini, mctx, miniBg;
  const cam = { x: 15 * T, y: 3 * T, z: 3, follow: true, vx: 0, vy: 0 };
  let opts = { names: true }, hoverName = null, cb = {};
  function viewW() { return canvas.width / cam.z; }
  function viewH() { return canvas.height / cam.z; }
  function clampCam() {
    const vw = viewW(), vh = viewH(), pad = 24;
    cam.x = vw >= WW ? (WW - vw) / 2 : clamp(cam.x, -pad, WW - vw + pad);
    cam.y = vh >= WH ? (WH - vh) / 2 : clamp(cam.y, -pad, WH - vh + pad);
  }
  function centerOn(x, y, smooth) {
    const tx = x - viewW() / 2, ty = y - viewH() / 2;
    if (smooth) { cam.x = lerp(cam.x, tx, smooth); cam.y = lerp(cam.y, ty, smooth); } else { cam.x = tx; cam.y = ty; }
    clampCam();
  }
  function drawWorld(t) {
    const vw = Math.ceil(viewW()) + 2, vh = Math.ceil(viewH()) + 2;
    if (buf.width !== vw || buf.height !== vh) { buf.width = vw; buf.height = vh; }
    X = bctx;
    const ox = Math.floor(cam.x), oy = Math.floor(cam.y);
    X.setTransform(1, 0, 0, 1, 0, 0); X.fillStyle = '#0d0d16'; X.fillRect(0, 0, vw, vh);
    X.setTransform(1, 0, 0, 1, -ox, -oy);
    X.drawImage(bg, 0, 0);
    wallDyn.forEach((f) => f(t));
    flats.forEach((f) => f(t));
    // anel do agente ao vivo (embaixo de tudo)
    const live = liveName && agents.get(liveName);
    if (live) {
      const pr = 0.5 + 0.5 * Math.sin(t * 6);
      X.globalAlpha = 0.25 + 0.25 * pr; ellipse(live.x, live.y, 11 + Math.round(pr * 2), 4, '#ff5d73'); X.globalAlpha = 1;
      ellipse(live.x, live.y, 9, 3, 'rgba(255,93,115,0.35)');
    }
    const x0 = ox - 40, y0 = oy - 40, x1 = ox + vw + 40, y1 = oy + vh + 60;
    const list = [];
    for (const e of ents) if (e.x1 >= x0 && e.x0 <= x1 && e.y1 >= y0 && e.y0 <= y1) list.push([e.base, e]);
    for (const a of agents.values()) list.push([a.base(), a]);
    list.push([cat.y, { draw: drawCat }]); list.push([bot.y - 4, { draw: drawBot }]);
    list.sort((p, q) => p[0] - q[0]);
    for (const [, e] of list) e.draw(t);
    drawParts();
    drawFlies(t);
    // luz da noite
    if (SKY.night > 0.02) {
      X.fillStyle = `rgba(14,16,48,${0.42 * SKY.night})`; X.fillRect(ox, oy, vw, vh);
      X.globalCompositeOperation = 'lighter';
      for (const l of lights) {
        if (!l.when() || l.x + l.r < x0 || l.x - l.r > x1 || l.y + l.r < y0 || l.y - l.r > y1) continue;
        const g = X.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r); g.addColorStop(0, l.c + (0.32 * SKY.night) + ')'); g.addColorStop(1, l.c + '0)');
        X.fillStyle = g; X.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
      }
      X.globalCompositeOperation = 'source-over';
    }
    if (live) {
      X.globalCompositeOperation = 'lighter';
      const g = X.createRadialGradient(live.x, live.y - 14, 0, live.x, live.y - 14, 34); g.addColorStop(0, 'rgba(255,190,120,0.22)'); g.addColorStop(1, 'rgba(255,190,120,0)');
      X.fillStyle = g; X.fillRect(live.x - 34, live.y - 48, 68, 68); X.globalCompositeOperation = 'source-over';
    }
    // etiquetas e baloes
    for (const a of agents.values()) drawTags(a, t, a === live);
    drawUserTag(t);
    drawLetters();
    // tela
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(buf, 0, 0, vw, vh, Math.round(-(cam.x - ox) * cam.z), Math.round(-(cam.y - oy) * cam.z), vw * cam.z, vh * cam.z);
    if (live) offscreenArrow(live, t);
    drawMini(t);
  }
  function drawTags(a, t, isLive) {
    const sit = a.seat && !a.path.length, top = a.y - 25 + (sit ? 3 : 0) - (a.state === 'cheer' && a.pose === 'jump' ? Math.abs(Math.sin(a.cheerT * 7)) * 6 : 0);
    let y = top;
    if (opts.names || isLive || hoverName === a.name) {
      const w = textW(a.short) + 4, bx = Math.round(a.x - w / 2);
      R(bx, y - 6, w, 7, isLive ? '#ff5d73' : 'rgba(27,23,38,0.82)'); text(a.short, bx + 2, y - 5, '#ffffff');
      if (a.mode === 'wait') R(bx - 3, y - 4, 2, 2, '#ffd166');
      y -= 8;
    }
    if (isLive) {
      const w = textW('AO VIVO') + 8, bx = Math.round(a.x - w / 2);
      R(bx, y - 6, w, 7, '#1b1726'); R(bx + 2, y - 4, 2, 2, Math.sin(t * 8) > 0 ? '#ff5d73' : '#7a2a3a'); text('AO VIVO', bx + 6, y - 5, '#ff8a9a');
      y -= 8;
    }
    // balao
    let txt = '', ic = null;
    if (a.bubble && a.bubble.until > NOW) { txt = a.bubble.text || ''; ic = a.bubble.icon || null; }
    else if (a.mode === 'work') txt = a.action || ('PENSANDO' + '.'.repeat(1 + (Math.floor(t * 3) % 3)));
    else if (a.mode === 'wait') txt = 'AGUARDANDO ' + (a.waitFor || '').replace(/^agent-/, '');
    if (!txt && !ic) return;
    txt = normTxt(txt).slice(0, 30);
    const iw = ic ? (ICONS[ic][0].length + (txt ? 2 : 0)) : 0, w = Math.max(9, textW(txt) + iw + 6), h = 9, bx = Math.round(clamp(a.x - w / 2, cam.x + 2, cam.x + viewW() - w - 2)), by = Math.round(y - h - 2);
    R(bx, by, w, h, '#1b1726'); R(bx + 1, by + 1, w - 2, h - 2, a.mode === 'wait' ? '#fff3c4' : '#fffbef');
    R(Math.round(a.x) - 1, by + h, 3, 1, '#1b1726'); R(Math.round(a.x), by + h + 1, 1, 1, '#1b1726'); R(Math.round(a.x) - 1, by + h - 1, 3, 1, a.mode === 'wait' ? '#fff3c4' : '#fffbef');
    let cx = bx + 3;
    if (ic) { icon(ic, cx, by + 2); cx += iw; }
    if (txt) text(txt, cx, by + 2, '#2a2440');
  }
  function drawUserTag(t) {
    const w = textW('VOCE') + 4, bx = Math.round(user.x - w / 2), y = user.y - 31;
    R(bx, y, w, 7, '#ff6f91'); text('VOCE', bx + 2, y + 1, '#ffffff');
  }
  function offscreenArrow(a, t) {
    const sx = (a.x - cam.x) * cam.z, sy = (a.y - 14 - cam.y) * cam.z, W = canvas.width, H = canvas.height, m = 46;
    if (sx > 0 && sy > 0 && sx < W && sy < H) return;
    const cx = W / 2, cy = H / 2, ang = Math.atan2(sy - cy, sx - cx);
    const ex = clamp(sx, m, W - m), ey = clamp(sy, m, H - m);
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(ang);
    const p = 1 + Math.sin(t * 6) * 0.12; ctx.scale(p, p);
    ctx.fillStyle = '#ff5d73'; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-8, -12); ctx.lineTo(-3, 0); ctx.lineTo(-8, 12); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.font = '600 12px "Silkscreen", "Consolas", monospace'; ctx.textAlign = 'center';
    const lbl = 'AO VIVO: ' + a.short, tw = ctx.measureText(lbl).width + 14, lx = clamp(ex, tw / 2 + 6, W - tw / 2 - 6), ly = clamp(ey + (ey > H / 2 ? -28 : 30), 16, H - 16);
    ctx.fillStyle = 'rgba(20,16,30,0.85)'; ctx.fillRect(lx - tw / 2, ly - 11, tw, 20); ctx.fillStyle = '#ff8a9a'; ctx.fillText(lbl, lx, ly + 4);
  }
  function buildMini() {
    miniBg = document.createElement('canvas'); miniBg.width = MW * 3; miniBg.height = MH * 3;
    const g = miniBg.getContext('2d'); g.imageSmoothingEnabled = true; g.drawImage(bg, 0, 0, miniBg.width, miniBg.height);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (solid[y][x] && !wall[y][x]) { g.fillStyle = 'rgba(40,30,50,0.55)'; g.fillRect(x * 3, y * 3, 3, 3); }
  }
  function drawMini(t) {
    if (!mctx) return;
    const s = mini.width / WW;
    mctx.imageSmoothingEnabled = false; mctx.clearRect(0, 0, mini.width, mini.height);
    mctx.drawImage(miniBg, 0, 0, mini.width, mini.height);
    for (const a of agents.values()) {
      const live = a.name === liveName;
      mctx.fillStyle = live ? (Math.sin(t * 8) > 0 ? '#ff5d73' : '#ffffff') : a.st.shirt;
      const r = live ? 4 : 3; mctx.fillRect(Math.round(a.x * s) - r / 2, Math.round((a.y - 6) * s) - r / 2, r, r);
    }
    mctx.strokeStyle = 'rgba(255,255,255,0.9)'; mctx.lineWidth = 1;
    mctx.strokeRect(Math.round(cam.x * s) + 0.5, Math.round(cam.y * s) + 0.5, Math.round(viewW() * s), Math.round(viewH() * s));
  }

  // --------------------------------------------------------------- loop
  let last = 0;
  function loop(ms) {
    const t = ms / 1000; let rem = Math.min(1, last ? t - last : 0.016); last = t;
    if (Math.floor(t) % 30 === 0) { const d = new Date(); SKY = sky(d.getHours() + d.getMinutes() / 60); }
    const dt = Math.min(0.05, rem);
    while (rem > 0.0001) { // sub-passos: se o quadro atrasar, a simulacao alcanca
      const st = Math.min(0.05, rem); rem -= st; NOW += st;
      for (const a of agents.values()) a.update(st);
      updateCat(st); updateBot(st); updateParts(st); updateLetters(st);
    }
    const live = liveName && agents.get(liveName);
    if (cam.follow && live) centerOn(live.x, live.y - 10, Math.min(1, dt * 3));
    if (keys.size) { const sp = 360 / cam.z * dt; if (keys.has('a')) cam.x -= sp; if (keys.has('d')) cam.x += sp; if (keys.has('w')) cam.y -= sp; if (keys.has('s')) cam.y += sp; clampCam(); }
    if (Math.abs(cam.vx) > 0.01 || Math.abs(cam.vy) > 0.01) { cam.x -= cam.vx; cam.y -= cam.vy; cam.vx *= 0.88; cam.vy *= 0.88; clampCam(); }
    drawWorld(t);
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- input
  const keys = new Set();
  function agentAt(sx, sy) {
    const wx = sx / cam.z + cam.x, wy = sy / cam.z + cam.y;
    let best = null, bd = 1e9;
    for (const a of agents.values()) { const dx = wx - a.x, dy = wy - (a.y - 11); if (Math.abs(dx) < 8 && Math.abs(dy) < 14) { const d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = a; } } }
    return best;
  }
  function setFollow(v) { cam.follow = !!v; cb.onFollowChange && cb.onFollowChange(cam.follow); }
  function bindInput() {
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: false, lx: e.clientX, ly: e.clientY }; canvas.setPointerCapture(e.pointerId); cam.vx = cam.vy = 0; });
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect(), sx = (e.clientX - r.left) * (canvas.width / r.width), sy = (e.clientY - r.top) * (canvas.height / r.height);
      if (drag) {
        const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) { drag.moved = true; if (cam.follow) setFollow(false); canvas.classList.add('dragging'); }
        if (drag.moved) { const k = canvas.width / r.width / cam.z; cam.x -= dx * k; cam.y -= dy * k; cam.vx = dx * k * 0.6; cam.vy = dy * k * 0.6; clampCam(); }
        drag.lx = e.clientX; drag.ly = e.clientY;
        return;
      }
      const a = agentAt(sx, sy); hoverName = a ? a.name : null; canvas.style.cursor = a ? 'pointer' : 'grab';
      cb.onHover && cb.onHover(a ? a.name : null, e.clientX, e.clientY);
    });
    const end = (e) => {
      if (!drag) return;
      canvas.classList.remove('dragging');
      if (!drag.moved) {
        const r = canvas.getBoundingClientRect(), a = agentAt((e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height));
        if (a) { cb.onSelect && cb.onSelect(a.name); a.bubble = { icon: 'heart', until: NOW + 1.2 }; } else { cam.vx = cam.vy = 0; }
      }
      drag = null;
    };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { hoverName = null; cb.onHover && cb.onHover(null); });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1 : -1, (e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)); }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (/input|textarea|select/i.test(e.target.tagName)) return;
      const k = { arrowleft: 'a', arrowright: 'd', arrowup: 'w', arrowdown: 's', a: 'a', d: 'd', w: 'w', s: 's' }[e.key.toLowerCase()];
      if (k) { keys.add(k); if (cam.follow) setFollow(false); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => { const k = { arrowleft: 'a', arrowright: 'd', arrowup: 'w', arrowdown: 's', a: 'a', d: 'd', w: 'w', s: 's' }[e.key.toLowerCase()]; if (k) keys.delete(k); });
    window.addEventListener('blur', () => keys.clear());
    if (mini) {
      let md = false;
      const go = (e) => { const r = mini.getBoundingClientRect(), s = WW / r.width; if (cam.follow) setFollow(false); centerOn((e.clientX - r.left) * s, (e.clientY - r.top) * s); };
      mini.addEventListener('pointerdown', (e) => { md = true; mini.setPointerCapture(e.pointerId); go(e); });
      mini.addEventListener('pointermove', (e) => { if (md) go(e); });
      mini.addEventListener('pointerup', () => (md = false));
    }
  }
  function zoomAt(dir, sx, sy) {
    const nz = clamp(cam.z + dir, 2, 6); if (nz === cam.z) return;
    if (sx == null) { sx = canvas.width / 2; sy = canvas.height / 2; }
    const wx = sx / cam.z + cam.x, wy = sy / cam.z + cam.y;
    cam.z = nz; cam.x = wx - sx / cam.z; cam.y = wy - sy / cam.z; clampCam();
    cb.onZoom && cb.onZoom(cam.z);
  }
  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(200, Math.round(r.width * dpr)); canvas.height = Math.max(200, Math.round(r.height * dpr));
    const want = Math.round(3 * dpr); if (!resize.done) { cam.z = clamp(want, 2, 6); resize.done = true; }
    clampCam();
  }

  // -------------------------------------------------------------- eventos
  function ensureAgent(name) {
    if (!name || name === 'usuario') return null;
    let a = agents.get(name);
    if (!a) {
      const d = desks.find((k) => !k.agent);
      a = new Agent(name, agents.size, d || null); agents.set(name, a);
    }
    return a;
  }
  const TOOL_ICON = { Read: 'book', Grep: 'book', Glob: 'book', Edit: 'bulb', Write: 'bulb', MultiEdit: 'bulb', Bash: 'game', PowerShell: 'game', WebFetch: 'mail', WebSearch: 'mail' };
  function event(ev) {
    const a = ensureAgent(ev.agente);
    switch (ev.tipo) {
      case 'tarefa_inicio': job.list.push({ id: ev.job, st: 'run' }); userAct('wave', 1.5); break;
      case 'ao_vivo':
        liveName = ev.agente; a && a.summon();
        break;
      case 'ferramenta':
        if (a) { a.action = (ev.ferramenta || '') + (ev.texto ? ' ' + ev.texto : ''); a.bubble = { text: a.action, icon: TOOL_ICON[ev.ferramenta] || 'bulb', until: NOW + 3.5 }; }
        break;
      case 'pensando': if (a && (!a.bubble || a.bubble.until < NOW)) a.action = ''; break;
      case 'fala': if (a) a.bubble = { text: ev.texto, until: NOW + 3 }; break;
      case 'mensagem': {
        const de = ev.de, para = ev.para;
        if (de !== 'usuario') ensureAgent(de);
        if (para !== 'usuario') ensureAgent(para);
        sendLetter(de, para, ev.performativa);
        const da = agents.get(de);
        if (de === 'usuario') userAct('wave', 1.6);
        if (para === 'usuario') setTimeout(() => userAct('jump', 2.5), 1300);
        if (da) { if (para !== 'usuario' && /request|query|propose|cfp/.test(ev.performativa)) da.waitFor_(para); else da.finish(ev.performativa !== 'failure' && ev.performativa !== 'refuse'); }
        break;
      }
      case 'agente_fim': if (a && !ev.ok) a.finish(false); break;
      case 'tarefa_fim': {
        const j = job.list.find((k) => k.id === ev.job); if (j) j.st = ev.ok ? 'ok' : 'err';
        for (const ag of agents.values()) if (ag.mode !== 'free') ag.finish(ev.ok);
        liveName = null; fx.printUntil = NOW + 2.5;
        if (ev.ok) userAct('jump', 2.5); else userAct('facepalm', 2.5);
        break;
      }
      default: break;
    }
  }

  // ----------------------------------------------------------------- API
  function init(o) {
    canvas = o.canvas; ctx = canvas.getContext('2d'); mini = o.minimap || null; mctx = mini ? mini.getContext('2d') : null;
    buf = document.createElement('canvas'); bctx = buf.getContext('2d');
    cb = o; buildBackground(); buildMini();
    const d = new Date(); SKY = sky(d.getHours() + d.getMinutes() / 60);
    (o.agents || []).forEach((ag) => ensureAgent(ag.name));
    resize(); window.addEventListener('resize', resize);
    bindInput();
    centerOn(26 * T, 11 * T);
    requestAnimationFrame(loop);
  }
  function focus(name) { const a = agents.get(name); if (a) { setFollow(false); centerOn(a.x, a.y - 10); a.bubble = { icon: 'heart', until: NOW + 1.2 }; } }
  function portrait(cv, name) {
    const a = agents.get(name), st = a ? a.st : styleFor(name || '?', 0);
    const g = cv.getContext('2d'), tmp = document.createElement('canvas'); tmp.width = 16; tmp.height = 16;
    const old = X; X = tmp.getContext('2d');
    drawPerson(8, 25, st, { dir: 'd', pose: 'stand', blink: false });
    X = old;
    g.imageSmoothingEnabled = false; g.clearRect(0, 0, cv.width, cv.height); g.drawImage(tmp, 0, 0, 16, 16, 0, 0, cv.width, cv.height);
  }
  function info(name) { const a = agents.get(name); return a ? { short: a.short, color: a.st.shirt, mode: a.mode, action: a.action } : null; }
  return {
    init, event, focus, portrait, info,
    setFollow: (v) => { setFollow(v); const a = liveName && agents.get(liveName); if (v && a) centerOn(a.x, a.y - 10); },
    getFollow: () => cam.follow,
    zoom: (d) => zoomAt(d),
    setNames: (v) => (opts.names = !!v),
    live: () => liveName,
    debug: () => [...agents.values()].map((a) => ({ n: a.short, st: a.state, mode: a.mode, seat: a.seat, path: a.path.length, tile: a.tile(), pose: a.pose, x: Math.round(a.x), y: Math.round(a.y) })),
    resize,
  };
})();
