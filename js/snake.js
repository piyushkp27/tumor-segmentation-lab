// Exercise 3a: an active contour ("snake") after Kass, Witkin & Terzopoulos (1988),
// with Cohen's (1991) balloon force.
//
// Each iteration solves the semi-implicit update
//     (I + A) x_new = x_old + f(x_old)
// where A is the cyclic pentadiagonal matrix from tension (alpha) and bending (beta),
// and f is the external force: w * grad P (pull towards edges) + kappa * n (balloon).
// Because A is circulant, (I + A)^-1 is circulant too, and its first row follows
// directly from the eigenvalues 1 + alpha q + beta q^2 with q = 2 - 2 cos(2 pi k / n).

import { app, on, setMask, uiState } from './state.js';
import { COLORS, toCanvasXY, pxScale, fitCanvas, polyline, arrow } from './draw.js';
import { gaussianBlur, gradient, quantile, sample, rasterizePolygon, area } from './imgproc.js';

const $ = (id) => document.getElementById(id);

const DEFAULTS = { alpha: 0.2, beta: 0.1, wedge: 2, sigma: 2 };
const KAPPA = { loop: -0.15, seed: 0.5 };
const SEED_RADIUS = 10;  // px, the circle placed by a click
const SPACING = 4;         // target distance between neighbouring points, px
const RESAMPLE_EVERY = 5;  // iterations
const MAX_ITER = 5000;
const ARROW_SCALE = 15;    // force arrows are drawn this many times longer than the step

