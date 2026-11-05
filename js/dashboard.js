/* Dashboard de Don Kiko: recibe telemetría del juego, guarda el historial y dibuja KPIs. */
(() => {
  'use strict';

  const STORAGE_KEY = 'donkiko_dashboard_runs_v1';
  const MAX_RUNS = 100;
  const MAX_LOG = 8;
  const PERSIST_MS = 3000;
  const GOAL_X = { 1: 799, 2: 1453, 3: 2345 };
  const RESULT_LABELS = {
    won: 'Victoria',
    game_over: 'Sin vidas',
    pau_caught: 'Atrapado por Pau',
    abandoned: 'Abandonada',
    playing: 'En curso'
  };
  const PHASE_LABELS = {
    menu: 'Menú',
    playing: 'Jugando',
    paused: 'Pausa',
    intermission: 'Nivel superado',
    lost: 'Game over',
    won: 'Victoria'
  };

  const $ = id => document.getElementById(id);
  const frame = $('gameFrame');
  const state = {
    runs: [],
    current: null,
    snap: null,
    muted: false,
    connected: false,
    storageOk: true
  };
  let log = [];
  let toastTimer = null;
  let resizeTimer = null;
  let lastPersist = 0;

  /* ---------- Utilidades ---------- */
  const now = () => Date.now();
  const uid = () => 'r' + now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pad6 = n => String(Math.max(0, Math.round(n))).padStart(6, '0');
  const fmtNum = n => (Number(n) || 0).toLocaleString('es-ES');

  function fmtDuration(ms) {
    const s = Math.max(0, Math.round((ms || 0) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ---------- Persistencia ---------- */
  function isRun(r) {
    return !!r && typeof r === 'object' && typeof r.startedAt === 'number' && typeof r.result === 'string';
  }

  function normalizeRun(r) {
    const wasPlaying = r.result === 'playing';
    const result = wasPlaying
      ? 'abandoned'
      : (RESULT_LABELS[r.result] ? r.result : 'abandoned');
    const levels = Array.isArray(r.levels) ? r.levels.map(lv => ({
      stage: clamp(Number(lv.stage) || 1, 1, 3),
      completed: !!lv.completed,
      closed: true,
      timeMs: Number(lv.timeMs) || 0,
      hurts: Number(lv.hurts) || 0,
      tokens: Number(lv.tokens) || 0,
      startedAt: Number(lv.startedAt) || r.startedAt
    })) : [];
    const startStage = clamp(
      Number(r.startStage) || (levels.length ? Number(levels[0].stage) : 1) || 1,
      1, 3
    );
    const lastSeenAt = Number(r.lastSeenAt) || null;
    const endedAt = r.endedAt || (wasPlaying ? (lastSeenAt || Number(r.startedAt)) : null);
    return {
      id: /^[a-z0-9-]{1,40}$/i.test(String(r.id || '')) ? String(r.id) : uid(),
      startedAt: r.startedAt,
      lastSeenAt,
      endedAt,
      durationMs: Number(r.durationMs) || (wasPlaying ? Math.max(0, endedAt - r.startedAt) : 0),
      result,
      startStage,
      stageReached: clamp(Number(r.stageReached) || 1, 1, 3),
      score: Number(r.score) || 0,
      livesLeft: Number(r.livesLeft) || 0,
      cause: r.cause || null,
      levels
    };
  }

  function loadRuns() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      state.storageOk = true;
    } catch (e) {
      state.storageOk = false;
      $('storageWarning').hidden = false;
      return;
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.runs) ? parsed.runs : [];
      state.runs = arr
        .filter(isRun)
        .map(normalizeRun)
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, MAX_RUNS);
    } catch (e) {
      state.runs = [];
      toast('El historial guardado está dañado; se ignoró.');
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.runs));
      state.storageOk = true;
    } catch (e) {
      state.storageOk = false;
      $('storageWarning').hidden = false;
    }
  }

  /* ---------- Modelo de partidas ---------- */
  function currentLevel() {
    const run = state.current;
    return run ? run.levels[run.levels.length - 1] : null;
  }

  function closeLevel(timeMs) {
    const lv = currentLevel();
    if (!lv || lv.closed) return;
    lv.closed = true;
    lv.timeMs = typeof timeMs === 'number' && timeMs >= 0
      ? Math.round(timeMs)
      : Math.max(0, now() - lv.startedAt);
  }

  function ensureLevel(stage) {
    const run = state.current;
    if (!run) return null;
    let lv = currentLevel();
    if (!lv || lv.stage !== stage) {
      closeLevel();
      lv = { stage, completed: false, closed: false, timeMs: 0, hurts: 0, tokens: 0, startedAt: now() };
      run.levels.push(lv);
    }
    return lv;
  }

  function startRun(level) {
    if (state.current) endRun('abandoned', { cause: 'restart' });
    const stage = clamp(Number(level) || 1, 1, 3);
    const run = {
      id: uid(),
      startedAt: now(),
      lastSeenAt: now(),
      endedAt: null,
      durationMs: 0,
      result: 'playing',
      startStage: stage,
      stageReached: stage,
      score: 0,
      livesLeft: 3,
      cause: null,
      levels: [{ stage, completed: false, closed: false, timeMs: 0, hurts: 0, tokens: 0, startedAt: now() }]
    };
    state.runs.unshift(run);
    if (state.runs.length > MAX_RUNS) state.runs.length = MAX_RUNS;
    state.current = run;
    lastPersist = now();
    persist();
    log = [];
    logEvent(`Partida iniciada · Nivel ${stage}`, 'gold');
    renderAll();
  }

  function endRun(result, extra = {}) {
    const run = state.current;
    if (!run) return;
    closeLevel(extra.levelTime);
    run.endedAt = now();
    run.lastSeenAt = run.endedAt;
    run.durationMs = Math.max(0, run.endedAt - run.startedAt);
    run.result = result;
    if (typeof extra.score === 'number') run.score = extra.score;
    if (typeof extra.lives === 'number') run.livesLeft = extra.lives;
    if (typeof extra.stage === 'number') run.stageReached = Math.max(run.stageReached, extra.stage);
    if (extra.cause) run.cause = extra.cause;
    state.current = null;
    lastPersist = now();
    persist();
    renderAll();
  }

  /* ---------- Telemetría del juego ---------- */
  function handleSnapshot(d) {
    const prev = state.snap;
    state.snap = d;
    if (typeof d.muted === 'boolean') state.muted = d.muted;
    if (state.current) {
      const run = state.current;
      run.lastSeenAt = now();
      let lv = currentLevel();
      if (lv && d.stage !== lv.stage) {
        closeLevel(prev ? prev.elapsed * 1000 : undefined);
        lv = ensureLevel(d.stage);
      }
      if (lv && !lv.closed) {
        lv.timeMs = Math.round((Number(d.elapsed) || 0) * 1000);
      }
      if (d.phase === 'playing') {
        run.score = d.score || 0;
        run.livesLeft = d.lives || 0;
        run.stageReached = Math.max(run.stageReached, d.stage || 1);
      }
      if (now() - lastPersist >= PERSIST_MS) {
        lastPersist = now();
        persist();
      }
    }
    setStatus(d.phase);
    updatePauseButton(d.phase);
    updateContinueButton(d.phase);
    updateSoundButton();
    renderLive();
  }

  function handleStageComplete(d) {
    const lv = ensureLevel(d.stage || state.snap?.stage || 1);
    if (lv) {
      lv.completed = true;
      closeLevel((d.elapsed || 0) * 1000);
    }
    if (state.current) {
      if (typeof d.score === 'number') state.current.score = d.score;
      state.current.stageReached = Math.max(state.current.stageReached, d.stage || 1);
      state.current.lastSeenAt = now();
    }
    logEvent(`Nivel ${d.stage} superado · +${d.bonus || 0} de bonus`, 'good');
    persist();
    renderAll();
  }

  function handleGameMessage(ev) {
    if (ev.source !== frame.contentWindow) return;
    if (location.protocol !== 'file:' && ev.origin !== location.origin) return;
    const d = ev.data;
    if (!d || d.source !== 'donkiko') return;

    switch (d.type) {
      case 'ready':
        state.connected = true;
        setStatus('menu');
        break;

      case 'snapshot':
        state.connected = true;
        handleSnapshot(d);
        break;

      case 'run_start':
        state.connected = true;
        startRun(d.level || d.stage || 1);
        break;

      case 'stage_complete':
        handleStageComplete(d);
        break;

      case 'hurt': {
        const lv = ensureLevel(d.stage || state.snap?.stage || 1);
        if (lv) lv.hurts++;
        logEvent(d.cause === 'fall' ? 'Caída en un hueco' : 'Golpe con un obstáculo', 'bad');
        break;
      }

      case 'token': {
        const lv = ensureLevel(d.stage || state.snap?.stage || 1);
        if (lv) lv.tokens++;
        logEvent('+75 bonificación', 'gold');
        break;
      }

      case 'punch_hit':
        logEvent(`Golpe certero: +${d.gained || 0} puntos`, 'good');
        break;

      case 'pause':
        logEvent('Juego en pausa', 'info');
        break;

      case 'resume':
        logEvent('Juego reanudado', 'info');
        break;

      case 'pau_caught':
        logEvent('Pau los atrapó', 'bad');
        endRun('pau_caught', { score: d.score, stage: d.stage, lives: 0, cause: 'pau' });
        break;

      case 'game_over':
        logEvent('Game over: sin vidas', 'bad');
        endRun('game_over', { score: d.score, stage: d.stage, lives: 0, cause: d.cause || 'hazard' });
        break;

      case 'won':
        logEvent('¡Campaña completada!', 'good');
        endRun('won', { score: d.score, stage: 3, lives: state.snap?.lives ?? 0, cause: 'goal' });
        break;
    }
  }

  /* ---------- Interfaz ---------- */
  function setStatus(phase) {
    const badge = $('statusBadge');
    badge.textContent = state.connected ? (PHASE_LABELS[phase] || phase || '—') : 'Conectando…';
    badge.dataset.state = phase || 'menu';
  }

  function updatePauseButton(phase) {
    const btn = $('pauseToggleBtn');
    const active = phase === 'playing' || phase === 'paused';
    btn.disabled = !active;
    btn.textContent = phase === 'paused' ? 'Reanudar' : 'Pausa';
  }

  function updateContinueButton(phase) {
    const btn = $('continueBtn');
    const active = phase === 'menu' || phase === 'intermission' || phase === 'lost' || phase === 'won';
    btn.disabled = !active;
    btn.textContent = phase === 'intermission' ? 'Siguiente nivel'
      : (phase === 'menu' || phase === 'lost' || phase === 'won') ? 'Jugar' : 'Continuar';
  }

  function updateSoundButton() {
    $('soundToggleBtn').textContent = state.muted ? 'Sonido: no' : 'Sonido: sí';
  }

  function renderLive() {
    const s = state.snap;
    if (!s) return;
    $('liveLevel').textContent = `${s.stage} / 3`;
    $('liveScore').textContent = pad6(s.score);
    $('liveLives').textContent = s.lives > 0 ? '♥ '.repeat(s.lives).trim() : '—';
    $('liveTime').textContent = fmtDuration((s.elapsed || 0) * 1000);
    $('liveStage').textContent = s.levelName || '—';
    $('livePos').textContent = `${fmtNum(s.x)} px`;
    $('livePau').textContent = s.pauActive ? `${fmtNum(Math.abs(s.x - s.pauX))} px` : '—';
    $('liveObjects').textContent = fmtNum(s.objects);
    const floor = clamp(Number(s.floor) || 0, 0, 5);
    $('liveFriend').textContent = s.stage === 1
      ? `Piso ${floor} / 5`
      : s.friendX == null ? '—' : `${fmtNum(Math.abs(s.x - s.friendX))} px`;
    const goal = Number(s.goalX) || GOAL_X[s.stage] || 1000;
    const ratio = s.stage === 1
      ? (floor + clamp(Number(s.x) || 0, 0, goal) / goal) / 6
      : (Number(s.x) || 0) / goal;
    $('liveProgress').style.width = `${clamp(ratio * 100, 0, 100).toFixed(1)}%`;
  }

  function logEvent(text, kind = 'info') {
    log.unshift({ text, kind, t: new Date() });
    log = log.slice(0, MAX_LOG);
    renderLog();
  }

  function renderLog() {
    const box = $('liveLog');
    if (!log.length) {
      box.innerHTML = '<p class="log-empty">Esperando eventos…</p>';
      return;
    }
    box.innerHTML = log.map(e => {
      const time = e.t.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `<div class="log-item" data-kind="${e.kind}"><time>${time}</time><span>${escapeHtml(e.text)}</span></div>`;
    }).join('');
  }

  function finishedRuns() {
    return state.runs.filter(r => r.result !== 'playing');
  }

  function renderKpis() {
    const runs = finishedRuns();
    const total = runs.length;
    const wins = runs.filter(r => r.result === 'won').length;
    const best = Math.max(0, ...runs.map(r => r.score || 0));
    const bestStage = Math.max(0, ...runs.map(r => r.stageReached || 0));
    const avg = total ? runs.reduce((a, r) => a + (r.durationMs || 0), 0) / total : 0;
    const points = runs.reduce((a, r) => a + (r.score || 0), 0);

    $('kpiRuns').textContent = fmtNum(total);
    $('kpiBest').textContent = fmtNum(best);
    $('kpiWinRate').textContent = total ? `${Math.round(wins / total * 100)}%` : '—';
    $('kpiWins').textContent = `${wins} de ${total}`;
    $('kpiBestStage').textContent = bestStage ? `${bestStage} / 3` : '—';
    $('kpiAvgTime').textContent = total ? fmtDuration(avg) : '—';
    $('kpiTotalPoints').textContent = fmtNum(points);
  }

  function causeLabel(r) {
    if (r.result === 'won') return 'Llegó a la cantina';
    if (r.result === 'pau_caught') return 'Alcanzado por Pau';
    if (r.result === 'abandoned') return 'Reinicio o cierre';
    if (r.result === 'playing') return '—';
    return r.cause === 'fall' ? 'Cayó en un hueco' : 'Perdió las 3 vidas';
  }

  function renderTable() {
    const filter = $('filterResult').value;
    const rows = state.runs.filter(r => filter === 'all' || r.result === filter);
    const body = $('historyBody');

    body.innerHTML = rows.map(r => {
      const playing = r.result === 'playing';
      const test = Number(r.startStage) > 1
        ? ' <span class="tag test" title="Partida iniciada en el nivel ' + Number(r.startStage) + '">prueba</span>'
        : '';
      return `<tr>
        <td>${fmtDate(r.startedAt)}</td>
        <td>${r.stageReached || 1} / 3${test}</td>
        <td class="num">${fmtNum(r.score)}</td>
        <td class="num">${playing ? '—' : fmtNum(r.livesLeft)}</td>
        <td class="num">${playing ? '—' : fmtDuration(r.durationMs)}</td>
        <td><span class="tag ${r.result}">${RESULT_LABELS[r.result] || r.result}</span></td>
        <td>${causeLabel(r)}</td>
        <td class="center">${playing ? '' : `<button class="icon-btn" data-del="${escapeHtml(r.id)}" title="Eliminar esta partida">✕</button>`}</td>
      </tr>`;
    }).join('');

    const empty = $('historyEmpty');
    empty.hidden = rows.length > 0;
    if (!rows.length) {
      empty.textContent = filter === 'all'
        ? 'Aún no hay partidas. Juega desde el panel y aparecerán aquí.'
        : 'No hay partidas con este filtro.';
    }
  }

  function renderCharts() {
    if (!window.DKCharts) return;
    const runs = finishedRuns();
    window.DKCharts.scores($('chartScores'), runs);
    window.DKCharts.results($('chartResults'), runs);
    window.DKCharts.hurts($('chartHurts'), runs);
    window.DKCharts.funnel($('chartFunnel'), runs);
  }

  function renderAll() {
    renderKpis();
    renderTable();
    renderCharts();
    renderLive();
  }

  /* ---------- Comandos hacia el juego ---------- */
  function send(command, extra = {}) {
    try {
      frame.contentWindow.postMessage({ source: 'dashboard', command, ...extra }, '*');
    } catch (e) {
      toast('No se pudo comunicar con el juego');
    }
  }

  document.querySelectorAll('[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'start') {
        send('start', { level: Number(btn.dataset.level) || 1 });
      } else if (cmd === 'toggle') {
        const phase = state.snap && state.snap.phase;
        if (phase === 'paused') send('resume');
        else if (phase === 'playing') send('pause');
        else send('continue');
      } else if (cmd === 'continue') {
        send('continue');
      } else if (cmd === 'restart') {
        if (confirm('¿Reiniciar la campaña desde el nivel 1? La partida actual se marcará como abandonada.')) {
          send('restart');
        }
      } else if (cmd === 'mute') {
        state.muted = !state.muted;
        updateSoundButton();
        send('mute', { value: state.muted });
      }
    });
  });

  /* ---------- Historial: borrar, filtrar, exportar, importar ---------- */
  $('historyBody').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-del]');
    if (!btn) return;
    const id = btn.dataset.del;
    if (!confirm('¿Eliminar esta partida del historial?')) return;
    const wasCurrent = !!state.current && state.current.id === id;
    state.runs = state.runs.filter(r => r.id !== id);
    if (wasCurrent) state.current = null;
    persist();
    renderAll();
    toast(wasCurrent ? 'Partida eliminada; la partida en curso ya no se registra' : 'Partida eliminada');
  });

  $('filterResult').addEventListener('change', renderTable);

  $('exportBtn').addEventListener('click', () => {
    if (!state.runs.length) {
      toast('No hay partidas para exportar');
      return;
    }
    const payload = {
      app: 'don-kiko-dashboard',
      version: 1,
      exportedAt: new Date().toISOString(),
      runs: state.runs
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    a.href = URL.createObjectURL(blob);
    a.download = `don-kiko-historial-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Historial exportado');
  });

  $('importInput').addEventListener('change', ev => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if (state.current) {
      toast('Termina la partida en curso antes de importar');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast('El archivo es demasiado grande (máximo 2 MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.runs) ? parsed.runs : [];
        const valid = arr
          .filter(isRun)
          .map(normalizeRun)
          .sort((a, b) => b.startedAt - a.startedAt);
        if (!valid.length) throw new Error('sin partidas válidas');
        if (!confirm(`Se importarán ${valid.length} partidas y se reemplazará el historial actual. ¿Continuar?`)) return;
        state.runs = valid.slice(0, MAX_RUNS);
        state.current = null;
        persist();
        renderAll();
        toast(`${state.runs.length} partidas importadas`);
      } catch (e) {
        toast('Archivo inválido: no se pudo importar');
      }
    };
    reader.onerror = () => toast('No se pudo leer el archivo');
    reader.readAsText(file);
  });

  $('clearBtn').addEventListener('click', () => {
    if (!state.runs.length) {
      toast('El historial ya está vacío');
      return;
    }
    if (!confirm('¿Borrar todas las partidas guardadas? Esta acción no se puede deshacer.')) return;
    const wasPlaying = !!state.current;
    state.runs = [];
    state.current = null;
    persist();
    renderAll();
    toast(wasPlaying ? 'Historial borrado; la partida en curso ya no se registra' : 'Historial borrado');
  });

  $('openGameBtn').addEventListener('click', () => {
    window.open('game/don_kiko.html', '_blank', 'noopener');
  });

  /* ---------- Arranque ---------- */
  function persistNow() {
    if (!state.current) return;
    const lv = currentLevel();
    if (lv && !lv.closed) {
      lv.timeMs = Math.round((Number(state.snap && state.snap.elapsed) || 0) * 1000);
    }
    state.current.lastSeenAt = now();
    persist();
  }

  loadRuns();
  renderLog();
  renderAll();
  window.addEventListener('message', handleGameMessage);
  window.addEventListener('pagehide', persistNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistNow();
  });
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderCharts, 150);
  });

  // Por si el mensaje "ready" se perdió mientras cargaba el iframe.
  setTimeout(() => send('status'), 800);
  requestAnimationFrame(renderCharts);
})();
