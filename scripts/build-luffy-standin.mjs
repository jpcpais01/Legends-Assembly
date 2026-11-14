#!/usr/bin/env node
/**
 * Builds a stand-in Luffy body (vertex-coloured primitives in an A-pose) as an UNRIGGED raw GLB at
 * models-src/heroes/luffy.glb, so it goes through the exact same pipeline as a Meshy export:
 *
 *   node scripts/build-luffy-standin.mjs && npm run models -- --only luffy --ratio 1
 *
 * That auto-rigs it onto the game skeleton, so the stand-in already plays the real motion capture, stretch
 * punches and Gear Fifth. When the Meshy model arrives, drop it at models-src/heroes/luffy.glb instead,
 * run `npm run models -- --only luffy`, and bump ?v= on the hero's modelUrl.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { mkdirSync } from 'node:fs';

const parts = [];
const C = (hex) => new THREE.Color(hex);
const SKIN = C('#e6a777'), RED = C('#c8202a'), RED_D = C('#8e121a'), DENIM = C('#3767b4'), CUFF = C('#f3efe6');
const SASH = C('#f2c230'), STRAW = C('#e9c35b'), STRAW_D = C('#c89b38'), BAND = C('#c41e28'), HAIR = C('#141216');
const DARK = C('#2a1210'), WHITE = C('#fbfbf6'), SANDAL = C('#a8793e'), BTN = C('#f4c430');

function add(geo, color, m = new THREE.Matrix4()) {
  const g = geo; // every primitive used here is indexed
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.applyMatrix4(m);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  parts.push(g);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TRS = (p, q = new THREE.Quaternion(), s = V(1, 1, 1)) => new THREE.Matrix4().compose(p, q, s);
const E = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
/** capsule (or cylinder) from a to b */
function limb(a, b, r, color, { r2 = r, cyl = false, seg = 16 } = {}) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize());
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const geo = cyl || r2 !== r ? new THREE.CylinderGeometry(r2, r, len, seg, 1, false) : new THREE.CapsuleGeometry(r, len, 6, seg);
  add(geo, color, TRS(mid, q));
}
const ball = (p, r, color, s = V(1, 1, 1), q = new THREE.Quaternion(), seg = 18) => add(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7)), color, TRS(p, q, s));

// ── legs: bare shins, denim shorts with rolled fuzzy cuffs, straw sandals ──
for (const sx of [1, -1]) {
  const ank = V(0.115 * sx, 0.075, 0), knee = V(0.112 * sx, 0.47, 0.01), hip = V(0.105 * sx, 0.86, 0);
  limb(ank, knee, 0.047, SKIN, { r2: 0.056 });
  ball(knee, 0.056, SKIN);
  limb(V(0.112 * sx, 0.5, 0.005), hip, 0.08, DENIM, { r2: 0.086, cyl: true });
  add(new THREE.TorusGeometry(0.08, 0.022, 10, 26), CUFF, TRS(V(0.112 * sx, 0.515, 0.005), E(Math.PI / 2, 0, 0), V(1, 1, 1.2)));
  // foot + sandal sole + straps
  ball(V(0.112 * sx, 0.05, 0.05), 0.05, SKIN, V(0.95, 0.6, 1.9));
  add(new THREE.BoxGeometry(0.105, 0.025, 0.27, 2, 1, 4), SANDAL, TRS(V(0.112 * sx, 0.0125, 0.055)));
  add(new THREE.TorusGeometry(0.05, 0.012, 6, 16, Math.PI), SANDAL, TRS(V(0.112 * sx, 0.03, 0.09), E(0, 0, 0), V(1, 0.8, 1)));
  add(new THREE.TorusGeometry(0.048, 0.01, 6, 16, Math.PI), SANDAL, TRS(V(0.112 * sx, 0.03, -0.01), E(0, 0, 0), V(1, 0.8, 1)));
}
// pelvis + sash
add(new THREE.CapsuleGeometry(0.1, 0.13, 6, 18), DENIM, TRS(V(0, 0.9, 0), E(0, 0, Math.PI / 2), V(0.9, 1, 0.95)));
add(new THREE.TorusGeometry(0.15, 0.034, 10, 30), SASH, TRS(V(0, 0.975, 0), E(Math.PI / 2, 0, 0), V(1.05, 0.76, 1)));
ball(V(0.11, 0.965, 0.085), 0.035, SASH, V(1.2, 1, 0.7));
limb(V(0.115, 0.95, 0.1), V(0.14, 0.82, 0.1), 0.022, SASH, { r2: 0.03, cyl: true });
limb(V(0.1, 0.95, 0.1), V(0.105, 0.84, 0.115), 0.02, SASH, { r2: 0.026, cyl: true });

