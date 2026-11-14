#!/usr/bin/env node
/**
 * Builds the stand-in Mickey hero model until João's Meshy model is delivered.
 *
 *   node scripts/build-mickey-standin.mjs   ->  public/models/heroes/mickey.glb
 *
 * The 1928 rubber-hose mouse is modelled from smooth primitives (vertex colors, one material, ~25k triangles),
 * in the same A-pose a Meshy export comes in, then auto-rigged onto the game skeleton with scripts/autorig.mjs.
 * Because every joint is known here, the rig gets them all as explicit landmarks, so the cartoon proportions
 * (big head, thin limbs, huge shoes) never confuse the landmark finder.
 *
 * When the Meshy GLB arrives, drop it in models-src/heroes/mickey.glb and run `npm run models -- --only mickey`:
 * it replaces this file (then bump `?v=` on Mickey's modelUrl).
 */
import { statSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { autoRig } from './autorig.mjs';

const OUT = 'public/models/heroes/mickey.glb';
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// palette (linear-ish sRGB values, the loader treats COLOR_0 as linear)
const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const INK = lin('#0b0b0d');
const INK_SOFT = lin('#16161a');
const CREAM = lin('#f1e7d2');
const SHORTS = lin('#2c2b30');
const BUTTON = lin('#f6f1e6');
const SHOE = lin('#cfc6b4');
const SHOE_SOLE = lin('#7d7466');
const WHITE = lin('#ffffff');
const TONGUE = lin('#6e2a2a');

const parts = [];
/** geometry + placement + color */
function add(geo, color, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], q = null } = {}) {
  const g = geo;
  const m = new THREE.Matrix4().compose(V(...p), q ?? new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), V(...s));
  const out = g.clone();
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k);
  out.applyMatrix4(m);
  const n = out.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!out.index) throw new Error('expected indexed geometry');
  parts.push(out);
}
const sphere = (seg = 32, rings = 22) => new THREE.SphereGeometry(1, seg, rings);
/** tube between two points */
function limb(a, b, r, color, seg = 14) {
  const d = b.clone().sub(a), len = d.length();
  const geo = new THREE.CapsuleGeometry(r, len, 6, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize());
  add(geo, color, { p: a.clone().add(b).multiplyScalar(0.5).toArray(), q });
}
/** ellipsoid whose local y axis points along dir */
function blob(c, radii, dir, color, seg = 24) {
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
  add(sphere(seg, Math.round(seg * 0.7)), color, { p: c.toArray(), q, s: radii });
}

// ── joints (A-pose, left side = +x, facing +z) ──
const J = {
  shoulderL: V(0.14, 1.04, 0), elbowL: V(0.31, 0.87, 0), handL: V(0.465, 0.715, 0),
  hipL: V(0.105, 0.62, 0), kneeL: V(0.12, 0.38, 0.01), footL: V(0.13, 0.135, -0.025), toeL: V(0.13, 0.045, 0.15),
};

// ── legs + shoes ──
for (const sx of [1, -1]) {
  const m = (v) => V(v.x * sx, v.y, v.z);
  limb(m(V(0.108, 0.6, 0)), m(J.kneeL), 0.042, INK);
  limb(m(J.kneeL), m(V(0.13, 0.15, -0.02)), 0.04, INK);
  // big rounded cartoon shoe: toe bulb, heel, a sole rim
  blob(m(V(0.13, 0.085, 0.085)), [0.1, 0.082, 0.155], V(0, 1, 0), SHOE, 32);
  blob(m(V(0.13, 0.09, -0.04)), [0.08, 0.075, 0.08], V(0, 1, 0), SHOE, 24);
  blob(m(V(0.13, 0.03, 0.04)), [0.105, 0.03, 0.2], V(0, 1, 0), SHOE_SOLE, 28);
  // a little highlight bump on the toe (rubber-hose shoes have a shiny cap)
  blob(m(V(0.13, 0.115, 0.17)), [0.055, 0.04, 0.05], V(0, 1, 0), SHOE, 16);
  // shorts leg openings
  add(new THREE.CylinderGeometry(0.075, 0.085, 0.09, 28, 1, true), SHORTS, { p: m(V(0.11, 0.6, 0.005)).toArray() });
}

