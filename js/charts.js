/* Gráficas ligeras en canvas, sin dependencias externas. */
(() => {
  'use strict';

  const GOLD = '#ffe19a';
  const GREEN = '#8fe3a8';
  const RED = '#ff959b';
  const BLUE = '#7fc8e8';
  const MUTED = '#6c8aa3';
  const TEXT = '#c9dcea';
  const GRID = 'rgba(151,183,205,.16)';
  const FONT = 'ui-monospace, Consolas, "Courier New", monospace';
  const UI = 'system-ui, -apple-system, "Segoe UI", sans-serif';

  function setup(canvas) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(240, Math.round(canvas.clientWidth || canvas.parentElement?.clientWidth || 320));
    const h = 220;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function empty(ctx, w, h, text = 'Sin datos todavía') {
    ctx.fillStyle = MUTED;
    ctx.font = '13px ' + UI;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function compact(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '') + 'k';
    return String(n);
  }

  function shortDate(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }

  /* Puntos por partida: barras verticales. */
  function scores(canvas, runs) {
    const { ctx, w, h } = setup(canvas);
    const data = (runs || []).slice(0, 20).reverse();
    if (!data.length) return empty(ctx, w, h);

    const pad = { l: 44, r: 10, t: 16, b: 28 };
    const cw = w - pad.l - pad.r;
    const ch = h - pad.t - pad.b;
    const max = Math.max(500, ...data.map(r => r.score || 0));
    const nice = Math.ceil(max / 500) * 500;

    ctx.font = '10px ' + FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ch * i / 4;
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + cw, y);
      ctx.stroke();
      ctx.fillStyle = MUTED;
      ctx.fillText(compact(Math.round(nice * (1 - i / 4))), pad.l - 7, y);
    }

    const gap = Math.max(2, Math.min(8, cw / data.length * 0.22));
    const bw = Math.max(3, (cw - gap * (data.length - 1)) / data.length);
    data.forEach((r, i) => {
      const v = Math.max(0, r.score || 0);
      const bh = Math.max(2, ch * v / nice);
      const x = pad.l + i * (bw + gap);
      const y = pad.t + ch - bh;
      ctx.fillStyle = r.result === 'won' ? GOLD : BLUE;
      roundRect(ctx, x, y, bw, bh, Math.min(4, bw / 2));
      ctx.fill();
    });

    const every = Math.max(1, Math.ceil(data.length / 5));
    ctx.fillStyle = MUTED;
    ctx.font = '9.5px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    data.forEach((r, i) => {
      if (i % every !== 0 && i !== data.length - 1) return;
      const x = pad.l + i * (bw + gap) + bw / 2;
      ctx.fillText(shortDate(r.startedAt), x, pad.t + ch + 8);
    });
  }

  /* Resultados: dona con leyenda. */
  function results(canvas, runs) {
    const { ctx, w, h } = setup(canvas);
    const list = runs || [];
    const groups = [
      { key: 'won', label: 'Victoria', color: GREEN },
      { key: 'game_over', label: 'Sin vidas', color: RED },
      { key: 'pau_caught', label: 'Atrapado por Pau', color: GOLD },
      { key: 'abandoned', label: 'Abandonada', color: MUTED }
    ];
    const counts = groups.map(g => list.filter(r => r.result === g.key).length);
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) return empty(ctx, w, h);

    const cx = w < 380 ? w * 0.36 : w * 0.34;
    const cy = h / 2;
    const r = Math.min(h / 2 - 22, w * 0.23);
    ctx.lineWidth = Math.max(16, r * 0.44);
    let start = -Math.PI / 2;
    groups.forEach((g, i) => {
      const frac = counts[i] / total;
      if (!frac) return;
      const end = start + frac * Math.PI * 2;
      ctx.strokeStyle = g.color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start + 0.012, end - 0.012);
      ctx.stroke();
      start = end;
    });

    ctx.fillStyle = TEXT;
    ctx.font = '800 24px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(total), cx, cy - 5);
    ctx.fillStyle = MUTED;
    ctx.font = '9.5px ' + UI;
    ctx.fillText('partidas', cx, cy + 16);

    const lx = w * 0.6;
    const lh = 30;
    let ly = h / 2 - (groups.length * lh) / 2 + lh / 2 - 4;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    groups.forEach((g, i) => {
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = counts[i] ? TEXT : MUTED;
      ctx.font = '10.5px ' + UI;
      ctx.fillText(g.label, lx + 11, ly - 6);
      ctx.fillStyle = MUTED;
      ctx.font = '700 10px ' + FONT;
      ctx.fillText(`${counts[i]} · ${Math.round(counts[i] / total * 100)}%`, lx + 11, ly + 8);
      ly += lh;
    });
  }

  /* Barras horizontales genéricas. */
  function hbars(canvas, items, color, maxValue) {
    const { ctx, w, h } = setup(canvas);
    if (!items.length || items.every(i => !i.value)) return empty(ctx, w, h);

    const pad = { l: 72, r: 54, t: 18, b: 14 };
    const cw = Math.max(40, w - pad.l - pad.r);
    const rowH = (h - pad.t - pad.b) / items.length;
    const max = Math.max(1, maxValue || Math.max(...items.map(i => i.value)));

    ctx.textBaseline = 'middle';
    items.forEach((it, i) => {
      const y = pad.t + rowH * i + rowH / 2;
      ctx.fillStyle = TEXT;
      ctx.font = '11.5px ' + UI;
      ctx.textAlign = 'right';
      ctx.fillText(it.label, pad.l - 8, y);

      const barH = Math.max(10, rowH * 0.5);
      ctx.fillStyle = 'rgba(151,183,205,.10)';
      roundRect(ctx, pad.l, y - barH / 2, cw, barH, 5);
      ctx.fill();

      const bw = Math.max(it.value > 0 ? 4 : 0, cw * it.value / max);
      if (bw > 0) {
        ctx.fillStyle = color;
        roundRect(ctx, pad.l, y - barH / 2, bw, barH, 5);
        ctx.fill();
      }

      ctx.fillStyle = it.value ? TEXT : MUTED;
      ctx.font = '700 11px ' + FONT;
      ctx.textAlign = 'left';
      const suffix = it.suffix || '';
      ctx.fillText(`${it.value}${suffix}`, pad.l + cw + 8, y);
    });
  }

  /* Vidas perdidas por nivel. */
  function hurts(canvas, runs) {
    const sums = [1, 2, 3].map(stage => {
      let total = 0;
      for (const run of runs || []) {
        for (const lv of run.levels || []) {
          if (lv.stage === stage) total += lv.hurts || 0;
        }
      }
      return { label: `Nivel ${stage}`, value: total };
    });
    hbars(canvas, sums, RED);
  }

  /* Embudo: partidas que alcanzaron cada nivel. */
  function funnel(canvas, runs) {
    const list = (runs || []).filter(r => r.result !== 'playing');
    if (!list.length) {
      const { ctx, w, h } = setup(canvas);
      return empty(ctx, w, h);
    }
    const total = list.length;
    const reachedStage = (run, stage) => {
      const start = Math.min(3, Math.max(1, Number(run.startStage) || 1));
      if (stage < start) return false;
      if (Array.isArray(run.levels) && run.levels.length) {
        return run.levels.some(lv => (Number(lv.stage) || 1) >= stage);
      }
      return (Number(run.stageReached) || 1) >= stage;
    };
    const reached = [1, 2, 3].map(stage => ({
      label: `Nivel ${stage}`,
      value: Math.round(list.filter(r => reachedStage(r, stage)).length / total * 100),
      suffix: '%'
    }));
    hbars(canvas, reached, GREEN, 100);
  }

  window.DKCharts = { scores, results, hurts, funnel };
})();
