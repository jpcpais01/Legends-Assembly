import * as THREE from 'three';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import COLLECTION from '../data/museumPaintings.json';

/**
 * The museum's collection: twelve public-domain masterpieces in one KTX2 atlas (built by scripts/build-paintings.mjs
 * from the table in src/data/museumPaintings.json). One texture, one material, one draw for every painting in the hall.
 */
export const PAINTINGS = COLLECTION.paintings.map((p) => p.id);
export type PaintingId = string;
const ATLAS_VER = 1;

const { cols: COLS, cell: [CW, CH], gutter: G } = COLLECTION;
const ROWS = Math.ceil(PAINTINGS.length / COLS);
const SW = CW + 2 * G, SH = CH + 2 * G, W = COLS * SW, H = ROWS * SH;

export function loadPaintings(ktx2: KTX2Loader): Promise<THREE.Texture | null> {
  return ktx2.loadAsync(`/textures/museum/paintings.ktx2?v=${ATLAS_VER}`).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, (e) => { console.warn('[museum] paintings missing', e); return null; });
}

/** How much a painting's frame is widened (>1) or narrowed (<1) to meet the painting's own proportions. */
export function frameStretch(id: PaintingId) {
  const p = COLLECTION.paintings.find((q) => q.id === id)!;
  const m = COLLECTION.maxStretch;
  return Math.min(1 + m, Math.max(1 - m, p.aspect / COLLECTION.frameAspect));
}

/**
 * UV rectangle of a painting in the atlas as (u0, vBottom, u1, vTop), inside its gutter. KTX2 textures are not flipped,
 * so v runs down the image: the painting's top edge has the smaller v.
 */
export function paintingUV(id: PaintingId) {
  const i = PAINTINGS.indexOf(id);
  const x0 = (i % COLS) * SW + G, y0 = Math.floor(i / COLS) * SH + G;
  return [x0 / W, (y0 + CH) / H, (x0 + CW) / W, y0 / H] as const;
}