// ── shorts with two big buttons ──
blob(V(0, 0.71, 0), [0.2, 0.155, 0.17], V(0, 1, 0), SHORTS, 40);
for (const sx of [1, -1]) {
  blob(V(0.075 * sx, 0.745, 0.15), [0.036, 0.05, 0.014], V(0, 1, 0), BUTTON, 20);
  blob(V(0.075 * sx, 0.745, 0.147), [0.042, 0.056, 0.012], V(0, 1, 0), INK_SOFT, 18); // button rim
}

// ── pear-shaped body ──
blob(V(0, 0.93, 0), [0.152, 0.2, 0.142], V(0, 1, 0), INK, 36);
blob(V(0, 1.05, 0), [0.112, 0.1, 0.1], V(0, 1, 0), INK, 28);
limb(V(0, 1.08, 0), V(0, 1.17, 0.01), 0.052, INK);

// ── tail: a thin hose curling up behind ──
{
  const curve = new THREE.CatmullRomCurve3([V(0, 0.68, -0.15), V(0, 0.63, -0.32), V(0, 0.67, -0.47), V(0, 0.8, -0.56), V(0, 0.94, -0.53), V(0, 1.0, -0.45)]);
  add(new THREE.TubeGeometry(curve, 48, 0.014, 8, false), INK);
  blob(V(0, 1.0, -0.45), [0.016, 0.016, 0.016], V(0, 1, 0), INK, 10);
}

// ── arms + bare four-fingered hands (1928: no gloves yet) ──
for (const sx of [1, -1]) {
  const m = (v) => V(v.x * sx, v.y, v.z);
  const sh = m(J.shoulderL), el = m(J.elbowL), wr = m(J.handL);
  blob(sh, [0.06, 0.06, 0.06], V(0, 1, 0), INK, 20);
  limb(sh, el, 0.04, INK);
  limb(el, wr, 0.037, INK);
  const d = wr.clone().sub(el).normalize();
  // palm faces down and in (A-pose); fingers spread forward/back in the hand's plane
  const n = V(-0.707 * sx, -0.707, 0);
  const side = new THREE.Vector3().crossVectors(d, n).normalize();
  const palm = wr.clone().addScaledVector(d, 0.055);
  blob(palm, [0.052, 0.062, 0.03], d, INK, 22);
  // flatten the palm along its normal: rotate an ellipsoid whose thin axis is n
  for (const [k, a] of [[-1, -0.32], [0, 0], [1, 0.32]]) {
    const fd = d.clone().applyAxisAngle(n, a * sx).normalize();
    const base = palm.clone().addScaledVector(d, 0.04).addScaledVector(side, k * 0.026);
    limb(base, base.clone().addScaledVector(fd, 0.065), 0.016, INK, 10);
  }
  const thumbDir = d.clone().multiplyScalar(0.35).addScaledVector(side, -0.95).normalize();
  const tb = palm.clone().addScaledVector(side, -0.035);
  limb(tb, tb.clone().addScaledVector(thumbDir, 0.05), 0.016, INK, 10);
}

