// Page start-up: load an image, build the case picker, start the exercises.

import { app, emit, setMask } from './state.js';
import { initManual } from './manual.js';
import { initOtsu } from './otsu.js';
import { initSnake } from './snake.js';
import { initGrow } from './grow.js';
import { initCompare } from './compare.js';

const SIZE = 512; // every image is scaled so its longer side is this many pixels

const CASES = [
  {
    id: 'A',
    file: 'img/gbm_t1c.png',
    title: 'A · Glioblastoma, T1 + contrast',
    blurb: 'Bright enhancing rim around a dark necrotic center.',
  },
  {
    id: 'B',
    file: 'img/gbm_t2.png',
    title: 'B · Same tumor, T2-weighted',
    blurb: 'Water is bright on T2, so the fluid in the ventricles is too.',
  },
  {
    id: 'C',
    file: 'img/phantom.png',
    truth: 'img/phantom_truth.png',
    title: 'C · Simulated slice',
    blurb: 'Made for this lab. Its true mask is known, so it is the only image we can score.',
  },
];

const loaded = new Map();

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

// Draw any image into a SIZE canvas, convert to grayscale, and keep both.
function makeCase(id, title, img) {
  const s = SIZE / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.max(1, Math.round(img.naturalWidth * s));
  const h = Math.max(1, Math.round(img.naturalHeight * s));
  const base = document.createElement('canvas');
  base.width = w;
  base.height = h;
  const ctx = base.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const id0 = ctx.getImageData(0, 0, w, h);
  const d = id0.data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
    gray[i] = v;
    d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = Math.round(v);
    d[4 * i + 3] = 255;
  }
  ctx.putImageData(id0, 0, 0); // show exactly what the algorithms see
  const orig = { img, w: img.naturalWidth, h: img.naturalHeight };
  return { id, title, w, h, gray, base, orig, masks: {}, info: {}, ui: {} };
}

// Read a binary mask image at the working size. Works for 0/255 and for 0/1 PNGs:
// anything brighter than half the brightest pixel counts as tumor.
function maskFromImage(img, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const v = new Float32Array(w * h);
  let max = 0;
  for (let i = 0; i < w * h; i++) {
    v[i] = Math.max(d[4 * i], d[4 * i + 1], d[4 * i + 2]);
    if (v[i] > max) max = v[i];
  }
  const m = new Uint8Array(w * h);
  if (max > 0) for (let i = 0; i < w * h; i++) m[i] = v[i] > max / 2 ? 1 : 0;
  return m;
}

function buildMaskUpload() {
  const input = document.getElementById('upload-mask');
  const status = document.getElementById('mask-status');
  const remove = document.getElementById('mask-remove');

  const show = () => {
    const c = app.cur;
    if (!c) return;
    remove.hidden = !c.masks.truth || !c.truthFromUser;
    status.textContent = c.masks.truth
      ? (c.truthFromUser ? `Loaded for this image: ${c.info.truth}` : 'This image already has a stored ground truth. Loading one replaces it.')
      : 'No ground truth for this image yet.';
  };

  document.getElementById('mask-load').addEventListener('click', () => input.click());
  remove.addEventListener('click', () => {
    app.cur.truthFromUser = false;
    setMask('truth', null);
    show();
  });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file || !app.cur) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const c = app.cur;
      const m = maskFromImage(img, c.w, c.h);
      let n = 0;
      for (let i = 0; i < m.length; i++) n += m[i];
      if (!n) throw new Error(`${file.name} has no white pixels, so it cannot be a tumor mask`);
      const sameShape = Math.abs(img.naturalWidth / img.naturalHeight - c.orig.w / c.orig.h) < 0.01;
      c.truthFromUser = true;
      setMask('truth', m, `${file.name}, ${img.naturalWidth} × ${img.naturalHeight}` +
        (sameShape ? '' : ' (WARNING: not the same shape as the image, so it was stretched to fit)'));
    } catch (err) {
      status.textContent = err.message;
      return;
    } finally {
      URL.revokeObjectURL(url);
    }
    show();
  });
  return show;
}

async function selectCase(def) {
  let c = loaded.get(def.id);
  if (!c) {
    const img = await loadImage(def.file);
    c = makeCase(def.id, def.title, img);
    if (def.truth) {
      c.masks.truth = maskFromImage(await loadImage(def.truth), c.w, c.h);
      c.info.truth = 'Stored with the phantom when it was generated.';
    }
    loaded.set(def.id, c);
  }
  app.cur = c;
  for (const b of document.querySelectorAll('#case-picker .case')) {
    b.setAttribute('aria-pressed', String(b.dataset.id === def.id));
  }
  emit('case', c);
  showMask();
}

function buildPicker() {
  const picker = document.getElementById('case-picker');
  const upload = document.getElementById('upload');
  for (const def of CASES) {
    const b = document.createElement('button');
    b.className = 'case';
    b.dataset.id = def.id;
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<img src="${def.file}" alt="" width="190" height="190" loading="lazy">
      <span class="txt"><b>${def.title}</b><span>${def.blurb}</span></span>`;
    b.addEventListener('click', () => selectCase(def).catch(report));
    picker.append(b);
  }

  const own = document.createElement('button');
  own.className = 'case';
  own.dataset.id = 'own';
  own.setAttribute('aria-pressed', 'false');
  own.innerHTML = `<span class="blank">Choose a file&hellip;</span>
    <span class="txt"><b>Your own image</b><span>Any PNG or JPEG. It is converted to grayscale and resized to ${SIZE}&nbsp;px.</span></span>`;
  own.addEventListener('click', () => upload.click());
  picker.append(own);

  let n = 0;
  upload.addEventListener('change', async () => {
    const file = upload.files && upload.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const def = { id: `own-${++n}`, title: file.name };
      const c = makeCase(def.id, `Your image (${file.name})`, img);
      c.fileName = file.name;
      loaded.set(def.id, c);
      own.querySelector('.blank, img').outerHTML = `<img src="${url}" alt="" width="190" height="190">`;
      own.dataset.id = def.id;
      await selectCase(def);
    } catch (err) {
      report(err);
    }
    upload.value = '';
  });
}

function buildTabs() {
  const tabs = [
    [document.getElementById('tab-btn-snake'), document.getElementById('tab-snake')],
    [document.getElementById('tab-btn-grow'), document.getElementById('tab-grow')],
  ];
  for (const [btn] of tabs) {
    btn.addEventListener('click', () => {
      for (const [b, panel] of tabs) {
        const on = b === btn;
        b.setAttribute('aria-selected', String(on));
        panel.hidden = !on;
      }
      emit('tab', btn.id);
    });
  }
}

function report(err) {
  console.error(err);
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = `${err.message}. If you opened index.html straight from disk, serve the folder instead (see README).`;
  document.getElementById('case-picker').after(p);
}

buildPicker();
buildTabs();
const showMask = buildMaskUpload();
initManual();
initOtsu();
initSnake();
initGrow();
initCompare();
selectCase(CASES[0]).catch(report);

window.lab = app; // handy for poking at the data from the browser console
