#!/usr/bin/env node
/**
 * Custom rig for the T-Rex (public/models/heroes/trex.glb).
 *
 * A dinosaur shares nothing with the game's humanoid `la_*` skeleton, so it gets its own `rex_*` skeleton that
 * src/render/TrexModel.ts animates procedurally (leg IK with digitigrade feet, a swaying tail, neck aim, jaw).
 *
 *  1. scales João's Meshy model to game size (about 5.8 m nose to tail, 2.6 m tall, facing +z, feet on y = 0),
 *  2. places every joint by hand (measured on orthographic renders of the model),
 *  3. writes smooth skin weights from the distance to each bone's segment, gated by region so the legs never pull
 *     the other leg's skin, the arms stay small, and the open mouth splits cleanly into skull and lower jaw.
 *
 * Every bone has an identity rotation in the bind pose, so a bone's local rotation is exactly its deviation from it.
 *
 * Usage: npm run models -- --only trex --norig && node scripts/rig-trex.mjs   (always start from a fresh export)
 */
import { statSync } from 'node:fs';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, prune, meshopt, transformMesh } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const PATH = process.argv[2] ?? 'public/models/heroes/trex.glb';
const SCALE = 3;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// joints in game metres (model faces +z, +x is its left side, feet on y = 0)
export const J = {
  pelvis: [0, 1.8, 0.12], spine1: [0, 1.86, 0.5], spine2: [0, 1.86, 0.9], neck1: [0, 1.88, 1.25], neck2: [0, 1.99, 1.58],
  head: [0, 2.14, 1.86], jaw: [0, 2.04, 1.95], snout: [0, 2.2, 2.85], jawTip: [0, 1.52, 2.66],
  tail1: [0, 1.74, -0.45], tail2: [-0.02, 1.73, -0.9], tail3: [-0.06, 1.75, -1.35], tail4: [-0.14, 1.81, -1.8],
  tail5: [-0.24, 1.81, -2.2], tail6: [-0.3, 1.71, -2.55], tailTip: [-0.36, 1.53, -2.92],
  thighL: [0.42, 1.75, 0.12], shinL: [0.48, 1.1, 0.58], metaL: [0.48, 0.52, 0.21], toeL: [0.52, 0.14, 0.64], tipL: [0.55, 0.05, 0.95],
  thighR: [-0.42, 1.75, 0.12], shinR: [-0.47, 1.07, 0.26], metaR: [-0.42, 0.57, -0.39], toeR: [-0.5, 0.14, -0.26], tipR: [-0.53, 0.05, 0.11],
  armL: [0.36, 1.5, 1.15], foreL: [0.42, 1.28, 1.2], handL: [0.43, 1.05, 1.31], clawL: [0.43, 0.86, 1.33],
  armR: [-0.36, 1.5, 1.15], foreR: [-0.42, 1.28, 1.2], handR: [-0.43, 1.05, 1.31], clawR: [-0.43, 0.86, 1.33],
};

/** name: [parent, segment end (for weights), flesh radius] */
const BONES = {
  pelvis: [null, 'spine1', 0.5],
  spine1: ['pelvis', 'spine2', 0.55], spine2: ['spine1', 'neck1', 0.5], neck1: ['spine2', 'neck2', 0.36], neck2: ['neck1', 'head', 0.3],
  head: ['neck2', 'snout', 0.3], jaw: ['head', 'jawTip', 0.2],
  tail1: ['pelvis', 'tail2', 0.36], tail2: ['tail1', 'tail3', 0.27], tail3: ['tail2', 'tail4', 0.2], tail4: ['tail3', 'tail5', 0.15],
  tail5: ['tail4', 'tail6', 0.11], tail6: ['tail5', 'tailTip', 0.07],
  thighL: ['pelvis', 'shinL', 0.3], shinL: ['thighL', 'metaL', 0.14], metaL: ['shinL', 'toeL', 0.1], toeL: ['metaL', 'tipL', 0.07],
  thighR: ['pelvis', 'shinR', 0.3], shinR: ['thighR', 'metaR', 0.14], metaR: ['shinR', 'toeR', 0.1], toeR: ['metaR', 'tipR', 0.07],
  armL: ['spine2', 'foreL', 0.06], foreL: ['armL', 'handL', 0.05], handL: ['foreL', 'clawL', 0.04],
  armR: ['spine2', 'foreR', 0.06], foreR: ['armR', 'handR', 0.05], handR: ['foreR', 'clawR', 0.04],
};
export const REX_BONES = Object.keys(BONES);
const IDX = Object.fromEntries(REX_BONES.map((n, i) => [n, i]));

await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(PATH);
const root = doc.getRoot();
const scene = root.listScenes()[0];
if (root.listSkins().length) { console.error('trex.glb is already rigged: re-export it first (npm run models -- --only trex --norig)'); process.exit(1); }

