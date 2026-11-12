#!/usr/bin/env node
/**
 * Shrinks raw Meshy exports into game-ready GLBs.
 *
 *   models-src/heroes/<hero>.glb  ->  public/models/heroes/<hero>.glb
 *
 * - cuts triangles to `--ratio` (default 0.1 = 10x fewer) with meshoptimizer, keeping UVs, normals and skin weights
 * - resizes textures to at most 2K and re-encodes them as WebP
 * - auto-rigs unrigged A/T-pose humanoids onto the game's skeleton (scripts/autorig.mjs)
 * - quantizes + meshopt-compresses geometry (the game's GLTFLoader already has the decoder)
 *
 * Usage: npm run models [-- --ratio 0.1] [-- --only yeat] [-- --rig] [-- --flip]
 */
import { readdirSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, resample, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { autoRig } from './autorig.mjs';

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const RATIO = Number(arg('ratio', '0.1'));
const ONLY = arg('only', null);
const TEX = Number(arg('tex', '2048'));
const SRC = arg('src', 'models-src/heroes');
const OUT = arg('out', 'public/models/heroes');
const FORCE_RIG = args.includes('--rig');
const FLIP = args.includes('--flip') ? true : null;

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

function triangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      n += Math.floor((idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3);
    }
  }
  return n;
}

const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

if (!existsSync(SRC)) { console.error(`No ${SRC}/ folder. Put raw Meshy GLBs there.`); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const files = readdirSync(SRC).filter((f) => f.toLowerCase().endsWith('.glb') && (!ONLY || basename(f, '.glb') === ONLY));
if (!files.length) { console.error(`No .glb files in ${SRC}/`); process.exit(1); }

for (const f of files) {
  const inPath = join(SRC, f);
  const outPath = join(OUT, f.toLowerCase());
  const before = triangles(await io.read(inPath));
  const target = Math.round(before * RATIO);

  // Loosen the error budget until the target count is reached, so flat areas collapse first
  // and silhouettes / detailed parts keep the most triangles.
  let doc, after = before;
  for (const error of [0.002, 0.005, 0.01, 0.02, 0.04, 0.08]) {
    doc = await io.read(inPath);
    await doc.transform(dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error }));
    after = triangles(doc);
    if (after <= target * 1.1) break;
  }

  // Unrigged (or --rig): bind to the game's own skeleton so the procedural animator drives it.
  if (FORCE_RIG || !doc.getRoot().listSkins().length) await autoRig(doc, { flip: FLIP });

  await doc.transform(
    resample(),
    prune(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEX, TEX], quality: 90 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(outPath, doc);
  console.log(`${f}: ${before.toLocaleString()} -> ${after.toLocaleString()} triangles (${(before / Math.max(1, after)).toFixed(1)}x), ${mb(statSync(inPath).size)} -> ${mb(statSync(outPath).size)}  => ${outPath}`);
}
