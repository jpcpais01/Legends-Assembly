#!/usr/bin/env node
/**
 * The Grand Museum's paintings: real public-domain masterpieces in one KTX2 atlas (one texture, one draw for the hall).
 *
 *   models-src/paintings/<id>.jpg  ->  public/textures/museum/paintings.ktx2
 *
 * Each painting meets its frame halfway: the frame is widened or narrowed by up to maxStretch (MuseumArena does this),
 * the rest is cropped around `focus`. Cells get an edge-repeat gutter so mipmaps don't bleed neighbours into each
 * other. Basis ETC1S, sRGB, with mipmaps (stays compressed on the GPU).
 *
 * Table: src/data/museumPaintings.json.  Usage: npm run paintings
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';

const T = JSON.parse(readFileSync('src/data/museumPaintings.json', 'utf8'));
const SRC = 'models-src/paintings', OUT = 'public/textures/museum';
const [CW, CH] = T.cell, G = T.gutter, SW = CW + 2 * G, SH = CH + 2 * G;
const rows = Math.ceil(T.paintings.length / T.cols);
const W = T.cols * SW, H = rows * SH;

const layers = [];
for (const [i, p] of T.paintings.entries()) {
  const file = `${SRC}/${p.id}.jpg`;
  if (!existsSync(file)) { console.error(`missing ${file}`); process.exit(1); }
  const img = sharp(file);
  const { width: w, height: h } = await img.metadata();
  if (Math.abs(w / h - p.aspect) > 0.01) console.warn(`${p.id}: aspect ${(w / h).toFixed(3)} != table ${p.aspect}`);
  const stretch = Math.min(1 + T.maxStretch, Math.max(1 - T.maxStretch, p.aspect / T.frameAspect));
  const target = T.frameAspect * stretch;
  let cw = w, ch = h, left = 0, top = 0;
  if (w / h > target) { cw = Math.round(h * target); left = Math.round((w - cw) * p.focus); }
  else { ch = Math.round(w / target); top = Math.round((h - ch) * p.focus); }
  const cell = await sharp(file).extract({ left, top, width: cw, height: ch }).resize(CW, CH, { fit: 'fill', kernel: 'lanczos3' })
    .extend({ top: G, bottom: G, left: G, right: G, extendWith: 'copy' }).removeAlpha().png().toBuffer();
  layers.push({ input: cell, left: (i % T.cols) * SW, top: Math.floor(i / T.cols) * SH });
  console.log(`${p.id.padEnd(20)} ${w}x${h}  frame x${stretch.toFixed(3)}  crop ${cw}x${ch} @${left},${top}`);
}
const atlas = await sharp({ create: { width: W, height: H, channels: 3, background: '#1a1410' } }).composite(layers).png().toBuffer();
mkdirSync(OUT, { recursive: true });
const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};
// ETC1S at top quality: next to UASTC it is indistinguishable on these canvases at a quarter of the download (~1.2 MB)
const ktx = await encodeToKTX2(new Uint8Array(atlas), {
  isUASTC: false, qualityLevel: 255, compressionLevel: 4, isPerceptual: true, isSetKTX2SRGBTransferFunc: true, generateMipmap: true, imageDecoder,
});
writeFileSync(`${OUT}/paintings.ktx2`, ktx);
console.log(`atlas ${W}x${H} -> ${OUT}/paintings.ktx2 ${(ktx.length / 1048576).toFixed(2)} MB`);
