/**
 * Auto-rig for A-pose / T-pose humanoids (e.g. unrigged Meshy exports).
 *
 * Bakes the model to 1.8 m tall, feet at y=0, facing +z, finds anatomical landmarks from mesh cross-sections
 * (leg split, armpits, arm axes, neck, chin) and binds it to the game's 22-bone skeleton (`la_<name>`), which has
 * the same topology as the motion-capture library (spine x3, neck, head, collarbones, arms, legs, toes), so clips
 * retarget bone for bone.
 *
 * Skin weights come from distances measured THROUGH the body (a voxel solid of the mesh), so a sleeve hanging
 * next to the torso or two trouser legs never borrow each other's bones, the torso bones are wide sheets rather
 * than thin lines, and everything above the chin is bound rigidly to the head, so faces, hair and hats keep their shape.
 *
 * Per-model fixes go in `overrides` (see scripts/rig-overrides.json): any landmark in metres at 1.8 m scale.
 */
import * as THREE from 'three';
import { clearNodeTransform, flatten, transformMesh } from '@gltf-transform/functions';

export const RIG_BONES = [
  'hips', 'spine', 'spine2', 'chest', 'neck', 'head',
  'clavicleL', 'clavicleR', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR',
  'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR', 'toeL', 'toeR',
];
const PARENT = {
  hips: null, spine: 'hips', spine2: 'spine', chest: 'spine2', neck: 'chest', head: 'neck',
  clavicleL: 'chest', clavicleR: 'chest', shoulderL: 'clavicleL', shoulderR: 'clavicleR',
  elbowL: 'shoulderL', elbowR: 'shoulderR', handL: 'elbowL', handR: 'elbowR',
  hipL: 'hips', hipR: 'hips', kneeL: 'hipL', kneeR: 'hipR', footL: 'kneeL', footR: 'kneeR', toeL: 'footL', toeR: 'footR',
};
/** Limb bones point their -Y axis at this child, so "rotation 0" means the limb hangs straight down. */
const AIM = { shoulderL: 'elbowL', shoulderR: 'elbowR', elbowL: 'handL', elbowR: 'handR', hipL: 'kneeL', hipR: 'kneeR', kneeL: 'footL', kneeR: 'footR' };

const H = 1.8;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

function readVec3(acc) {
  const n = acc.getCount();
  const out = new Float32Array(n * 3);
  const el = [0, 0, 0];
  for (let i = 0; i < n; i++) { acc.getElement(i, el); out[i * 3] = el[0]; out[i * 3 + 1] = el[1]; out[i * 3 + 2] = el[2]; }
  return out;
}

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @param {{ height?: number, flip?: boolean|null, normalize?: boolean, overrides?: Record<string, number>, log?: Function }} opts
 *   normalize=false keeps the mesh where it is (already 1.8 m, on the ground, facing +z)
 */