// ── torso: bare chest under an open red vest ──
add(new THREE.CapsuleGeometry(0.135, 0.3, 8, 22), SKIN, TRS(V(0, 1.17, 0), undefined, V(1.18, 1, 0.74)));
// pecs + abs hints and the X scar
ball(V(0.065, 1.29, 0.075), 0.07, SKIN, V(1.1, 0.75, 0.55));
ball(V(-0.065, 1.29, 0.075), 0.07, SKIN, V(1.1, 0.75, 0.55));
for (const a of [0.75, -0.75]) add(new THREE.BoxGeometry(0.008, 0.11, 0.006), RED_D, TRS(V(0, 1.27, 0.112), E(0, 0, a)));
// vest: an open shell (front gap, double-sided material) and a rolled collar
const vestH = 0.4, vestY = 1.2;
add(new THREE.CylinderGeometry(0.168, 0.158, vestH, 28, 1, true, Math.PI * 0.2, Math.PI * 1.6), RED, TRS(V(0, vestY, 0), E(0, 0, 0), V(1.14, 1, 0.78)));
add(new THREE.TorusGeometry(0.15, 0.022, 8, 24, Math.PI * 1.5), RED, TRS(V(0, 1.395, -0.005), E(Math.PI / 2 - 0.25, 0, Math.PI * 0.75), V(1.05, 0.82, 1)));
for (let i = 0; i < 3; i++) ball(V(-0.085, 1.31 - i * 0.075, 0.118 - i * 0.004), 0.011, BTN, V(1, 1, 0.6), undefined, 10);
// shoulders (sleeves are short red caps)
for (const sx of [1, -1]) ball(V(0.19 * sx, 1.36, 0), 0.068, RED);

// ── arms: bare, A-pose 45 degrees, hands flat with fingers together, palms down ──
for (const sx of [1, -1]) {
  const sh = V(0.2 * sx, 1.355, 0), dir = V(0.72 * sx, -0.69, 0.02).normalize();
  const el = sh.clone().addScaledVector(dir, 0.28), wr = el.clone().addScaledVector(dir, 0.255);
  limb(sh.clone().addScaledVector(dir, 0.02), sh.clone().addScaledVector(dir, 0.12), 0.064, RED, { r2: 0.06, cyl: true });
  limb(sh, el, 0.047, SKIN, { r2: 0.042 });
  ball(el, 0.042, SKIN);
  limb(el, wr, 0.041, SKIN, { r2: 0.034 });
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), dir);
  const hand = wr.clone().addScaledVector(dir, 0.055);
  // a loose fist: knuckle block, thumb wrapped across the front
  ball(hand, 0.052, SKIN, V(1, 1.1, 0.85), q);
  ball(hand.clone().addScaledVector(dir, 0.03).add(V(0, 0, 0.02)), 0.038, SKIN, V(1.15, 0.8, 0.9), q, 12);
  ball(wr.clone().addScaledVector(dir, 0.04).add(V(0, 0, 0.04)), 0.017, SKIN, V(1, 1.7, 1), q, 10);
}

