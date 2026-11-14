#!/usr/bin/env node
/**
 * The Grand Museum's Meshy models, made game-ready.
 *
 *   models-src/museum/<name>.glb  ->  public/models/museum/<name>.glb
 *
 * Meshy already exports these at 6k-32k triangles, so geometry is only welded, deduplicated and meshopt-compressed.
 * The win is the textures: each model ships three 2K JPEGs (~64 MB of video memory once decoded). They become KTX2
 * (Basis) textures that stay compressed on the GPU (BC7/ASTC/ETC2, about 4-8x less memory than RGBA):
 *   base color  UASTC + RDO + Zstandard, 2K for the big repeated walls, the dome and the T-rex, 1K for the rest
 *   normal      UASTC normal-map mode, 1K
 *   metal/rough ETC1S, 512 (smooth data)
 * The game loads them with KTX2Loader (transcoder in public/basis/).
 *
 * Usage: npm run models:museum [-- --only trex_skeleton]
 */
import { readdirSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import sharp from 'sharp';

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const ONLY = arg('only', null);
const SRC = 'models-src/museum', OUT = 'public/models/museum';
/** Models seen big or up close keep a 2K base color. */
const BIG = new Set(['museum_column_bay', 'museum_wall_niche', 'broken_dome_ring', 'trex_skeleton', 'museum_bay_drape', 'museum_bay_relief', 'museum_bay_fountain', 'museum_bay_doorway', 'colossal_statue']);
/**
 * Stray Meshy triangles to cut, by index in the raw file. The loggia ("Marble Arcade") had a double-sided sheet running
 * diagonally through its gallery and a thin sliver across the left arch.
 */
const DROP = {
  museum_upper_loggia: [9961, 14247, 9652, 14580, 14583],
  // the sky fresco ("Gilded Sky Portal") had a full-width sheet over its face whose two triangles sample different parts of
  // the texture (a bright diagonal wedge across the painting), two slanted slivers, a second copy of the painted quad
  // fighting the first, and two slivers along its diagonal
  museum_upper_fresco: [11572, 13997, 13994, 13996, 2718, 7803, 7800, 13823],
  // the lion fountain's recess backdrop came out as shards with broken UVs (black and yellow wedges, two stray sheets):
  // it is cut here and the game puts a verde marble panel in its place (FOUNTAIN_PATCH in MuseumArena)
  museum_bay_fountain: [1777, 14195, 10705, 14199, 372, 374, 846, 849, 1778, 1780, 2199, 2200, 4076, 4078, 5454, 5455, 6302, 6304, 6470, 6729,
    7565, 7566, 7869, 7870, 8266, 8268, 9120, 9122, 9587, 10230, 10620, 10745, 10747, 10804, 10806, 11027, 11028, 11442, 11444, 11908, 11909,
    12754, 12775, 12776, 12777, 12778, 12779, 12780, 12781, 12782, 12783],
};
const dropTriangles = (tris) => (doc) => {
  const drop = new Set(tris);
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices(), I = idx.getArray(), keep = [];
    for (let t = 0; t < I.length / 3; t++) if (!drop.has(t)) keep.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2]);
    idx.setArray(new I.constructor(keep));
  }
};

/**
 * Whole regions to cut, by a test on each triangle's raw-space bounds. The display case ("Gilded Relic Mask") keeps only
 * its wooden base, the case floor, its corner posts and its lid: the opaque painted glass and the mask inside go, and
 * the game builds real glass and puts the mask in (makeDisplayCases in MuseumArena).
 */
const STRIP = {
  display_case: ({ c, mn, mx }) => {
    const corner = Math.abs(c[0]) > 0.16 && Math.abs(c[2]) > 0.16;
    const pane = mx[1] - mn[1] > 0.3 && !corner;
    return pane || (c[1] > -0.215 && c[1] < 0.425 && !corner);
  },
};
const stripTriangles = (test) => (doc) => {
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION').getArray(), idx = prim.getIndices(), I = idx.getArray(), keep = [];
    for (let t = 0; t < I.length / 3; t++) {
      const a = [0, 1, 2].map((k) => [P[I[t * 3 + k] * 3], P[I[t * 3 + k] * 3 + 1], P[I[t * 3 + k] * 3 + 2]]);
      const c = [0, 1, 2].map((i) => (a[0][i] + a[1][i] + a[2][i]) / 3);
      const mn = [0, 1, 2].map((i) => Math.min(a[0][i], a[1][i], a[2][i])), mx = [0, 1, 2].map((i) => Math.max(a[0][i], a[1][i], a[2][i]));
      if (!test({ c, mn, mx })) keep.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2]);
    }
    idx.setArray(new I.constructor(keep));
  }
};

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};
const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;

if (!existsSync(SRC)) { console.error(`No ${SRC}/ folder. Put the raw Meshy GLBs there.`); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const files = readdirSync(SRC).filter((f) => f.toLowerCase().endsWith('.glb') && (!ONLY || basename(f, '.glb') === ONLY));

for (const f of files) {
  const name = basename(f, '.glb').toLowerCase();
  const inPath = join(SRC, f), outPath = join(OUT, `${name}.glb`);
  const doc = await io.read(inPath);
  const base = BIG.has(name) ? 2048 : 1024;
  await doc.transform(
    ...(DROP[name] ? [dropTriangles(DROP[name])] : []),
    ...(STRIP[name] ? [stripTriangles(STRIP[name])] : []),
    dedup(), weld(), prune(),
    // resize losslessly first (PNG) so Basis encodes from clean pixels
    textureCompress({ encoder: sharp, targetFormat: 'png', slots: /^baseColor/, resize: [base, base] }),
    textureCompress({ encoder: sharp, targetFormat: 'png', slots: /^normal/, resize: [1024, 1024] }),
    textureCompress({ encoder: sharp, targetFormat: 'png', slots: /^metallicRoughness/, resize: [512, 512] }),
    ktx2({ slots: /^baseColor/, isUASTC: true, uastcLDRQualityLevel: 2, rdoQualityLevel: 1.5, needSupercompression: true, isPerceptual: true, isSetKTX2SRGBTransferFunc: true, generateMipmap: true, imageDecoder }),
    ktx2({ slots: /^normal/, isUASTC: true, uastcLDRQualityLevel: 2, rdoQualityLevel: 1, needSupercompression: true, isNormalMap: true, isPerceptual: false, generateMipmap: true, imageDecoder }),
    ktx2({ slots: /^metallicRoughness/, isUASTC: false, qualityLevel: 200, compressionLevel: 2, isPerceptual: false, generateMipmap: true, imageDecoder }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(outPath, doc);
  console.log(`${f}: ${mb(statSync(inPath).size)} -> ${mb(statSync(outPath).size)}  => ${outPath}`);
}
