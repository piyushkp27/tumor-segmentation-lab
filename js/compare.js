// Exercise 4: put every mask for the current image side by side and measure agreement.

import { app, on } from './state.js';
import { COLORS, drawMask, beginPixels, endPixels, fitCanvas, fmt } from './draw.js';
import { area, dice, boundaryDistances } from './imgproc.js';

const $ = (id) => document.getElementById(id);

const METHODS = [
  { key: 'manual', name: 'By hand, attempt 1' },
  { key: 'manual2', name: 'By hand, attempt 2' },
  { key: 'otsu', name: 'Otsu threshold' },
  { key: 'snake', name: 'Active contour' },
  { key: 'grow', name: 'Region growing' },
  { key: 'truth', name: 'True mask (phantom only)' },
];

// agreement map colours: one mask -> all masks
const RAMP = [[47, 107, 255], [209, 76, 200], [255, 225, 77]];

function rampColor(t) {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  return RAMP[i].map((v, k) => Math.round(v + f * (RAMP[i + 1][k] - v)));
}

export function initCompare() {
  const cv = $('c-canvas'), ctx = cv.getContext('2d');
  let view = 'outline';
  const hidden = new Set();
  let visible = false, dirty = true, timer = 0;

  const available = () => (app.cur ? METHODS.filter((m) => app.cur.masks[m.key]) : []);
  const shownMethods = () => available().filter((m) => !hidden.has(m.key));

  // The truth if there is one, else your first hand-drawn mask, unless you picked another.
  function refKey() {
    const av = available().map((m) => m.key);
    const picked = app.cur.ui.compareRef;
    if (picked && av.includes(picked)) return picked;
    return av.includes('truth') ? 'truth' : av.includes('manual') ? 'manual' : av[0] || null;
  }

  // ------------------------------------------------------------ figure

  function renderCanvas() {
    const c = app.cur;
    if (!c) return;
    const { w, h } = c;
    fitCanvas(cv, w, h);
    ctx.drawImage(c.base, 0, 0);
    const list = shownMethods();
    if (view === 'outline') {
      // draw the truth first so the methods sit on top of it
      const ordered = [...list.filter((m) => m.key === 'truth'), ...list.filter((m) => m.key !== 'truth')];
      for (const m of ordered) drawMask(ctx, c.masks[m.key], w, h, COLORS[m.key], { fill: 0, outline: 2 });
      $('c-caption').textContent = list.length
        ? 'Outlines of the ticked masks on the same slice.'
        : 'No masks yet for this image.';
    } else {
      const k = list.length;
      const count = new Uint8Array(w * h);
      for (const m of list) {
        const mk = c.masks[m.key];
        for (let i = 0; i < w * h; i++) count[i] += mk[i];
      }
      const d = beginPixels(w, h);
      for (let i = 0; i < w * h; i++) {
        if (!count[i]) continue;
        const col = rampColor(k > 1 ? (count[i] - 1) / (k - 1) : 1);
        d[4 * i] = col[0]; d[4 * i + 1] = col[1]; d[4 * i + 2] = col[2]; d[4 * i + 3] = 165;
      }
      endPixels(ctx);
      $('c-caption').textContent = k
        ? `How many of the ${k} ticked masks include each pixel. Blue: only one. Yellow: all ${k}.`
        : 'No masks yet for this image.';
    }
  }

  function buildLayers() {
    const box = $('c-layers');
    const av = available();
    box.innerHTML = '';
    if (!av.length) {
      box.innerHTML = '<p class="small" style="margin:0">Nothing yet. Finish Exercises 1 to 3 first.</p>';
      return;
    }
    for (const m of av) {
      const lab = document.createElement('label');
      lab.className = 'check';
      lab.innerHTML = `<input type="checkbox" ${hidden.has(m.key) ? '' : 'checked'}>
        <span><span class="sw ${m.key}"></span> ${m.name}</span>`;
      lab.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) hidden.delete(m.key); else hidden.add(m.key);
        renderCanvas();
      });
      box.append(lab);
    }
  }

  function buildRef() {
    const sel = $('c-ref');
    const av = available();
    const ref = refKey();
    sel.innerHTML = av.map((m) => `<option value="${m.key}" ${m.key === ref ? 'selected' : ''}>${m.name}</option>`).join('');
    sel.disabled = !av.length;
  }

  function buildThumbs() {
    const box = $('c-thumbs');
    const c = app.cur;
    box.innerHTML = '';
    for (const m of available()) {
      const fig = document.createElement('figure');
      const tc = document.createElement('canvas');
      tc.width = 200;
      tc.height = Math.round((200 * c.h) / c.w);
      const tctx = tc.getContext('2d');
      tctx.drawImage(c.base, 0, 0, tc.width, tc.height);
      drawMask(tctx, c.masks[m.key], c.w, c.h, COLORS[m.key], { fill: 0.55, outline: 1, dw: tc.width, dh: tc.height });
      const cap = document.createElement('figcaption');
      cap.innerHTML = `<span class="sw ${m.key}"></span> ${m.name}<br>${area(c.masks[m.key]).toLocaleString()} px`;
      fig.append(tc, cap);
      box.append(fig);
    }
  }

  // ------------------------------------------------------------ numbers

  function buildTables() {
    const c = app.cur, { w, h } = c;
    const av = available();
    const table = $('c-table'), pairs = $('c-pairs');
    if (av.length < 2) {
      table.innerHTML = `<tbody><tr><td class="empty">You need at least two masks for this image to compare them.
        So far: ${av.length ? av.map((m) => m.name).join(', ') : 'none'}.</td></tr></tbody>`;
      pairs.innerHTML = '';
      return;
    }
    const ref = refKey();
    const refName = METHODS.find((m) => m.key === ref).name;
    const R = c.masks[ref];
    let rows = '';
    for (const m of av) {
      const M = c.masks[m.key];
      const same = m.key === ref;
      const dist = same ? null : boundaryDistances(M, R, w, h);
      rows += `<tr>
        <th scope="row"><span class="sw ${m.key}"></span> ${m.name}</th>
        <td class="num">${area(M).toLocaleString()}</td>
        <td class="num">${same ? 'ref.' : fmt(dice(M, R), 3)}</td>
        <td class="num">${same ? 'ref.' : fmt(dist.hd95, 1)}</td>
        <td class="how">${c.info[m.key] || ''}</td>
      </tr>`;
    }
    table.innerHTML = `<thead><tr><th>Mask</th><th>Area (px)</th><th>Dice vs. ${refName.toLowerCase()}</th>
      <th>HD95 (px)</th><th>How it was made</th></tr></thead><tbody>${rows}</tbody>`;

    let head = '<tr><th></th>' + av.map((m) => `<th><span class="sw ${m.key}"></span> ${short(m)}</th>`).join('') + '</tr>';
    let body = '';
    for (const a of av) {
      body += `<tr><th scope="row"><span class="sw ${a.key}"></span> ${short(a)}</th>`;
      for (const b of av) {
        body += a.key === b.key
          ? '<td class="num dim">1</td>'
          : `<td class="num">${fmt(dice(c.masks[a.key], c.masks[b.key]), 3)}</td>`;
      }
      body += '</tr>';
    }
    pairs.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
  }

  function short(m) {
    return { manual: 'Hand 1', manual2: 'Hand 2', otsu: 'Otsu', snake: 'Snake', grow: 'Growing', truth: 'Truth' }[m.key];
  }

  function refresh() {
    if (!app.cur) return;
    dirty = false;
    buildLayers();
    buildRef();
    renderCanvas();
    buildThumbs();
    buildTables();
  }

  function schedule() {
    dirty = true;
    clearTimeout(timer);
    if (visible) timer = setTimeout(refresh, 200);
  }

  // only do the work while the section is on screen
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible && dirty) refresh();
  }, { rootMargin: '300px 0px' }).observe($('compare'));

  for (const r of document.querySelectorAll('input[name="c-view"]')) {
    r.addEventListener('change', () => {
      view = r.value;
      $('c-agree-legend').hidden = view !== 'agree';
      renderCanvas();
    });
  }
  $('c-ref').addEventListener('change', (e) => {
    app.cur.ui.compareRef = e.target.value;
    buildTables();
  });
  $('c-download').addEventListener('click', download);

  function download() {
    const c = app.cur;
    if (!c) return;
    const list = shownMethods();
    const pad = 12, line = 22;
    const out = document.createElement('canvas');
    out.width = c.w;
    out.height = c.h + pad * 2 + line * Math.max(1, list.length);
    const o = out.getContext('2d');
    o.fillStyle = '#fff';
    o.fillRect(0, 0, out.width, out.height);
    o.drawImage(cv, 0, 0);
    o.font = '15px "Source Sans 3", sans-serif';
    o.textBaseline = 'middle';
    list.forEach((m, i) => {
      const y = c.h + pad + line * i + line / 2;
      o.fillStyle = COLORS[m.key];
      o.fillRect(pad, y - 7, 14, 14);
      o.strokeStyle = '#555';
      o.strokeRect(pad + 0.5, y - 6.5, 13, 13);
      o.fillStyle = '#1e1d1a';
      o.fillText(`${m.name} · ${area(c.masks[m.key]).toLocaleString()} px`, pad + 22, y);
    });
    out.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `lab1-masks-${c.id}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  on('case', schedule);
  on('masks', schedule);
}