export function initSnake() {
  const cv = $('s-canvas'), ctx = cv.getContext('2d');
  const P = { ...DEFAULTS, kappa: KAPPA.loop };
  let mode = 'loop', bg = 'mri', showField = false, showForces = true, speed = 4;
  let field = null;      // edge map and force field for the current image and sigma
  let running = false;
  let runningCase = null; // the image the snake was started on
  let path = null;       // loop being drawn
  const inverse = new Map();
  let queued = false;

  const st = () => uiState('snake', () => ({
    init: null, xs: null, ys: null, iter: 0, mode: 'loop',
    state: 'empty', areas: [], how: '',
  }));

  // ------------------------------------------------------------ what the snake sees

  function getField() {
    const c = app.cur, key = `${c.id}:${P.sigma}`;
    if (field && field.key === key) return field;
    const { w, h } = c;
    // edge map P = |grad(G_sigma * I)|, scaled so the strongest 1% of edges reach 1
    const { mag } = gradient(gaussianBlur(c.gray, w, h, P.sigma), w, h);
    const top = quantile(mag, 0.99) || 1;
    const E = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) E[i] = Math.min(1, mag[i] / top);
    // force = grad P, scaled the same way and capped at length 1
    const { gx, gy, mag: fm } = gradient(E, w, h);
    const ftop = quantile(fm, 0.99) || 1;
    for (let i = 0; i < w * h; i++) {
      let fx = gx[i] / ftop, fy = gy[i] / ftop;
      const m = Math.hypot(fx, fy);
      if (m > 1) { fx /= m; fy /= m; }
      gx[i] = fx;
      gy[i] = fy;
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const cctx = canvas.getContext('2d');
    const img = cctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = Math.round(255 * E[i]);
      img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v;
      img.data[4 * i + 3] = 255;
    }
    cctx.putImageData(img, 0, 0);
    field = { key, E, fx: gx, fy: gy, canvas };
    return field;
  }

  // ------------------------------------------------------------ the numerics

  function inverseRow(n) {
    let r = inverse.get(n);
    if (r) return r;
    const cos = new Float64Array(n);
    for (let m = 0; m < n; m++) cos[m] = Math.cos((2 * Math.PI * m) / n);
    const lam = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const q = 2 - 2 * cos[k];
      lam[k] = 1 + P.alpha * q + P.beta * q * q;
    }
    const g = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += cos[(k * j) % n] / lam[k];
      g[j] = s / n;
    }
    // The row decays fast, so only a band around the diagonal matters. It can also
    // change sign, so the band ends after the last entry that is still non-negligible.
    const half = Math.floor((n - 1) / 2);
    let band = 1;
    for (let j = half; j >= 1; j--) {
      if (Math.abs(g[j]) >= 1e-9 * g[0]) { band = j + 1; break; }
    }
    if (band > half) band = 0; // no useful decay: multiply by the full matrix
    r = { g, band };
    inverse.set(n, r);
    return r;
  }

  function solve(b, out, n, { g, band }) {
    if (band > 0) {
      for (let i = 0; i < n; i++) {
        let s = g[0] * b[i];
        for (let k = 1; k < band; k++) s += g[k] * (b[(i + k) % n] + b[(i - k + n) % n]);
        out[i] = s;
      }
    } else {
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = 0; j < n; j++) s += g[(j - i + n) % n] * b[j];
        out[i] = s;
      }
    }
  }

  function signedArea(xs, ys) {
    let a = 0;
    for (let i = 0, n = xs.length; i < n; i++) {
      const j = i + 1 < n ? i + 1 : 0;
      a += xs[i] * ys[j] - xs[j] * ys[i];
    }
    return a / 2;
  }

  // Redistribute points evenly along the curve, keeping a fixed orientation.
  function resample(xs, ys) {
    const n = xs.length, L = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const j = i + 1 < n ? i + 1 : 0;
      L[i + 1] = L[i] + Math.hypot(xs[j] - xs[i], ys[j] - ys[i]);
    }
    const total = L[n];
    const m = Math.max(12, Math.min(700, Math.round(total / SPACING)));
    const ox = new Float64Array(m), oy = new Float64Array(m);
    let seg = 0;
    for (let k = 0; k < m; k++) {
      const d = (k * total) / m;
      while (seg < n - 1 && L[seg + 1] < d) seg++;
      const len = L[seg + 1] - L[seg], t = len > 0 ? (d - L[seg]) / len : 0;
      const j = seg + 1 < n ? seg + 1 : 0;
      ox[k] = xs[seg] + t * (xs[j] - xs[seg]);
      oy[k] = ys[seg] + t * (ys[j] - ys[seg]);
    }
    if (signedArea(ox, oy) < 0) { ox.reverse(); oy.reverse(); }
    return { xs: ox, ys: oy, length: total };
  }

  // Outward unit normal at point i (the curve is kept counter-clockwise).
  function normal(xs, ys, i) {
    const n = xs.length, ip = i + 1 < n ? i + 1 : 0, im = i > 0 ? i - 1 : n - 1;
    const tx = xs[ip] - xs[im], ty = ys[ip] - ys[im];
    const tl = Math.hypot(tx, ty) || 1;
    return [ty / tl, -tx / tl];
  }

  function iterate(count) {
    const s = st(), { w, h } = app.cur, f = getField();
    for (let it = 0; it < count; it++) {
      const n = s.xs.length, xs = s.xs, ys = s.ys;
      const bx = new Float64Array(n), by = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const [nx, ny] = normal(xs, ys, i);
        let fx = P.wedge * sample(f.fx, w, h, xs[i], ys[i]) + P.kappa * nx;
        let fy = P.wedge * sample(f.fy, w, h, xs[i], ys[i]) + P.kappa * ny;
        const fm = Math.hypot(fx, fy);
        if (fm > 1) { fx /= fm; fy /= fm; } // at most one pixel per step
        bx[i] = xs[i] + fx;
        by[i] = ys[i] + fy;
      }
      const inv = inverseRow(n);
      const nxs = new Float64Array(n), nys = new Float64Array(n);
      solve(bx, nxs, n, inv);
      solve(by, nys, n, inv);
      for (let i = 0; i < n; i++) {
        nxs[i] = Math.min(w - 0.5, Math.max(0.5, nxs[i]));
        nys[i] = Math.min(h - 0.5, Math.max(0.5, nys[i]));
      }
      s.xs = nxs;
      s.ys = nys;
      s.iter++;

      if (s.iter % RESAMPLE_EVERY === 0) {
        const r = resample(s.xs, s.ys);
        if (r.length < 25) { halt('collapsed'); return; }
        s.xs = r.xs;
        s.ys = r.ys;
      }
      // settled = the enclosed area has stopped changing
      if (s.iter % 10 === 0) {
        s.areas.push(Math.abs(signedArea(s.xs, s.ys)));
        if (s.areas.length > 4) s.areas.shift();
        if (s.areas.length === 4) {
          const a = s.areas, tol = Math.max(3, 0.002 * a[3]);
          if (Math.abs(a[3] - a[0]) < tol && Math.abs(a[3] - a[1]) < tol && Math.abs(a[3] - a[2]) < tol) {
            halt('settled');
            return;
          }
        }
      }
      if (s.iter >= MAX_ITER) { halt('limit'); return; }
    }
  }

  // ------------------------------------------------------------ running

  function run() {
    const s = st();
    if (!s.xs || running) return;
    running = true;
    runningCase = app.cur;
    s.state = 'running';
    s.areas = [];
    setMask('snake', null);
    updateUI();
    const tick = () => {
      if (!running) return;
      iterate(speed);
      render();
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function halt(state) {
    const s = st();
    running = false;
    s.state = state;
    commitMask();
    updateUI();
    schedule();
  }

  function commitMask() {
    const s = st(), c = app.cur;
    if (!s.xs) { setMask('snake', null); return; }
    const m = rasterizePolygon(s.xs, s.ys, c.w, c.h);
    s.how = `${s.mode === 'seed' ? 'grown from a seed' : 'shrunk from a loop'}; ` +
      `α ${P.alpha}, β ${P.beta}, w ${P.wedge}, κ ${P.kappa}, σ ${P.sigma}; ${s.iter} iterations`;
    setMask('snake', area(m) ? m : null, s.how);
  }

  function setStart(xs, ys) {
    const s = st();
    const r = resample(xs, ys);
    s.init = { xs: r.xs.slice(), ys: r.ys.slice() };
    s.xs = r.xs;
    s.ys = r.ys;
    s.iter = 0;
    s.mode = mode;
    s.state = 'ready';
    run();
  }

  // ------------------------------------------------------------ drawing

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
    const f = bg === 'edge' || showField || (showForces && s.xs) ? getField() : null;
    ctx.drawImage(bg === 'edge' ? f.canvas : c.base, 0, 0);
    if (showField) drawField(f);
    if (s.init) polyline(ctx, s.init.xs, s.init.ys, { color: '#fff', width: 1.2, dash: [5, 4], alpha: 0.8 });
    if (path) polyline(ctx, path.xs, path.ys, { closed: false, color: COLORS.snake, width: 1.5 });
    if (s.xs) {
      polyline(ctx, s.xs, s.ys, { color: COLORS.snake, width: 2.2 });
      const k = pxScale(cv);
      ctx.fillStyle = '#fff';
      for (let i = 0; i < s.xs.length; i++) {
        ctx.beginPath();
        ctx.arc(s.xs[i], s.ys[i], 1.2 * k, 0, 2 * Math.PI);
        ctx.fill();
      }
      if (showForces && !path) drawForces(s, f);
    }
  }

  function drawField(f) {
    const { w, h } = app.cur, step = 14;
    ctx.save();
    for (let y = step / 2; y < h; y += step) {
      for (let x = step / 2; x < w; x += step) {
        const fx = P.wedge * sample(f.fx, w, h, x, y), fy = P.wedge * sample(f.fy, w, h, x, y);
        if (Math.hypot(fx, fy) < 0.04) continue;
        arrow(ctx, x, y, fx * 7, fy * 7, 'rgba(255,154,46,.9)', 1.1);
      }
    }
    ctx.restore();
  }

  function drawForces(s, f) {
    const { w, h } = app.cur, xs = s.xs, ys = s.ys, n = xs.length;
    const every = Math.max(1, Math.round(n / 36));
    const at = (i) => (i % n + n) % n;
    ctx.save();
    for (let i = 0; i < n; i += every) {
      const x = xs[i], y = ys[i];
      const ex = P.wedge * sample(f.fx, w, h, x, y), ey = P.wedge * sample(f.fy, w, h, x, y);
      const [nx, ny] = normal(xs, ys, i);
      // explicit internal force: alpha * (second difference) - beta * (fourth difference)
      const d2x = xs[at(i - 1)] - 2 * x + xs[at(i + 1)], d2y = ys[at(i - 1)] - 2 * y + ys[at(i + 1)];
      const d4x = xs[at(i - 2)] - 4 * xs[at(i - 1)] + 6 * x - 4 * xs[at(i + 1)] + xs[at(i + 2)];
      const d4y = ys[at(i - 2)] - 4 * ys[at(i - 1)] + 6 * y - 4 * ys[at(i + 1)] + ys[at(i + 2)];
      const ix = P.alpha * d2x - P.beta * d4x, iy = P.alpha * d2y - P.beta * d4y;
      arrow(ctx, x, y, ex * ARROW_SCALE, ey * ARROW_SCALE, '#ff9a2e');
      arrow(ctx, x, y, P.kappa * nx * ARROW_SCALE, P.kappa * ny * ARROW_SCALE, '#7bd148');
      arrow(ctx, x, y, ix * ARROW_SCALE, iy * ARROW_SCALE, '#4da3ff');
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ controls

  const STATUS = {
    empty: 'Draw a starting curve on the image.',
    ready: 'Ready.',
    running: 'Moving…',
    paused: 'Paused.',
    settled: 'Settled: the curve has stopped moving.',
    collapsed: 'Collapsed: no edge was strong enough to hold the curve. Try less tension or a positive κ.',
    limit: `Stopped after ${MAX_ITER} iterations.`,
  };

  function updateUI() {
    if (!app.cur) return;
    const s = st(), has = !!s.xs;
    $('s-run').textContent = running ? 'Pause' : 'Run';
    $('s-run').disabled = !has || (!running && s.state === 'collapsed');
    $('s-step').disabled = !has || running || s.state === 'collapsed';
    $('s-reset').disabled = !s.init;
    $('s-clear').disabled = !s.init;
    const pts = has ? ` · ${s.xs.length} points` : '';
    $('s-status').textContent = s.init ? `Iteration ${s.iter}${pts}. ${STATUS[s.state]}` : STATUS.empty;
    $('s-mode-hint').textContent = mode === 'loop'
      ? `Drag a closed loop around the tumor. κ starts at ${KAPPA.loop}, so the loop deflates.`
      : `Click inside the tumor. A small circle appears there, and κ starts at +${KAPPA.seed}, so it inflates.`;
  }

  function syncSliders() {
    for (const k of ['alpha', 'beta', 'wedge', 'kappa', 'sigma']) {
      $(`s-${k}`).value = P[k];
      $(`s-${k}-out`).textContent = (k === 'kappa' && P[k] > 0 ? '+' : '') + P[k];
    }
  }

  for (const k of ['alpha', 'beta', 'wedge', 'kappa', 'sigma']) {
    $(`s-${k}`).addEventListener('input', (e) => {
      P[k] = +e.target.value;
      if (k === 'alpha' || k === 'beta') inverse.clear();
      syncSliders();
      const s = app.cur && st();
      // let the curve respond straight away to the new weights
      if (s && s.xs && !running && s.state !== 'collapsed') run();
      schedule();
    });
  }
  $('s-defaults').addEventListener('click', () => {
    Object.assign(P, DEFAULTS, { kappa: KAPPA[mode] });
    inverse.clear();
    syncSliders();
    schedule();
  });
  for (const r of document.querySelectorAll('input[name="s-mode"]')) {
    r.addEventListener('change', () => {
      mode = r.value;
      P.kappa = KAPPA[mode];
      syncSliders();
      updateUI();
    });
  }
  for (const r of document.querySelectorAll('input[name="s-bg"]')) {
    r.addEventListener('change', () => { bg = r.value; schedule(); });
  }
  $('s-field').addEventListener('change', (e) => { showField = e.target.checked; schedule(); });
  $('s-forces').addEventListener('change', (e) => { showForces = e.target.checked; schedule(); });
  $('s-speed').addEventListener('input', (e) => {
    speed = +e.target.value;
    $('s-speed-out').textContent = `${speed} it/frame`;
  });

  $('s-run').addEventListener('click', () => {
    const s = st();
    if (running) {
      running = false;
      s.state = 'paused';
      commitMask();
      updateUI();
    } else {
      run();
    }
  });
  $('s-step').addEventListener('click', () => {
    const s = st();
    if (!s.xs || running) return;
    s.state = 'paused';
    iterate(10);
    if (s.state === 'paused') commitMask();
    updateUI();
    schedule();
  });
  $('s-reset').addEventListener('click', () => {
    const s = st();
    if (!s.init) return;
    running = false;
    s.xs = s.init.xs.slice();
    s.ys = s.init.ys.slice();
    s.iter = 0;
    s.areas = [];
    s.state = 'ready';
    setMask('snake', null);
    updateUI();
    schedule();
  });
  $('s-clear').addEventListener('click', () => {
    running = false;
    app.cur.ui.snake = null;
    setMask('snake', null);
    updateUI();
    schedule();
  });

  // ------------------------------------------------------------ pointer

  cv.addEventListener('pointerdown', (e) => {
    if (!app.cur || e.button > 0) return;
    e.preventDefault();
    running = false;
    const p = toCanvasXY(cv, e);
    if (mode === 'seed') {
      const xs = [], ys = [];
      for (let k = 0; k < 24; k++) {
        const a = (2 * Math.PI * k) / 24;
        xs.push(p.x + SEED_RADIUS * Math.cos(a));
        ys.push(p.y + SEED_RADIUS * Math.sin(a));
      }
      setStart(xs, ys);
      return;
    }
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
    path = { xs: [p.x], ys: [p.y] };
    schedule();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!path) return;
    const p = toCanvasXY(cv, e), n = path.xs.length;
    if (Math.hypot(p.x - path.xs[n - 1], p.y - path.ys[n - 1]) >= 2) {
      path.xs.push(p.x);
      path.ys.push(p.y);
      schedule();
    }
  });
  const finish = () => {
    if (!path) return;
    const { xs, ys } = path;
    path = null;
    if (xs.length >= 6 && Math.abs(signedArea(xs, ys)) > 150) {
      setStart(xs, ys);
    } else {
      $('s-status').textContent = 'That loop is too small. Drag a larger closed loop around the tumor.';
      schedule();
    }
  };
  cv.addEventListener('pointerup', finish);
  cv.addEventListener('pointercancel', finish);

  on('case', () => {
    running = false;
    path = null;
    const prev = runningCase && runningCase.ui.snake;
    if (prev && prev.state === 'running') prev.state = 'paused';
    updateUI();
    schedule();
  });

  syncSliders();
  updateUI();
}
