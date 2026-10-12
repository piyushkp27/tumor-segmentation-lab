// A small image-processing toolbox used by all exercises.
// Images are row-major Float32Arrays (0..255). Masks are Uint8Arrays of 0/1.

// ---------------------------------------------------------------- filtering

// Separable Gaussian blur, edges clamped.
export function gaussianBlur(src, w, h, sigma) {
  if (!(sigma > 0.05)) return Float32Array.from(src);
  const r = Math.ceil(3 * sigma);
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += k[i + r];
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;

  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
        acc += k[i + r] * src[row + xx];
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        acc += k[i + r] * tmp[yy * w + x];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

// Gradient by central differences. Returns { gx, gy, mag }.
export function gradient(img, w, h) {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : y, yp = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : x, xp = x < w - 1 ? x + 1 : x;
      const i = y * w + x;
      const dx = (img[y * w + xp] - img[y * w + xm]) / (xp - xm || 1);
      const dy = (img[yp * w + x] - img[ym * w + x]) / (yp - ym || 1);
      gx[i] = dx;
      gy[i] = dy;
      mag[i] = Math.hypot(dx, dy);
    }
  }
  return { gx, gy, mag };
}

// p-th quantile (0..1) of an array, from a subsample for speed.
export function quantile(arr, p, stride = 3) {
  const n = Math.ceil(arr.length / stride);
  const a = new Float32Array(n);
  for (let i = 0, j = 0; i < arr.length; i += stride, j++) a[j] = arr[i];
  a.sort();
  return a[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
}

// Bilinear sample at continuous canvas coordinates (pixel i covers [i, i+1)).
export function sample(arr, w, h, px, py) {
  let x = px - 0.5, y = py - 0.5;
  if (x < 0) x = 0; else if (x > w - 1.001) x = w - 1.001;
  if (y < 0) y = 0; else if (y > h - 1.001) y = h - 1.001;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const i = y0 * w + x0;
  return arr[i] * (1 - fx) * (1 - fy) + arr[i + 1] * fx * (1 - fy) +
         arr[i + w] * (1 - fx) * fy + arr[i + w + 1] * fx * fy;
}

// ---------------------------------------------------------------- Otsu

export function histogram(img, roi) {
  const hist = new Float64Array(256);
  for (let i = 0; i < img.length; i++) {
    if (roi && !roi[i]) continue;
    let v = Math.round(img[i]);
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    hist[v]++;
  }
  return hist;
}

// Otsu (1979). Class 0 is [0..t], class 1 is [t+1..255].
// Returns the best t and the whole curve sigmaB[t] so it can be plotted.
export function otsu(hist) {
  let total = 0, sumAll = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sumAll += i * hist[i]; }
  const sigmaB = new Float64Array(256);
  let w0 = 0, sum0 = 0, best = -1, bestT = 0;
  for (let t = 0; t < 256; t++) {
    w0 += hist[t];
    sum0 += t * hist[t];
    const w1 = total - w0;
    if (w0 === 0 || w1 === 0) continue;
    const mu0 = sum0 / w0, mu1 = (sumAll - sum0) / w1;
    const v = (w0 / total) * (w1 / total) * (mu0 - mu1) * (mu0 - mu1);
    sigmaB[t] = v;
    if (v > best) { best = v; bestT = t; }
  }
  return { t: bestT, sigmaB, max: Math.max(best, 0), total };
}

// Class weights and means for a given threshold.
export function classStats(hist, t) {
  let n0 = 0, s0 = 0, n1 = 0, s1 = 0;
  for (let i = 0; i < 256; i++) {
    if (i <= t) { n0 += hist[i]; s0 += i * hist[i]; } else { n1 += hist[i]; s1 += i * hist[i]; }
  }
  const n = n0 + n1 || 1;
  return { w0: n0 / n, w1: n1 / n, mu0: n0 ? s0 / n0 : NaN, mu1: n1 ? s1 / n1 : NaN };
}

export function threshold(img, t, roi) {
  const m = new Uint8Array(img.length);
  for (let i = 0; i < img.length; i++) m[i] = img[i] >= t + 0.5 && (!roi || roi[i]) ? 1 : 0; // same rounding as histogram()
  return m;
}

// ---------------------------------------------------------------- binary masks

export function area(m) {
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i];
  return n;
}

