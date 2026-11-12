/* Dashboard de Don Kiko: recibe telemetría del juego, guarda el historial y dibuja KPIs. */
(() => {
  'use strict';

  const STORAGE_KEY = 'donkiko_dashboard_runs_v1';
  const MAX_RUNS = 100;
  const MAX_LOG = 8;
  const WORLD_WIDTH = { 1: 1000, 2: 1580, 3: 2470 };
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
  const DIFF_LABELS = { easy: 'Fácil', fair: 'Justo', hard: 'Difícil' };
  const FEELING_LABELS = ['', 'Muy mal', 'Mal', 'Regular', 'Bien', 'Genial'];
  const SURVEY_PREF_KEY = 'donkiko_survey_autoshow';

  const RANKING_TIMEOUT_MS = 9000;
  const RANKING_REFRESH_MS = 30000;

  const rankingConfig = window.DK_CONFIG || {};
  const rankingUrl = String(rankingConfig.supabaseUrl || '').replace(/\/+$/, '');
  const rankingKey = String(rankingConfig.supabaseKey || '');
  const rankingLimit = Math.min(100, Math.max(1, Number(rankingConfig.leaderboardLimit) || 50));
  const rankingEnabled = !!(rankingUrl && rankingKey);

  let supabase = null;
  if (window.supabase && rankingEnabled) {
    try {
      supabase = window.supabase.createClient(rankingUrl, rankingKey);
    } catch (e) {
      console.warn('Supabase no disponible:', e);
    }
  }

  const $ = id => document.getElementById(id);
  const frame = $('gameFrame');
  const state = {
    runs: [],
    current: null,
    snap: null,
    muted: false,
    connected: false,
    storageOk: true,
    playerName: '',
    auth: {
      user: null,
      profile: null,
      loading: false
    },
    ranking: {
      rows: [],
      loading: false,
      error: null,
      loadedAt: 0
    },
    surveyRunId: null,
    surveyAuto: false,
    surveyFeeling: 0,
    surveyDifficulty: null,
    surveyHeld: false
  };
  let log = [];
  let toastTimer = null;
  let resizeTimer = null;
  let nameHintShown = false;

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

  /* ---------- Autenticación (Supabase Auth) ---------- */
  const MAX_ALIAS = 24;

  function sanitizeAlias(value, fallback = 'usuario') {
    const text = String(value || '').trim();
    return Array.from(text).slice(0, MAX_ALIAS).join('') || fallback;
  }

  function isAuthenticated() {
    return !!(state.auth.user && supabase);
  }

  async function loadProfile(userId, email = '') {
    if (!supabase || !userId) return null;
    try {
      const { data } = await supabase
        .from('profiles')
        .select('alias')
        .eq('id', userId)
        .maybeSingle();
      if (data && data.alias) return data;

      // Sin fila en profiles: se crea con el prefijo del correo (máx. 24 caracteres).
      const alias = sanitizeAlias(email ? String(email).split('@')[0] : '');
      const { data: inserted, error: insertError } = await supabase
        .from('profiles')
        .insert({ id: userId, alias })
        .select('alias')
        .maybeSingle();
      if (insertError) {
        console.warn('No se pudo crear perfil:', insertError);
        return { alias };
      }
      return inserted || { alias };
    } catch (e) {
      console.warn('Perfil:', e);
      return { alias: sanitizeAlias(email ? String(email).split('@')[0] : '') };
    }
  }

  async function initAuth() {
    if (!supabase) {
      state.auth.loading = false;
      updateAuthUI();
      return;
    }
    state.auth.loading = true;
    updateAuthUI();
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) {
        state.auth.user = null;
        state.auth.profile = null;
      } else {
        state.auth.user = user;
        state.auth.profile = await loadProfile(user.id, user.email);
      }
    } catch (e) {
      console.warn('Auth init:', e);
      state.auth.user = null;
      state.auth.profile = null;
    } finally {
      state.auth.loading = false;
      updateAuthUI();
    }
  }

  function subscribeAuth() {
    if (!supabase) return;
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        state.auth.user = session?.user ?? null;
        state.auth.profile = session?.user ? await loadProfile(session.user.id, session.user.email) : null;
      } else if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
        state.auth.user = null;
        state.auth.profile = null;
      }
      updateAuthUI();
    });
  }

  function authErrorMessage(err) {
    const raw = String((err && (err.message || err.error_description)) || '');
    const code = String((err && err.code) || '');
    if (code === 'email_confirmation_required') return raw;
    if (/invalid login credentials/i.test(raw)) return 'Correo o contraseña incorrectos.';
    if (/email not confirmed/i.test(raw)) return 'Confirma tu correo antes de iniciar sesión.';
    if (/user already registered|already been registered/i.test(raw)) return 'Ese correo ya tiene una cuenta. Inicia sesión.';
    if (/password should be at least/i.test(raw)) return 'La contraseña debe tener al menos 6 caracteres.';
    if (/rate limit|too many requests/i.test(raw) || code === 'over_email_send_rate_limit') {
      return 'Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.';
    }
    if (/signups? not allowed|signup is disabled/i.test(raw)) return 'El registro está desactivado en Supabase.';
    return raw || 'No se pudo completar la autenticación.';
  }

  async function signUp(email, password, alias) {
    if (!supabase) throw new Error('Supabase no está configurado.');
    const cleanAlias = sanitizeAlias(alias, '');
    if (!cleanAlias) throw new Error('El alias es obligatorio.');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { alias: cleanAlias } }
    });
    if (error) throw new Error(authErrorMessage(error));
    const user = (data && data.session && data.session.user) || null;
    if (!user) {
      throw new Error('Cuenta creada, pero falta confirmar el correo. Revisa tu bandeja o desactiva "Confirm email" en Supabase.');
    }
    state.auth.user = user;
    state.auth.profile = await loadProfile(user.id, user.email);
    updateAuthUI();
    return data;
  }

  async function signIn(email, password) {
    if (!supabase) throw new Error('Supabase no está configurado.');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(authErrorMessage(error));
    const user = (data && data.session && data.session.user) || data.user || null;
    if (user) {
      state.auth.user = user;
      state.auth.profile = await loadProfile(user.id, user.email);
    }
    updateAuthUI();
    return data;
  }

  async function signOut() {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Cerrar sesión:', e);
    }
    state.auth.user = null;
    state.auth.profile = null;
    updateAuthUI();
  }

  function updateAuthUI() {
    const userEl = $('authUser');
    const guestEl = $('authGuest');
    const aliasEl = $('authUserAlias');
    if (!userEl || !guestEl || !aliasEl) return;

    if (isAuthenticated() && state.auth.profile) {
      userEl.hidden = false;
      guestEl.hidden = true;
      aliasEl.textContent = state.auth.profile.alias || state.auth.user.email;
    } else {
      userEl.hidden = true;
      guestEl.hidden = false;
    }

    const nameInput = $('playerName');
    if (nameInput) {
      if (isAuthenticated() && state.auth.profile) {
        nameInput.value = state.auth.profile.alias;
        nameInput.disabled = true;
      } else {
        nameInput.disabled = false;
      }
    }
  }

  function currentPlayerNameForRanking() {
    if (isAuthenticated() && state.auth.profile) {
      return state.auth.profile.alias;
    }
    return currentPlayerName();
  }

  /* ---------- Ranking global (Supabase) ---------- */
  function normalizeName(value) {
    return Array.from(String(value || '').trim()).slice(0, 24).join('');
  }

  function currentPlayerName() {
    const input = $('playerName');
    return normalizeName(input ? input.value : state.playerName);
  }

  function rankingHeaders(extra = {}) {
    return {
      apikey: rankingKey,
      Authorization: `Bearer ${rankingKey}`,
      ...extra
    };
  }

  function rankingEndpoint(path) {
    return `${rankingUrl}/rest/v1/${path}`;
  }

  async function rankingFetch(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RANKING_TIMEOUT_MS);
    try {
      return await fetch(rankingEndpoint(path), {
        cache: 'no-store',
        ...options,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  function rankingErrorMessage(err) {
    if (err && err.name === 'AbortError') return 'El ranking tardó demasiado en responder.';
    const message = String((err && err.message) || '');
    if (message.includes('HTTP 401') || message.includes('HTTP 403')) {
      return 'No se pudo autenticar con el ranking. Revisá la clave pública.';
    }
    if (message.includes('HTTP 404')) {
      return 'La vista del ranking no está disponible. Revisá el esquema de Supabase.';
    }
    if (location.protocol === 'file:') {
      return 'No se pudo conectar. Si abriste el archivo con doble clic, probá desde Netlify o http://localhost.';
    }
    return 'No se pudo cargar el ranking. Revisá tu conexión.';
  }

  async function loadRanking() {
    const st = state.ranking;
    if (!rankingEnabled) {
      st.loading = false;
      st.error = 'El ranking global no está configurado.';
      renderRanking();
      return;
    }
    if (st.loading) return;
    st.loading = true;
    st.error = null;
    renderRanking();
    try {
      const params = new URLSearchParams({
        select: 'player_name,best_score,best_stage,best_time_ms,runs,last_played',
        order: 'best_score.desc,best_time_ms.asc.nullslast,last_played.asc',
        limit: String(rankingLimit)
      });
      const res = await rankingFetch(`leaderboard?${params}`, { headers: rankingHeaders() });
      if (!res.ok) {
        let detail = '';
        try {
          const data = await res.json();
          detail = data.message || data.hint || '';
        } catch (e) { /* sin cuerpo útil */ }
        throw new Error(`HTTP ${res.status}${detail ? ': ' + detail : ''}`);
      }
      const data = await res.json();
      st.rows = Array.isArray(data) ? data.filter(row => row && row.player_name) : [];
      st.error = null;
      st.loadedAt = now();
    } catch (err) {
      console.warn('Ranking global:', err);
      st.error = rankingErrorMessage(err);
    } finally {
      st.loading = false;
      renderRanking();
    }
  }

  function renderRanking() {
    const st = state.ranking;
    const body = $('rankingBody');
    const empty = $('rankingEmpty');
    const status = $('rankingStatus');
    const refresh = $('refreshRankingBtn');
    const section = document.querySelector('.ranking');
    if (!body || !empty || !status || !refresh) return;

    if (section) section.setAttribute('aria-busy', st.loading ? 'true' : 'false');
    refresh.disabled = st.loading || !rankingEnabled;
    refresh.textContent = st.loading ? 'Actualizando…' : 'Actualizar';

    if (st.loading) {
      status.dataset.state = 'loading';
      status.textContent = 'Cargando ranking…';
    } else if (st.error) {
      status.dataset.state = 'error';
      status.textContent = st.error;
    } else if (!rankingEnabled) {
      status.dataset.state = 'error';
      status.textContent = 'El ranking global no está configurado.';
    } else if (!st.rows.length) {
      status.dataset.state = 'ok';
      status.textContent = 'Todavía no hay marcas globales.';
    } else {
      const time = st.loadedAt
        ? new Date(st.loadedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        : '—';
      status.dataset.state = 'ok';
      status.textContent = `${st.rows.length} jugador${st.rows.length === 1 ? '' : 'es'} · actualizado ${time}`;
    }

    const me = currentPlayerNameForRanking().toLowerCase();
    body.innerHTML = st.rows.map((row, index) => {
      const name = String(row.player_name || '');
      const isMe = !!me && name.toLowerCase() === me;
      const rank = index + 1;
      const rankClass = rank <= 3 ? ` rank-${rank}` : '';
      return `<tr class="rank-row${rankClass}${isMe ? ' is-you' : ''}">
        <td class="rank-cell">${rank}</td>
        <td>${escapeHtml(name)}${isMe ? ' <span class="you-tag">tú</span>' : ''}</td>
        <td class="num">${fmtNum(row.best_score)}</td>
        <td class="num">${clamp(Number(row.best_stage) || 0, 0, 3)} / 3</td>
        <td class="num">${row.best_time_ms != null ? fmtDuration(row.best_time_ms) : '—'}</td>
        <td class="num">${fmtNum(row.runs)}</td>
        <td>${row.last_played ? fmtDate(row.last_played) : '—'}</td>
      </tr>`;
    }).join('');

    empty.hidden = st.loading || !!st.error || st.rows.length > 0;
    if (!empty.hidden) {
      empty.textContent = rankingEnabled
        ? 'Aún no hay marcas globales. Juega la campaña desde el Nivel 1.'
        : 'Configurá Supabase en js/config.js para activar el ranking.';
    }
  }

  /* ---------- Persistencia ---------- */
  function isRun(r) {
    return !!r && typeof r === 'object' && typeof r.startedAt === 'number' && typeof r.result === 'string';
  }

  function starsText(value) {
    const n = clamp(Math.round(Number(value) || 0), 0, 5);
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  function normalizeFeedback(fb) {
    if (!fb || typeof fb !== 'object') return null;
    const feeling = Math.round(Number(fb.feeling));
    if (!Number.isFinite(feeling) || feeling < 1 || feeling > 5) return null;
    return {
      feeling,
      difficulty: ['easy', 'fair', 'hard'].includes(fb.difficulty) ? fb.difficulty : null,
      comment: typeof fb.comment === 'string' ? fb.comment.slice(0, 280) : '',
      createdAt: typeof fb.createdAt === 'string' ? fb.createdAt : new Date().toISOString()
    };
  }

  function normalizeRun(r) {
    const wasPlaying = r.result === 'playing';
    const result = wasPlaying
      ? 'abandoned'
      : (RESULT_LABELS[r.result] ? r.result : 'abandoned');
    const endedAt = r.endedAt || (wasPlaying ? now() : null);
    return {
      id: r.id || uid(),
      startedAt: r.startedAt,
      endedAt,
      durationMs: Number(r.durationMs) || (wasPlaying ? Math.max(0, endedAt - r.startedAt) : 0),
      result,
      stageReached: clamp(Number(r.stageReached) || 1, 1, 3),
      score: Number(r.score) || 0,
      livesLeft: Number(r.livesLeft) || 0,
      cause: r.cause || null,
      feedback: normalizeFeedback(r.feedback),
      levels: Array.isArray(r.levels) ? r.levels.map(lv => ({
        stage: clamp(Number(lv.stage) || 1, 1, 3),
        completed: !!lv.completed,
        closed: true,
        timeMs: Number(lv.timeMs) || 0,
        hurts: Number(lv.hurts) || 0,
        tokens: Number(lv.tokens) || 0,
        startedAt: Number(lv.startedAt) || r.startedAt
      })) : []
    };
  }

  function loadRuns() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.runs) ? parsed.runs : [];
        state.runs = arr.filter(isRun).map(normalizeRun).slice(0, MAX_RUNS);
      }
      state.storageOk = true;
    } catch (e) {
      state.storageOk = false;
      $('storageWarning').hidden = false;
    }
    // Partidas que quedaron "en curso" en una sesión anterior.
    for (const r of state.runs) {
      if (r.result === 'playing') {
        r.result = 'abandoned';
        r.endedAt = r.endedAt || now();
        r.durationMs = r.durationMs || Math.max(0, r.endedAt - r.startedAt);
      }
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

  /* ---------- Preferencia de la encuesta ---------- */
  function surveyPrefOn() {
    try { return localStorage.getItem(SURVEY_PREF_KEY) !== 'off'; }
    catch (e) { return true; }
  }

  function setSurveyPref(on) {
    try { localStorage.setItem(SURVEY_PREF_KEY, on ? 'on' : 'off'); }
    catch (e) {}
    updateSurveyPrefBtn();
  }

  function updateSurveyPrefBtn() {
    const btn = $('surveyPrefBtn');
    if (!btn) return;
    const on = surveyPrefOn();
    btn.textContent = `Encuesta automática: ${on ? 'sí' : 'no'}`;
    btn.setAttribute('aria-pressed', String(on));
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
    persist();
    logEvent(`Partida iniciada · Nivel ${stage}`, 'gold');
    renderAll();
  }

  function endRun(result, extra = {}) {
    const run = state.current;
    if (!run) return null;
    closeLevel(extra.levelTime);
    run.endedAt = now();
    run.durationMs = Math.max(0, run.endedAt - run.startedAt);
    run.result = result;
    if (typeof extra.score === 'number') run.score = extra.score;
    if (typeof extra.lives === 'number') run.livesLeft = extra.lives;
    if (typeof extra.stage === 'number') run.stageReached = Math.max(run.stageReached, extra.stage);
    if (extra.cause) run.cause = extra.cause;
    state.current = null;
    persist();
    renderAll();
    submitRun(run);
    return run;
  }

  async function submitRun(run) {
    if (!run || run.startStage !== 1) return;
    if (!['won', 'game_over', 'pau_caught'].includes(run.result)) return;
    if (!rankingEnabled) return;

    if (!isAuthenticated()) {
      if (!nameHintShown) {
        nameHintShown = true;
        toast('Inicia sesión para enviar tu puntaje al ranking global.');
      }
      return;
    }

    const playerName = currentPlayerNameForRanking();
    if (!playerName) {
      if (!nameHintShown) {
        nameHintShown = true;
        toast('Tu perfil no tiene alias asignado.');
      }
      return;
    }

    const levels = (Array.isArray(run.levels) ? run.levels : [])
      .slice(0, 3)
      .map(lv => ({
        stage: clamp(Number(lv.stage) || 1, 1, 3),
        completed: !!lv.completed,
        timeMs: Math.max(0, Math.round(Number(lv.timeMs) || 0)),
        hurts: Math.max(0, Math.round(Number(lv.hurts) || 0)),
        tokens: Math.max(0, Math.round(Number(lv.tokens) || 0))
      }));
    if (!levels.length) return;

    const activeTime = levels.reduce((total, lv) => total + lv.timeMs, 0);
    const payload = {
      client_run_id: String(run.id).slice(0, 64),
      user_id: state.auth.user ? state.auth.user.id : null,
      player_name: playerName,
      score: clamp(Math.round(Number(run.score) || 0), 0, 100000000),
      result: run.result,
      start_stage: clamp(Number(run.startStage) || 1, 1, 3),
      stage_reached: clamp(Number(run.stageReached) || 1, 1, 3),
      duration_ms: clamp(Math.round(Number(run.durationMs) || 0), 0, 86400000),
      active_time_ms: clamp(Math.round(activeTime), 0, 86400000),
      levels
    };

    try {
      const res = await rankingFetch('runs', {
        method: 'POST',
        headers: rankingHeaders({
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        }),
        body: JSON.stringify(payload)
      });
      if (res.status === 409) {
        toast('Esa partida ya estaba en el ranking global.');
        loadRanking();
        return;
      }
      if (!res.ok) {
        let detail = '';
        try {
          const data = await res.json();
          detail = data.message || data.hint || '';
        } catch (e) { /* sin cuerpo útil */ }
        throw new Error(`HTTP ${res.status}${detail ? ': ' + detail : ''}`);
      }
      toast('Puntaje enviado al ranking global.');
      loadRanking();
    } catch (err) {
      console.warn('Ranking global (envío):', err);
      toast('No se pudo enviar el puntaje; quedó guardado en el historial local.');
    }
  }

  /* ---------- Telemetría del juego ---------- */
  function handleSnapshot(d) {
    const prev = state.snap;
    state.snap = d;
    if (state.current) {
      const lv = currentLevel();
      if (lv && d.stage !== lv.stage) {
        closeLevel(prev ? prev.elapsed * 1000 : undefined);
        ensureLevel(d.stage);
      }
      if (d.phase === 'playing') {
        state.current.score = d.score || 0;
        state.current.livesLeft = d.lives || 0;
        state.current.stageReached = Math.max(state.current.stageReached, d.stage || 1);
      }
    }
    setStatus(d.phase);
    updatePauseButton(d.phase);
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
    }
    logEvent(`Nivel ${d.stage} superado · +${d.bonus || 0} de bonus`, 'good');
    persist();
    renderAll();
  }

  function handleGameMessage(ev) {
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

      case 'pau_caught': {
        logEvent('Pau los atrapó', 'bad');
        const run = endRun('pau_caught', { score: d.score, stage: d.stage, lives: 0, cause: 'pau' });
        maybeOpenSurvey(run, true);
        break;
      }

      case 'game_over': {
        logEvent('Game over: sin vidas', 'bad');
        const run = endRun('game_over', { score: d.score, stage: d.stage, lives: 0, cause: d.cause || 'hazard' });
        maybeOpenSurvey(run);
        break;
      }

      case 'won': {
        logEvent('¡Campaña completada!', 'good');
        const run = endRun('won', { score: d.score, stage: 3, lives: state.snap?.lives ?? 0, cause: 'goal' });
        maybeOpenSurvey(run);
        break;
      }
    }
  }

  /* ---------- Encuesta de jugadores ---------- */
  function shouldSurvey(run) {
    if (!run || run.feedback) return false;
    if (!['won', 'game_over', 'pau_caught'].includes(run.result)) return false;
    return surveyPrefOn();
  }

  function maybeOpenSurvey(run, hold = false) {
    if (!shouldSurvey(run)) return;
    if (!$('surveyModal').hidden) return;
    if (hold) {
      send('hold');
      state.surveyHeld = true;
    }
    openSurvey(run.id, true);
  }

  function openSurvey(runId, auto = false) {
    const run = state.runs.find(r => r.id === runId);
    if (!run || run.result === 'playing') return;
    state.surveyRunId = runId;
    state.surveyAuto = !!auto;
    state.surveyFeeling = run.feedback ? run.feedback.feeling : 0;
    state.surveyDifficulty = run.feedback ? run.feedback.difficulty : null;
    $('surveySub').textContent = `${RESULT_LABELS[run.result] || run.result} · Nivel ${run.stageReached || 1}/3 · ${fmtDate(run.startedAt)}`;
    $('surveyComment').value = run.feedback ? run.feedback.comment : '';
    $('commentCount').textContent = String($('surveyComment').value.length);
    $('surveyNoAuto').checked = !surveyPrefOn();
    $('surveyDelete').hidden = !run.feedback;
    $('surveyError').hidden = true;
    renderSurveySelection();
    renderSurveyDifficulty();
    $('surveyModal').hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(() => {
      const target = document.querySelector(`#surveyStars [data-feeling="${state.surveyFeeling || 1}"]`);
      if (target) target.focus();
    }, 40);
  }

  function closeSurvey(sendContinue = true) {
    $('surveyModal').hidden = true;
    document.body.classList.remove('modal-open');
    if (sendContinue && state.surveyHeld) {
      send('continue');
      state.surveyHeld = false;
    }
    state.surveyRunId = null;
    state.surveyAuto = false;
  }

  function applySurveyPref() {
    setSurveyPref(!$('surveyNoAuto').checked);
  }

  function renderSurveySelection() {
    document.querySelectorAll('#surveyStars [data-feeling]').forEach(btn => {
      const v = Number(btn.dataset.feeling);
      const on = v <= state.surveyFeeling;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', String(v === state.surveyFeeling));
    });
    $('starsCaption').textContent = state.surveyFeeling ? FEELING_LABELS[state.surveyFeeling] : 'Toca una estrella';
  }

  function renderSurveyDifficulty() {
    document.querySelectorAll('#surveyDifficulty [data-difficulty]').forEach(btn => {
      const on = btn.dataset.difficulty === state.surveyDifficulty;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', String(on));
    });
  }

  function saveSurvey() {
    if (!state.surveyFeeling) {
      $('surveyError').hidden = false;
      return;
    }
    const run = state.runs.find(r => r.id === state.surveyRunId);
    if (!run) {
      closeSurvey();
      return;
    }
    run.feedback = {
      feeling: state.surveyFeeling,
      difficulty: state.surveyDifficulty || null,
      comment: $('surveyComment').value.trim().slice(0, 280),
      createdAt: new Date().toISOString()
    };
    applySurveyPref();
    persist();
    renderAll();
    closeSurvey();
    toast('¡Gracias por tu opinión!');
  }

  function skipSurvey() {
    const wasAuto = state.surveyAuto;
    applySurveyPref();
    closeSurvey();
    toast(wasAuto ? 'Puedes responder después desde el historial.' : 'Encuesta cerrada.');
  }

  function deleteSurvey() {
    const run = state.runs.find(r => r.id === state.surveyRunId);
    if (!run) {
      closeSurvey();
      return;
    }
    run.feedback = null;
    persist();
    renderAll();
    closeSurvey();
    toast('Respuesta eliminada');
  }

  /* ---------- Interfaz ---------- */
  function setStatus(phase) {
    const badge = $('statusBadge');
    badge.textContent = state.connected ? (PHASE_LABELS[phase] || phase || '—') : 'Conectando…';
    badge.dataset.state = phase || 'menu';
  }

  function updatePauseButton(phase) {
    $('pauseToggleBtn').textContent = phase === 'paused' ? 'Reanudar' : 'Pausa';
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
    $('livePau').textContent = s.pauActive ? `${fmtNum(Math.max(0, s.x - s.pauX))} px` : '—';
    $('liveObjects').textContent = fmtNum(s.objects);
    $('liveFriend').textContent = s.friendX == null ? '—' : `${fmtNum(Math.max(0, s.x - s.friendX))} px`;
    const total = WORLD_WIDTH[s.stage] || 1000;
    $('liveProgress').style.width = `${clamp(s.x / total * 100, 0, 100).toFixed(1)}%`;
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

  function renderFeedbackKpis() {
    const runs = finishedRuns();
    const withFb = runs.filter(r => r.feedback);
    const total = withFb.length;
    const avg = total ? withFb.reduce((a, r) => a + r.feedback.feeling, 0) / total : 0;
    const positive = withFb.filter(r => r.feedback.feeling >= 4).length;
    const counts = { easy: 0, fair: 0, hard: 0 };
    withFb.forEach(r => {
      if (r.feedback.difficulty) counts[r.feedback.difficulty]++;
    });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

    $('kpiFeeling').textContent = total ? `${avg.toFixed(1)} / 5` : '—';
    $('kpiFeelingCount').textContent = `${total} respuesta${total === 1 ? '' : 's'}`;
    $('kpiResponses').textContent = fmtNum(total);
    $('kpiResponseRate').textContent = `de ${fmtNum(runs.length)} partida${runs.length === 1 ? '' : 's'}`;
    $('kpiPositive').textContent = total ? `${Math.round(positive / total * 100)}%` : '—';
    $('kpiDifficulty').textContent = top && top[1] ? DIFF_LABELS[top[0]] : '—';
  }

  function renderComments() {
    const filter = $('filterFeedback').value;
    let items = finishedRuns().filter(r => r.feedback);
    if (filter === 'positive') items = items.filter(r => r.feedback.feeling >= 4);
    else if (filter === 'negative') items = items.filter(r => r.feedback.feeling <= 3);
    else if (filter === 'with-comment') items = items.filter(r => r.feedback.comment);

    items = items.slice().sort((a, b) => new Date(b.feedback.createdAt) - new Date(a.feedback.createdAt));
    const box = $('commentsList');
    box.innerHTML = items.map(r => {
      const fb = r.feedback;
      const comment = fb.comment
        ? `<p>${escapeHtml(fb.comment)}</p>`
        : '<p class="muted">Sin comentario</p>';
      return `<article class="comment-item">
        <div class="comment-top">
          <span class="comment-stars" title="${fb.feeling}/5">${starsText(fb.feeling)}</span>
          <span class="tag ${r.result}">${RESULT_LABELS[r.result] || r.result}</span>
          ${fb.difficulty ? `<span>${DIFF_LABELS[fb.difficulty]}</span>` : ''}
          <time>${fmtDate(r.startedAt)}</time>
        </div>
        ${comment}
      </article>`;
    }).join('');
    $('commentsEmpty').hidden = items.length > 0;
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
      const fbStars = r.feedback
        ? `<span class="comment-stars" title="${r.feedback.feeling}/5">${'★'.repeat(r.feedback.feeling)}</span>`
        : '—';
      const surveyBtn = playing
        ? ''
        : `<button class="icon-btn survey-btn${r.feedback ? ' has-feedback' : ''}" data-survey="${r.id}" title="${r.feedback ? 'Editar encuesta' : 'Responder encuesta'}" aria-label="${r.feedback ? 'Editar encuesta' : 'Responder encuesta'}">★</button>`;
      return `<tr>
        <td>${fmtDate(r.startedAt)}</td>
        <td>${r.stageReached || 1} / 3</td>
        <td class="num">${fmtNum(r.score)}</td>
        <td class="num">${fbStars}</td>
        <td class="num">${playing ? '—' : fmtNum(r.livesLeft)}</td>
        <td class="num">${playing ? '—' : fmtDuration(r.durationMs)}</td>
        <td><span class="tag ${r.result}">${RESULT_LABELS[r.result] || r.result}</span></td>
        <td>${causeLabel(r)}</td>
        <td class="center">${surveyBtn}${playing ? '' : `<button class="icon-btn" data-del="${r.id}" title="Eliminar esta partida">✕</button>`}</td>
      </tr>`;
    }).join('');

    $('historyEmpty').hidden = rows.length > 0;
  }

  function renderCharts() {
    if (!window.DKCharts) return;
    const runs = finishedRuns();
    window.DKCharts.scores($('chartScores'), runs);
    window.DKCharts.results($('chartResults'), runs);
    window.DKCharts.hurts($('chartHurts'), runs);
    window.DKCharts.funnel($('chartFunnel'), runs);
    window.DKCharts.feelings($('chartFeelings'), runs);
    window.DKCharts.difficulty($('chartDifficulty'), runs);
  }

  function renderAll() {
    renderKpis();
    renderFeedbackKpis();
    renderTable();
    renderComments();
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
        send('toggle');
      } else if (cmd === 'restart') {
        if (confirm('¿Reiniciar la campaña desde el nivel 1? La partida actual se marcará como abandonada.')) {
          send('restart');
        }
      } else if (cmd === 'mute') {
        state.muted = !state.muted;
        btn.textContent = state.muted ? 'Sonido: no' : 'Sonido: sí';
        send('mute', { value: state.muted });
      }
    });
  });

  /* ---------- Historial: borrar, filtrar, exportar, importar ---------- */
  $('historyBody').addEventListener('click', ev => {
    const surveyBtn = ev.target.closest('[data-survey]');
    if (surveyBtn) {
      openSurvey(surveyBtn.dataset.survey, false);
      return;
    }
    const btn = ev.target.closest('[data-del]');
    if (!btn) return;
    const id = btn.dataset.del;
    if (!confirm('¿Eliminar esta partida del historial?')) return;
    state.runs = state.runs.filter(r => r.id !== id);
    if (state.current && state.current.id === id) state.current = null;
    persist();
    renderAll();
    toast('Partida eliminada');
  });

  $('filterResult').addEventListener('change', renderTable);

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportSurveyCsv() {
    const rows = finishedRuns().filter(r => r.feedback);
    if (!rows.length) {
      toast('No hay encuestas para exportar');
      return;
    }
    const head = ['fecha_partida', 'nivel', 'puntos', 'resultado', 'estrellas', 'dificultad', 'comentario', 'fecha_encuesta'];
    const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [head.join(',')];
    rows.forEach(r => {
      lines.push([
        new Date(r.startedAt).toISOString(),
        r.stageReached || 1,
        r.score || 0,
        RESULT_LABELS[r.result] || r.result,
        r.feedback.feeling,
        DIFF_LABELS[r.feedback.difficulty] || '',
        r.feedback.comment || '',
        r.feedback.createdAt
      ].map(esc).join(','));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    downloadBlob(blob, `don-kiko-encuestas-${stamp}.csv`);
    toast('Encuestas exportadas');
  }

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
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.runs) ? parsed.runs : [];
        const valid = arr.filter(isRun).map(normalizeRun);
        if (!valid.length) throw new Error('sin partidas válidas');
        if (!confirm(`Se importarán ${valid.length} partidas y se reemplazará el historial actual. ¿Continuar?`)) return;
        state.runs = valid.slice(0, MAX_RUNS);
        state.current = null;
        persist();
        renderAll();
        toast(`${valid.length} partidas importadas`);
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
    state.runs = [];
    state.current = null;
    persist();
    renderAll();
    toast('Historial borrado');
  });

  $('openGameBtn').addEventListener('click', () => {
    window.open('game/don_kiko.html', '_blank', 'noopener');
  });

  /* ---------- Encuesta: interacción ---------- */
  document.querySelectorAll('#surveyStars [data-feeling]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.surveyFeeling = Number(btn.dataset.feeling);
      $('surveyError').hidden = true;
      renderSurveySelection();
    });
  });

  document.querySelectorAll('#surveyDifficulty [data-difficulty]').forEach(btn => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.difficulty;
      state.surveyDifficulty = state.surveyDifficulty === value ? null : value;
      renderSurveyDifficulty();
    });
  });

  $('surveyComment').addEventListener('input', () => {
    $('commentCount').textContent = String($('surveyComment').value.length);
  });

  $('surveySave').addEventListener('click', saveSurvey);
  $('surveyDelete').addEventListener('click', deleteSurvey);
  document.querySelectorAll('[data-survey-close]').forEach(el => el.addEventListener('click', skipSurvey));
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && !$('surveyModal').hidden) skipSurvey();
  });

  $('surveyPrefBtn').addEventListener('click', () => {
    const on = !surveyPrefOn();
    setSurveyPref(on);
    toast(on ? 'Encuesta automática activada' : 'Encuesta automática desactivada');
  });
  $('exportSurveyBtn').addEventListener('click', exportSurveyCsv);
  $('filterFeedback').addEventListener('change', renderComments);

  /* ---------- Autenticación: UI ---------- */
  const authPanel = $('authPanel');
  const authForm = $('authForm');
  const authTitle = $('authTitle');
  const authSubmitBtn = $('authSubmitBtn');
  const authToggleBtn = $('authToggleBtn');
  const authError = $('authError');
  const authEmail = $('authEmail');
  const authPassword = $('authPassword');
  const authPasswordConfirm = $('authPasswordConfirm');
  const authAlias = $('authAlias');
  const authFieldEmail = $('authFieldEmail');
  const authFieldAlias = $('authFieldAlias');
  const authFieldConfirm = $('authFieldConfirm');
  let authMode = 'login';

  function showAuthPanel() {
    if (!authPanel) return;
    authPanel.hidden = false;
    authError.hidden = true;
    authError.textContent = '';
    authForm.reset();
    setAuthMode('login');
  }

  function hideAuthPanel() {
    if (!authPanel) return;
    authPanel.hidden = true;
    authError.hidden = true;
  }

  function setAuthMode(mode) {
    authMode = mode;
    if (!authTitle || !authSubmitBtn || !authToggleBtn) return;
    if (authError) {
      authError.hidden = true;
      authError.textContent = '';
    }
    if (mode === 'signup') {
      authTitle.textContent = 'Crear cuenta';
      authSubmitBtn.textContent = 'Registrarse';
      authToggleBtn.textContent = '¿Ya tienes cuenta? Inicia sesión';
      if (authFieldEmail) authFieldEmail.style.display = '';
      if (authFieldAlias) authFieldAlias.style.display = '';
      if (authFieldConfirm) authFieldConfirm.style.display = '';
      if (authAlias) authAlias.required = true;
      if (authPasswordConfirm) authPasswordConfirm.required = true;
      authPassword.setAttribute('autocomplete', 'new-password');
    } else {
      authTitle.textContent = 'Iniciar sesión';
      authSubmitBtn.textContent = 'Iniciar sesión';
      authToggleBtn.textContent = '¿No tienes cuenta? Regístrate';
      if (authFieldEmail) authFieldEmail.style.display = '';
      if (authFieldAlias) authFieldAlias.style.display = 'none';
      if (authFieldConfirm) authFieldConfirm.style.display = 'none';
      if (authAlias) authAlias.required = false;
      if (authPasswordConfirm) authPasswordConfirm.required = false;
      authPassword.setAttribute('autocomplete', 'current-password');
    }
  }

  if ($('authSignInBtn')) $('authSignInBtn').addEventListener('click', showAuthPanel);
  if ($('authSignUpBtn')) $('authSignUpBtn').addEventListener('click', () => { showAuthPanel(); setAuthMode('signup'); });
  if ($('authCloseBtn')) $('authCloseBtn').addEventListener('click', hideAuthPanel);
  if ($('authBackdrop')) $('authBackdrop').addEventListener('click', hideAuthPanel);
  if (authToggleBtn) authToggleBtn.addEventListener('click', () => setAuthMode(authMode === 'login' ? 'signup' : 'login'));

  if (authForm) {
    authForm.addEventListener('submit', async ev => {
      ev.preventDefault();
      if (!supabase) {
        authError.hidden = false;
        authError.textContent = 'Supabase no está configurado.';
        return;
      }
      const email = authEmail ? authEmail.value.trim() : '';
      const password = authPassword ? authPassword.value : '';
      const alias = authAlias ? authAlias.value.trim() : '';
      authError.hidden = true;
      const previousLabel = authSubmitBtn.textContent;
      authSubmitBtn.disabled = true;
      try {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Escribe un correo válido.');
        if (!password) throw new Error('Escribe tu contraseña.');
        if (authMode === 'signup') {
          if (!alias) throw new Error('El alias es obligatorio');
          if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
          if (authPasswordConfirm && authPasswordConfirm.value !== password) throw new Error('Las contraseñas no coinciden');
          authSubmitBtn.textContent = 'Creando cuenta…';
          await signUp(email, password, alias);
          toast('Cuenta creada. Ya puedes aparecer en el ranking.');
        } else {
          authSubmitBtn.textContent = 'Entrando…';
          await signIn(email, password);
          toast('Sesión iniciada.');
        }
        loadRanking();
        hideAuthPanel();
      } catch (err) {
        authError.hidden = false;
        authError.textContent = err.message || 'Error de autenticación';
        console.warn('Auth error:', err);
      } finally {
        authSubmitBtn.disabled = false;
        authSubmitBtn.textContent = previousLabel;
      }
    });
  }

  if ($('authSignOutBtn')) $('authSignOutBtn').addEventListener('click', async () => {
    await signOut();
    loadRanking();
    toast('Sesión cerrada');
  });

  if ($('refreshRankingBtn')) $('refreshRankingBtn').addEventListener('click', () => loadRanking());

  /* ---------- Arranque ---------- */
  loadRuns();
  updateSurveyPrefBtn();
  renderLog();
  renderAll();
  initAuth();
  subscribeAuth();
  loadRanking();
  window.addEventListener('message', handleGameMessage);
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderCharts, 150);
  });

  // Por si el mensaje "ready" se perdió mientras cargaba el iframe.
  setTimeout(() => send('status'), 800);
  requestAnimationFrame(renderCharts);
})();
