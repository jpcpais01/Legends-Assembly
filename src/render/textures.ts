import * as THREE from 'three';
import { mulberry32 } from '../core/math';

/**
 * All textures are generated procedurally at boot (no downloads, tiny bundle, instant PWA start).
 * Each generator works on small tileable grids so shaders can sample them at multiple scales.
 */

function makeLattice(period: number, seed: number) {
  const r = mulberry32(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return g;
}

/** Tileable value-noise sample with quintic interpolation. */
function sampleLattice(g: Float32Array, period: number, x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const a = g[y0 * period + x0], b = g[y0 * period + x1];
  const c = g[y1 * period + x0], d = g[y1 * period + x1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal tileable noise field in [0,1]. */
export function fbmField(size: number, basePeriod: number, octaves: number, seed: number, ridged = false) {
  const out = new Float32Array(size * size);
  const lattices: { g: Float32Array; p: number }[] = [];
  for (let o = 0; o < octaves; o++) {
    const p = basePeriod << o;
    lattices.push({ g: makeLattice(p, seed + o * 1013), p });
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let amp = 0.5, sum = 0, norm = 0;
      for (let o = 0; o < octaves; o++) {
        const { g, p } = lattices[o];
        let n = sampleLattice(g, p, (x / size) * p, (y / size) * p);
        if (ridged) n = 1 - Math.abs(n * 2 - 1);
        sum += n * amp;
        norm += amp;
        amp *= 0.5;
      }
      out[y * size + x] = sum / norm;
    }
  }
  return out;
}

let noiseTex: THREE.DataTexture | null = null;
/** RGBA tileable noise: R = fine fbm, G = medium fbm, B = ridged, A = coarse fbm. */
export function getNoiseTexture() {
  if (noiseTex) return noiseTex;
  const size = 256;
  const r = fbmField(size, 8, 5, 11);
  const g = fbmField(size, 4, 4, 77);
  const b = fbmField(size, 4, 4, 133, true);
  const a = fbmField(size, 2, 3, 991);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = r[i] * 255;
    data[i * 4 + 1] = g[i] * 255;
    data[i * 4 + 2] = b[i] * 255;
    data[i * 4 + 3] = a[i] * 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  noiseTex = t;
  return t;
}

function heightToNormal(h: Float32Array, size: number, strength: number) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x];
      const u = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

function dataTex(data: Uint8Array, size: number, srgb: boolean) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export interface PBRSet { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }

const cache = new Map<string, PBRSet>();

/** Warm weathered marble: soft veins, mottling, and chipped micro-detail. */
export function getMarble(): PBRSet {
  const hit = cache.get('marble');
  if (hit) return hit;
  const size = 512;
  const base = fbmField(size, 4, 6, 5);
  const vein = fbmField(size, 3, 5, 42, true);
  const fine = fbmField(size, 32, 3, 9);
  const col = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const h = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.pow(vein[i], 9);
    const m = base[i];
    const f = fine[i];
    // warm cream marble with grey-rose veins and dirt in low areas
    let r = 0.86 + (m - 0.5) * 0.12 - v * 0.25 - (1 - f) * 0.05;
    let g = 0.80 + (m - 0.5) * 0.10 - v * 0.28 - (1 - f) * 0.06;
    let b = 0.70 + (m - 0.5) * 0.08 - v * 0.24 - (1 - f) * 0.07;
    const dirt = Math.max(0, 0.42 - m) * 1.2;
    r -= dirt * 0.25; g -= dirt * 0.27; b -= dirt * 0.3;
    col[i * 4] = Math.max(0, Math.min(1, r)) * 255;
    col[i * 4 + 1] = Math.max(0, Math.min(1, g)) * 255;
    col[i * 4 + 2] = Math.max(0, Math.min(1, b)) * 255;
    col[i * 4 + 3] = 255;
    const ro = 0.55 + (1 - f) * 0.25 + dirt * 0.3 - v * 0.1;
    rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = Math.max(0, Math.min(1, ro)) * 255;
    rough[i * 4 + 3] = 255;
    h[i] = m * 0.6 + f * 0.4 - v * 0.3;
  }
  const set = {
    map: dataTex(col, size, true),
    normalMap: dataTex(heightToNormal(h, size, 6), size, false),
    roughnessMap: dataTex(rough, size, false),
  };
  cache.set('marble', set);
  return set;
}

