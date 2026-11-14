#!/usr/bin/env node
/**
 * Builds Steve: the blocky miner, every face painted pixel by pixel.
 *
 *   node scripts/build-steve.mjs [out.glb]   ->  public/models/heroes/steve.glb
 *
 * He is 32 "pixels" tall like the original (8 head, 12 body, 12 legs), scaled so he stands 1.8 m. Every texel is
 * its own little quad with a flat vertex color, so the pixel art stays razor sharp at any distance without a
 * texture (one material, one draw call, ~13k triangles). The arms come in the A-pose a Meshy export uses.
 *
 * The rig is the game's standard 22-bone `la_*` skeleton (scripts/autorig.mjs), so mocap, IK gestures and the
 * weapon grips all work, but the skin weights are written here: blocks stay blocks. Head and torso are rigid,
 * and each limb bends only across a narrow band at the elbow or knee, like a hinge in the block.
 *
 * This is Steve's final model (João's call: blocks built in code look sharper and move better than a scan of
 * them). After changing it, run the script again and bump `?v=` on Steve's modelUrl.
 */
import { statSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { autoRig, RIG_BONES } from './autorig.mjs';

const OUT = process.argv[2] ?? 'public/models/heroes/steve.glb';
const PX = 1.8 / 32;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const B = Object.fromEntries(RIG_BONES.map((n, i) => [n, i]));
const smooth = THREE.MathUtils.smoothstep;

// ── palette (sRGB hex -> linear; COLOR_0 is read as linear) ──
const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const PAL = {
  H: lin('#3b2715'), h: lin('#2a1b0d'), // hair
  S: lin('#d4a585'), s: lin('#c09070'), // skin
  W: lin('#f4f4f4'), I: lin('#4b3d8f'), // eye white, iris
  N: lin('#8c5a43'), M: lin('#4a2a17'), m: lin('#5a3520'), R: lin('#a8625a'), // nose, beard, mouth
  C: lin('#22c0c0'), c: lin('#18a0a0'), // shirt
  P: lin('#4a50c0'), p: lin('#3c41a8'), // jeans
  G: lin('#707070'), g: lin('#5a5a5a'), // shoes
};

// deterministic texel noise so every texel varies a little, like a real hand-made skin
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** A face filled with one or two colors in a speckle. */
const fill = (w, h, a, b = a, p = 0.25) => Array.from({ length: h }, () => Array.from({ length: w }, () => (rnd() < p ? b : a)).join(''));

// ── the skin, face by face (rows top to bottom; front/back as seen from that side; sides start at the front) ──
const HEAD = {
  front: ['HHHhHHHH', 'HHHHHHhH', 'HSSSSSSH', 'SSSSSSSS', 'SWISSIWS', 'sSSNNSSs', 'SSMRRMSS', 'SSMMmMSS'],
  side: ['HHHHHHHH', 'HHHHHHHH', 'SSHHHHHH', 'SSSHhHHH', 'SSSSHHhH', 'SSSSSHHH', 'sSSSSSHH', 'sSSSSSSH'],
  back: ['HHHHHHHH', 'HHhHHHHH', 'HHHHHhHH', 'HHHHHHHH', 'HhHHHHHH', 'HHHHHHhH', 'HHHHHHHH', 'hHHhhHHh'],
  top: fill(8, 8, 'H', 'h', 0.2),
  bottom: fill(8, 8, 'S', 's', 0.3),
};
const BODY = {
  front: ['CCCSSCCC', 'CCCsSCCC', 'CCCCcCCC', ...fill(8, 7, 'C', 'c', 0.14), 'CCCCCcCC', 'PPPPPpPP'],
  side: [...fill(4, 11, 'C', 'c', 0.12), 'PPPP'],
  back: [...fill(8, 11, 'C', 'c', 0.12), 'PPPPPPPP'],
  top: ['CCCCCCCC', 'CCCSSCCC', 'CCCSSCCC', 'CCCCCCCC'],
  bottom: fill(8, 4, 'P', 'p', 0.3),
};
const ARM = {
  front: [...fill(4, 3, 'C', 'c', 0.15), 'cccc', ...fill(4, 8, 'S', 's', 0.18)],
  side: [...fill(4, 3, 'C', 'c', 0.15), 'cccc', ...fill(4, 8, 'S', 's', 0.18)],
  back: [...fill(4, 3, 'C', 'c', 0.15), 'cccc', ...fill(4, 8, 'S', 's', 0.18)],
  top: fill(4, 4, 'C', 'c', 0.2),
  bottom: fill(4, 4, 'S', 's', 0.3),
};
const LEG = {
  front: [...fill(4, 5, 'P', 'p', 0.1), 'PppP', ...fill(4, 4, 'P', 'p', 0.1), 'pppp', 'GgGG'],
  side: [...fill(4, 10, 'P', 'p', 0.12), 'pppp', 'GGgG'],
  back: [...fill(4, 10, 'P', 'p', 0.12), 'pppp', 'gGGG'],
  top: fill(4, 4, 'P', 'p', 0.2),
  bottom: fill(4, 4, 'g', 'G', 0.3),
};

const pos = [], nor = [], col = [], idx = [], wts = [];
/**
 * One box of pixel quads. The box spans [x0, x0+w] x [y0, y0+h] x [z0, z0+d] in pixels (its own frame), `m` places
 * it in the model (metres), and `weigh(x, y, z)` gives its skin weights from a point in the box frame.
 */
function box([x0, y0, z0], [w, h, d], tex, m, weigh) {
  const faces = [
    // origin of texel (0,0) top-left as seen from outside, column axis u, row axis v, normal n
    { t: tex.front, o: [x0, y0 + h, z0 + d], u: [1, 0, 0], v: [0, -1, 0], n: [0, 0, 1], W: w, H: h },
    { t: tex.back, o: [x0 + w, y0 + h, z0], u: [-1, 0, 0], v: [0, -1, 0], n: [0, 0, -1], W: w, H: h },
    { t: tex.side, o: [x0 + w, y0 + h, z0 + d], u: [0, 0, -1], v: [0, -1, 0], n: [1, 0, 0], W: d, H: h },
    { t: tex.side, o: [x0, y0 + h, z0 + d], u: [0, 0, -1], v: [0, -1, 0], n: [-1, 0, 0], W: d, H: h },
    { t: tex.top, o: [x0, y0 + h, z0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0], W: w, H: d },
    { t: tex.bottom, o: [x0, y0, z0 + d], u: [1, 0, 0], v: [0, 0, -1], n: [0, -1, 0], W: w, H: d },
  ];
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const p = V(0, 0, 0), q = V(0, 0, 0);
  for (const f of faces) {
    const n = V(...f.n).applyMatrix3(nm).normalize();
    // keep triangles facing out whatever the axes' handedness
    const flip = V(...f.u).cross(V(...f.v)).dot(V(...f.n)) > 0;
    for (let j = 0; j < f.H; j++) {
      const row = f.t[Math.min(f.t.length - 1, Math.floor((j * f.t.length) / f.H))];
      for (let i = 0; i < f.W; i++) {
        const ch = row[Math.min(row.length - 1, Math.floor((i * row.length) / f.W))];
        const c = PAL[ch] ?? PAL.S;
        const k = 0.9 + rnd() * 0.16;
        const base = pos.length / 3;
        for (const [a, b] of [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]) {
          p.set(f.o[0] + f.u[0] * a + f.v[0] * b, f.o[1] + f.u[1] * a + f.v[1] * b, f.o[2] + f.u[2] * a + f.v[2] * b);
          wts.push(weigh(p.x, p.y, p.z));
          q.copy(p).multiplyScalar(PX).applyMatrix4(m);
          pos.push(q.x, q.y, q.z);
          nor.push(n.x, n.y, n.z);
          col.push(c.r * k, c.g * k, c.b * k);
        }
        if (flip) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
  }
}

const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const A_POSE = Math.PI / 4;

// ── head: rigid ──
box([-4, 24, -4], [8, 8, 8], HEAD, new THREE.Matrix4(), () => [[B.head, 1]]);

// ── torso: pelvis -> chest, kept nearly rigid ──
box([-4, 12, -2], [8, 12, 4], BODY, new THREE.Matrix4(), (_x, y) => {
  const ch = smooth(y, 17, 21), hp = 1 - smooth(y, 13, 16.5);
  return [[B.hips, hp], [B.spine2, Math.max(0, 1 - ch - hp)], [B.chest, ch]];
});

// ── arms: pivot 2 px below the top of the shoulder, hinge at the elbow, the fist is the bottom 2.5 px ──
const ARM_J = { shoulder: 0, elbow: -5, hand: -8, tip: -10 };
const armJoint = (sx, y) => V(0, y, 0).applyMatrix4(new THREE.Matrix4().makeRotationZ(sx * A_POSE)).add(V(6 * sx, 22, 0)).multiplyScalar(PX);
for (const [sd, sx] of [['L', 1], ['R', -1]]) {
  const m = T(6 * sx * PX, 22 * PX, 0).multiply(new THREE.Matrix4().makeRotationZ(sx * A_POSE));
  box([-2, -10, -2], [4, 12, 4], ARM, m, (_x, y) => {
    const el = smooth(y, -5.9, -4.1), hd = smooth(y, -8.6, -7.6);
    return [[B[`shoulder${sd}`], el], [B[`elbow${sd}`], Math.max(0, 1 - el - hd)], [B[`hand${sd}`], hd]];
  });
}

// ── legs: hinge at the knee, the shoe is its own little block ──
for (const [sd, sx] of [['L', 1], ['R', -1]]) {
  box([-2, -12, -2], [4, 12, 4], LEG, T(2 * sx * PX, 12 * PX, 0), (_x, y) => {
    const up = smooth(y, -6.9, -5.1), ft = smooth(y, -10.6, -9.6);
    const hp = smooth(y, -0.6, 0.0);
    return [[B.hips, hp], [B[`hip${sd}`], Math.max(0, up - hp)], [B[`knee${sd}`], Math.max(0, 1 - up - ft)], [B[`foot${sd}`], ft]];
  });
}

const nv = pos.length / 3;
console.log(`steve: ${(idx.length / 3).toLocaleString()} triangles, ${nv.toLocaleString()} vertices`);

// ── glTF document ──
const doc = new Document();
const buf = doc.createBuffer();
const prim = doc.createPrimitive()
  .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
  .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buf))
  .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(col)).setBuffer(buf))
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(idx)).setBuffer(buf))
  .setMaterial(doc.createMaterial('steve_pixels').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.86).setMetallicFactor(0));
