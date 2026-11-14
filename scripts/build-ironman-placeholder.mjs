#!/usr/bin/env node
/**
 * Builds a stand-in Iron Man GLB out of code-made armour plates, then auto-rigs it exactly like a Meshy export,
 * so the motion-capture animator, IK gestures and everything else run on him from day one.
 *
 *   node scripts/build-ironman-placeholder.mjs  ->  public/models/heroes/ironman.glb
 *
 * When João's Meshy model lands, drop it in models-src/heroes/ironman.glb and run `npm run models -- --only ironman`
 * instead (and bump the ?v= on IRONMAN.modelUrl).
 *
 * The suit is modelled at 1.8 m, feet on y=0, facing +z, in an A-pose with the arms 45 degrees out.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsEmissiveStrength } from '@gltf-transform/extensions';
import { prune, dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { autoRig } from './autorig.mjs';

const OUT = process.argv[2] ?? 'public/models/heroes/ironman.glb';
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** parts per material */
const parts = { red: [], gold: [], dark: [], glow: [], silver: [] };
const add = (mat, geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], quat = null } = {}) => {
  const m = new THREE.Matrix4().compose(V(...pos), quat ?? new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), V(...scale));
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  g.applyMatrix4(m);
  parts[mat].push(g);
};
/** a part laid along a segment a->b (its local +y axis) */
const along = (mat, geo, a, b, { scale = [1, 1, 1], twist = 0 } = {}) => {
  const d = b.clone().sub(a);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize());
  if (twist) q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), twist));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  add(mat, geo, { pos: mid.toArray(), quat: q, scale: [scale[0], d.length() * scale[1], scale[2]] });
};
/** tapered, softly capped tube of unit length along y (radius r0 at the bottom, r1 at the top) */
const tube = (r0, r1, seg = 28) => {
  const pts = [];
  const n = 8;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(r0 * Math.sin(a), -0.5 + (1 - Math.cos(a)) * r0 * 0.5)); }
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(r1 * Math.cos(a), 0.5 - r1 * 0.5 + Math.sin(a) * r1 * 0.5)); }
  return new THREE.LatheGeometry(pts, seg);
};
const ball = (r = 1, w = 28, h = 20) => new THREE.SphereGeometry(r, w, h);
/** rounded box */
const rbox = (w, h, d, r = 0.015) => {
  const s = new THREE.Shape();
  const x = w / 2 - r, y = h / 2 - r;
  s.moveTo(-x, -h / 2); s.lineTo(x, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -y); s.lineTo(w / 2, y); s.quadraticCurveTo(w / 2, h / 2, x, h / 2);
  s.lineTo(-x, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, y); s.lineTo(-w / 2, -y); s.quadraticCurveTo(-w / 2, -h / 2, -x, -h / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - r * 2, bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.6, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -(d - r * 2) / 2);
  return g;
};
const ring = (r, t, seg = 32) => new THREE.TorusGeometry(r, t, 8, seg);
const disc = (r, h, seg = 32) => new THREE.CylinderGeometry(r, r, h, seg);

// ───────── legs ─────────
for (const s of [1, -1]) {
  const x = 0.115 * s;
  // boot: sole, toe cap, heel thruster ring
  add('dark', rbox(0.115, 0.03, 0.27, 0.01), { pos: [x, 0.015, 0.035] });
  add('red', rbox(0.11, 0.075, 0.2, 0.03), { pos: [x, 0.065, 0.055] });
  add('gold', rbox(0.1, 0.05, 0.08, 0.02), { pos: [x, 0.07, 0.15], rot: [-0.35, 0, 0] });
  add('red', tube(0.06, 0.068), { pos: [x, 0.13, -0.005], scale: [1, 0.12, 1.08] });
  add('glow', disc(0.028, 0.006), { pos: [x, 0.0005, -0.03] });
  // shin + calf plates
  along('red', tube(0.056, 0.07), V(x, 0.12, 0), V(x * 0.98, 0.48, 0), { scale: [1, 1, 1.05] });
  add('gold', rbox(0.06, 0.24, 0.03, 0.012), { pos: [x, 0.3, 0.06], rot: [-0.05, 0, 0] });
  add('dark', ring(0.064, 0.01), { pos: [x, 0.2, 0], rot: [Math.PI / 2, 0, 0] });
  // knee
  add('dark', ball(0.066), { pos: [x * 0.98, 0.5, 0] });
  add('gold', ball(0.05, 20, 14), { pos: [x * 0.98, 0.51, 0.04], scale: [1, 1.1, 0.7] });
  // thigh
  along('red', tube(0.072, 0.095), V(x * 0.98, 0.52, 0), V(x * 0.95, 0.92, -0.005));
  add('gold', rbox(0.07, 0.2, 0.03, 0.012), { pos: [x * 0.97 + 0.012 * s, 0.73, 0.07], rot: [0.05, 0, 0] });
  add('dark', ring(0.088, 0.008), { pos: [x * 0.96, 0.86, 0], rot: [Math.PI / 2, 0, 0] });
}