export async function autoRig(doc, { height = H, flip = null, normalize = true, overrides = {}, log = console.log } = {}) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const meshNodes = root.listNodes().filter((n) => n.getMesh());
  for (const n of root.listNodes()) if (n.getSkin()) n.setSkin(null);
  for (const s of root.listSkins()) s.dispose();
  for (const a of root.listAnimations()) a.dispose();
  for (const n of root.listNodes()) if (/^la_/.test(n.getName())) n.dispose();

  // 1) bake every node transform into its mesh so all geometry lives in one space
  await flatten()(doc);
  for (const n of meshNodes) clearNodeTransform(n);
  const meshes = [...new Set(meshNodes.map((n) => n.getMesh()))];
  const prims = meshes.flatMap((m) => m.listPrimitives());

  // 2) normalize: height -> 1.8 m, feet on y=0, centered on x/z
  if (normalize) {
    const bb = new THREE.Box3();
    for (const p of prims) {
      const a = readVec3(p.getAttribute('POSITION'));
      for (let i = 0; i < a.length; i += 3) bb.expandByPoint(V(a[i], a[i + 1], a[i + 2]));
    }
    const s = height / Math.max(1e-6, bb.max.y - bb.min.y);
    const c = bb.getCenter(V(0, 0, 0));
    const m = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-c.x, -bb.min.y, -c.z));
    for (const mesh of meshes) transformMesh(mesh, m.toArray());
  }

  // all positions + triangles in one soup
  let P, TI;
  const gather = () => {
    const all = [], tris = [];
    let base = 0;
    for (const p of prims) {
      const a = readVec3(p.getAttribute('POSITION'));
      all.push(a);
      const n = a.length / 3, ix = p.getIndices();
      if (ix) { const arr = ix.getArray(); for (let i = 0; i < arr.length; i++) tris.push(arr[i] + base); }
      else for (let i = 0; i < n; i++) tris.push(i + base);
      base += n;
    }
    P = new Float32Array(base * 3);
    let o = 0; for (const a of all) { P.set(a, o); o += a.length; }
    TI = Uint32Array.from(tris);
  };
  gather();

  /** Cross-section at height y as x-sorted blobs: { x0, x1, z0, z1, cx, cz, len } (centroids weighted by outline length). */
  const blobsAt = (y, gap = 0.006) => {
    const segs = [];
    const pts = [];
    const edge = (i, j, di, dj) => {
      if ((di > 0) === (dj > 0)) return;
      const t = di / (di - dj);
      pts.push(P[i] + (P[j] - P[i]) * t, P[i + 2] + (P[j + 2] - P[i + 2]) * t);
    };
    for (let t = 0; t < TI.length; t += 3) {
      const a = TI[t] * 3, b = TI[t + 1] * 3, c = TI[t + 2] * 3;
      const da = P[a + 1] - y || 1e-9, db = P[b + 1] - y || 1e-9, dc = P[c + 1] - y || 1e-9;
      if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) continue;
      pts.length = 0;
      edge(a, b, da, db); edge(b, c, db, dc); edge(c, a, dc, da);
      if (pts.length === 4) segs.push([pts[0], pts[1], pts[2], pts[3]]);
    }
    segs.sort((p, q) => Math.min(p[0], p[2]) - Math.min(q[0], q[2]));
    const out = [];
    for (const s of segs) {
      const x0 = Math.min(s[0], s[2]), x1 = Math.max(s[0], s[2]), z0 = Math.min(s[1], s[3]), z1 = Math.max(s[1], s[3]);
      const len = Math.hypot(s[2] - s[0], s[3] - s[1]) + 1e-6;
      const l = out[out.length - 1];
      if (l && x0 <= l.x1 + gap) {
        l.x1 = Math.max(l.x1, x1); l.z0 = Math.min(l.z0, z0); l.z1 = Math.max(l.z1, z1);
        l.sx += (s[0] + s[2]) * 0.5 * len; l.sz += (s[1] + s[3]) * 0.5 * len; l.len += len;
      } else out.push({ x0, x1, z0, z1, sx: (s[0] + s[2]) * 0.5 * len, sz: (s[1] + s[3]) * 0.5 * len, len });
    }
    for (const b of out) { b.cx = b.sx / b.len; b.cz = b.sz / b.len; }
    return out.filter((b) => b.len > 0.02);
  };
  const central = (bl) => bl.find((b) => b.x0 <= 0.005 && b.x1 >= -0.005) ?? null;

  // 3) facing: toes stick out in front of the ankles
  if (normalize) {
    const foot = blobsAt(0.02 * H), ank = blobsAt(0.1 * H);
    const cz = (bl) => bl.reduce((s, b) => s + b.cz * b.len, 0) / Math.max(1e-6, bl.reduce((s, b) => s + b.len, 0));
    let back = foot.length && ank.length ? cz(foot) < cz(ank) : false;
    if (flip !== null) back = flip;
    if (back) {
      const r = new THREE.Matrix4().makeRotationY(Math.PI);
      for (const mesh of meshes) transformMesh(mesh, r.toArray());
      gather();
      log('  autorig: model faced -z, turned it around');
    }
  }

  // 4) landmarks from a stack of cross-sections
  const STEP = 0.005 * H;
  const prof = [];
  for (let y = STEP; y < H; y += STEP) prof.push({ y, bl: blobsAt(y) });
  const at = (y) => prof[clamp(Math.round(y / STEP) - 1, 0, prof.length - 1)];

  // legs: two blobs until they merge
  let merge = 0.47 * H;
  for (const s of prof) {
    if (s.y < 0.2 * H) continue;
    if (central(s.bl)) { merge = s.y; break; }
  }
  // armpits: the central blob suddenly widens where the arms join it
  let armpit = 0.64 * H, torsoW = 0.11 * H;
  {
    const ws = [];
    for (const s of prof) {
      if (s.y < merge + 0.08 * H) continue;
      const c = central(s.bl);
      if (!c) continue;
      const w = (c.x1 - c.x0) / 2;
      if (ws.length >= 6 && w > median(ws) * 1.3) { armpit = s.y; break; }
      ws.push(w);
    }
    // torso width just under the arms
    const top = ws.slice(-Math.max(4, Math.floor(ws.length * 0.35)));
    if (top.length) torsoW = median(top);
  }
  armpit = overrides.armpit ?? armpit;
  torsoW = overrides.torsoW ?? torsoW;

  // crotch: where the legs merge, unless a coat hem hides it (the merged outline is suddenly deeper / wider than the legs)
  let crotch = merge;
  {
    const below = at(merge - 0.03 * H).bl.filter((b) => Math.abs(b.cx) < 0.2 * H), c = central(at(merge + STEP).bl);
    const hem = c && below.length >= 2 && ((c.z1 - c.z0) - Math.max(...below.map((b) => b.z1 - b.z0)) > 0.05 || (c.x1 - c.x0) - (Math.max(...below.map((b) => b.x1)) - Math.min(...below.map((b) => b.x0))) > 0.05);
    if (hem || merge < 0.5 * armpit || merge > 0.72 * armpit) crotch = 0.63 * armpit;
    if (hem) log('  autorig: coat hem hides the leg split, estimating the crotch');
  }
  crotch = overrides.crotch ?? crotch;

  const hipY = overrides.hipY ?? crotch + 0.05 * H;
  const ankleY = overrides.ankleY ?? 0.05 * H;
  const legBlob = (y, sign) => {
    const bl = at(y).bl.filter((b) => b.cx * sign > 0.01 && Math.abs(b.cx) < 0.22 * H && b.len > 0.1);
    if (bl.length) return bl.sort((p, q) => q.len - p.len)[0];
    // above the split: half of the merged outline
    const c = central(at(y).bl);
    return c ? { cx: sign * (c.x1 - c.x0) / 4, cz: c.cz, x0: 0, x1: 0, z0: c.z0, z1: c.z1 } : { cx: sign * 0.06 * H, cz: 0, z0: -0.1, z1: 0.1 };
  };
  const legs = {};
  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    const top = legBlob(Math.min(crotch - 0.04 * H, merge - 0.02 * H), sign);
    const kneeY = (hipY + ankleY) / 2 + 0.01 * H;
    const kn = legBlob(kneeY, sign), an = legBlob(ankleY + 0.04, sign), sole = legBlob(0.02 * H, sign);
    const hipX = clamp(Math.abs(top.cx) * 0.9, 0.04 * H, 0.075 * H);
    const heel = sole.z0, tip = sole.z1;
    legs[side] = {
      hip: V(sign * hipX, hipY, top.cz), knee: V(kn.cx, kneeY, kn.cz), ankle: V(an.cx, ankleY, an.cz),
      ball: V(an.cx + (sole.cx - an.cx) * 0.6, 0.018 * H, heel + (tip - heel) * 0.72), tip: V(sole.cx, 0.012 * H, tip), heel,
    };
  }

  // arms: fit an axis through the sleeve, the shoulder joint sits on it above the armpit
  const arms = {};
  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    let tip = null, best = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      const y = P[i + 1];
      if (y < crotch - 0.25 * H || y > armpit + 0.25 * H) continue;
      const v = P[i] * sign;
      if (v > best) { best = v; tip = V(P[i], y, P[i + 2]); }
    }
    const pit = V(sign * torsoW, armpit, 0);
    if (!tip || best < torsoW * 1.3) {
      // arms down along the body: no separate sleeve to measure
      const sh = V(sign * torsoW * 0.85, armpit + 0.06 * H, 0), t = V(sign * torsoW * 1.05, crotch - 0.05 * H, 0);
      arms[side] = { shoulder: sh, elbow: sh.clone().lerp(t, 0.43), wrist: sh.clone().lerp(t, 0.77), tip: t, r: 0.045 * H };
      continue;
    }
    const a0 = tip.clone().sub(V(pit.x, pit.y + 0.05 * H, tip.z)).normalize();
    const o = V(pit.x, pit.y + 0.05 * H, tip.z), total = tip.clone().sub(o).dot(a0);
    // centroids of the sleeve along the rough axis (only geometry clearly outside the torso)
    const bins = new Map(), q = V(0, 0, 0);
    for (let i = 0; i < P.length; i += 3) {
      if (P[i] * sign < torsoW + 0.02) continue;
      q.set(P[i] - o.x, P[i + 1] - o.y, P[i + 2] - o.z);
      const t = q.dot(a0);
      if (t < total * 0.12 || t > total * 0.7 || q.addScaledVector(a0, -t).length() > 0.12 * H) continue;
      const k = Math.floor(t / 0.02);
      const b = bins.get(k) ?? { n: 0, x: 0, y: 0, z: 0 };
      b.n++; b.x += P[i]; b.y += P[i + 1]; b.z += P[i + 2];
      bins.set(k, b);
    }
    const cs = [...bins.values()].filter((b) => b.n > 20).map((b) => V(b.x / b.n, b.y / b.n, b.z / b.n));
    let axis = a0, mid = o.clone().addScaledVector(a0, total * 0.4);
    if (cs.length >= 4) {
      // least-squares line through the centroids (principal direction)
      mid = cs.reduce((s, c) => s.add(c), V(0, 0, 0)).multiplyScalar(1 / cs.length);
      const d = V(0, 0, 0);
      for (const c of cs) { const r = c.clone().sub(mid); d.addScaledVector(r, Math.sign(r.dot(a0)) || 1); }
      axis = d.normalize();
    }
    // sleeve radius around the fitted axis
    const radii = [];
    for (let i = 0; i < P.length; i += 3) {
      if (P[i] * sign < torsoW + 0.02) continue;
      q.set(P[i] - mid.x, P[i + 1] - mid.y, P[i + 2] - mid.z);
      const t = q.dot(axis);
      if (Math.abs(t) > total * 0.2) continue;
      radii.push(q.addScaledVector(axis, -t).length());
    }
    const r = clamp(radii.length ? median(radii) : 0.04 * H, 0.025 * H, 0.06 * H);
    // shoulder joint: the axis point above the armpit crease, then a little further into the body
    const tp = pit.clone().sub(mid).dot(V(axis.x, axis.y, 0)) / Math.max(1e-6, axis.x * axis.x + axis.y * axis.y);
    const sh = mid.clone().addScaledVector(axis, tp - 0.9 * r);
    const hand = tip.clone().sub(mid); const tt = hand.dot(axis);
    const end = mid.clone().addScaledVector(axis, tt); // fingertip projected on the axis
    arms[side] = { shoulder: sh, elbow: sh.clone().lerp(end, 0.43), wrist: sh.clone().lerp(end, 0.765), tip: end, r };
  }
  // symmetric skeleton: average the two sides (keeps clips from limping on slightly lopsided meshes)
  const symPair = (a, b) => { const x = (a.x - b.x) / 2, y = (a.y + b.y) / 2, z = (a.z + b.z) / 2; a.set(x, y, z); b.set(-x, y, z); };
  for (const k of ['shoulder', 'elbow', 'wrist', 'tip']) symPair(arms.L[k], arms.R[k]);
  for (const k of ['hip', 'knee', 'ankle', 'ball', 'tip']) symPair(legs.L[k], legs.R[k]);
  arms.L.r = arms.R.r = (arms.L.r + arms.R.r) / 2;
  const shY = arms.L.shoulder.y;

  // neck and chin: above the shoulders the outline narrows to the neck, then the head begins
  let neckY = shY + 0.2, neckW = 0.09;
  {
    let start = null;
    for (const s of prof) {
      if (s.y < shY + 0.05) continue;
      const c = central(s.bl);
      if (!c) continue;
      const w = (c.x1 - c.x0) / 2;
      if (start === null && w <= 0.072 * H) start = s.y;
      if (start !== null && s.y <= start + 0.09) { if (w < neckW - 0.004) { neckW = w; neckY = s.y; } }
      else if (start !== null) break;
    }
    if (start === null) log('  autorig: no clear neck found, guessing');
  }
  // head pivot at the top of the neck; everything above the chin line moves rigidly with the head
  const headY = overrides.headY ?? neckY + 0.02;
  const chinY = overrides.chinY ?? headY - 0.015;
  const neckBaseY = overrides.neckBaseY ?? shY + 0.6 * (headY - shY);
  const zc = (y) => { const c = central(at(y).bl); return c ? c.cz : 0; };
  const zHips = zc(hipY + 0.04), zChest = zc(armpit - 0.03), zNeck = overrides.neckZ ?? zc(headY - 0.02) - 0.01;
  const pelvisY = hipY + 0.02;
  const spineAt = (f) => V(0, pelvisY + (neckBaseY - pelvisY) * f, zHips + (zChest - zHips) * Math.min(1, f / 0.7));

  const joints = {
    hips: V(0, pelvisY, zHips), spine: spineAt(0.24), spine2: spineAt(0.455), chest: spineAt(0.7),
    neck: V(0, neckBaseY, (zChest + zNeck) / 2), head: V(0, headY, zNeck),
    shoulderL: arms.L.shoulder, elbowL: arms.L.elbow, handL: arms.L.wrist,
    shoulderR: arms.R.shoulder, elbowR: arms.R.elbow, handR: arms.R.wrist,
    hipL: legs.L.hip, kneeL: legs.L.knee, footL: legs.L.ankle, toeL: legs.L.ball,
    hipR: legs.R.hip, kneeR: legs.R.knee, footR: legs.R.ankle, toeR: legs.R.ball,
  };
  for (const [sd, sign] of [['L', 1], ['R', -1]]) {
    const sh = joints[`shoulder${sd}`];
    joints[`clavicle${sd}`] = V(sign * 0.022 * H, neckBaseY - 0.035, sh.z + 0.015);
  }
  // explicit joint overrides: "<bone>": [x, y, z] (left side; the right side mirrors unless given)
  for (const [k, v] of Object.entries(overrides)) {
    if (!Array.isArray(v) || !joints[k]) continue;
    joints[k].set(v[0], v[1], v[2]);
    const m = k.endsWith('L') ? k.slice(0, -1) + 'R' : null;
    if (m && !overrides[m]) joints[m].set(-v[0], v[1], v[2]);
  }
  for (const sd of ['L', 'R']) {
    // keep the helper landmarks consistent with overridden joints
    arms[sd].shoulder = joints[`shoulder${sd}`]; arms[sd].elbow = joints[`elbow${sd}`]; arms[sd].wrist = joints[`hand${sd}`];
    legs[sd].hip = joints[`hip${sd}`]; legs[sd].knee = joints[`knee${sd}`]; legs[sd].ankle = joints[`foot${sd}`]; legs[sd].ball = joints[`toe${sd}`];
    // thin cartoon arms: the sleeve fit can't measure them, so a model may give the radius and hand length outright
    if (overrides.armR) arms[sd].r = overrides.armR;
    if (overrides.handLen) arms[sd].tip = arms[sd].wrist.clone().add(arms[sd].wrist.clone().sub(arms[sd].elbow).normalize().multiplyScalar(overrides.handLen));
  }

  // how far the arms must stay from vertical so the sleeve clears the body (bulky jackets, coats)
  let armMin = 0;
  {
    const sh = arms.L.shoulder, L = sh.distanceTo(arms.L.tip), r = arms.L.r;
    const bodyW = (y) => { const c = central(at(y).bl); return c && y < armpit ? c.x1 : 0; };
    for (let th = 0; th < 0.6; th += 0.01) {
      let ok = true;
      for (let t = 0.3; t <= 0.8 && ok; t += 0.05) {
        const x = sh.x + Math.sin(th) * L * t, y = sh.y - Math.cos(th) * L * t;
        if (x - r * 0.85 < bodyW(y)) ok = false;
      }
      if (ok) { armMin = th; break; }
      armMin = th;
    }
  }

  // 5) skeleton (three.js objects -> local transforms + inverse bind matrices)
  const bones = {};
  const armature = new THREE.Object3D();
  const down = V(0, -1, 0);
  const worldQ = {};
  for (const name of RIG_BONES) {
    const b = new THREE.Bone(); b.name = `la_${name}`; bones[name] = b;
    const parent = PARENT[name];
    (parent ? bones[parent] : armature).add(b);
    const child = AIM[name];
    const wq = child ? new THREE.Quaternion().setFromUnitVectors(down, joints[child].clone().sub(joints[name]).normalize()) : new THREE.Quaternion();
    if (name === 'handL' || name === 'handR') wq.copy(worldQ[parent]);
    worldQ[name] = wq;
    const pq = parent ? worldQ[parent] : new THREE.Quaternion();
    const pp = parent ? joints[parent] : V(0, 0, 0);
    const inv = pq.clone().invert();
    b.position.copy(joints[name].clone().sub(pp).applyQuaternion(inv));
    b.quaternion.copy(inv.multiply(wq));
  }
  armature.updateMatrixWorld(true);

  // 6) skin weights
  const neckR = neckW + 0.03;
  const W = skinWeights(P, TI, {
    joints, arms, legs, torsoW, crotch, chinY, neckR, top: H, beardZ: overrides.beardZ,
    halfW: (y) => { const c = central(at(y).bl); return c && y < armpit ? (c.x1 - c.x0) / 2 : torsoW; },
    log,
  });
  let base = 0;
  for (const p of prims) {
    const n = p.getAttribute('POSITION').getCount();
    const buf = root.listBuffers()[0] ?? doc.createBuffer();
    p.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(W.J.slice(base * 4, (base + n) * 4)).setBuffer(buf));
    p.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(W.W.slice(base * 4, (base + n) * 4)).setBuffer(buf));
    base += n;
  }

  // 7) write the skeleton into the glTF
  const gNodes = {};
  const gArm = doc.createNode('la_armature').setExtras({ laRig: 2, armMin: +armMin.toFixed(3), armR: +arms.L.r.toFixed(3), torsoW: +torsoW.toFixed(3), heel: +legs.L.heel.toFixed(3), toeTip: +legs.L.tip.z.toFixed(3) });
  scene.addChild(gArm);
  for (const name of RIG_BONES) {
    const b = bones[name];
    const gn = doc.createNode(b.name).setTranslation(b.position.toArray()).setRotation(b.quaternion.toArray());
    gNodes[name] = gn;
    (PARENT[name] ? gNodes[PARENT[name]] : gArm).addChild(gn);
  }
  const ibm = new Float32Array(RIG_BONES.length * 16);
  RIG_BONES.forEach((name, i) => ibm.set(bones[name].matrixWorld.clone().invert().toArray(), i * 16));
  const skin = doc.createSkin('la_skin').setSkeleton(gNodes.hips)
    .setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(root.listBuffers()[0]));
  for (const name of RIG_BONES) skin.addJoint(gNodes[name]);
  for (const n of meshNodes) n.setSkin(skin);

  const f = (v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
  log(`  autorig: crotch ${crotch.toFixed(2)} (legs split ${merge.toFixed(2)}), armpit ${armpit.toFixed(2)}, torso half-width ${torsoW.toFixed(2)}, neck ${neckY.toFixed(2)} (w ${neckW.toFixed(2)}), chin line ${chinY.toFixed(2)}`);
  log(`  autorig: shoulder ${f(arms.L.shoulder)}, elbow ${f(arms.L.elbow)}, wrist ${f(arms.L.wrist)}, tip ${f(arms.L.tip)}, sleeve r ${arms.L.r.toFixed(3)}, arm clearance ${armMin.toFixed(2)} rad`);
  log(`  autorig: hip ${f(legs.L.hip)}, knee ${f(legs.L.knee)}, ankle ${f(legs.L.ankle)}, ball ${f(legs.L.ball)}`);
  return { joints, crotch, torsoW, armpit, neckY, chinY, armMin };
}

