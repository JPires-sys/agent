/* Agent Branch - interface (painel, linha do tempo) e ponte com o Python. */
'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const short = (n) => (n === 'usuario' ? 'VOCE' : String(n || '?').replace(/^agent-/, '').toUpperCase());
  const hhmmss = (t) => new Date(t ? t * 1000 : Date.now()).toLocaleTimeString('pt-BR', { hour12: false });

  const S = { agents: [], last: 0, polling: false, job: null, chain: [], live: null, liveSince: 0, liveAction: '', hops: 0, history: [], demo: false, demoN: 0 };
  let api = null;

  // ------------------------------------------------------------- backend
  function waitApi() {
    return new Promise((res) => {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.config) return res(window.pywebview.api);
      window.addEventListener('pywebviewready', () => res(window.pywebview.api), { once: true });
      setTimeout(() => res(window.pywebview && window.pywebview.api && window.pywebview.api.config ? window.pywebview.api : null), 1200);
    });
  }
  const DEFAULT_AGENTS = ['agent-007', 'agent-decider', 'agent-architect', 'agent-coder', 'agent-tester', 'agent-reviewer', 'agent-docs']
    .map((name) => ({ name, description: '' }));

  // ------------------------------------------------------------- inicio
  async function boot() {
    api = await waitApi();
    let cfg;
    if (api) {
      try { cfg = await api.config(); } catch (e) { cfg = null; }
    }
    if (!cfg) {
      S.demo = true;
      cfg = { agents: DEFAULT_AGENTS, models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'], perms: ['acceptEdits', 'bypassPermissions'], defaultAgent: 'agent-007' };
      $('#mode-note').textContent = 'Modo navegador: sem backend Python. ENVIAR roda uma simulacao.';
      $('#mode-note').classList.add('warn');
    }
    S.agents = cfg.agents;
    fill('#sel-model', cfg.models, cfg.models[0]);
    fill('#sel-effort', cfg.efforts, 'medium');
    fill('#sel-agent', cfg.agents.map((a) => a.name), cfg.defaultAgent || 'agent-007');
    fill('#sel-perm', cfg.perms, cfg.perms[0], { acceptEdits: 'editar arquivos (padrao)', bypassPermissions: 'tudo liberado (cuidado)' });
    Game.init({
      canvas: $('#world'), minimap: $('#minimap'), agents: cfg.agents,
      onSelect: (name) => { $('#sel-agent').value = name; toast(`Agente principal: <b>${esc(name)}</b>`); },
      onFollowChange: (v) => $('#btn-follow').classList.toggle('on', v),
      onHover: tooltip,
    });
    bindUi();
    renderLive();
    if (api && !S.demo) setInterval(poll, 150);
    setTimeout(() => $('#hint').classList.add('gone'), 9000);
  }
  function fill(sel, values, def, labels) {
    const el = $(sel); el.innerHTML = '';
    values.forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = (labels && labels[v]) || v; el.appendChild(o); });
    if (values.includes(def)) el.value = def;
  }

  async function poll() {
    if (S.polling) return;
    S.polling = true;
    try {
      const evs = await api.poll(S.last);
      for (const ev of evs || []) { S.last = Math.max(S.last, ev.seq); handle(ev); }
    } catch (e) { /* janela fechando */ }
    S.polling = false;
  }

  // ----------------------------------------------------------- eventos
  function handle(ev) {
    Game.event(ev);
    switch (ev.tipo) {
      case 'tarefa_inicio':
        S.job = ev.job; S.chain = []; S.hops = 0;
        addHistory({ id: ev.job, agent: ev.agente, prompt: ev.prompt, status: 'running', t: ev.t });
        setRunning(true);
        feed('live', 'VOCE', `nova tarefa para <b>${esc(short(ev.agente))}</b>: ${esc(clip(ev.prompt, 120))}`, ev.t);
        break;
      case 'mensagem':
        if (!S.chain.length) S.chain.push(ev.de);
        if (S.chain[S.chain.length - 1] !== ev.para) S.chain.push(ev.para);
        feed('mail', `${short(ev.de)} → ${short(ev.para)}`, `<span class="perf ${esc(ev.performativa)}">${esc(ev.performativa)}</span>${esc(clip(ev.conteudo, 220))}`, ev.t);
        renderChain();
        break;
      case 'ao_vivo':
        S.live = ev.agente; S.liveSince = Date.now(); S.liveAction = 'chegando no computador...'; S.hops = ev.salto || S.hops + 1;
        feed('live', short(ev.agente), 'agora e o agente <b>AO VIVO</b>', ev.t);
        renderChain(); renderLive();
        break;
      case 'ferramenta':
        if (ev.agente === S.live) { S.liveAction = `${ev.ferramenta} ${ev.texto || ''}`.trim(); renderLive(); }
        feed('tool', short(ev.agente), `<b>${esc(ev.ferramenta)}</b> ${esc(ev.texto || '')}`, ev.t);
        break;
      case 'fala':
        if (ev.agente === S.live) { S.liveAction = clip(ev.texto, 90); renderLive(); }
        feed('tool', short(ev.agente), `<i>${esc(clip(ev.texto, 140))}</i>`, ev.t);
        break;
      case 'pensando':
        if (ev.agente === S.live && !S.liveAction) { S.liveAction = 'pensando...'; renderLive(); }
        break;
      case 'agente_fim':
        feed(ev.ok ? 'ok' : 'err', short(ev.agente), `${ev.ok ? 'terminou' : 'falhou'}${ev.duracao ? ` em ${(ev.duracao / 1000).toFixed(1)}s` : ''}${ev.custo ? ` · US$ ${ev.custo.toFixed(4)}` : ''}`, ev.t);
        break;
      case 'tarefa_fim': {
        S.live = null; renderLive(); renderChain(true); setRunning(false);
        const h = S.history.find((x) => x.id === ev.job);
        if (h) { h.status = ev.ok ? 'done' : 'error'; h.resposta = ev.resposta; h.custo = ev.custo; h.duracao = ev.duracao; }
        renderHistory();
        feed(ev.ok ? 'ok' : 'err', 'FIM', `${ev.ok ? 'tarefa concluida' : 'tarefa com erro'} · ${(ev.duracao / 1000 || 0).toFixed(1)}s${ev.custo ? ` · US$ ${ev.custo.toFixed(4)}` : ''}`, ev.t);
        showOutput(ev.resposta, `${ev.ok ? 'concluida' : 'erro'} · ${S.chain.map(short).join(' → ')}`);
        S.job = null;
        break;
      }
      default: break;
    }
  }
  const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  // ------------------------------------------------------------- render
  function feed(kind, who, html, t) {
    const li = document.createElement('li');
    li.className = 'k-' + kind;
    li.innerHTML = `<time>${hhmmss(t)}</time><div><span class="who">${esc(who)}</span> <span class="msg">${html}</span></div>`;
    const ol = $('#feed'); ol.appendChild(li);
    while (ol.children.length > 300) ol.removeChild(ol.firstChild);
    ol.scrollTop = ol.scrollHeight;
  }
  function renderChain(finished) {
    const el = $('#chain');
    if (!S.chain.length) { el.innerHTML = '<span class="chain-empty">nenhuma tarefa em andamento</span>'; return; }
    const items = S.chain.slice(-9);
    el.innerHTML = items.map((n, i) => {
      const info = Game.info(n), col = n === 'usuario' ? '#ff6f91' : (info ? info.color : '#888');
      const live = !finished && n === S.live && i === items.length - 1;
      return `${i ? '<span class="arrow">→</span>' : ''}<span class="node ${live ? 'live' : finished ? 'done' : ''}"><i style="background:${col}"></i>${esc(short(n))}${live ? ' ●' : ''}</span>`;
    }).join('');
  }
  function renderLive() {
    const card = $('#live-card');
    if (!S.live) {
      card.classList.remove('on');
      $('#live-name').textContent = 'ninguem';
      $('#live-action').textContent = S.job ? 'trocando mensagens...' : 'envie uma tarefa para comecar';
      $('#live-meta').textContent = '';
      Game.portrait($('#live-portrait'), 'usuario');
      return;
    }
    card.classList.add('on');
    $('#live-name').textContent = S.live;
    $('#live-action').textContent = S.liveAction || 'trabalhando...';
    Game.portrait($('#live-portrait'), S.live);
  }
  setInterval(() => { if (S.live) $('#live-meta').textContent = `ha ${Math.round((Date.now() - S.liveSince) / 1000)}s · troca ${S.hops}`; }, 500);

  function addHistory(h) { S.history.unshift(h); renderHistory(); }
  function renderHistory() {
    const ul = $('#history');
    if (!S.history.length) { ul.innerHTML = '<li class="empty">nada ainda</li>'; return; }
    ul.innerHTML = S.history.map((h, i) => `<li data-i="${i}"><span class="st">${h.status === 'running' ? '…' : h.status === 'done' ? '✓' : '✖'}</span><span class="ag">${esc(short(h.agent))}</span><span class="tx">${esc(h.prompt)}</span></li>`).join('');
  }
  let twTimer = null;
  function showOutput(text, meta) {
    const out = $('#output'), body = $('#output-body');
    out.classList.remove('collapsed'); $('#output-toggle').textContent = '▾';
    $('#output-meta').textContent = meta || '';
    clearInterval(twTimer); body.textContent = '';
    const s = String(text || '(sem resposta)'); let i = 0;
    twTimer = setInterval(() => { i = Math.min(s.length, i + Math.max(6, Math.round(s.length / 120))); body.textContent = s.slice(0, i); body.scrollTop = body.scrollHeight; if (i >= s.length) clearInterval(twTimer); }, 16);
    body.onclick = () => { clearInterval(twTimer); body.textContent = s; };
  }
  function setRunning(on) { $('#btn-send').disabled = on; $('#btn-cancel').disabled = !on; $('#btn-demo').disabled = on; }
  let toastT = null;
  function toast(html) { const t = $('#toast'); t.innerHTML = html; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2200); }
  function tooltip(name, x, y) {
    const tt = $('#tooltip');
    if (!name) { tt.hidden = true; return; }
    const a = S.agents.find((k) => k.name === name), info = Game.info(name);
    const estado = info && info.mode === 'work' ? 'trabalhando' : info && info.mode === 'wait' ? 'aguardando resposta' : 'livre';
    tt.innerHTML = `<b>${esc(name)}</b> · <span style="color:var(--dim)">${estado}</span>${a && a.description ? `<p>${esc(clip(a.description, 140))}</p>` : ''}`;
    tt.hidden = false; tt.style.left = x + 14 + 'px'; tt.style.top = y + 14 + 'px';
  }

  // ------------------------------------------------------------- acoes
  async function send() {
    const prompt = $('#prompt').value.trim();
    if (!prompt) { toast('Escreva um prompt primeiro.'); $('#prompt').focus(); return; }
    const data = { prompt, model: $('#sel-model').value, effort: $('#sel-effort').value, agent: $('#sel-agent').value, perm: $('#sel-perm').value };
    $('#prompt').value = '';
    Game.setFollow(true);
    if (S.demo || !api) { runDemo(prompt, data.agent); return; }
    setRunning(true);
    try { const r = await api.send(data); if (r && r.erro) { toast(esc(r.erro)); setRunning(false); } }
    catch (e) { toast('Falha ao enviar: ' + esc(e)); setRunning(false); }
  }
  async function cancel() {
    if (S.demo && S.job && S.job.startsWith('demo')) { demoCancel = true; return; }
    if (api && S.job) { await api.cancel(S.job); toast('Cancelando...'); }
  }

  // ---------------------------------------------------- demonstracao
  let demoCancel = false;
  function runDemo(prompt, start) {
    demoCancel = false;
    const job = 'demo' + (++S.demoN), first = start || 'agent-007';
    const seq = [];
    let t = 0;
    const at = (dt, ev) => { t += dt; seq.push([t, ev]); };
    const msg = (de, para, perf, conteudo) => at(0.6, { tipo: 'mensagem', de, para, performativa: perf, conteudo });
    const live = (a, de) => at(0.4, { tipo: 'ao_vivo', agente: a, de });
    const tool = (a, f, tx, dt = 1.6) => at(dt, { tipo: 'ferramenta', agente: a, ferramenta: f, texto: tx });
    const fim = (a, d = 1.2) => at(d, { tipo: 'agente_fim', agente: a, ok: true, duracao: 4200 + Math.random() * 6000, custo: 0 });
    at(0.1, { tipo: 'tarefa_inicio', agente: first, prompt });
    msg('usuario', first, 'request', prompt); live(first, 'usuario');
    tool(first, 'Read', 'README.md', 3.5); tool(first, 'Grep', 'def enviar'); fim(first);
    msg(first, 'agent-decider', 'request', 'Monte um plano curto para: ' + prompt); live('agent-decider', first);
    tool('agent-decider', 'Read', 'README.md', 3.5); tool('agent-decider', 'Glob', '**/*.py'); fim('agent-decider');
    msg('agent-decider', first, 'inform', '1) coder implementa 2) tester testa 3) docs atualiza README'); live(first, 'agent-decider');
    tool(first, 'Read', 'home.py', 2); fim(first);
    msg(first, 'agent-coder', 'request', 'Implemente o plano; depois envie para agent-tester; o tester envia para agent-docs.'); live('agent-coder', first);
    tool('agent-coder', 'Read', 'terminalContact.py', 3.5); tool('agent-coder', 'Edit', 'home.py', 2.5); tool('agent-coder', 'Bash', 'python -m py_compile home.py', 2.5); fim('agent-coder');
    msg('agent-coder', 'agent-tester', 'request', 'Alterei home.py; rode os testes.'); live('agent-tester', 'agent-coder');
    tool('agent-tester', 'Write', 'tests/test_home.py', 3.5); tool('agent-tester', 'Bash', 'pytest -q', 3); fim('agent-tester');
    msg('agent-tester', 'agent-docs', 'request', '3 testes passaram. Atualize o README.'); live('agent-docs', 'agent-tester');
    tool('agent-docs', 'Read', 'README.md', 3.5); tool('agent-docs', 'Edit', 'README.md', 2.5); fim('agent-docs');
    msg('agent-docs', first, 'inform', 'README atualizado (secao Como rodar).'); live(first, 'agent-docs');
    tool(first, 'Read', 'README.md', 2.5); fim(first);
    msg(first, 'usuario', 'inform', 'Pronto: decider planejou, coder implementou, tester testou e docs documentou.');
    at(0.8, { tipo: 'tarefa_fim', ok: true, resposta: 'DEMONSTRACAO (nenhum token foi gasto)\n\nagent-007 recebeu o pedido e pediu um plano ao agent-decider.\nO agent-coder implementou e repassou direto ao agent-tester,\nque repassou ao agent-docs, que devolveu ao agent-007.\n\nPedido: ' + prompt, custo: 0, duracao: Math.round(t * 1000) });
    const t0 = performance.now();
    let i = 0, n = 0;
    const tick = () => {
      if (demoCancel) { handle({ tipo: 'tarefa_fim', job, seq: 0, ok: false, resposta: '[ERRO] demonstracao cancelada.', custo: 0, duracao: performance.now() - t0, t: Date.now() / 1000 }); return; }
      const el = (performance.now() - t0) / 1000;
      while (i < seq.length && seq[i][0] <= el) { handle(Object.assign({ job, seq: ++n, t: Date.now() / 1000 }, seq[i][1])); i++; }
      if (i < seq.length) setTimeout(tick, 50);
    };
    tick();
  }

  // ------------------------------------------------------------- ui
  function bindUi() {
    $('#btn-send').onclick = send;
    $('#btn-cancel').onclick = cancel;
    $('#btn-demo').onclick = () => { Game.setFollow(true); runDemo($('#prompt').value.trim() || 'criar um script hello.py, testar e documentar', $('#sel-agent').value); };
    $('#prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
    $('#btn-follow').onclick = () => Game.setFollow(!Game.getFollow());
    $('#btn-names').onclick = (e) => { const on = !e.currentTarget.classList.contains('on'); e.currentTarget.classList.toggle('on', on); Game.setNames(on); };
    $('#btn-zoom-in').onclick = () => Game.zoom(1);
    $('#btn-zoom-out').onclick = () => Game.zoom(-1);
    $('#output-head').onclick = () => { const o = $('#output'), c = o.classList.toggle('collapsed'); $('#output-toggle').textContent = c ? '▴' : '▾'; };
    $('#history').onclick = (e) => {
      const li = e.target.closest('li[data-i]'); if (!li) return;
      const h = S.history[+li.dataset.i];
      if (h.status === 'running') toast('Ainda rodando...'); else showOutput(h.resposta, `${short(h.agent)} · ${h.prompt}`);
    };
  }

  boot();
})();