// Connected components, 8-connected. labels[i] = 0 for background, 1..count otherwise.
export function components(mask, w, h) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const sizes = [0];
  let count = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i]) continue;
    count++;
    let sp = 0, size = 0;
    stack[sp++] = i;
    labels[i] = count;
    while (sp) {
      const p = stack[--sp];
      size++;
      const x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (mask[q] && !labels[q]) { labels[q] = count; stack[sp++] = q; }
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes, count };
}

export function keepLabel(labels, label) {
  const m = new Uint8Array(labels.length);
  if (label > 0) for (let i = 0; i < labels.length; i++) m[i] = labels[i] === label ? 1 : 0;
  return m;
}

// Fill holes: any background pixel that cannot be reached from the image border.
export function fillHoles(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (q) => { if (!mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const p = stack[--sp];
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = mask[i] || !seen[i] ? 1 : 0;
  return out;
}

function diskOffsets(r) {
  const o = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) o.push(dx, dy);
  }
  return o;
}

export function erode(mask, w, h, r) {
  const o = diskOffsets(r);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      let keep = 1;
      for (let k = 0; k < o.length && keep; k += 2) {
        const xx = x + o[k], yy = y + o[k + 1];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx]) keep = 0;
      }
      out[y * w + x] = keep;
    }
  }
  return out;
}

export function dilate(mask, w, h, r) {
  const o = diskOffsets(r);
  const out = Uint8Array.from(mask);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      // only boundary pixels can grow the mask
      if (x > 0 && x < w - 1 && y > 0 && y < h - 1 &&
          mask[i - 1] && mask[i + 1] && mask[i - w] && mask[i + w]) continue;
      for (let k = 0; k < o.length; k += 2) {
        const xx = x + o[k], yy = y + o[k + 1];
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) out[yy * w + xx] = 1;
      }
    }
  }
  return out;
}

// Opening = erosion then dilation: removes specks and cuts bridges thinner than 2r.
export function opening(mask, w, h, r) {
  return r > 0 ? dilate(erode(mask, w, h, r), w, h, r) : mask;
}

// Pixels of the mask that touch the background (4-neighbourhood) or the image border.
export function boundary(mask, w, h) {
  const b = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
          !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) b[i] = 1;
    }
  }
  return b;
}

// ---------------------------------------------------------------- polygons

let rasterCanvas = null;
let rasterCtx = null;

// Fill a closed polygon given in canvas coordinates. Returns a mask.
export function rasterizePolygon(xs, ys, w, h) {
  if (!rasterCanvas) {
    rasterCanvas = document.createElement('canvas');
    rasterCtx = rasterCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (rasterCanvas.width !== w || rasterCanvas.height !== h) {
    rasterCanvas.width = w;
    rasterCanvas.height = h;
  }
  const c = rasterCtx;
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#fff';
  c.beginPath();
  c.moveTo(xs[0], ys[0]);
  for (let i = 1; i < xs.length; i++) c.lineTo(xs[i], ys[i]);
  c.closePath();
  c.fill('nonzero');
  const d = c.getImageData(0, 0, w, h).data;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = d[4 * i + 3] >= 128 ? 1 : 0;
  return m;
}

// ---------------------------------------------------------------- comparing masks

export function dice(a, b) {
  let inter = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    na += a[i];
    nb += b[i];
    inter += a[i] & b[i];
  }
  return na + nb ? (2 * inter) / (na + nb) : NaN;
}

// Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher 2012).
// Returns, for every pixel, the squared distance to the nearest pixel where feature = 1.
export function distanceTransform(feature, w, h) {
  const INF = 1e20;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n);
  const v = new Int32Array(n), z = new Float64Array(n + 1);
  const out = new Float64Array(w * h);

  const dt1d = (len) => {
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = feature[y * w + x] ? 0 : INF;
    dt1d(h);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    dt1d(w);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  return out;
}

// Symmetric boundary distances between two masks: { hd95, hd } in pixels.
export function boundaryDistances(a, b, w, h) {
  const ba = boundary(a, w, h), bb = boundary(b, w, h);
  const da = distanceTransform(bb, w, h); // distance to b's boundary
  const db = distanceTransform(ba, w, h); // distance to a's boundary
  const dist = [];
  for (let i = 0; i < w * h; i++) {
    if (ba[i]) dist.push(Math.sqrt(da[i]));
    if (bb[i]) dist.push(Math.sqrt(db[i]));
  }
  if (!dist.length || !area(ba) || !area(bb)) return { hd95: NaN, hd: NaN };
  dist.sort((p, q) => p - q);
  return { hd95: dist[Math.floor(0.95 * (dist.length - 1))], hd: dist[dist.length - 1] };
}
