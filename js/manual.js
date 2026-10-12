// Exercise 1: draw the mask by hand, then draw it again to test repeatability.

import { app, on, setMask, uiState } from './state.js';
import { COLORS, drawMask, beginPixels, endPixels, hexToRgb, toCanvasXY, pxScale, fitCanvas, polyline, fmtTime, fmt } from './draw.js';
import { rasterizePolygon, area, dice } from './imgproc.js';

const $ = (id) => document.getElementById(id);
const ZOOM = 8, LOUPE = 176, SRC = LOUPE / ZOOM; // magnifier shows 22 x 22 pixels

export function initManual() {
  const cv = $('m-canvas'), ctx = cv.getContext('2d');
  const loupe = $('m-loupe'), lctx = loupe.getContext('2d');
  let tool = 'lasso', size = 8, opacity = 0.35;
  let stroke = null; // the stroke in progress
  let hover = null;
  let queued = false;

  const st = () => uiState('manual', () => {
    const n = app.cur.w * app.cur.h;
    return {
      attempt: 0,                       // 0 = first attempt, 1 = second
      masks: [new Uint8Array(n), new Uint8Array(n)],
      undo: [[], []],
      strokes: [0, 0],
      t0: [0, 0],
      t1: [0, 0],
      compare: false,
    };
  });

  // ------------------------------------------------------------ painting

  function stampLine(m, a, b, val) {
    const { w, h } = app.cur;
    const r = size / 2;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(0.5, r / 2)));
    for (let k = 0; k <= steps; k++) {
      const cx = a.x + ((b.x - a.x) * k) / steps;
      const cy = a.y + ((b.y - a.y) * k) / steps;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= r * r) m[y * w + x] = val;
        }
      }
    }
  }

  function pushUndo(s) {
    const u = s.undo[s.attempt];
    u.push(s.masks[s.attempt].slice());
    if (u.length > 30) u.shift();
  }

  function commit() {
    const s = st(), a = s.attempt, m = s.masks[a];
    const n = area(m);
    const info = `${fmtTime(s.t1[a] - s.t0[a])} of drawing, ${s.strokes[a]} stroke${s.strokes[a] === 1 ? '' : 's'}`;
    setMask(a ? 'manual2' : 'manual', n ? m.slice() : null, info);
    updatePanel();
  }

  // ------------------------------------------------------------ pointer

  cv.addEventListener('pointerdown', (e) => {
    if (!app.cur || e.button > 0) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
    const s = st(), p = toCanvasXY(cv, e);
    s.compare = false;
    if (!s.t0[s.attempt]) s.t0[s.attempt] = performance.now();
    if (tool === 'lasso') {
      stroke = { xs: [p.x], ys: [p.y] };
    } else {
      pushUndo(s);
      stroke = { last: p };
      stampLine(s.masks[s.attempt], p, p, tool === 'erase' ? 0 : 1);
    }
    hover = p;
    schedule();
  });

  cv.addEventListener('pointermove', (e) => {
    if (!app.cur) return;
    const p = toCanvasXY(cv, e);
    hover = p;
    if (stroke) {
      const s = st();
      if (tool === 'lasso') {
        const n = stroke.xs.length;
        if (Math.hypot(p.x - stroke.xs[n - 1], p.y - stroke.ys[n - 1]) >= 1) {
          stroke.xs.push(p.x);
          stroke.ys.push(p.y);
        }
      } else {
        stampLine(s.masks[s.attempt], stroke.last, p, tool === 'erase' ? 0 : 1);
        stroke.last = p;
      }
    }
    schedule();
  });

  const finish = () => {
    if (!stroke) return;
    const s = st(), { w, h } = app.cur;
    if (tool === 'lasso') {
      if (stroke.xs.length >= 3) {
        pushUndo(s);
        const poly = rasterizePolygon(stroke.xs, stroke.ys, w, h);
        const m = s.masks[s.attempt];
        for (let i = 0; i < m.length; i++) m[i] |= poly[i];
      } else {
        stroke = null;
        schedule();
        return;
      }
    }
    stroke = null;
    s.strokes[s.attempt]++;
    s.t1[s.attempt] = performance.now();
    commit();
    schedule();
  };
  cv.addEventListener('pointerup', finish);
  cv.addEventListener('pointercancel', finish);
  cv.addEventListener('pointerleave', () => { if (!stroke) { hover = null; schedule(); } });

  // ------------------------------------------------------------ controls

  for (const r of document.querySelectorAll('input[name="m-tool"]')) {
    r.addEventListener('change', () => { tool = r.value; updateHint(); schedule(); });
  }
  $('m-size').addEventListener('input', (e) => {
    size = +e.target.value;
    $('m-size-out').textContent = `${size} px`;
    schedule();
  });
  $('m-opacity').addEventListener('input', (e) => {
    opacity = e.target.value / 100;
    $('m-opacity-out').textContent = `${e.target.value} %`;
    schedule();
  });
  $('m-undo').addEventListener('click', () => {
    const s = st(), u = s.undo[s.attempt];
    if (!u.length) return;
    s.masks[s.attempt].set(u.pop());
    s.compare = false;
    commit();
    schedule();
  });
  $('m-clear').addEventListener('click', () => {
    const s = st();
    if (!area(s.masks[s.attempt])) return;
    pushUndo(s);
    s.masks[s.attempt].fill(0);
    s.compare = false;
    commit();
    schedule();
  });
  $('m-again').addEventListener('click', () => {
    const s = st();
    s.attempt = 1;
    s.compare = false;
    updatePanel();
    schedule();
  });
  $('m-compare').addEventListener('click', () => {
    const s = st();
    s.compare = !s.compare;
    updatePanel();
    schedule();
  });
  $('m-restart').addEventListener('click', () => {
    if (!window.confirm('Delete both attempts and start again?')) return;
    app.cur.ui.manual = null;
    setMask('manual', null);
    setMask('manual2', null);
    updatePanel();
    schedule();
  });

  function updateHint() {
    const hints = {
      lasso: 'Drag around the tumor in one stroke. Let go to fill it.',
      brush: 'Paint to add pixels.',
      erase: 'Paint to remove pixels.',
    };
    $('m-hint').textContent = hints[tool];
  }

  function updatePanel() {
    if (!app.cur) return;
    const s = st(), a = s.attempt, m = s.masks[a];
    $('m-area').textContent = `${area(m).toLocaleString()} px`;
    $('m-strokes').textContent = String(s.strokes[a]);
    $('m-time').textContent = s.t1[a] ? fmtTime(s.t1[a] - s.t0[a]) : '0:00';
    $('m-undo').disabled = !s.undo[a].length;
    $('m-again').disabled = a === 1 || !area(s.masks[0]);
    $('m-again').hidden = a === 1;
    $('m-compare').disabled = a === 0 || !area(s.masks[1]);
    $('m-compare').textContent = s.compare ? 'Back to drawing' : 'Compare attempts';
    $('m-restart').hidden = a === 0;
    $('m-attempt').textContent = a === 0
      ? 'You are on attempt 1.'
      : 'You are on attempt 2. Your first outline is hidden. Draw the same tumor again from scratch.';
    $('m-caption').innerHTML = s.compare
      ? 'Both attempts: <span class="sw both"></span> both, <span class="sw manual"></span> only attempt 1, <span class="sw manual2"></span> only attempt 2.'
      : `Your mask, attempt ${a + 1} <span class="sw ${a ? 'manual2' : 'manual'}"></span>.`;

    const out = $('m-repeat');
    if (s.compare) {
      let both = 0, only1 = 0, only2 = 0;
      const [m1, m2] = s.masks;
      for (let i = 0; i < m1.length; i++) {
        if (m1[i] && m2[i]) both++; else if (m1[i]) only1++; else if (m2[i]) only2++;
      }
      out.innerHTML = `Dice between your attempts: <b>${fmt(dice(m1, m2), 3)}</b>. ` +
        `${both.toLocaleString()} px in both, ${only1.toLocaleString()} only in the first, ` +
        `${only2.toLocaleString()} only in the second.`;
    } else {
      out.textContent = '';
    }
  }

  // ------------------------------------------------------------ rendering

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  }

  function render() {
    const c = app.cur;
    if (!c) return;
    const s = st(), { w, h } = c;
    fitCanvas(cv, w, h);
    ctx.drawImage(c.base, 0, 0);

    if (s.compare) {
      const d = beginPixels(w, h);
      const c1 = hexToRgb(COLORS.manual), c2 = hexToRgb(COLORS.manual2);
      const [m1, m2] = s.masks;
      for (let i = 0; i < w * h; i++) {
        if (!m1[i] && !m2[i]) continue;
        const col = m1[i] && m2[i] ? [244, 241, 232] : m1[i] ? c1 : c2;
        d[4 * i] = col[0]; d[4 * i + 1] = col[1]; d[4 * i + 2] = col[2];
        d[4 * i + 3] = m1[i] && m2[i] ? 120 : 230;
      }
      endPixels(ctx);
    } else {
      drawMask(ctx, s.masks[s.attempt], w, h, s.attempt ? COLORS.manual2 : COLORS.manual, { fill: opacity });
    }
    if (stroke && stroke.xs) {
      polyline(ctx, stroke.xs, stroke.ys, { closed: false, color: s.attempt ? COLORS.manual2 : COLORS.manual, width: 1.5 });
    }

    renderLoupe();

    if (hover && tool !== 'lasso') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = pxScale(cv);
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, Math.max(size / 2, 1), 0, 2 * Math.PI);
      ctx.stroke();
      ctx.restore();
    }
  }

  function renderLoupe() {
    lctx.fillStyle = '#000';
    lctx.fillRect(0, 0, LOUPE, LOUPE);
    if (!hover) {
      lctx.fillStyle = '#9a968c';
      lctx.font = '13px sans-serif';
      lctx.textAlign = 'center';
      lctx.fillText('hover over the image', LOUPE / 2, LOUPE / 2 + 4);
      return;
    }
    const sx = Math.floor(hover.x) - Math.floor(SRC / 2);
    const sy = Math.floor(hover.y) - Math.floor(SRC / 2);
    lctx.imageSmoothingEnabled = false;
    lctx.drawImage(cv, sx, sy, SRC, SRC, 0, 0, LOUPE, LOUPE);
    lctx.strokeStyle = 'rgba(255,255,255,.08)';
    lctx.lineWidth = 1;
    lctx.beginPath();
    for (let k = 1; k < SRC; k++) {
      lctx.moveTo(k * ZOOM + 0.5, 0); lctx.lineTo(k * ZOOM + 0.5, LOUPE);
      lctx.moveTo(0, k * ZOOM + 0.5); lctx.lineTo(LOUPE, k * ZOOM + 0.5);
    }
    lctx.stroke();
    const cx = (Math.floor(hover.x) - sx) * ZOOM, cy = (Math.floor(hover.y) - sy) * ZOOM;
    lctx.strokeStyle = '#fff';
    lctx.strokeRect(cx + 0.5, cy + 0.5, ZOOM - 1, ZOOM - 1);
    const v = app.cur.gray[Math.floor(hover.y) * app.cur.w + Math.floor(hover.x)];
    if (v !== undefined) {
      lctx.fillStyle = 'rgba(0,0,0,.65)';
      lctx.fillRect(0, LOUPE - 20, LOUPE, 20);
      lctx.fillStyle = '#fff';
      lctx.font = '12px ui-monospace, Menlo, monospace';
      lctx.textAlign = 'left';
      lctx.fillText(`(${Math.floor(hover.x)}, ${Math.floor(hover.y)})  I = ${Math.round(v)}`, 6, LOUPE - 6);
    }
  }

  on('case', () => { stroke = null; hover = null; updatePanel(); schedule(); });
  updateHint();
}
