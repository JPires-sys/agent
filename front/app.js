/* agents0.7 - interface (tela inicial, painel, agentes, linha do tempo) e ponte com o Python. */
'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const short = (n) => (n === 'usuario' ? 'VOCE' : String(n || '?').replace(/^agent-/, '').toUpperCase());
  const hhmmss = (t) => new Date(t ? t * 1000 : Date.now()).toLocaleTimeString('pt-BR', { hour12: false });

  // S.pc: estado do terminal (modal do PC) da tarefa atual; zerado em tarefa_inicio
  const newPc = () => ({ live: null, since: 0, tool: '', files: [], done: {}, run: {}, cost: {}, total: null });
  const S = { agents: [], last: 0, polling: false, job: null, chain: [], live: null, liveSince: 0, liveAction: '', hops: 0, history: [], demo: false, demoN: 0, pc: newPc(),
    hairStyles: ['short', 'messy', 'long', 'bun', 'curly', 'bald', 'slick'],
    accessories: ['glasses', 'sunglasses', 'suit', 'hoodie', 'headphones', 'labcoat', 'beard', 'badge', 'hardhat', 'cardigan'],
    tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'TodoWrite'], tema: 'escritorio', agentsDir: '' };
  let api = null;
  const ZERO = () => ({ entrada: 0, saida: 0, cache: 0 });
  const addTok = (bag, name, t) => { const b = bag[name] || (bag[name] = ZERO()); ['entrada', 'saida', 'cache'].forEach((k) => (b[k] += +(t && t[k]) || 0)); return b; };
  const fmtN = (n) => Math.round(+n || 0).toLocaleString('pt-BR');

  // ------------------------------------------------------------- backend
  function waitApi() {
    // no app desktop o home.py marca a pagina (__AGENTS_DESKTOP__): espera a ponte do pywebview
    // ficar pronta (pode levar alguns segundos). No navegador comum entra no modo demonstracao.
    return new Promise((res) => {
      const pronta = () => window.pywebview && window.pywebview.api && window.pywebview.api.config;
      if (pronta()) return res(window.pywebview.api);
      let feito = false;
      const fim = (v) => { if (!feito) { feito = true; clearInterval(tick); res(v); } };
      window.addEventListener('pywebviewready', () => fim(pronta() ? window.pywebview.api : null), { once: true });
      const limite = window.__AGENTS_DESKTOP__ ? 150 : 4;   // x100 ms
      let n = 0;
      const tick = setInterval(() => { if (pronta()) fim(window.pywebview.api); else if (++n > limite) fim(null); }, 100);
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
      cfg.agents = cfg.agents.map((a) => Object.assign({ tools: '', model: '', prompt: `Voce e o **${a.name}**.` }, a));
      $('#mode-note').textContent = 'Modo navegador: sem backend Python. ENVIAR roda uma simulacao.';
      $('#mode-note').classList.add('warn');
    }
    S.agents = cfg.agents;
    if (cfg.hairStyles && cfg.hairStyles.length) S.hairStyles = cfg.hairStyles;
    if (cfg.accessories && cfg.accessories.length) S.accessories = cfg.accessories;
    if (cfg.tools && cfg.tools.length) S.tools = cfg.tools;
    S.agentsDir = cfg.agentsDir || '';
    let salvo = null; try { salvo = localStorage.getItem('agents07.tema'); } catch (e) { /* sem storage */ }
    S.tema = cfg.tema || salvo || 'escritorio';
    showFolder(cfg.pasta || cfg.base || '');
    fill('#sel-model', cfg.models, cfg.models[0]);
    fill('#sel-effort', cfg.efforts, 'medium');
    fill('#sel-agent', cfg.agents.map((a) => a.name), cfg.defaultAgent || 'agent-007');
    fill('#sel-perm', cfg.perms, cfg.perms[0], { acceptEdits: 'editar arquivos (padrao)', bypassPermissions: 'tudo liberado (cuidado)' });
    Game.init({
      canvas: $('#world'), minimap: $('#minimap'), agents: cfg.agents, skins: cfg.skins || {}, theme: S.tema,
      onSelect: (name) => { $('#sel-agent').value = name; toast(`Agente principal: <b>${esc(name)}</b>`); },
      onComputer: () => openModal('pc-modal'),
      onFollowChange: (v) => $('#btn-follow').classList.toggle('on', v),
      onHover: tooltip,
    });
    fill('#sel-map', Game.themes().map((t) => t.id), S.tema, Object.fromEntries(Game.themes().map((t) => [t.id, (MAP_INFO[t.id] || [t.label])[0]])));
    bindUi();
    renderLive();
    buildStart(); showStart();
    if (api && !S.demo) setInterval(poll, 150);
    setTimeout(() => $('#hint').classList.add('gone'), 15000);
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
        S.job = ev.job; S.chain = []; S.hops = 0; S.pc = newPc();
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
        S.pc.live = ev.agente; S.pc.since = Date.now(); S.pc.tool = 'chegando no computador...';
        feed('live', short(ev.agente), 'agora e o agente <b>AO VIVO</b>', ev.t);
        renderChain(); renderLive();
        break;
      case 'ferramenta':
        if (ev.agente === S.live) { S.liveAction = `${ev.ferramenta} ${ev.texto || ''}`.trim(); renderLive(); }
        if (ev.agente === S.pc.live) S.pc.tool = `${ev.ferramenta} ${ev.texto || ''}`.trim();
        if (ev.arquivo) { S.pc.files.unshift({ path: ev.arquivo, agente: ev.agente, ferramenta: ev.ferramenta, t: ev.t }); S.pc.files.length = Math.min(S.pc.files.length, 300); }
        feed('tool', short(ev.agente), `<b>${esc(ev.ferramenta)}</b> ${esc(ev.texto || '')}`, ev.t);
        renderPc();
        break;
      case 'tokens':
        addTok(S.pc.run, ev.agente, ev); renderPc();
        break;
      case 'fipa_cobrar':
        feed('err', short(ev.agente), `nao terminou com FIPA-ACL: o roteador pediu de novo (tentativa ${esc(ev.tentativa)})`, ev.t);
        if (ev.agente === S.pc.live) { S.pc.tool = 'cobrado: falta a mensagem FIPA-ACL'; renderPc(); }
        break;
      case 'fala':
        if (ev.agente === S.live) { S.liveAction = clip(ev.texto, 90); renderLive(); }
        feed('tool', short(ev.agente), `<i>${esc(clip(ev.texto, 140))}</i>`, ev.t);
        break;
      case 'pensando':
        if (ev.agente === S.live && !S.liveAction) { S.liveAction = 'pensando...'; renderLive(); }
        break;
      case 'agente_fim':
        // o total do result (ev.tokens) substitui a soma ao vivo desta rodada
        addTok(S.pc.done, ev.agente, ev.tokens || S.pc.run[ev.agente]); S.pc.run[ev.agente] = ZERO();
        S.pc.cost[ev.agente] = (S.pc.cost[ev.agente] || 0) + (+ev.custo || 0); renderPc();
        feed(ev.ok ? 'ok' : 'err', short(ev.agente), `${ev.ok ? 'terminou' : 'falhou'}${ev.duracao ? ` em ${(ev.duracao / 1000).toFixed(1)}s` : ''}${ev.custo ? ` · US$ ${ev.custo.toFixed(4)}` : ''}`, ev.t);
        break;
      case 'tarefa_fim': {
        S.live = null; renderLive(); renderChain(true); setRunning(false);
        S.pc.live = null; S.pc.tool = ev.ok ? 'tarefa concluida' : 'tarefa com erro'; S.pc.total = ev.tokens || null; S.pc.totalCost = ev.custo; renderPc();
        const h = S.history.find((x) => x.id === ev.job);
        if (h) { h.status = ev.ok ? 'done' : 'error'; h.resposta = ev.resposta; h.custo = ev.custo; h.duracao = ev.duracao; h.tokens = ev.tokens; h.arquivo = ev.arquivo || null; }
        renderHistory();
        const tk = ev.tokens ? ` · ${fmtN(ev.tokens.entrada + ev.tokens.saida + ev.tokens.cache)} tokens` : '';
        feed(ev.ok ? 'ok' : 'err', 'FIM', `${ev.ok ? 'tarefa concluida' : 'tarefa com erro'} · ${(ev.duracao / 1000 || 0).toFixed(1)}s${ev.custo ? ` · US$ ${ev.custo.toFixed(4)}` : ''}${tk}`, ev.t);
        showOutput(ev.resposta, `${ev.ok ? 'concluida' : 'erro'} · ${S.chain.map(short).join(' → ')}`, String(ev.job).startsWith('demo') ? null : ev.job);
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
    ul.innerHTML = S.history.map((h, i) => {
      const pronto = h.status !== 'running' && !String(h.id).startsWith('demo');
      const rep = pronto ? `<button class="rep word" data-rep="${esc(h.id)}" data-fmt="docx" title="Baixar o relatorio em Word (.docx)">Word</button><button class="rep txt" data-rep="${esc(h.id)}" data-fmt="txt" title="Baixar o relatorio em texto (.txt)">TXT</button>` : '';
      return `<li data-i="${i}"><span class="st">${h.status === 'running' ? '…' : h.status === 'done' ? '✓' : '✖'}</span><span class="ag">${esc(short(h.agent))}</span><span class="tx">${esc(h.prompt)}</span>${rep}</li>`;
    }).join('');
  }
  async function downloadReport(id, fmt) {
    if (S.demo || !api || !api.relatorio) { toast('O relatorio precisa do app (backend Python).'); return; }
    try {
      const r = await api.relatorio(id, fmt === 'txt' ? 'txt' : 'docx');
      if (r && r.arquivo) toast(`Relatorio salvo: <b>${esc(r.arquivo)}</b>`);
      else if (r && r.erro && r.erro !== 'cancelado') toast(esc(r.erro));
    } catch (e) { toast('Falha ao gerar o relatorio: ' + esc(e)); }
  }

  // ---------------------------------------------------- modais
  function openModal(id) {
    const m = $('#' + id); if (!m) return;
    m.hidden = false;
    if (id === 'pc-modal') renderPc();
  }
  function closeModal(id) { const m = $('#' + id); if (m) m.hidden = true; }

  // terminal (PC): quem roda, ha quanto tempo, ferramenta, arquivos, tokens e custo
  function renderPc() {
    const m = $('#pc-modal'); if (!m || m.hidden) return;
    const P = S.pc, nomes = [...new Set([...Object.keys(P.done), ...Object.keys(P.run), ...Object.keys(P.cost)])];
    const por = (n) => { const t = ZERO(); addTok({ x: t }, 'x', P.done[n]); addTok({ x: t }, 'x', P.run[n]); return t; };
    const tot = ZERO(); nomes.forEach((n) => addTok({ x: tot }, 'x', por(n)));
    const custo = P.total ? (+P.totalCost || 0) : nomes.reduce((s, n) => s + (P.cost[n] || 0), 0);
    $('#pc-live').textContent = P.live || (S.job ? 'trocando mensagens...' : 'ninguem');
    $('#pc-since').textContent = P.live ? `${Math.round((Date.now() - P.since) / 1000)}s` : '-';
    $('#pc-tool').textContent = P.tool || '-';
    $('#pc-tokens').textContent = `${fmtN(tot.entrada)} / ${fmtN(tot.saida)} / ${fmtN(tot.cache)}`;
    $('#pc-cost').textContent = `US$ ${custo.toFixed(4)}`;
    $('#pc-agents').innerHTML = nomes.length
      ? '<tr><th>agente</th><th>entrada</th><th>saida</th><th>cache</th><th>custo</th></tr>' + nomes.map((n) => { const t = por(n); return `<tr class="${n === P.live ? 'live' : ''}"><td>${esc(n)}</td><td>${fmtN(t.entrada)}</td><td>${fmtN(t.saida)}</td><td>${fmtN(t.cache)}</td><td>US$ ${(P.cost[n] || 0).toFixed(4)}</td></tr>`; }).join('')
      : '<tr><td class="empty">nenhum token ainda</td></tr>';
    $('#pc-files').innerHTML = P.files.length
      ? P.files.map((f) => `<li><time>${hhmmss(f.t)}</time><b>${esc(f.ferramenta)}</b><span class="path" title="${esc(f.path)}">${esc(f.path)}</span><span class="by">${esc(short(f.agente))}</span></li>`).join('')
      : '<li class="empty">nenhum ainda</li>';
  }
  setInterval(() => { if (S.pc.live) renderPc(); }, 500);

  // ------------------------------------------- gerenciador de agentes
  const RE_NOME = /^[a-z0-9][a-z0-9-]{1,40}$/;
  const RE_HEX = /^#[0-9a-f]{6}$/i;
  const SKIN_COLORS = ['skin', 'hair', 'shirt', 'pants', 'shoe', 'tie'];
  const MODELOS_AG = { '': 'herdar (o escolhido na tela)', opus: 'Opus (mais capaz)', sonnet: 'Sonnet (equilibrado)', haiku: 'Haiku (rapido e barato)', fable: 'Fable' };
  const FECHO = '\n\nAo terminar, devolva um inform para quem pediu com um resumo curto do que fez. Responda em portugues.';
  const TEMPLATES = {
    branco: { label: 'Em branco', desc: '', tools: null, model: '', prompt: (n) => `Voce e o **${n}**.\n\n- (papel do agente)\n- (regras importantes)` + FECHO },
    designer: { label: 'Designer de front-end', desc: 'Designer. Cuida de HTML, CSS e do visual das telas.', tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'], model: 'sonnet',
      skin: { shirt: '#f15bb5', hair: '#5b6ee1', hairStyle: 'bun', acc: ['glasses'] },
      prompt: (n) => `Voce e o **${n}**, designer de front-end.\n\n- Leia o HTML/CSS antes de mudar e siga o estilo que ja existe.\n- Priorize legibilidade, contraste e espacamentos consistentes.\n- Mudancas pequenas e focadas: nao mexa na logica do programa.` + FECHO },
    pesquisador: { label: 'Pesquisador (web)', desc: 'Pesquisador. Busca documentacao e exemplos na web e devolve um resumo com as fontes.', tools: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'], model: 'haiku',
      skin: { shirt: '#90be6d', hairStyle: 'curly', acc: ['glasses', 'badge'] },
      prompt: (n) => `Voce e o **${n}**, pesquisador.\n\n- Pesquise na web so o necessario para responder o pedido.\n- Cite as fontes (URLs) de cada afirmacao importante.\n- Entregue um resumo em topicos curtos. Nao edite arquivos.` + FECHO },
    seguranca: { label: 'Auditor de seguranca', desc: 'Auditor de seguranca. Procura segredos, injecoes e permissoes perigosas no codigo e no diff.', tools: ['Read', 'Grep', 'Glob', 'Bash'], model: 'sonnet',
      skin: { shirt: '#1a1a1a', hair: '#1a1a1a', hairStyle: 'slick', acc: ['sunglasses', 'suit'] },
      prompt: (n) => `Voce e o **${n}**, auditor de seguranca.\n\n- Rode git diff e leia so o que mudou.\n- Procure: senhas e chaves no codigo, injecao de comando/SQL, caminhos sem validacao, permissoes amplas.\n- Para cada achado: arquivo:linha, risco e como corrigir. Nao edite arquivos.\n- Achou algo grave: envie um request para o agent-coder com a lista.` + FECHO },
    devops: { label: 'DevOps / build', desc: 'DevOps. Cuida de scripts, dependencias, build e do executavel.', tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'PowerShell'], model: '',
      skin: { shirt: '#ffa657', hairStyle: 'short', acc: ['hardhat'] },
      prompt: (n) => `Voce e o **${n}**, responsavel por build e ambiente.\n\n- Antes de instalar algo, confira o que ja existe.\n- Rode os comandos de build/teste e copie a saida relevante.\n- Explique cada mudanca de configuracao em uma linha.` + FECHO },
    dados: { label: 'Analista de dados', desc: 'Analista de dados. Le CSV/JSON, calcula estatisticas e escreve o resultado em arquivo.', tools: ['Read', 'Grep', 'Glob', 'Write', 'Bash'], model: 'sonnet',
      skin: { shirt: '#4cc9f0', hairStyle: 'long', acc: ['cardigan'] },
      prompt: (n) => `Voce e o **${n}**, analista de dados.\n\n- Leia os dados com cuidado (cabecalho, tipos, linhas vazias).\n- Mostre os numeros principais e como chegou neles.\n- Se gerar arquivo, diga o caminho e o formato.` + FECHO },
    tradutor: { label: 'Tradutor / revisor', desc: 'Tradutor. Traduz e revisa textos e interfaces mantendo o tom.', tools: ['Read', 'Edit', 'Write'], model: 'haiku',
      skin: { shirt: '#9b5de5', hairStyle: 'messy', acc: ['headphones'] },
      prompt: (n) => `Voce e o **${n}**, tradutor e revisor.\n\n- Mantenha o tom e a formatacao do original.\n- Nao traduza nomes de codigo, comandos ou caminhos.\n- Liste as frases em que ficou em duvida.` + FECHO },
  };
  const AG = { cur: null, tab: 'perfil', del: false };

  function agentsOpen(name) {
    openModal('agent-modal');
    if (!$('#ag-template').options.length) {
      fill('#ag-template', Object.keys(TEMPLATES), 'branco', Object.fromEntries(Object.entries(TEMPLATES).map(([k, v]) => [k, v.label])));
      fill('#ag-model', Object.keys(MODELOS_AG), '', MODELOS_AG);
      fill('#ag-hair', S.hairStyles, S.hairStyles[0]);
      $('#ag-acc').innerHTML = S.accessories.map((a) => `<label><input type="checkbox" value="${esc(a)}">${esc(a)}</label>`).join('');
      $('#ag-tools').innerHTML = S.tools.map((t) => `<label><input type="checkbox" value="${esc(t)}">${esc(t)}</label>`).join('');
    }
    renderAgentList();
    if (name === '') newAgent(); else selectAgent(name || (S.agents[0] && S.agents[0].name) || '');
  }
  function renderAgentList() {
    const box = $('#ag-items'); box.innerHTML = '';
    S.agents.forEach((a) => {
      const b = document.createElement('button');
      b.className = 'ag-item' + (a.name === AG.cur ? ' on' : ''); b.dataset.agent = a.name;
      const tag = a.name === 'agent-007' ? '<em class="tag">ORQUESTRADOR</em>' : a.model ? `<em class="tag">${esc(a.model)}</em>` : '';
      b.innerHTML = `<canvas width="40" height="40"></canvas><span><b>${esc(a.name)}${tag}</b><small>${esc(a.description || '')}</small></span>`;
      box.appendChild(b); Game.portrait(b.querySelector('canvas'), a.name);
    });
    $('#ag-new').classList.toggle('on', AG.cur === '');
  }
  function setTab(tab) {
    AG.tab = tab;
    document.querySelectorAll('#agent-modal .tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
    document.querySelectorAll('#agent-modal .tab-body').forEach((b) => (b.hidden = b.dataset.body !== tab));
    if (tab === 'arquivo') loadRaw();
  }
  function armDelete(on) { AG.del = on; const b = $('#ag-delete'); b.classList.toggle('confirm', on); b.textContent = on ? 'Confirmar exclusao' : 'Excluir'; }
  function selectAgent(name) {
    const a = S.agents.find((k) => k.name === name);
    if (!a) { newAgent(); return; }
    AG.cur = name; armDelete(false);
    $('#ag-template-wrap').hidden = true;
    $('#ag-title').textContent = name; $('#ag-file').textContent = (S.agentsDir ? S.agentsDir.replace(/\\/g, '/') + '/' : '') + name + '.md';
    $('#ag-name').value = name; $('#ag-desc').value = a.description || ''; $('#ag-model').value = MODELOS_AG[a.model || ''] !== undefined ? (a.model || '') : '';
    setTools(a.tools || ''); $('#ag-prompt').value = a.prompt || '';
    $('#ag-delete').hidden = false; $('#ag-save').textContent = 'SALVAR';
    $('#ag-note').textContent = 'Muda o arquivo .md do agente. A aparencia fica salva no app.';
    $('#ag-raw').value = ''; $('#ag-raw').dataset.loaded = '';
    $('#agent-modal .tab[data-tab="arquivo"]').hidden = false;
    writeSkin(Game.styleOf(name));
    renderAgentList(); setTab(AG.tab === 'arquivo' ? 'arquivo' : AG.tab);
  }
  function newAgent() {
    AG.cur = ''; armDelete(false);
    $('#ag-template-wrap').hidden = false; $('#ag-template').value = 'branco';
    $('#ag-title').textContent = 'Novo agente'; $('#ag-file').textContent = 'escolha um modelo pronto ou comece do zero';
    $('#ag-name').value = ''; $('#ag-delete').hidden = true; $('#ag-save').textContent = 'CRIAR AGENTE';
    $('#ag-note').textContent = 'Cria o arquivo <nome>.md na pasta dos agentes. Ele ganha uma mesa no mapa na hora.';
    $('#agent-modal .tab[data-tab="arquivo"]').hidden = true;
    if (AG.tab === 'arquivo') AG.tab = 'perfil';
    applyTemplate('branco', true);
    renderAgentList(); setTab(AG.tab);
  }
  function applyTemplate(key, keepSkin) {
    const tp = TEMPLATES[key] || TEMPLATES.branco;
    const nome = $('#ag-name').value.trim() || (key === 'branco' ? 'agent-novo' : 'agent-' + key);
    if (!$('#ag-name').value.trim() && key !== 'branco') $('#ag-name').value = 'agent-' + key;
    $('#ag-desc').value = tp.desc; $('#ag-model').value = tp.model || '';
    setTools(tp.tools ? tp.tools.join(', ') : ''); $('#ag-prompt').value = tp.prompt(nome);
    if (!keepSkin || tp.skin) { randomSkin(); if (tp.skin) writeSkin(Object.assign(readSkin(), tp.skin)); }
    preview();
  }
  function setTools(str) {
    const lista = String(str || '').split(',').map((t) => t.trim()).filter(Boolean);
    $('#ag-tools-all').checked = !lista.length;
    $('#ag-tools').classList.toggle('off', !lista.length);
    $('#ag-tools').querySelectorAll('input').forEach((c) => (c.checked = lista.includes(c.value)));
  }
  function readTools() {
    if ($('#ag-tools-all').checked) return '';
    return [...$('#ag-tools').querySelectorAll('input:checked')].map((c) => c.value).join(', ');
  }
  function writeSkin(st) {
    SKIN_COLORS.forEach((k) => { const el = document.querySelector(`[data-skin="${k}"]`); el.value = RE_HEX.test(st[k] || '') ? st[k].toLowerCase() : '#888888'; });
    $('#ag-hair').value = S.hairStyles.includes(st.hairStyle) ? st.hairStyle : S.hairStyles[0];
    $('#ag-acc').querySelectorAll('input').forEach((c) => (c.checked = (st.acc || []).includes(c.value)));
    preview();
  }
  function readSkin() {
    const skin = {};
    SKIN_COLORS.forEach((k) => (skin[k] = document.querySelector(`[data-skin="${k}"]`).value.toLowerCase()));
    skin.hairStyle = $('#ag-hair').value;
    skin.acc = [...$('#ag-acc').querySelectorAll('input:checked')].map((c) => c.value);
    return skin;
  }
  function preview() {
    const nome = AG.cur || $('#ag-name').value.trim() || 'agent-novo', skin = readSkin();
    Game.portrait($('#ag-preview'), nome, skin); Game.portrait($('#ag-preview-big'), nome, skin);
    if (AG.cur === '') $('#ag-title').textContent = $('#ag-name').value.trim() || 'Novo agente';
  }
  function randomSkin() {
    const pick = (l) => l[(Math.random() * l.length) | 0];
    const accs = S.accessories.filter(() => Math.random() < 0.18).filter((a) => !(a === 'suit' && Math.random() < 0.5));
    writeSkin({
      skin: pick(['#f1c49b', '#e0a878', '#c68654', '#8d5a3a', '#f6d5b5', '#c98d5e']), hair: pick(['#2b1b12', '#6b3e26', '#e0b04a', '#1a1a1a', '#a33b20', '#d9d2c5', '#5b6ee1']),
      shirt: pick(['#e07a5f', '#4cc9f0', '#9b5de5', '#f15bb5', '#00bbf9', '#90be6d', '#ffd166']), pants: pick(['#2f3445', '#3a3352', '#5a4636', '#384058']),
      shoe: pick(['#2a2030', '#e9e4d8', '#3a2a22', '#0f0f14']), tie: pick(['#d33a44', '#4a6fd8', '#2fb36b']), hairStyle: pick(S.hairStyles), acc: accs,
    });
  }
  function formData() {
    return { name: $('#ag-name').value.trim(), description: $('#ag-desc').value.trim(), tools: readTools(), model: $('#ag-model').value, prompt: $('#ag-prompt').value.trim(), skin: readSkin() };
  }
  function upsertAgent(ag, original) {
    const i = S.agents.findIndex((k) => k.name === (original || ag.name));
    if (i >= 0) S.agents[i] = Object.assign({}, S.agents[i], ag); else S.agents.push(ag);
    S.agents.sort((a, b) => (a.name !== 'agent-007') - (b.name !== 'agent-007') || a.name.localeCompare(b.name));
    const cur = $('#sel-agent').value; fill('#sel-agent', S.agents.map((a) => a.name), cur === original ? ag.name : cur);
    renderTeam();
  }
  async function saveAgent() {
    const d = formData(), orig = AG.cur;
    if (!RE_NOME.test(d.name)) { toast('Nome invalido: 2-41 caracteres a-z, 0-9 e "-".'); setTab('perfil'); $('#ag-name').focus(); return; }
    if (!d.description) { toast('Escreva a descricao do agente.'); setTab('perfil'); $('#ag-desc').focus(); return; }
    if (!d.prompt) { toast('Escreva as instrucoes do agente.'); setTab('perfil'); $('#ag-prompt').focus(); return; }
    if (d.name !== orig && S.agents.some((a) => a.name === d.name)) { toast('Ja existe um agente com esse nome.'); return; }
    if (S.demo || !api) {   // modo navegador: so na memoria
      if (orig && d.name !== orig) Game.renameAgent(orig, d.name);
      upsertAgent({ name: d.name, description: d.description, tools: d.tools, model: d.model, prompt: d.prompt }, orig || null);
      if (!orig) Game.addAgent(d.name);
      Game.setSkin(d.name, d.skin); toast('Modo navegador: alteracao so na memoria (nao foi salva em disco).');
      selectAgent(d.name); return;
    }
    try {
      const r = orig ? await api.salvar_agente(Object.assign({ original: orig }, d)) : await api.criar_agente(d);
      if (r && r.erro) { toast(esc(r.erro)); return; }
      if (orig && d.name !== orig) Game.renameAgent(orig, d.name);
      upsertAgent(r.agente, orig || null);
      if (!orig) Game.addAgent(r.agente);
      if (r.skin) Game.setSkin(r.agente.name, r.skin);
      renderLive();
      toast(orig ? `Agente <b>${esc(r.agente.name)}</b> salvo.` : `Agente <b>${esc(r.agente.name)}</b> criado: ele ja tem uma mesa no mapa.`);
      selectAgent(r.agente.name);
    } catch (e) { toast('Falha ao salvar: ' + esc(e)); }
  }
  async function loadRaw(force) {
    const ta = $('#ag-raw');
    if (!AG.cur || (ta.dataset.loaded === AG.cur && !force)) return;
    if (S.demo || !api) {
      const d = formData();
      ta.value = `---\nname: ${d.name}\ndescription: ${d.description}\n${d.tools ? 'tools: ' + d.tools + '\n' : ''}${d.model ? 'model: ' + d.model + '\n' : ''}---\n\n${d.prompt}\n`;
    } else {
      try { const r = await api.ler_agente(AG.cur); if (r && r.erro) { toast(esc(r.erro)); return; } ta.value = r.agente.raw; }
      catch (e) { toast('Falha ao ler o arquivo: ' + esc(e)); return; }
    }
    ta.dataset.loaded = AG.cur;
  }
  async function saveRaw() {
    if (!AG.cur) return;
    if (S.demo || !api) { toast('Editar o arquivo precisa do app (backend Python).'); return; }
    try {
      const r = await api.salvar_arquivo_agente(AG.cur, $('#ag-raw').value);
      if (r && r.erro) { toast(esc(r.erro)); return; }
      upsertAgent(r.agente, AG.cur); toast(`Arquivo de <b>${esc(AG.cur)}</b> salvo.`);
      const tab = AG.tab; selectAgent(AG.cur); setTab(tab);
    } catch (e) { toast('Falha ao salvar o arquivo: ' + esc(e)); }
  }
  async function deleteAgent() {
    const nome = AG.cur; if (!nome) return;
    if (!AG.del) { armDelete(true); setTimeout(() => AG.cur === nome && armDelete(false), 4000); return; }
    armDelete(false);
    if (S.agents.length <= 1) { toast('Nao da para excluir o ultimo agente.'); return; }
    if (!(S.demo || !api)) {
      try { const r = await api.excluir_agente(nome); if (r && r.erro) { toast(esc(r.erro)); return; } toast(`<b>${esc(nome)}</b> foi para a lixeira:<br><small>${esc(r.lixeira)}</small>`); }
      catch (e) { toast('Falha ao excluir: ' + esc(e)); return; }
    } else toast('Modo navegador: removido so da memoria.');
    S.agents = S.agents.filter((a) => a.name !== nome); Game.removeAgent(nome);
    const cur = $('#sel-agent').value; fill('#sel-agent', S.agents.map((a) => a.name), cur === nome ? S.agents[0].name : cur);
    renderTeam(); selectAgent(S.agents[0].name);
  }

  // ------------------------------------------------ tela inicial e mapas
  const MAP_INFO = {
    escritorio: ['Escritorio', 'Escritorio moderno com copa, lounge de fliperama e jardim com lago.'],
    espiao: ['Quartel Espiao', 'Central de operacoes, cofre com laser, cassino, laboratorio de gadgets e heliponto.'],
    gotica: ['Cidade Gotica', 'Noite eterna com chuva: delegacia, detetives, lanchonete, clube de jazz e telhado.'],
  };
  const TOUR = [[29, 11], [7, 11], [51, 7], [51, 17], [10, 30], [30, 30], [50, 30]];
  let tourT = null, tourI = 0;
  function startTour() { stopTour(); const go = () => { const [x, y] = TOUR[tourI++ % TOUR.length]; Game.lookAt(x, y, 3); }; go(); tourT = setInterval(go, 4500); }
  function stopTour() { clearInterval(tourT); tourT = null; }
  function buildStart() {
    const box = $('#start-maps'); box.innerHTML = '';
    Game.themes().forEach(({ id, label }) => {
      const info = MAP_INFO[id] || [label, ''];
      const b = document.createElement('button'); b.className = 'map-card' + (id === S.tema ? ' on' : ''); b.dataset.map = id;
      b.innerHTML = `<canvas width="300" height="120"></canvas><span class="check">✓</span><div><b>${esc(info[0])}</b><small>${esc(info[1])}</small></div>`;
      box.appendChild(b);
    });
    Game.themes().forEach(({ id }) => { Game.setTheme(id); Game.snapshot(box.querySelector(`[data-map="${id}"] canvas`)); });
    Game.setTheme(S.tema);
    renderTeam();
  }
  function renderTeam() {
    const t = $('#start-team'); if (!t) return;
    t.innerHTML = '';
    S.agents.forEach((a) => {
      const b = document.createElement('button'); b.dataset.agent = a.name; b.title = a.description || a.name;
      b.innerHTML = `<canvas width="48" height="48"></canvas><span>${esc(short(a.name))}</span>`;
      t.appendChild(b); Game.portrait(b.querySelector('canvas'), a.name);
    });
  }
  function showStart() {
    const st = $('#start'); st.hidden = false; st.classList.remove('leaving');
    document.querySelectorAll('.map-card').forEach((c) => c.classList.toggle('on', c.dataset.map === S.tema));
    $('#start-folder').textContent = $('#folder-path').value;
    renderTeam(); startTour();
  }
  function enterApp(demo) {
    const st = $('#start'); if (st.hidden) return;
    stopTour(); st.classList.add('leaving');
    setTimeout(() => { st.hidden = true; st.classList.remove('leaving'); }, 340);
    Game.lookAt(29, 11); Game.setFollow(true);
    if (demo) { const p = $('#prompt').value.trim() || 'criar um script hello.py, testar e documentar'; setTimeout(() => runDemo(p, $('#sel-agent').value), 400); }
    else setTimeout(() => $('#prompt').focus(), 360);
  }
  function chooseMap(id) {
    if (!MAP_INFO[id]) return;
    S.tema = id; Game.setTheme(id); $('#sel-map').value = id;
    document.querySelectorAll('.map-card').forEach((c) => c.classList.toggle('on', c.dataset.map === id));
    try { localStorage.setItem('agents07.tema', id); } catch (e) { /* sem storage */ }
    if (api && !S.demo && api.set_tema) api.set_tema(id).catch(() => {});
    if ($('#start').hidden) toast(`Mapa: <b>${esc(MAP_INFO[id][0])}</b>`);
  }

  let twTimer = null;
  function showOutput(text, meta, reportId) {
    const out = $('#output'), body = $('#output-body');
    out.classList.remove('collapsed'); $('#output-toggle').textContent = '▾';
    $('#output-meta').textContent = meta || '';
    const grp = $('#output-reports');
    if (grp) { grp.hidden = !reportId; grp.dataset.job = reportId || ''; }
    clearInterval(twTimer); body.textContent = '';
    const s = String(text || '(sem resposta)'); let i = 0;
    twTimer = setInterval(() => { i = Math.min(s.length, i + Math.max(6, Math.round(s.length / 120))); body.textContent = s.slice(0, i); body.scrollTop = body.scrollHeight; if (i >= s.length) clearInterval(twTimer); }, 16);
    body.onclick = () => { clearInterval(twTimer); body.textContent = s; };
  }
  function showFolder(p) { const el = $('#folder-path'); el.value = p || '(nenhuma)'; el.title = p || ''; }
  async function chooseFolder() {
    if (S.demo || !api) { toast('Escolher pasta precisa do app (backend Python).'); return; }
    try {
      const caminho = await api.escolher_pasta();
      if (!caminho) return;
      const r = await api.set_pasta(caminho);
      if (r && r.erro) { toast(esc(r.erro)); return; }
      showFolder(r.pasta);
      toast(S.job ? 'Pasta trocada. Vale para os proximos envios.' : `Pasta: <b>${esc(r.pasta)}</b>`);
    } catch (e) { toast('Falha ao escolher pasta: ' + esc(e)); }
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
    const tool = (a, f, tx, dt = 1.6) => {
      at(dt, Object.assign({ tipo: 'ferramenta', agente: a, ferramenta: f, texto: tx }, /^(Edit|Write)$/.test(f) ? { arquivo: 'C:/projeto/' + tx } : {}));
      at(0.05, { tipo: 'tokens', agente: a, entrada: 600 + ((Math.random() * 1200) | 0), saida: 80 + ((Math.random() * 400) | 0), cache: 2000 + ((Math.random() * 6000) | 0) });
    };
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
    $('#btn-folder').onclick = chooseFolder;
    $('#btn-demo').onclick = () => { Game.setFollow(true); runDemo($('#prompt').value.trim() || 'criar um script hello.py, testar e documentar', $('#sel-agent').value); };
    $('#prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
    $('#btn-follow').onclick = () => Game.setFollow(!Game.getFollow());
    $('#btn-names').onclick = (e) => { const on = !e.currentTarget.classList.contains('on'); e.currentTarget.classList.toggle('on', on); Game.setNames(on); };
    $('#btn-zoom-in').onclick = () => Game.zoom(1);
    $('#btn-zoom-out').onclick = () => Game.zoom(-1);
    $('#output-reports').onclick = (e) => { e.stopPropagation(); const b = e.target.closest('[data-fmt]'); if (b && e.currentTarget.dataset.job) downloadReport(e.currentTarget.dataset.job, b.dataset.fmt); };
    $('#output-head').onclick = () => { const o = $('#output'), c = o.classList.toggle('collapsed'); $('#output-toggle').textContent = c ? '▴' : '▾'; };
    $('#btn-agents').onclick = () => agentsOpen($('#sel-agent').value);
    $('#btn-pc').onclick = () => openModal('pc-modal');
    document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.hidden = true; }));
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.modal').forEach((m) => (m.hidden = true)); });
    $('#ag-new').onclick = newAgent;
    $('#ag-items').onclick = (e) => { const b = e.target.closest('[data-agent]'); if (b) selectAgent(b.dataset.agent); };
    document.querySelectorAll('#agent-modal .tab').forEach((t) => (t.onclick = () => setTab(t.dataset.tab)));
    $('#ag-template').onchange = (e) => applyTemplate(e.target.value);
    $('#ag-tools-all').onchange = (e) => { $('#ag-tools').classList.toggle('off', e.target.checked); };
    $('#ag-name').oninput = preview;
    $('#ag-hair').onchange = preview;
    $('#ag-acc').onchange = preview;
    document.querySelectorAll('[data-skin]').forEach((el) => (el.oninput = preview));
    $('#ag-random').onclick = randomSkin;
    $('#ag-save').onclick = saveAgent;
    $('#ag-delete').onclick = deleteAgent;
    $('#ag-raw-save').onclick = saveRaw;
    $('#ag-raw-reload').onclick = () => loadRaw(true);
    // tela inicial e mapas
    $('#sel-map').onchange = (e) => chooseMap(e.target.value);
    $('#btn-home').onclick = showStart;
    $('#start-maps').onclick = (e) => { const c = e.target.closest('[data-map]'); if (c) chooseMap(c.dataset.map); };
    $('#start-team').onclick = (e) => { const b = e.target.closest('[data-agent]'); if (b) agentsOpen(b.dataset.agent); };
    $('#start-agents').onclick = () => agentsOpen($('#sel-agent').value);
    $('#start-go').onclick = () => enterApp(false);
    $('#start-demo').onclick = () => enterApp(true);
    $('#start-folder-btn').onclick = async () => { await chooseFolder(); $('#start-folder').textContent = $('#folder-path').value; };
    window.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('#start').hidden && $('#agent-modal').hidden && !/input|textarea|select/i.test(e.target.tagName)) { e.preventDefault(); enterApp(false); } });
    $('#history').onclick = (e) => {
      const rep = e.target.closest('[data-rep]');
      if (rep) { e.stopPropagation(); downloadReport(rep.dataset.rep, rep.dataset.fmt); return; }
      const li = e.target.closest('li[data-i]'); if (!li) return;
      const h = S.history[+li.dataset.i];
      if (h.status === 'running') toast('Ainda rodando...'); else showOutput(h.resposta, `${short(h.agent)} · ${h.prompt}`, String(h.id).startsWith('demo') ? null : h.id);
    };
  }

  boot();
})();