// ───────────────────────── skin weights ─────────────────────────

/** Min-heap of (key, value) pairs on typed arrays. */
class Heap {
  constructor(cap) { this.k = new Float32Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(key, val) {
    if (this.n === this.k.length) { const k = new Float32Array(this.n * 2); k.set(this.k); this.k = k; const v = new Int32Array(this.n * 2); v.set(this.v); this.v = v; }
    let i = this.n++;
    const K = this.k, Vv = this.v;
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= key) break; K[i] = K[p]; Vv[i] = Vv[p]; i = p; }
    K[i] = key; Vv[i] = val;
  }
  pop() {
    const K = this.k, Vv = this.v, top = Vv[0];
    this.topKey = K[0];
    const key = K[--this.n], val = Vv[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && K[c + 1] < K[c]) c++;
      if (K[c] >= key) break;
      K[i] = K[c]; Vv[i] = Vv[c]; i = c;
    }
    K[i] = key; Vv[i] = val;
    return top;
  }
}

function skinWeights(P, TI, { joints, arms, legs, chinY, neckR, top, halfW, beardZ, log }) {
  const NV = P.length / 3, NB = RIG_BONES.length;
  const vs = H / 150;
  const bb = new THREE.Box3();
  for (let i = 0; i < P.length; i += 3) bb.expandByPoint(V(P[i], P[i + 1], P[i + 2]));
  const ox = bb.min.x - 2.5 * vs, oy = bb.min.y - 2.5 * vs, oz = bb.min.z - 2.5 * vs;
  const nx = Math.ceil((bb.max.x - ox) / vs) + 3, ny = Math.ceil((bb.max.y - oy) / vs) + 3, nz = Math.ceil((bb.max.z - oz) / vs) + 3;
  const N = nx * ny * nz, sxy = nx * ny;
  const vox = (x, y, z) => Math.floor((x - ox) / vs) + Math.floor((y - oy) / vs) * nx + Math.floor((z - oz) / vs) * sxy;

  // surface voxels
  const grid = new Uint8Array(N); // 1 = surface, 2 = outside, 0 = inside (after the flood)
  for (let t = 0; t < TI.length; t += 3) {
    const a = TI[t] * 3, b = TI[t + 1] * 3, c = TI[t + 2] * 3;
    const e = Math.max(
      Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]),
      Math.hypot(P[b] - P[c], P[b + 1] - P[c + 1], P[b + 2] - P[c + 2]),
      Math.hypot(P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]));
    const n = Math.max(1, Math.ceil(e / (vs * 0.45)));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n, w = 1 - u - v;
      grid[vox(P[a] * u + P[b] * v + P[c] * w, P[a + 1] * u + P[b + 1] * v + P[c + 1] * w, P[a + 2] * u + P[b + 2] * v + P[c + 2] * w)] = 1;
    }
  }
  // flood the outside from the grid border
  {
    const stack = new Int32Array(N); let sp = 0;
    const push = (i) => { if (grid[i] === 0) { grid[i] = 2; stack[sp++] = i; } };
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) push(x + y * nx + z * sxy);
    while (sp) {
      const i = stack[--sp], x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / sxy);
      if (x > 0) push(i - 1); if (x < nx - 1) push(i + 1);
      if (y > 0) push(i - nx); if (y < ny - 1) push(i + nx);
      if (z > 0) push(i - sxy); if (z < nz - 1) push(i + sxy);
    }
  }
  let nSolid = 0; for (let i = 0; i < N; i++) if (grid[i] !== 2) nSolid++;
  const solid = (i) => grid[i] !== 2;

  // bone shapes: limbs are lines, torso bones are sheets across the body (their surface is evenly far from them)
  const line = (a, b) => { const out = []; const n = Math.max(1, Math.ceil(a.distanceTo(b) / (vs * 0.5))); for (let i = 0; i <= n; i++) out.push(a.clone().lerp(b, i / n)); return out; };
  const sheet = (a, b, k) => {
    const out = [];
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / (vs * 0.5)));
    for (let i = 0; i <= n; i++) {
      const c = a.clone().lerp(b, i / n), hw = halfW(c.y) * k;
      for (let x = -hw; x <= hw; x += vs * 0.5) out.push(V(x, c.y, c.z));
    }
    return out;
  };
  const J = joints;
  const shape = {
    hips: sheet(V(0, legs.L.hip.y, J.hips.z), J.spine, 0.55), spine: sheet(J.spine, J.spine2, 0.55), spine2: sheet(J.spine2, J.chest, 0.55),
    chest: [...sheet(J.chest, V(0, arms.L.shoulder.y, J.chest.z), 0.5), ...line(V(0, arms.L.shoulder.y, J.chest.z), J.neck)],
    neck: line(J.neck, J.head), head: line(J.head, V(0, top - 0.05, J.head.z)),
  };
  for (const sd of ['L', 'R']) {
    shape[`clavicle${sd}`] = line(J[`clavicle${sd}`], J[`shoulder${sd}`]);
    shape[`shoulder${sd}`] = line(arms[sd].shoulder, arms[sd].elbow);
    shape[`elbow${sd}`] = line(arms[sd].elbow, arms[sd].wrist);
    shape[`hand${sd}`] = line(arms[sd].wrist, arms[sd].tip);
    shape[`hip${sd}`] = line(legs[sd].hip, legs[sd].knee);
    shape[`knee${sd}`] = line(legs[sd].knee, legs[sd].ankle);
    shape[`foot${sd}`] = line(legs[sd].ankle, legs[sd].ball);
    shape[`toe${sd}`] = line(legs[sd].ball, legs[sd].tip);
  }

  // 26-neighbourhood
  const nbr = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) nbr.push([dx + dy * nx + dz * sxy, Math.hypot(dx, dy, dz) * vs, dx, dy, dz]);
  const CUT = 0.62;
  const D = RIG_BONES.map(() => new Float32Array(N).fill(Infinity));
  const heap = new Heap(1 << 16);
  let outside = 0;
  RIG_BONES.forEach((name, b) => {
    const d = D[b];
    heap.n = 0;
    for (const p of shape[name]) {
      let i = vox(p.x, p.y, p.z), d0 = 0;
      if (i < 0 || i >= N) continue;
      if (!solid(i)) {
        // joint guessed slightly outside the body: start from the closest solid voxel
        outside++;
        const x0 = i % nx, y0 = Math.floor(i / nx) % ny, z0 = Math.floor(i / sxy);
        let best = Infinity, bi = -1;
        const R = 6;
        for (let z = Math.max(0, z0 - R); z <= Math.min(nz - 1, z0 + R); z++) for (let y = Math.max(0, y0 - R); y <= Math.min(ny - 1, y0 + R); y++) for (let x = Math.max(0, x0 - R); x <= Math.min(nx - 1, x0 + R); x++) {
          const k = x + y * nx + z * sxy;
          if (!solid(k)) continue;
          const dd = Math.hypot(x - x0, y - y0, z - z0);
          if (dd < best) { best = dd; bi = k; }
        }
        if (bi < 0) continue;
        i = bi; d0 = best * vs;
      }
      if (d0 < d[i]) { d[i] = d0; heap.push(d0, i); }
    }
    while (heap.n) {
      const i = heap.pop(), di = heap.topKey;
      if (di > d[i] || di > CUT) continue;
      const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / sxy);
      if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) continue;
      for (let k = 0; k < 26; k++) {
        const j = i + nbr[k][0];
        if (grid[j] === 2) continue;
        const nd = di + nbr[k][1];
        if (nd < d[j]) { d[j] = nd; heap.push(nd, j); }
      }
    }
  });

  // per-vertex distances -> weights
  const w = new Float32Array(NV * NB);
  const POW = 4, EPS = vs * 0.6;
  let orphans = 0;
  const dist = new Float32Array(NB);
  // how much closer (through the body) each vertex is to the head than to the upper torso
  const headLead = new Float32Array(NV);
  const HB = RIG_BONES.indexOf('head'), TB = ['chest', 'clavicleL', 'clavicleR', 'spine2'].map((n) => RIG_BONES.indexOf(n));
  for (let v = 0; v < NV; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const ix = Math.floor((x - ox) / vs), iy = Math.floor((y - oy) / vs), iz = Math.floor((z - oz) / vs);
    dist.fill(Infinity);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = (ix + dx) + (iy + dy) * nx + (iz + dz) * sxy;
      if (grid[i] === 2) continue;
      const off = Math.hypot(ox + (ix + dx + 0.5) * vs - x, oy + (iy + dy + 0.5) * vs - y, oz + (iz + dz + 0.5) * vs - z);
      for (let b = 0; b < NB; b++) { const dd = D[b][i] + off; if (dd < dist[b]) dist[b] = dd; }
    }
    let sum = 0;
    for (let b = 0; b < NB; b++) if (dist[b] < Infinity) { const ww = 1 / (dist[b] + EPS) ** POW; w[v * NB + b] = ww; sum += ww; }
    headLead[v] = Math.min(...TB.map((b) => dist[b])) - dist[HB];
    if (!Number.isFinite(headLead[v])) headLead[v] = dist[HB] < Infinity ? 1 : -1;
    if (sum === 0) {
      // a floating island the body solid never reaches (loose hair strand, chain): straight-line distances
      orphans++;
      const q = V(x, y, z);
      for (let b = 0; b < NB; b++) {
        let best = Infinity;
        for (const p of shape[RIG_BONES[b]]) best = Math.min(best, p.distanceToSquared(q));
        const ww = 1 / (Math.sqrt(best) + EPS) ** POW; w[v * NB + b] = ww; sum += ww;
      }
    }
    for (let b = 0; b < NB; b++) w[v * NB + b] /= sum;
  }

  // weld by position so UV seams get identical weights, then relax along the surface
  const key = new Map(), wid = new Int32Array(NV);
  let nw = 0;
  for (let v = 0; v < NV; v++) {
    const k = `${Math.round(P[v * 3] * 5000)},${Math.round(P[v * 3 + 1] * 5000)},${Math.round(P[v * 3 + 2] * 5000)}`;
    let id = key.get(k);
    if (id === undefined) { id = nw++; key.set(k, id); }
    wid[v] = id;
  }
  const adj = Array.from({ length: nw }, () => new Set());
  for (let t = 0; t < TI.length; t += 3) {
    const a = wid[TI[t]], b = wid[TI[t + 1]], c = wid[TI[t + 2]];
    if (a !== b) { adj[a].add(b); adj[b].add(a); }
    if (b !== c) { adj[b].add(c); adj[c].add(b); }
    if (c !== a) { adj[c].add(a); adj[a].add(c); }
  }
  let ww = new Float32Array(nw * NB), w2 = new Float32Array(nw * NB);
  for (let v = 0; v < NV; v++) for (let b = 0; b < NB; b++) ww[wid[v] * NB + b] = w[v * NB + b];
  for (let it = 0; it < 3; it++) {
    for (let i = 0; i < nw; i++) {
      const n = adj[i].size;
      for (let b = 0; b < NB; b++) {
        let s = 0;
        for (const j of adj[i]) s += ww[j * NB + b];
        w2[i * NB + b] = n ? ww[i * NB + b] * 0.5 + (s / n) * 0.5 : ww[i * NB + b];
      }
    }
    [ww, w2] = [w2, ww];
  }

  // anatomical rules, then keep the 4 strongest bones
  const HEAD = RIG_BONES.indexOf('head'), NECK = RIG_BONES.indexOf('neck');
  const Jout = new Uint8Array(NV * 4), Wout = new Float32Array(NV * 4);
  const row = new Float32Array(NB), order = RIG_BONES.map((_, i) => i);
  const nz0 = J.head.z, band = 0.03;
  for (let v = 0; v < NV; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    for (let b = 0; b < NB; b++) row[b] = ww[wid[v] * NB + b];
    // head: rigid above the chin line; below it the head lets go quickly (collars and scarves stay with the body)
    // (a raised collar or hood reaches above the chin but hangs from the shoulders: it is not part of the head)
    // a long beard or chin strap resting on the chest is still face: with a `beardZ` override, whatever sits in
    // front of that depth around the chin line belongs to the head however close the chest is through the body
    const own = beardZ !== undefined && y > chinY - band && z > beardZ ? 1 : smooth(headLead[v], -0.02, 0.04);
    const hk = smooth(y, chinY - band, chinY) * own;
    row[HEAD] *= smooth(y, chinY - band * 2.2, chinY - band * 0.4) * own;
    // neck: only what is close to the neck column
    row[NECK] *= 1 - smooth(Math.hypot(x, z - nz0), neckR, neckR + 0.06);
    let sum = 0; for (let b = 0; b < NB; b++) sum += row[b];
    if (sum < 1e-9) { row[RIG_BONES.indexOf('chest')] = 1; sum = 1; }
    for (let b = 0; b < NB; b++) row[b] = (row[b] / sum) * (1 - hk);
    row[HEAD] += hk;
    order.sort((p, q) => row[q] - row[p]);
    let s4 = 0, kept = 0;
    for (let j = 0; j < 4; j++) { const b = order[j]; if (row[b] < 0.015 && j > 0) break; Jout[v * 4 + kept] = b; Wout[v * 4 + kept] = row[b]; s4 += row[b]; kept++; }
    for (let j = 0; j < kept; j++) Wout[v * 4 + j] /= s4;
  }
  log(`  autorig: ${nx}x${ny}x${nz} voxels (${Math.round((nSolid / N) * 100)}% solid), ${orphans} loose vertices${outside ? `, ${outside} bone samples outside the body` : ''}`);
  return { J: Jout, W: Wout };
}
