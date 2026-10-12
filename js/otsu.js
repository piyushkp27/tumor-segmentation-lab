// Exercise 2: Otsu's threshold, with an optional box, smoothing and clean-up steps.

import { app, on, setMask, uiState } from './state.js';
import { COLORS, drawMask, drawBinary, toCanvasXY, pxScale, fitCanvas, crosshair, fmt } from './draw.js';
import {
  gaussianBlur, histogram, otsu, classStats, threshold, opening,
  components, keepLabel, fillHoles, area,
} from './imgproc.js';

const $ = (id) => document.getElementById(id);

export function initOtsu() {
  const cv = $('o-canvas'), ctx = cv.getContext('2d');
  const hc = $('o-hist'), hctx = hc.getContext('2d');
  const steps = [...document.querySelectorAll('#o-steps figure')];

  let blurCache = { key: '', img: null };
  let res = null;     // latest results, for drawing
  let drag = null;    // box being dragged on the image
  let queued = false;

  const st = () => uiState('otsu', () => ({
    sigma: 0, roi: 'all', box: null, seed: null,
    t: 0, lock: true, open: 0, keep: false, fill: false, log: true,
  }));

  function blurred() {
    const c = app.cur, s = st();
    const key = `${c.id}:${s.sigma}`;
    if (blurCache.key !== key) blurCache = { key, img: gaussianBlur(c.gray, c.w, c.h, s.sigma) };
    return blurCache.img;
  }

  function boxMask(b, w, h) {
    const m = new Uint8Array(w * h);
    for (let y = Math.max(0, b.y0); y < Math.min(h, b.y1); y++) {
      for (let x = Math.max(0, b.x0); x < Math.min(w, b.x1); x++) m[y * w + x] = 1;
    }
    return m;
  }

  // ------------------------------------------------------------ the pipeline

  function compute() {
    const c = app.cur, s = st(), { w, h } = c;
    const img = blurred();
    const roi = s.roi === 'box' && s.box ? boxMask(s.box, w, h) : null;
    const hist = histogram(img, roi);
    const ot = otsu(hist);
    if (s.lock) s.t = ot.t;
    const t = s.t;

    const s1 = threshold(img, t, roi);
    const s2 = opening(s1, w, h, s.open);
    let s3 = s2, note = '';
    if (s.keep) {
      const { labels, sizes, count } = components(s2, w, h);
      let lab = 0;
      if (s.seed) {
        lab = nearestLabel(labels, w, h, s.seed, 6);
        if (!lab) note = 'Your click is not on a highlighted blob, so the largest blob is kept instead. Click on the tumor.';
      } else {
        note = 'No blob picked yet, so the largest one is kept. Click on the tumor to choose.';
      }
      if (!lab) {
        let best = 0;
        for (let k = 1; k <= count; k++) if (sizes[k] > best) { best = sizes[k]; lab = k; }
      }
      s3 = keepLabel(labels, lab);
    }
    const s4 = s.fill ? fillHoles(s3, w, h) : s3;

    res = { hist, ot, t, roi, stages: [s1, s2, s3, s4], note, blobs: components(s4, w, h).count };

    const choices = [];
    if (s.sigma > 0) choices.push(`blur σ = ${s.sigma}`);
    choices.push(s.roi === 'box' && s.box ? 'histogram from a box' : 'histogram from whole image');
    choices.push(s.lock ? `t = t* = ${t}` : `t = ${t} set by hand (t* = ${ot.t})`);
    if (s.open) choices.push(`opening r = ${s.open}`);
    if (s.keep) choices.push(s.seed ? 'kept the clicked blob' : 'kept the largest blob');
    if (s.fill) choices.push('filled holes');
    setMask('otsu', area(s4) ? s4 : null, choices.join(', '));
  }

  function nearestLabel(labels, w, h, seed, radius) {
    const sx = Math.floor(seed.x), sy = Math.floor(seed.y);
    let best = 0, bestD = Infinity;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = sx + dx, y = sy + dy, d = dx * dx + dy * dy;
        if (x < 0 || y < 0 || x >= w || y >= h || d > radius * radius) continue;
        const l = labels[y * w + x];
        if (l && d < bestD) { bestD = d; best = l; }
      }
    }
    return best;
  }

  // ------------------------------------------------------------ drawing

  function render() {
    const c = app.cur;
    if (!c || !res) return;
    const s = st(), { w, h } = c;
    fitCanvas(cv, w, h);
    ctx.drawImage(c.base, 0, 0);
    drawMask(ctx, res.stages[3], w, h, COLORS.otsu, { fill: 0.45 });

    const k = pxScale(cv);
    const b = drag || (s.roi === 'box' ? s.box : null);
    if (b) {
      ctx.save();
      ctx.strokeStyle = '#ffe14d';
      ctx.lineWidth = 1.5 * k;
      ctx.setLineDash([6 * k, 4 * k]);
      ctx.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.restore();
    }
    if (s.keep && s.seed) crosshair(ctx, s.seed.x, s.seed.y, '#ffe14d');

    drawHistogram();
    drawSteps();
    updateText();
  }

  const H = { l: 58, r: 28, t: 18, b: 52 }; // histogram margins in canvas pixels

  function binX(v) { return H.l + ((v + 0.5) / 256) * (hc.width - H.l - H.r); }
  function xToBin(x) {
    return Math.max(0, Math.min(255, Math.round(((x - H.l) / (hc.width - H.l - H.r)) * 256 - 0.5)));
  }

  function drawHistogram() {
    const s = st(), { hist, ot, t } = res;
    const W = hc.width, Ht = hc.height, pw = W - H.l - H.r, ph = Ht - H.t - H.b;
    hctx.clearRect(0, 0, W, Ht);
    hctx.fillStyle = '#fff';
    hctx.fillRect(0, 0, W, Ht);

    let max = 0;
    for (let i = 0; i < 256; i++) max = Math.max(max, hist[i]);
    const scale = (v) => (s.log ? Math.log1p(v) / Math.log1p(max || 1) : v / (max || 1));
    const bw = pw / 256;
    for (let i = 0; i < 256; i++) {
      if (!hist[i]) continue;
      const bh = scale(hist[i]) * ph;
      hctx.fillStyle = i <= t ? '#8f8b80' : COLORS.otsu;
      hctx.fillRect(H.l + i * bw, H.t + ph - bh, Math.max(bw - 0.4, 1), bh);
    }

    // between-class variance curve
    if (ot.max > 0) {
      hctx.strokeStyle = '#b3261e';
      hctx.lineWidth = 3;
      hctx.beginPath();
      let started = false;
      for (let i = 0; i < 256; i++) {
        const y = H.t + ph - (ot.sigmaB[i] / ot.max) * ph;
        if (!started) { hctx.moveTo(binX(i), y); started = true; } else hctx.lineTo(binX(i), y);
      }
      hctx.stroke();
    }

    // axes
    hctx.strokeStyle = '#1e1d1a';
    hctx.lineWidth = 2;
    hctx.beginPath();
    hctx.moveTo(H.l, H.t);
    hctx.lineTo(H.l, H.t + ph);
    hctx.lineTo(W - H.r, H.t + ph);
    hctx.stroke();
    hctx.fillStyle = '#58554d';
    hctx.font = '22px "Source Sans 3", sans-serif';
    hctx.textAlign = 'center';
    for (const v of [0, 64, 128, 192, 255]) {
      hctx.fillText(String(v), binX(v), H.t + ph + 24);
      hctx.fillRect(binX(v) - 1, H.t + ph, 2, 7);
    }
    hctx.fillText('intensity', H.l + pw / 2, Ht - 4);
    hctx.save();
    hctx.translate(20, H.t + ph / 2);
    hctx.rotate(-Math.PI / 2);
    hctx.fillText(s.log ? 'pixel count (log)' : 'pixel count', 0, 0);
    hctx.restore();

    // Otsu's t* (dashed) and the threshold in use (solid)
    hctx.setLineDash([8, 6]);
    hctx.strokeStyle = '#b3261e';
    hctx.lineWidth = 2;
    hctx.beginPath();
    hctx.moveTo(binX(ot.t), H.t);
    hctx.lineTo(binX(ot.t), H.t + ph);
    hctx.stroke();
    hctx.setLineDash([]);
    hctx.strokeStyle = '#1e1d1a';
    hctx.lineWidth = 3;
    hctx.beginPath();
    hctx.moveTo(binX(t), H.t);
    hctx.lineTo(binX(t), H.t + ph);
    hctx.stroke();
    hctx.fillStyle = '#1e1d1a';
    hctx.beginPath();
    hctx.moveTo(binX(t), H.t + ph - 2);
    hctx.lineTo(binX(t) - 9, H.t + ph + 12);
    hctx.lineTo(binX(t) + 9, H.t + ph + 12);
    hctx.closePath();
    hctx.fill();

    hctx.font = '600 22px "Source Sans 3", sans-serif';
    const lx = binX(ot.t), right = lx < W - 160;
    hctx.textAlign = right ? 'left' : 'right';
    hctx.fillStyle = '#b3261e';
    hctx.fillText(`t* = ${ot.t}`, lx + (right ? 8 : -8), H.t + 20);
    if (t !== ot.t) {
      const tx = binX(t), r2 = tx < W - 160;
      hctx.textAlign = r2 ? 'left' : 'right';
      hctx.fillStyle = '#1e1d1a';
      hctx.fillText(`t = ${t}`, tx + (r2 ? 8 : -8), H.t + 46);
    }
  }

  function drawSteps() {
    const s = st(), { w, h } = app.cur;
    const on = [true, s.open > 0, s.keep, s.fill];
    const names = [
      `1. Threshold, t = ${res.t}`,
      s.open ? `2. Opening, r = ${s.open}` : '2. Opening (off)',
      s.keep ? '3. Keep one blob' : '3. Keep one blob (off)',
      s.fill ? '4. Fill holes' : '4. Fill holes (off)',
    ];
    steps.forEach((fig, i) => {
      const c2 = fig.querySelector('canvas');
      drawBinary(c2.getContext('2d'), res.stages[i], w, h, c2.width, c2.height);
      fig.classList.toggle('off', !on[i]);
      fig.querySelector('figcaption').textContent = `${names[i]} · ${area(res.stages[i]).toLocaleString()} px`;
    });
  }

  function updateText() {
    const s = st(), { hist, ot, t } = res;
    const cs = classStats(hist, t);
    const pct = ot.max > 0 ? (100 * ot.sigmaB[t]) / ot.max : 0;
    $('o-readout').innerHTML = `
      <dt>Threshold</dt><dd>t = ${t} &nbsp;(Otsu: t* = ${ot.t})</dd>
      <dt>Class 0, I &le; t</dt><dd>&omega;&#8320; = ${fmt(100 * cs.w0, 1)} %, &mu;&#8320; = ${fmt(cs.mu0, 1)}</dd>
      <dt>Class 1, I &gt; t</dt><dd>&omega;&#8321; = ${fmt(100 * cs.w1, 1)} %, &mu;&#8321; = ${fmt(cs.mu1, 1)}</dd>
      <dt>&sigma;&sup2;<sub>B</sub>(t)</dt><dd>${fmt(pct, 1)} % of its maximum</dd>
      <dt>Result</dt><dd>${area(res.stages[3]).toLocaleString()} px in ${res.blobs} blob${res.blobs === 1 ? '' : 's'}</dd>`;
    $('o-t').value = t;
    $('o-t-out').textContent = s.lock ? `${t} (t*)` : String(t);
    $('o-snap').disabled = s.lock;
    $('o-note').textContent = res.note;
    $('o-note').className = res.note ? 'small warn' : 'small';
    $('o-roi-hint').textContent = s.roi === 'box' && !s.box
      ? 'Drag a box around the tumor on the image.'
      : s.roi === 'box' ? `Box: ${s.box.x1 - s.box.x0} × ${s.box.y1 - s.box.y0} px. Drag again to redraw it.` : '';
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!app.cur) return;
      compute();
      render();
    });
  }

  function syncControls() {
    const s = st();
    $('o-sigma').value = s.sigma;
    $('o-sigma-out').textContent = `${s.sigma} px`;
    for (const r of document.querySelectorAll('input[name="o-roi"]')) r.checked = r.value === s.roi;
    $('o-open').value = s.open;
    $('o-open-out').textContent = `${s.open} px`;
    $('o-keep').checked = s.keep;
    $('o-fill').checked = s.fill;
    $('o-log').checked = s.log;
  }

  // ------------------------------------------------------------ events

  $('o-sigma').addEventListener('input', (e) => {
    st().sigma = +e.target.value;
    $('o-sigma-out').textContent = `${e.target.value} px`;
    schedule();
  });
  for (const r of document.querySelectorAll('input[name="o-roi"]')) {
    r.addEventListener('change', () => { st().roi = r.value; schedule(); });
  }
  $('o-t').addEventListener('input', (e) => {
    const s = st();
    s.t = +e.target.value;
    s.lock = false;
    schedule();
  });
  $('o-snap').addEventListener('click', () => { st().lock = true; schedule(); });
  $('o-log').addEventListener('change', (e) => { st().log = e.target.checked; schedule(); });
  $('o-open').addEventListener('input', (e) => {
    st().open = +e.target.value;
    $('o-open-out').textContent = `${e.target.value} px`;
    schedule();
  });
  $('o-keep').addEventListener('change', (e) => { st().keep = e.target.checked; schedule(); });
  $('o-fill').addEventListener('change', (e) => { st().fill = e.target.checked; schedule(); });

  // histogram: click or drag to set t
  let histDrag = false;
  const setFromHist = (e) => {
    const p = toCanvasXY(hc, e), s = st();
    s.t = xToBin(p.x);
    s.lock = false;
    schedule();
  };
  hc.addEventListener('pointerdown', (e) => {
    if (!app.cur) return;
    histDrag = true;
    try { hc.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
    setFromHist(e);
  });
  hc.addEventListener('pointermove', (e) => { if (histDrag) setFromHist(e); });
  hc.addEventListener('pointerup', () => { histDrag = false; });
  hc.addEventListener('pointercancel', () => { histDrag = false; });

  // image: drag = box, click = pick a blob
  let down = null;
  cv.addEventListener('pointerdown', (e) => {
    if (!app.cur || e.button > 0) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
    down = toCanvasXY(cv, e);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!down) return;
    const p = toCanvasXY(cv, e);
    if (drag || Math.hypot(p.x - down.x, p.y - down.y) > 5) {
      drag = { x0: down.x, y0: down.y, x1: p.x, y1: p.y };
      render();
    }
  });
  const up = (e) => {
    if (!down) return;
    const s = st(), { w, h } = app.cur;
    if (drag) {
      const box = {
        x0: Math.max(0, Math.floor(Math.min(drag.x0, drag.x1))),
        y0: Math.max(0, Math.floor(Math.min(drag.y0, drag.y1))),
        x1: Math.min(w, Math.ceil(Math.max(drag.x0, drag.x1))),
        y1: Math.min(h, Math.ceil(Math.max(drag.y0, drag.y1))),
      };
      if (box.x1 - box.x0 >= 8 && box.y1 - box.y0 >= 8) {
        s.box = box;
        s.roi = 'box';
        s.lock = true;
        syncControls();
      }
    } else if (e.type === 'pointerup') {
      s.seed = toCanvasXY(cv, e);
      s.keep = true;
      syncControls();
    }
    down = null;
    drag = null;
    schedule();
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);

  on('case', () => {
    drag = null;
    down = null;
    syncControls();
    schedule();
  });
}
