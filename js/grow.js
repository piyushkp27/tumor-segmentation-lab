// Exercise 3b: seeded region growing (Adams & Bischof, 1994), simplified.
// Starting from the seed, add every 4-neighbour whose intensity is within T of the
// region's current mean (or of the seed's value). Growth is recorded ring by ring
// so it can be replayed.

import { app, on, setMask, uiState } from './state.js';
import { COLORS, beginPixels, endPixels, hexToRgb, toCanvasXY, fitCanvas, crosshair, fmt } from './draw.js';
import { gaussianBlur } from './imgproc.js';

const $ = (id) => document.getElementById(id);

export function initGrow() {
  const cv = $('g-canvas'), ctx = cv.getContext('2d');
  let blurCache = { key: '', img: null };
  let shown = Infinity; // last ring drawn during the replay
  let anim = 0;
  let queued = false;

  const st = () => uiState('grow', () => ({
    seed: null, T: 20, rule: 'mean', sigma: 1,
    layer: null, rings: 0, size: 0, mean: 0,
  }));

  function blurred() {
    const c = app.cur, s = st(), key = `${c.id}:${s.sigma}`;
    if (blurCache.key !== key) blurCache = { key, img: gaussianBlur(c.gray, c.w, c.h, s.sigma) };
    return blurCache.img;
  }

  function grow() {
    const c = app.cur, s = st(), { w, h } = c, n = w * h;
    if (!s.seed) {
      s.layer = null;
      setMask('grow', null);
      return;
    }
    const g = blurred();
    const layer = new Int32Array(n).fill(-1);
    const seed = Math.floor(s.seed.y) * w + Math.floor(s.seed.x);
    const ref0 = g[seed];
    let sum = ref0, count = 1, ring = 0;
    layer[seed] = 0;
    let front = [seed];
    while (front.length) {
      const next = [];
      for (const p of front) {
        const x = p % w;
        const nbs = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1];
        for (const q of nbs) {
          if (q < 0 || layer[q] !== -1) continue;
          const ref = s.rule === 'mean' ? sum / count : ref0;
          if (Math.abs(g[q] - ref) <= s.T) {
            layer[q] = ring + 1;
            sum += g[q];
            count++;
            next.push(q);
          }
        }
      }
      if (next.length) ring++;
      front = next;
    }
    s.layer = layer;
    s.rings = ring;
    s.size = count;
    s.mean = sum / count;
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = layer[i] >= 0 ? 1 : 0;
    const where = `seed at (${Math.floor(s.seed.x)}, ${Math.floor(s.seed.y)})`;
    setMask('grow', m, `${where}, T = ${s.T}, compared with ${s.rule === 'mean' ? 'region mean' : 'seed value'}, σ = ${s.sigma}`);
  }

  function replay() {
    cancelAnimationFrame(anim);
    const s = st();
    if (!s.layer) return;
    const step = Math.max(1, Math.ceil(s.rings / 70));
    shown = 0;
    const tick = () => {
      shown += step;
      render();
      if (shown < s.rings) anim = requestAnimationFrame(tick);
      else { shown = Infinity; render(); }
    };
    anim = requestAnimationFrame(tick);
  }

  function render() {
    const c = app.cur;
    if (!c) return;
    const s = st(), { w, h } = c;
    fitCanvas(cv, w, h);
    ctx.drawImage(c.base, 0, 0);
    if (s.layer) {
      const d = beginPixels(w, h);
      const [r, g, b] = hexToRgb(COLORS.grow);
      for (let i = 0; i < w * h; i++) {
        const L = s.layer[i];
        if (L < 0 || L > shown) continue;
        const front = shown !== Infinity && L >= shown - 1;
        d[4 * i] = front ? 255 : r;
        d[4 * i + 1] = front ? 255 : g;
        d[4 * i + 2] = front ? 255 : b;
        d[4 * i + 3] = front ? 255 : 120;
      }
      endPixels(ctx);
    }
    if (s.seed) crosshair(ctx, s.seed.x, s.seed.y, '#ffe14d');
    updateUI();
  }

  function updateUI() {
    const s = st(), { w, h } = app.cur;
    $('g-replay').disabled = !s.layer;
    $('g-clear').disabled = !s.seed;
    if (!s.layer) {
      $('g-status').textContent = 'Click inside the tumor to place a seed.';
      return;
    }
    const leak = s.size > 0.08 * w * h ? ' The region has leaked well beyond the tumor.' : '';
    $('g-status').textContent =
      `${s.size.toLocaleString()} px after ${s.rings} rings. Region mean ${fmt(s.mean, 1)}.${leak}`;
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  }

  function syncControls() {
    const s = st();
    $('g-t').value = s.T;
    $('g-t-out').textContent = String(s.T);
    $('g-sigma').value = s.sigma;
    $('g-sigma-out').textContent = `${s.sigma} px`;
    for (const r of document.querySelectorAll('input[name="g-rule"]')) r.checked = r.value === s.rule;
  }

  // changing a rule regrows instantly; a new seed replays the growth
  const regrow = () => { cancelAnimationFrame(anim); shown = Infinity; grow(); schedule(); };
  $('g-t').addEventListener('input', (e) => {
    st().T = +e.target.value;
    $('g-t-out').textContent = e.target.value;
    regrow();
  });
  $('g-sigma').addEventListener('input', (e) => {
    st().sigma = +e.target.value;
    $('g-sigma-out').textContent = `${e.target.value} px`;
    regrow();
  });
  for (const r of document.querySelectorAll('input[name="g-rule"]')) {
    r.addEventListener('change', () => { st().rule = r.value; regrow(); });
  }
  $('g-replay').addEventListener('click', replay);
  $('g-clear').addEventListener('click', () => {
    cancelAnimationFrame(anim);
    const s = st();
    s.seed = null;
    grow();
    schedule();
  });
  cv.addEventListener('pointerdown', (e) => {
    if (!app.cur || e.button > 0) return;
    e.preventDefault();
    const p = toCanvasXY(cv, e);
    const { w, h } = app.cur;
    st().seed = { x: Math.min(w - 0.5, Math.max(0, p.x)), y: Math.min(h - 0.5, Math.max(0, p.y)) };
    grow();
    replay();
  });

  on('case', () => { cancelAnimationFrame(anim); shown = Infinity; syncControls(); schedule(); });
  on('tab', () => schedule());
}
