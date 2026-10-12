// Drawing helpers shared by the exercises.

export const COLORS = {
  manual: '#ffb000',
  manual2: '#b48cff',
  otsu: '#1fc3d3',
  snake: '#ff4fa3',
  grow: '#7bd148',
  truth: '#ffffff',
};

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Pointer position in canvas pixels (pixel i covers [i, i+1)).
export function toCanvasXY(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * canvas.width,
    y: ((e.clientY - r.top) / r.height) * canvas.height,
  };
}

// How many canvas pixels make one CSS pixel, so lines keep a steady on-screen width.
export function pxScale(canvas) {
  const cw = canvas.getBoundingClientRect().width;
  return cw > 0 ? canvas.width / cw : 1;
}

export function fitCanvas(canvas, w, h) {
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

// Masks are painted pixel by pixel into an offscreen canvas, then drawn on top.
const scratch = document.createElement('canvas');
let sctx = null, sdata = null;

export function beginPixels(w, h) {
  if (scratch.width !== w || scratch.height !== h || !sdata) {
    scratch.width = w;
    scratch.height = h;
    sctx = scratch.getContext('2d');
    sdata = sctx.createImageData(w, h);
  }
  sdata.data.fill(0);
  return sdata.data;
}

export function endPixels(ctx, dw, dh) {
  sctx.putImageData(sdata, 0, 0);
  ctx.drawImage(scratch, 0, 0, dw ?? scratch.width, dh ?? scratch.height);
}

// Filled mask with a solid outline. outline = 0 (none), 1 or 2 pixels thick.
export function drawMask(ctx, mask, w, h, color, { fill = 0.35, outline = 1, dw, dh } = {}) {
  const d = beginPixels(w, h);
  const [r, g, b] = hexToRgb(color);
  const fa = Math.round(fill * 255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let edge = false;
      if (outline) {
        edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
               !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w];
        if (!edge && outline > 1) {
          edge = x < 2 || y < 2 || x > w - 3 || y > h - 3 ||
                 !mask[i - 2] || !mask[i + 2] || !mask[i - 2 * w] || !mask[i + 2 * w] ||
                 !mask[i - w - 1] || !mask[i - w + 1] || !mask[i + w - 1] || !mask[i + w + 1];
        }
      }
      if (!edge && !fa) continue;
      const j = 4 * i;
      d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = edge ? 255 : fa;
    }
  }
  endPixels(ctx, dw, dh);
}

// A binary mask as a white-on-black picture (used for the step-by-step thumbnails).
export function drawBinary(ctx, mask, w, h, dw, dh) {
  const d = beginPixels(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = mask[i] ? 255 : 0;
    d[4 * i] = v; d[4 * i + 1] = v; d[4 * i + 2] = v; d[4 * i + 3] = 255;
  }
  endPixels(ctx, dw, dh);
}

export function polyline(ctx, xs, ys, { closed = true, color = '#fff', width = 2, dash = null, alpha = 1 } = {}) {
  if (!xs || xs.length < 2) return;
  const s = pxScale(ctx.canvas);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width * s;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash.map((v) => v * s));
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
  if (closed) ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export function arrow(ctx, x, y, dx, dy, color, width = 1.5) {
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const s = pxScale(ctx.canvas);
  const head = Math.min(5 * s, len * 0.45);
  const ux = dx / len, uy = dy / len;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width * s;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dx - ux * head * 0.6, y + dy - uy * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + dx, y + dy);
  ctx.lineTo(x + dx - ux * head - uy * head * 0.5, y + dy - uy * head + ux * head * 0.5);
  ctx.lineTo(x + dx - ux * head + uy * head * 0.5, y + dy - uy * head - ux * head * 0.5);
  ctx.closePath();
  ctx.fill();
}

export function crosshair(ctx, x, y, color = '#fff') {
  const s = pxScale(ctx.canvas);
  ctx.save();
  for (const c of ['rgba(0,0,0,.7)', color]) {
    ctx.strokeStyle = c;
    ctx.lineWidth = (c === color ? 1.5 : 3.5) * s;
    ctx.beginPath();
    ctx.moveTo(x - 7 * s, y); ctx.lineTo(x - 2 * s, y);
    ctx.moveTo(x + 2 * s, y); ctx.lineTo(x + 7 * s, y);
    ctx.moveTo(x, y - 7 * s); ctx.lineTo(x, y - 2 * s);
    ctx.moveTo(x, y + 2 * s); ctx.lineTo(x, y + 7 * s);
    ctx.stroke();
  }
  ctx.restore();
}

export function fmtTime(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmt(v, digits = 2) {
  return Number.isFinite(v) ? v.toFixed(digits) : '–';
}
