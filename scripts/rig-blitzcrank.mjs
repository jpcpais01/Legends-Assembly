#!/usr/bin/env node
/**
 * Custom rig for Blitzcrank (public/models/heroes/blitzcrank.glb).
 *
 * His Meshy body is nothing like a person: a huge ball of a torso with no neck, short legs set far back, and long
 * arms whose forearms are giant fists hanging forward, bent at the elbow. The generic auto-rig turns him around
 * (his feet point backwards) and can't find his arms, so this script:
 *  1. puts the fists in front (+z) if they aren't,
 *  2. places every joint by hand (measured from the mesh, in metres at the game's 1.8 m scale),
 *  3. builds the standard `la_*` 22-bone skeleton through scripts/autorig.mjs (so mocap, gestures and IK all work),
 *  4. replaces the skin weights with rigid robot parts: the ball torso moves as one piece, each arm is shoulder
 *     pad, upper-arm rod, forearm and fist, each leg is thigh, shin and foot, with short blends at the joints.
 *     Rigid parts are also what make the Rocket Grab read as a telescoping arm: only the forearm stretches,
 *     the fist and shoulder keep their shape.
 *
 * Usage: node scripts/rig-blitzcrank.mjs   (after `npm run models -- --only blitzcrank`; safe to run again)
 */
import { statSync } from 'node:fs';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, prune, meshopt, transformMesh } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { autoRig, RIG_BONES } from './autorig.mjs';

const PATH = process.argv[2] ?? 'public/models/heroes/blitzcrank.glb';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = THREE.MathUtils.smoothstep;

// joints (left side, +x; the right side mirrors). Facing +z, feet at y=0.
const J = {
  hips: [0, 0.6, -0.22], spine: [0, 0.78, -0.2], spine2: [0, 0.95, -0.2], chest: [0, 1.12, -0.2], neck: [0, 1.38, -0.12], head: [0, 1.5, -0.05],
  clavicleL: [0.2, 1.3, -0.16], shoulderL: [0.64, 1.25, -0.16], elbowL: [0.73, 0.8, -0.12], handL: [0.74, 0.5, 0.4],
  hipL: [0.2, 0.52, -0.14], kneeL: [0.24, 0.32, -0.1], footL: [0.25, 0.1, -0.1], toeL: [0.25, 0.03, 0.12],
};
// nothing above the top of the model is "face", so the head never claims the torso
const OVERRIDES = { ...J, chinY: 2.5, headY: 1.5, neckBaseY: 1.38, armR: 0.16, handLen: 0.4 };

await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(PATH);
const root = doc.getRoot();

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
const prims = root.listMeshes().flatMap((m) => m.listPrimitives());

const positions = () => prims.map((p) => { const a = p.getAttribute('POSITION'), e = [0, 0, 0], out = new Float32Array(a.getCount() * 3); for (let i = 0; i < a.getCount(); i++) { a.getElement(i, e); out.set(e, i * 3); } return out; });

// 1) the fists hang in front of him: if they're behind, turn him around
{
  let z = 0, n = 0;
  for (const P of positions()) for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i]) > 0.5 && P[i + 1] < 0.5) { z += P[i + 2]; n++; }
  if (n && z / n < 0) {
    for (const mesh of root.listMeshes()) transformMesh(mesh, new THREE.Matrix4().makeRotationY(Math.PI).toArray());
    console.log('  turned him around (fists were behind)');
  }
}

// 2-3) skeleton through the standard auto-rig, with every joint given
await autoRig(doc, { normalize: false, overrides: OVERRIDES });

// 4) rigid robot weights
const B = Object.fromEntries(RIG_BONES.map((n, i) => [n, i]));
const j3 = (k) => V(...J[k]);
const E = j3('elbowL'), H = j3('handL');
const foreDir = H.clone().sub(E).normalize();
/** The upper-arm rod (left side): x, z of its axis and its radius, between the forearm (y 0.92, the rod's narrowest point) and the shoulder joint inside the pad (so the stretched rod starts right at the pivot instead of leaving a gap). */
const ROD = [0.69, -0.16, 0.14];
const _p = V(0, 0, 0);