// 1) bake the quantization transforms into the vertices, then scale to game size with the feet on the ground
await doc.transform(dequantize());
const meshNodes = root.listNodes().filter((n) => n.getMesh());
for (const n of meshNodes) {
  transformMesh(n.getMesh(), n.getWorldMatrix());
  n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  let p = n.getParentNode();
  while (p) { p.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]); p = p.getParentNode(); }
}
const prims = root.listMeshes().flatMap((m) => m.listPrimitives());
let minY = Infinity;
for (const p of prims) { const a = p.getAttribute('POSITION'), e = [0, 0, 0]; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, e); minY = Math.min(minY, e[1]); } }
const M = new THREE.Matrix4().makeTranslation(0, -minY * SCALE, 0).multiply(new THREE.Matrix4().makeScale(SCALE, SCALE, SCALE));
for (const mesh of root.listMeshes()) transformMesh(mesh, M.toArray());

// 2) segments for the weights
const seg = REX_BONES.map((n) => ({ a: V(...J[n]), b: V(...J[BONES[n][1]]), r: BONES[n][2] }));
const _d = V(0, 0, 0), _q = V(0, 0, 0);
function segDist(p, s) {
  _d.subVectors(s.b, s.a);
  const t = THREE.MathUtils.clamp(_q.subVectors(p, s.a).dot(_d) / _d.lengthSq(), 0, 1);
  return p.distanceTo(_q.copy(s.a).addScaledVector(_d, t));
}
/** The mouth is wide open in the model: the gap between the teeth runs from the hinge forward and down. */
const mouthY = (z) => 2.03 - (z - 1.95) * 0.26;

function candidates(p) {
  const { x, y, z } = p;
  const s = x >= 0 ? 'L' : 'R';
  // the head: skull above the gap, lower jaw below it, the throat behind the hinge blends into the neck
  if (z > 1.95) return y > mouthY(z) ? ['head'] : ['jaw'];
  if (z > 1.55 && y > 1.45) {
    const c = ['neck2', 'neck1'];
    c.push(y > mouthY(z) ? 'head' : 'jaw');
    return c;
  }
  const out = ['pelvis', 'spine1', 'spine2', 'neck1', 'neck2', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6'];
  // tiny arms hang in front of the chest
  if (z > 1.0 && z < 1.5 && y < 1.62 && Math.abs(x) > 0.2) out.push(`arm${s}`, `fore${s}`, `hand${s}`);
  // legs: only this side's, only below the back
  if (z > -0.85 && z < 1.15 && y < 2.0 && Math.abs(x) > 0.08) out.push(`thigh${s}`, `shin${s}`, `meta${s}`, `toe${s}`);
  return out;
}

const P = V(0, 0, 0);
const counts = new Map();
for (const prim of prims) {
  const a = prim.getAttribute('POSITION'), n = a.getCount(), e = [0, 0, 0];
  const Jt = new Uint16Array(n * 4), Wt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    a.getElement(i, e); P.fromArray(e);
    const ws = candidates(P).map((name) => {
      const sgm = seg[IDX[name]];
      const d = Math.max(0, segDist(P, sgm) - sgm.r * 0.7) + 0.04;
      return [IDX[name], 1 / (d * d * d * d)];
    }).sort((p, q) => q[1] - p[1]).slice(0, 3);
    const sum = ws.reduce((s, [, w]) => s + w, 0);
    ws.forEach(([b, w], k) => { Jt[i * 4 + k] = b; Wt[i * 4 + k] = w / sum; });
    counts.set(REX_BONES[ws[0][0]], (counts.get(REX_BONES[ws[0][0]]) ?? 0) + 1);
  }
  const buf = root.listBuffers()[0];
  prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(Jt).setBuffer(buf));
  prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(Wt).setBuffer(buf));
}
console.log('  vertices per main bone:', Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])));

// 3) skeleton: identity rotations, translations relative to the parent joint
const arm = doc.createNode('rex_armature');
scene.addChild(arm);
const nodes = {};
for (const name of REX_BONES) {
  const parent = BONES[name][0];
  const pp = parent ? J[parent] : [0, 0, 0];
  const nd = doc.createNode(`rex_${name}`).setTranslation(J[name].map((v, k) => v - pp[k]));
  nodes[name] = nd;
  (parent ? nodes[parent] : arm).addChild(nd);
}
const ibm = new Float32Array(REX_BONES.length * 16);
REX_BONES.forEach((name, i) => ibm.set(new THREE.Matrix4().makeTranslation(-J[name][0], -J[name][1], -J[name][2]).toArray(), i * 16));
const skin = doc.createSkin('rex_skin').setSkeleton(nodes.pelvis)
  .setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(root.listBuffers()[0]));
for (const name of REX_BONES) skin.addJoint(nodes[name]);
for (const n of meshNodes) n.setSkin(skin);

await doc.transform(prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(PATH, doc);
console.log(`  -> ${PATH} (${(statSync(PATH).size / 1048576).toFixed(1)} MB)`);