// ───────── pelvis, waist, torso ─────────
add('red', ball(1), { pos: [0, 0.95, 0], scale: [0.17, 0.1, 0.115] });
add('gold', rbox(0.11, 0.08, 0.03, 0.012), { pos: [0, 0.93, 0.105], rot: [0.12, 0, 0] });
add('dark', tube(0.12, 0.125), { pos: [0, 1.06, 0], scale: [1.2, 0.16, 0.85] });
// abdomen bands
for (let i = 0; i < 3; i++) add(i === 1 ? 'red' : 'gold', rbox(0.2 - i * 0.004, 0.045, 0.05, 0.015), { pos: [0, 1.02 + i * 0.052, 0.085 + i * 0.004], rot: [-0.06, 0, 0] });
// chest shell (wider at the shoulders) + pecs + collar
add('red', ball(1, 36, 24), { pos: [0, 1.29, 0], scale: [0.2, 0.19, 0.13] });
add('red', ball(1, 30, 20), { pos: [0, 1.36, -0.01], scale: [0.235, 0.12, 0.125] });
for (const s of [1, -1]) add('red', rbox(0.15, 0.12, 0.05, 0.03), { pos: [0.075 * s, 1.33, 0.1], rot: [-0.15, 0.25 * s, 0.08 * s] });
add('gold', rbox(0.17, 0.035, 0.06, 0.015), { pos: [0, 1.44, 0.075], rot: [-0.4, 0, 0] });
// back pack + flaps
add('red', rbox(0.24, 0.24, 0.07, 0.03), { pos: [0, 1.3, -0.12] });
for (const s of [1, -1]) add('gold', rbox(0.08, 0.16, 0.025, 0.01), { pos: [0.065 * s, 1.27, -0.16], rot: [0.12, 0.2 * s, 0] });
// arc reactor: housing, glowing core, bright ring
add('silver', disc(0.05, 0.03), { pos: [0, 1.3, 0.13], rot: [Math.PI / 2, 0, 0] });
add('glow', disc(0.036, 0.02), { pos: [0, 1.3, 0.145], rot: [Math.PI / 2, 0, 0] });
add('silver', ring(0.04, 0.007), { pos: [0, 1.3, 0.15] });
// neck
add('dark', tube(0.055, 0.05), { pos: [0, 1.52, -0.005], scale: [1, 0.1, 1] });

// ───────── helmet ─────────
const HY = 1.645;
// red shell, a little taller than wide, the jaw narrowing toward the chin
add('red', ball(1, 36, 26), { pos: [0, HY + 0.005, -0.015], scale: [0.098, 0.118, 0.112] });
add('red', ball(1, 28, 20), { pos: [0, HY - 0.06, 0.005], scale: [0.08, 0.06, 0.09] });
// curved gold faceplate: the front of an ellipsoid, set just proud of the shell
add('gold', new THREE.SphereGeometry(1, 32, 24, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.2, Math.PI * 0.58), { pos: [0, HY - 0.012, 0.0], scale: [0.092, 0.118, 0.112] });
// brow ridge and chin
add('gold', rbox(0.1, 0.018, 0.03, 0.008), { pos: [0, HY + 0.035, 0.1], rot: [0.25, 0, 0] });
add('gold', ball(1, 20, 14), { pos: [0, HY - 0.088, 0.065], scale: [0.04, 0.025, 0.035] });
for (const s of [1, -1]) {
  // narrow glowing eye slits, angled up and out, following the faceplate
  add('glow', rbox(0.04, 0.011, 0.014, 0.004), { pos: [0.032 * s, HY + 0.012, 0.106], rot: [0, 0.32 * s, -0.14 * s] });
  // cheek vents and ear discs
  add('red', rbox(0.02, 0.07, 0.04, 0.008), { pos: [0.075 * s, HY - 0.04, 0.06], rot: [0.1, 0.55 * s, 0] });
  add('silver', disc(0.028, 0.016), { pos: [0.094 * s, HY - 0.005, -0.01], rot: [0, 0, Math.PI / 2] });
}
add('dark', rbox(0.045, 0.005, 0.01, 0.002), { pos: [0, HY - 0.055, 0.108], rot: [0.15, 0, 0] }); // mouth line
// collar ring hiding the neck
add('red', tube(0.075, 0.07), { pos: [0, 1.5, 0], scale: [1.15, 0.07, 1] });