doc.createScene('scene').addChild(doc.createNode('steve').setMesh(doc.createMesh('steve').addPrimitive(prim)));
doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0]);

// every joint is known: hand them all to the rig
const j = (v) => [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)];
const overrides = {
  crotch: 12 * PX, hipY: 12 * PX, armpit: 20 * PX, torsoW: 4 * PX,
  armR: 2.4 * PX, handLen: (ARM_J.hand - ARM_J.tip) * PX,
  headY: 24 * PX, chinY: 23.9 * PX, neckBaseY: 23.2 * PX, neckZ: 0,
  hips: [0, 12.5 * PX, 0], spine: [0, 15 * PX, 0], spine2: [0, 18 * PX, 0], chest: [0, 21 * PX, 0], neck: [0, 23.4 * PX, 0], head: [0, 24.2 * PX, 0],
  clavicleL: [1.5 * PX, 22.5 * PX, 0],
  shoulderL: j(armJoint(1, ARM_J.shoulder)), elbowL: j(armJoint(1, ARM_J.elbow)), handL: j(armJoint(1, ARM_J.hand)),
  hipL: [2 * PX, 12 * PX, 0], kneeL: [2 * PX, 6 * PX, 0], footL: [2 * PX, 1.5 * PX, -0.2 * PX], toeL: [2 * PX, 0.4 * PX, 1.8 * PX],
};
await autoRig(doc, { overrides, normalize: false, flip: false });

// ── blocky skin weights (replace the auto-rig's smooth ones) ──
{
  const Jt = new Uint16Array(nv * 4), Wt = new Float32Array(nv * 4);
  for (let i = 0; i < nv; i++) {
    const ws = wts[i].filter(([, w]) => w > 1e-3).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = ws.reduce((s, [, w]) => s + w, 0) || 1;
    ws.forEach(([b, w], k) => { Jt[i * 4 + k] = b; Wt[i * 4 + k] = w / sum; });
  }
  const p = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  p.getAttribute('JOINTS_0').setArray(Jt);
  p.getAttribute('WEIGHTS_0').setArray(Wt);
}

await MeshoptEncoder.ready;
await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
mkdirSync(OUT.replace(/[/][^/]*$/, ''), { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await io.write(OUT, doc);
console.log(`  -> ${OUT} (${(statSync(OUT).size / 1024).toFixed(0)} KB)`);
