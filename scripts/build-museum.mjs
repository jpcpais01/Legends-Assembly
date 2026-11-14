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
const BIG = new Set(['museum_column_bay', 'museum_wall_niche', 'broken_dome_ring', 'trex_skeleton']);

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