// ── head: black dome, cream face mask, long snout, button nose, pie eyes, huge round ears ──
blob(V(0, 1.355, -0.005), [0.2, 0.2, 0.195], V(0, 1, 0), INK, 44);
blob(V(0, 1.31, 0.07), [0.172, 0.178, 0.158], V(0, 1, 0), CREAM, 40);
// widow's peak between the eyes
blob(V(0, 1.43, 0.1), [0.05, 0.07, 0.11], V(0, 1, 0), INK, 20);
// cheeks
for (const sx of [1, -1]) blob(V(0.088 * sx, 1.245, 0.155), [0.072, 0.064, 0.07], V(0, 1, 0), CREAM, 24);
// snout (pointing forward and a touch down)
blob(V(0, 1.272, 0.215), [0.092, 0.15, 0.08], V(0, -0.22, 1), CREAM, 32);
blob(V(0, 1.296, 0.355), [0.05, 0.04, 0.042], V(0, 1, 0), INK, 24); // nose
blob(V(-0.016, 1.31, 0.385), [0.012, 0.009, 0.008], V(0, 1, 0), WHITE, 10); // nose shine
// smile: a black arc under the snout with a little tongue
{
  const arc = Math.PI * 0.62;
  const g = new THREE.TorusGeometry(0.085, 0.0085, 8, 32, arc);
  g.rotateZ(-Math.PI / 2 - arc / 2);
  add(g, INK, { p: [0, 1.255, 0.235], r: [-0.5, 0, 0], s: [1.05, 0.7, 1] });
  blob(V(0, 1.2, 0.262), [0.03, 0.016, 0.014], V(0, 1, 0), TONGUE, 14);
}
// pie-cut eyes: tall black ovals with a wedge of cream cut in, and a speck of light
for (const sx of [1, -1]) {
  const e = V(0.054 * sx, 1.392, 0.197);
  add(sphere(24, 18), INK, { p: e.toArray(), r: [-0.1, 0.28 * sx, 0], s: [0.031, 0.066, 0.02] });
  add(new THREE.CircleGeometry(1, 3, Math.PI * 1.35, Math.PI * 0.32), CREAM, { p: [e.x + 0.004 * sx, e.y + 0.012, e.z + 0.021], r: [-0.1, 0.28 * sx, 0], s: [0.028, 0.05, 1] });
  blob(V(e.x - 0.009 * sx, e.y + 0.03, e.z + 0.018), [0.007, 0.009, 0.004], V(0, 1, 0), WHITE, 10);
}
// ears: big flat discs, tilted out a little
for (const sx of [1, -1]) {
  const ear = new THREE.CylinderGeometry(1, 1, 1, 48, 1);
  add(ear, INK, { p: [0.205 * sx, 1.6, -0.045], r: [Math.PI / 2, 0, 0], s: [0.135, 0.034, 0.135], q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.12, 0, -0.32 * sx, 'ZYX')) });
  // soft rounded rim so the disc doesn't read as a coin
  add(new THREE.TorusGeometry(0.135, 0.017, 10, 48), INK, { p: [0.205 * sx, 1.6, -0.045], q: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0, -0.32 * sx, 'ZYX')) });
}

// ── merge into one mesh ──
const merged = mergeGeometries(parts, false);
merged.computeBoundingBox();
const top = merged.boundingBox.max.y;
const S = 1.8 / top;
const pos = merged.attributes.position.array, nor = merged.attributes.normal.array, col = merged.attributes.color.array;
const nv = pos.length / 3;
const idx = merged.index.array;
console.log(`mickey stand-in: ${Math.round(idx.length / 3).toLocaleString()} triangles, ${top.toFixed(3)} m tall before scaling`);

// ── glTF document ──
const doc = new Document();
const buf = doc.createBuffer();
const prim = doc.createPrimitive()
  .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
  .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buf))
  .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(col)).setBuffer(buf))
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(idx)).setBuffer(buf))
  .setMaterial(doc.createMaterial('mickey_ink').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.42).setMetallicFactor(0));
const mesh = doc.createMesh('mickey').addPrimitive(prim);
const node = doc.createNode('mickey').setMesh(mesh);
doc.createScene('scene').addChild(node);
doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0]);

// every landmark is known: hand them all to the rig (scaled to the 1.8 m the rig normalizes to)
const sc = (v) => [+(v.x * S).toFixed(4), +(v.y * S).toFixed(4), +(v.z * S).toFixed(4)];
const overrides = {
  crotch: 0.565 * S, hipY: 0.62 * S, armpit: 0.98 * S, torsoW: 0.14 * S,
  armR: 0.042 * S, handLen: 0.16 * S,
  headY: 1.165 * S, chinY: 1.14 * S, neckBaseY: 1.1 * S, neckZ: 0.0,
  shoulderL: sc(J.shoulderL), elbowL: sc(J.elbowL), handL: sc(J.handL),
  hipL: sc(J.hipL), kneeL: sc(J.kneeL), footL: sc(J.footL), toeL: sc(J.toeL),
};
await autoRig(doc, { overrides, flip: false });
await MeshoptEncoder.ready;
await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
mkdirSync('public/models/heroes', { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await io.write(OUT, doc);
console.log(`  -> ${OUT} (${(statSync(OUT).size / 1024).toFixed(0)} KB)`);