// ── head: big grin, scar under the left eye, messy black hair, straw hat ──
limb(V(0, 1.38, 0), V(0, 1.47, 0.005), 0.047, SKIN, { cyl: true });
const HY = 1.565;
ball(V(0, HY, 0.005), 0.118, SKIN, V(0.93, 1.06, 0.98), undefined, 26);
ball(V(0, HY - 0.07, 0.04), 0.075, SKIN, V(1.0, 0.8, 0.95)); // jaw
for (const sx of [1, -1]) {
  ball(V(0.112 * sx, HY - 0.005, -0.005), 0.026, SKIN, V(0.55, 1, 0.8), undefined, 10);
  // eyes: big dark anime eyes with a white catchlight
  ball(V(0.044 * sx, HY + 0.012, 0.103), 0.02, DARK, V(0.85, 1.25, 0.5), undefined, 12);
  ball(V(0.038 * sx, HY + 0.022, 0.111), 0.006, WHITE, V(1, 1, 0.5), undefined, 8);
  // brows
  add(new THREE.BoxGeometry(0.038, 0.007, 0.01), HAIR, TRS(V(0.046 * sx, HY + 0.05, 0.105), E(0, 0, -0.12 * sx)));
}
// grin: a wide white crescent with a dark line
add(new THREE.TorusGeometry(0.048, 0.011, 8, 20, Math.PI), WHITE, TRS(V(0, HY - 0.045, 0.098), E(0, 0, Math.PI), V(1, 0.55, 0.6)));
add(new THREE.TorusGeometry(0.05, 0.004, 6, 20, Math.PI), DARK, TRS(V(0, HY - 0.04, 0.104), E(0, 0, Math.PI), V(1, 0.5, 0.6)));
// the scar under his left eye (screen right when facing him)
add(new THREE.BoxGeometry(0.026, 0.005, 0.006), RED_D, TRS(V(0.045, HY - 0.012, 0.106), E(0, 0, 0.18)));
add(new THREE.BoxGeometry(0.004, 0.012, 0.006), RED_D, TRS(V(0.04, HY - 0.012, 0.107)));
ball(V(0, HY + 0.005, 0.117), 0.013, SKIN, V(1, 1, 0.9), undefined, 10); // nose
// hair: a cap plus tufts poking out from under the hat
ball(V(0, HY + 0.045, -0.015), 0.122, HAIR, V(1, 0.9, 1.02), undefined, 22);
for (let i = 0; i < 22; i++) {
  const a = (i / 22) * Math.PI * 2;
  const front = Math.cos(a);
  if (front > 0.6 && Math.abs(Math.sin(a)) < 0.45) continue;
  const base = V(Math.sin(a) * 0.112, HY + 0.07 - (front < -0.2 ? 0.03 : 0), Math.cos(a) * 0.112 - 0.012);
  const tip = base.clone().add(V(Math.sin(a) * 0.05, -0.04 - (i % 3) * 0.015, Math.cos(a) * 0.04));
  limb(base, tip, 0.028, HAIR, { r2: 0.002, cyl: true, seg: 6 });
}
// bangs over the forehead
for (let i = 0; i < 5; i++) {
  const x = (i - 2) * 0.034, base = V(x, HY + 0.1, 0.085);
  limb(base, base.clone().add(V(x * 0.25, -0.06 - (i % 2) * 0.015, 0.018)), 0.022, HAIR, { r2: 0.002, cyl: true, seg: 6 });
}
// straw hat: crown, band, wide brim (slightly drooped), a rim line
const HAT = HY + 0.11;
add(new THREE.CylinderGeometry(0.112, 0.125, 0.105, 28, 2), STRAW, TRS(V(0, HAT + 0.055, -0.008)));
ball(V(0, HAT + 0.105, -0.008), 0.112, STRAW, V(1, 0.22, 1), undefined, 24);
add(new THREE.CylinderGeometry(0.1275, 0.129, 0.032, 28, 1, true), BAND, TRS(V(0, HAT + 0.02, -0.008)));
add(new THREE.CylinderGeometry(0.255, 0.27, 0.014, 40, 1), STRAW, TRS(V(0, HAT, -0.008)));
add(new THREE.TorusGeometry(0.262, 0.009, 6, 40), STRAW_D, TRS(V(0, HAT - 0.002, -0.008), E(Math.PI / 2, 0, 0)));

const merged = mergeGeometries(parts, false);
const pos = merged.attributes.position.array, nor = merged.attributes.normal.array, col = merged.attributes.color.array;
const idx = merged.index.array;
console.log(`luffy stand-in: ${(idx.length / 3).toLocaleString()} triangles`);

const doc = new Document();
const buf = doc.createBuffer();
const prim = doc.createPrimitive()
  .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
  .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buf))
  .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(col)).setBuffer(buf))
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buf))
  .setMaterial(doc.createMaterial('luffy').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.72).setMetallicFactor(0).setDoubleSided(true));
const mesh = doc.createMesh('luffy').addPrimitive(prim);
doc.createScene('scene').addChild(doc.createNode('luffy').setMesh(mesh));
mkdirSync('models-src/heroes', { recursive: true });
await new NodeIO().write('models-src/heroes/luffy.glb', doc);
console.log('wrote models-src/heroes/luffy.glb');
