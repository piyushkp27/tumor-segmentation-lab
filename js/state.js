// Shared state: the image currently loaded and the masks made from it.
//
// app.cur = {
//   id, title, w, h,
//   gray:  Float32Array, intensities 0..255, row-major
//   base:  canvas with the grayscale image, for drawing
//   masks: { manual, manual2, otsu, snake, grow, truth }  each a Uint8Array of 0/1
//   info:  { same keys } a short note on how each mask was made
//   ui:    per-exercise settings that belong to this image
// }

export const app = { cur: null };

const bus = new EventTarget();

export function emit(type, detail) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

export function on(type, fn) {
  bus.addEventListener(type, (e) => fn(e.detail));
}

// Store (or remove, with mask = null) one method's mask for the current image.
export function setMask(key, mask, info = '') {
  const c = app.cur;
  if (!c) return;
  if (mask) {
    c.masks[key] = mask;
    c.info[key] = info;
  } else {
    delete c.masks[key];
    delete c.info[key];
  }
  emit('masks', { key });
}

// Per-image settings for one exercise, created on first use.
export function uiState(name, init) {
  const c = app.cur;
  if (!c.ui[name]) c.ui[name] = init();
  return c.ui[name];
}