// ───────── arms (A-pose, 45 degrees) ─────────
for (const s of [1, -1]) {
  const sh = V(0.215 * s, 1.415, 0);
  const d = V(0.7071 * s, -0.7071, 0);
  const el = sh.clone().addScaledVector(d, 0.285);
  const wr = el.clone().addScaledVector(d, 0.255);
  const tip = wr.clone().addScaledVector(d, 0.17);
  // pauldron
  add('red', ball(1, 28, 20), { pos: sh.clone().add(V(0.025 * s, 0.025, 0)).toArray(), scale: [0.085, 0.07, 0.09], rot: [0, 0, -0.5 * s] });
  add('gold', ring(0.075, 0.01), { pos: sh.clone().add(V(0.05 * s, -0.01, 0)).toArray(), rot: [0, Math.PI / 2, 0.78 * s] });
  // upper arm, elbow, forearm gauntlet
  along('red', tube(0.054, 0.064), el, sh.clone().addScaledVector(d, 0.04));
  add('dark', ball(0.052), { pos: el.toArray() });
  along('gold', tube(0.056, 0.05), wr.clone().addScaledVector(d, -0.01), el.clone().addScaledVector(d, 0.02));
  along('red', rbox(0.05, 1, 0.07, 0.015), wr.clone().addScaledVector(d, -0.03), el.clone().addScaledVector(d, 0.07), { scale: [1, 0.8, 1] });
  add('dark', ring(0.05, 0.008), { pos: wr.toArray(), quat: new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d) });
  // hand: palm block, finger block, thumb, glowing repulsor facing down/in
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), d);
  const palmC = wr.clone().addScaledVector(d, 0.055);
  add('red', rbox(0.09, 0.1, 0.035, 0.012), { pos: palmC.toArray(), quat: q });
  add('red', rbox(0.085, 0.08, 0.028, 0.01), { pos: wr.clone().addScaledVector(d, 0.135).toArray(), quat: q });
  const n = V(-0.7071 * s, -0.7071, 0); // palm normal: palms face down
  // thumb sits on the forward side of the palm
  add('red', rbox(0.025, 0.06, 0.025, 0.008), { pos: palmC.clone().add(V(0, 0, 0.05)).addScaledVector(d, 0.01).toArray(), quat: q });
  add('glow', disc(0.022, 0.008), { pos: palmC.clone().addScaledVector(n, 0.019).toArray(), quat: new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n) });
  void tip;
}

// ───────── document ─────────
const doc = new Document();
const buffer = doc.createBuffer();
const MATS = {
  red: { color: [0.52, 0.035, 0.03, 1], metal: 0.85, rough: 0.3 },
  gold: { color: [0.86, 0.6, 0.26, 1], metal: 1, rough: 0.26 },
  dark: { color: [0.07, 0.07, 0.08, 1], metal: 0.7, rough: 0.45 },
  silver: { color: [0.75, 0.76, 0.8, 1], metal: 1, rough: 0.22 },
  glow: { color: [0.75, 0.95, 1, 1], metal: 0, rough: 0.4, emissive: [0.62, 0.92, 1], strength: 6 },
};
const ext = doc.createExtension(KHRMaterialsEmissiveStrength);
const mesh = doc.createMesh('ironman');
for (const [name, list] of Object.entries(parts)) {
  if (!list.length) continue;
  let g = mergeGeometries(list.map((x) => { for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal') x.deleteAttribute(k); return x; }));
  g = mergeVertices(g, 1e-5);
  g.computeVertexNormals();
  const spec = MATS[name];
  const mat = doc.createMaterial(name).setBaseColorFactor(spec.color).setMetallicFactor(spec.metal).setRoughnessFactor(spec.rough);
  if (spec.emissive) mat.setEmissiveFactor(spec.emissive).setExtension('KHR_materials_emissive_strength', ext.createEmissiveStrength().setEmissiveStrength(spec.strength));
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.attributes.position.array)).setBuffer(buffer);
  const nor = doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.attributes.normal.array)).setBuffer(buffer);
  const idx = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(g.index.array)).setBuffer(buffer);
  mesh.addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('NORMAL', nor).setIndices(idx).setMaterial(mat));
}
const node = doc.createNode('ironman').setMesh(mesh);
doc.createScene('scene').addChild(node);

await autoRig(doc, { flip: false });
await MeshoptEncoder.ready;
await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await io.write(OUT, doc);
let tris = 0;
for (const p of mesh.listPrimitives()) tris += p.getIndices().getCount() / 3;
console.log(`ironman placeholder: ${tris} triangles -> ${OUT}`);