/** Weights for one vertex as [[bone, w], ...]. */
function weigh(x, y, z) {
  const s = x >= 0 ? 'L' : 'R', ax = Math.abs(x);
  // the forearms hug the legs and the belly, so near them only geometry in front of the body counts as arm
  const arm = y < 0.15 ? ax > 0.4 : y < 0.8 ? ax > 0.4 || (ax > 0.33 && z > 0.02) : ax > 0.46 || (y < 1 && ax > 0.3 && z > 0.3);
  if (arm) {
    // above the elbow only the slim upper-arm rod rides the shoulder bone (it telescopes during the Rocket Grab);
    // the pad and hoses around it hang from the collarbone and the flank of the ball stays with the chest
    const up = y > 0.92 ? 1 : 0; // a hard joint: a blend here would smear into a sheet when the rod telescopes
    if (up > 0) {
      const rod = y < J.shoulderL[1] && Math.hypot(ax - ROD[0], z - ROD[1]) < ROD[2];
      const top = rod ? B[`shoulder${s}`] : ax < 0.52 && y < 1.11 ? B.chest : B[`clavicle${s}`];
      return [[top, up], [B[`elbow${s}`], 1 - up]];
    }
    // the forearm, then the fist past the wrist plane
    const t = _p.set(ax, y, z).sub(H).dot(foreDir);
    const fist = smooth(t, -0.03, 0.03);
    return [[B[`elbow${s}`], 1 - fist], [B[`hand${s}`], fist]];
  }
  if (y < 0.5) {
    // legs: thigh, shin, foot
    const thigh = smooth(y, 0.31, 0.35), foot = 1 - smooth(y, 0.11, 0.15);
    const hips = smooth(y, 0.46, 0.5);
    return [[B.hips, hips], [B[`hip${s}`], thigh - hips], [B[`knee${s}`], 1 - thigh - foot], [B[`foot${s}`], foot]];
  }
  // pelvis, then the ball torso as one rigid piece
  const ch = smooth(y, 0.66, 0.8);
  return [[B.hips, 1 - ch], [B.chest, ch]];
}

/** Arm parts move away from the body (and the rod telescopes), so faces bridging the two are dropped. */
const ARM = new Set(['shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR'].map((n) => B[n]));
const BODY = new Set(['chest', 'hips', 'clavicleL', 'clavicleR'].map((n) => B[n]));
const counts = new Map();
for (const p of prims) {
  const a = p.getAttribute('POSITION'), n = a.getCount(), e = [0, 0, 0];
  const Jt = new Uint16Array(n * 4), Wt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    a.getElement(i, e);
    const ws = weigh(e[0], e[1], e[2]).filter(([, w]) => w > 1e-3).sort((p, q) => q[1] - p[1]).slice(0, 4);
    const sum = ws.reduce((s, [, w]) => s + w, 0) || 1;
    ws.forEach(([b, w], k) => { Jt[i * 4 + k] = b; Wt[i * 4 + k] = w / sum; });
    counts.set(RIG_BONES[ws[0][0]], (counts.get(RIG_BONES[ws[0][0]]) ?? 0) + 1);
  }
  p.getAttribute('JOINTS_0').setArray(Jt);
  p.getAttribute('WEIGHTS_0').setArray(Wt);
  // Meshy fuses touching parts with long hairline triangles. Invisible at rest, they turn into spikes once the
  // parts they bridge move apart, so drop the ones that span two rigid parts.
  const ix = p.getIndices(), arr = ix.getArray(), keep = [];
  const pa = V(0, 0, 0), pb = V(0, 0, 0), pc = V(0, 0, 0), u = V(0, 0, 0), w = V(0, 0, 0);
  let dropped = 0;
  for (let t = 0; t < arr.length; t += 3) {
    const [i0, i1, i2] = [arr[t], arr[t + 1], arr[t + 2]];
    const mixed = Jt[i0 * 4] !== Jt[i1 * 4] || Jt[i0 * 4] !== Jt[i2 * 4];
    if (mixed) {
      a.getElement(i0, e); pa.fromArray(e); a.getElement(i1, e); pb.fromArray(e); a.getElement(i2, e); pc.fromArray(e);
      const L = Math.max(pa.distanceTo(pb), pb.distanceTo(pc), pc.distanceTo(pa));
      const area = u.subVectors(pb, pa).cross(w.subVectors(pc, pa)).length() / 2;
      if (L > 0.1 || (L > 0.03 && area < 0.04 * L * L)) { dropped++; continue; }
      // the arm rod slides out of the pad during the Rocket Grab and the forearms swing clear of the ball: faces
      // joining an arm part to the body would stretch into fins, and the pad hides the small holes they leave
      const set = new Set([Jt[i0 * 4], Jt[i1 * 4], Jt[i2 * 4]]);
      if ([...set].some((b) => ARM.has(b)) && [...set].some((b) => BODY.has(b))) { dropped++; continue; }
    }
    keep.push(i0, i1, i2);
  }
  ix.setArray(new Uint32Array(keep));
  console.log(`  dropped ${dropped} hairline triangles between parts`);
}
console.log('  rigid parts (vertices per main bone):', Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])));

await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(PATH, doc);
console.log(`  -> ${PATH} (${(statSync(PATH).size / 1048576).toFixed(1)} MB)`);
