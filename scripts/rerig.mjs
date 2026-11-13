#!/usr/bin/env node
/**
 * Re-rigs the game-ready hero GLBs in place (no need for the raw Meshy exports): strips the old skeleton and
 * skin, runs scripts/autorig.mjs again and re-compresses. Textures are left untouched.
 *
 * Usage: npm run rerig [-- --only einstein]
 * Per-hero landmark fixes live in scripts/rig-overrides.json.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, prune, meshopt, transformMesh } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { autoRig } from './autorig.mjs';

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const DIR = arg('dir', 'public/models/heroes');
const ONLY = arg('only', null);
const OV = existsSync('scripts/rig-overrides.json') ? JSON.parse(readFileSync('scripts/rig-overrides.json', 'utf8')) : {};

await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

for (const f of readdirSync(DIR).filter((f) => f.endsWith('.glb') && (!ONLY || basename(f, '.glb') === ONLY))) {
  const path = join(DIR, f), name = basename(f, '.glb');
  const doc = await io.read(path);
  const root = doc.getRoot();
  console.log(`${f}:`);
  // quantized skinned meshes keep their real placement inside the inverse bind matrices: recover it
  const skin = root.listSkins()[0];
  let T = new THREE.Matrix4();
  if (skin) {
    const el = new Array(16);
    skin.getInverseBindMatrices().getElement(0, el);
    T = new THREE.Matrix4().fromArray(skin.listJoints()[0].getWorldMatrix()).multiply(new THREE.Matrix4().fromArray(el));
  }
  await doc.transform(dequantize());
  for (const mesh of root.listMeshes()) transformMesh(mesh, T.toArray());
  await autoRig(doc, { normalize: false, overrides: OV[name] ?? {} });
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(path, doc);
  console.log(`  -> ${path} (${(statSync(path).size / 1048576).toFixed(1)} MB)`);
}