/** Rough natural rock with lichen tint. */
export function getRock(): PBRSet {
  const hit = cache.get('rock');
  if (hit) return hit;
  const size = 256;
  const base = fbmField(size, 4, 6, 301);
  const crack = fbmField(size, 6, 4, 777, true);
  const lichen = fbmField(size, 3, 4, 55);
  const col = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const h = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const m = base[i];
    const c = Math.pow(crack[i], 6);
    const l = Math.max(0, lichen[i] - 0.55) * 3;
    let r = 0.42 + m * 0.18 - c * 0.2;
    let g = 0.39 + m * 0.16 - c * 0.2;
    let b = 0.35 + m * 0.14 - c * 0.18;
    r = r * (1 - l) + 0.42 * l; g = g * (1 - l) + 0.5 * l; b = b * (1 - l) + 0.2 * l;
    col[i * 4] = Math.max(0, Math.min(1, r)) * 255;
    col[i * 4 + 1] = Math.max(0, Math.min(1, g)) * 255;
    col[i * 4 + 2] = Math.max(0, Math.min(1, b)) * 255;
    col[i * 4 + 3] = 255;
    rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = (0.8 + c * 0.2) * 255;
    rough[i * 4 + 3] = 255;
    h[i] = m - c * 0.6;
  }
  const set = {
    map: dataTex(col, size, true),
    normalMap: dataTex(heightToNormal(h, size, 10), size, false),
    roughnessMap: dataTex(rough, size, false),
  };
  cache.set('rock', set);
  return set;
}

/** Bark: vertically stretched ridges. */
export function getBark(): PBRSet {
  const hit = cache.get('bark');
  if (hit) return hit;
  const size = 128;
  const ridges = fbmField(size, 16, 3, 444, true);
  const col = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // sample stretched: use row-averaged ridge for vertical grooves
      const v = ridges[(Math.floor(y / 6) * size + x) % (size * size)] * 0.6 + ridges[i] * 0.4;
      const r = 0.24 + v * 0.16, g = 0.17 + v * 0.11, b = 0.12 + v * 0.07;
      col[i * 4] = r * 255; col[i * 4 + 1] = g * 255; col[i * 4 + 2] = b * 255; col[i * 4 + 3] = 255;
      rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = 230; rough[i * 4 + 3] = 255;
      h[i] = v;
    }
  }
  const set = {
    map: dataTex(col, size, true),
    normalMap: dataTex(heightToNormal(h, size, 8), size, false),
    roughnessMap: dataTex(rough, size, false),
  };
  cache.set('bark', set);
  return set;
}

/** Text rendered to a canvas texture (used for floating glyphs like E=mc²). */
export function makeTextTexture(text: string, opts: { font?: string; color?: string; glow?: string; w?: number; h?: number } = {}) {
  const w = opts.w ?? 512, h = opts.h ?? 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.font = opts.font ?? `italic 700 ${Math.floor(h * 0.55)}px "Chakra Petch", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = opts.glow ?? '#ffffff';
  ctx.shadowBlur = h * 0.12;
  ctx.fillStyle = opts.color ?? '#ffffff';
  ctx.fillText(text, w / 2, h / 2);
  ctx.shadowBlur = 0;
  ctx.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** CPU-side bilinear sample of the shared noise texture (matches GPU `texture2D(uNoise, uv)` with repeat wrap). */
export function sampleNoise(u: number, v: number, channel: 0 | 1 | 2 | 3) {
  const tex = getNoiseTexture();
  const data = tex.image.data as Uint8Array;
  const size = tex.image.width;
  const x = u * size - 0.5, y = v * size - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const w = (n: number) => ((n % size) + size) % size;
  const s = (xx: number, yy: number) => data[(w(yy) * size + w(xx)) * 4 + channel] / 255;
  const a = s(x0, y0), b = s(x0 + 1, y0), c = s(x0, y0 + 1), d = s(x0 + 1, y0 + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
