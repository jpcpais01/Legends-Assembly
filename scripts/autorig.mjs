/**
 * Auto-rig for A-pose / T-pose humanoids (e.g. unrigged Meshy exports).
 *
 * Bakes the model to 1.8 m tall, feet at y=0, facing +z, finds anatomical landmarks from mesh
 * slices (crotch, legs, hands, torso width, neck) and binds it to the SAME 17-bone skeleton the
 * game's procedural animator drives (bone names `la_<name>`), so every Meshy hero gets the walk,
 * aim, attack, cast, levitate and death animations for free.
 */
import * as THREE from 'three';
import { clearNodeTransform, flatten, transformMesh } from '@gltf-transform/functions';

export const RIG_BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR',
  'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR',
];
const PARENT = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  shoulderL: 'chest', shoulderR: 'chest', elbowL: 'shoulderL', elbowR: 'shoulderR', handL: 'elbowL', handR: 'elbowR',
  hipL: 'hips', hipR: 'hips', kneeL: 'hipL', kneeR: 'hipR', footL: 'kneeL', footR: 'kneeR',
};

const H = 1.8;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function readVec3(acc) {
  const n = acc.getCount();
  const out = new Float32Array(n * 3);
  const el = [0, 0, 0];
  for (let i = 0; i < n; i++) { acc.getElement(i, el); out[i * 3] = el[0]; out[i * 3 + 1] = el[1]; out[i * 3 + 2] = el[2]; }
  return out;
}

/** @param {import('@gltf-transform/core').Document} doc */
export function autoRig(doc, { height = H, flip = null, log = console.log } = {}) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  // 1) bake every node transform into its mesh so all geometry lives in one space
  const meshNodes = root.listNodes().filter((n) => n.getMesh());
  for (const n of root.listNodes()) if (n.getSkin()) n.setSkin(null);
  for (const s of root.listSkins()) s.dispose();
  for (const a of root.listAnimations()) a.dispose();

  // flatten() moves mesh nodes to the scene root; then clear their transforms (bakes into vertices)
  return flatten()(doc).then(() => {
    for (const n of meshNodes) clearNodeTransform(n);
    const meshes = [...new Set(meshNodes.map((n) => n.getMesh()))];
    const prims = meshes.flatMap((m) => m.listPrimitives());

    // 2) normalize: height -> 1.8 m, feet on y=0, centered on x/z
    const bb = new THREE.Box3();
    for (const p of prims) {
      const a = readVec3(p.getAttribute('POSITION'));
      for (let i = 0; i < a.length; i += 3) bb.expandByPoint(V(a[i], a[i + 1], a[i + 2]));
    }
    const s = height / Math.max(1e-6, bb.max.y - bb.min.y);
    const c = bb.getCenter(V(0, 0, 0));
    const m = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-c.x, -bb.min.y, -c.z));
    for (const mesh of meshes) transformMesh(mesh, m.toArray());

    // gather all positions + triangles (slices cut triangles, so sparse long tubes still register)
    let all = [];
    const tris = [];
    let base = 0;
    for (const p of prims) {
      const a = readVec3(p.getAttribute('POSITION'));
      all.push(a);
      const n = a.length / 3;
      const ix = p.getIndices();
      if (ix) { const arr = ix.getArray(); for (let i = 0; i < arr.length; i++) tris.push(arr[i] + base); }
      else for (let i = 0; i < n; i++) tris.push(i + base);
      base += n;
    }
    const P = new Float32Array(base * 3);
    { let o = 0; for (const a of all) { P.set(a, o); o += a.length; } }
    all = null;
    const TI = Uint32Array.from(tris);
    tris.length = 0;

    /** Cross-section of the surface at height y: flat list of segment endpoints [x0,y,z0, x1,y,z1, ...]. */
    const sliceSegs = (y) => {
      const out = [];
      const pts = [];
      const edge = (i, j, di, dj) => {
        if ((di > 0) === (dj > 0)) return;
        const t = di / (di - dj);
        pts.push(P[i] + (P[j] - P[i]) * t, y, P[i + 2] + (P[j + 2] - P[i + 2]) * t);
      };
      for (let t = 0; t < TI.length; t += 3) {
        const a = TI[t] * 3, b = TI[t + 1] * 3, c = TI[t + 2] * 3;
        const da = P[a + 1] - y || 1e-9, db = P[b + 1] - y || 1e-9, dc = P[c + 1] - y || 1e-9;
        if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) continue;
        pts.length = 0;
        edge(a, b, da, db); edge(b, c, db, dc); edge(c, a, dc, da);
        if (pts.length === 6) out.push(...pts);
      }
      return out;
    };
    const slice = (y, _half, pred) => {
      const segs = sliceSegs(y);
      if (!pred) return segs;
      const out = [];
      for (let i = 0; i < segs.length; i += 3) if (pred(segs[i], y, segs[i + 2])) out.push(segs[i], y, segs[i + 2]);
      return out;
    };
    const centroid = (arr) => {
      if (!arr.length) return null;
      let x = 0, y = 0, z = 0; const n = arr.length / 3;
      for (let i = 0; i < arr.length; i += 3) { x += arr[i]; y += arr[i + 1]; z += arr[i + 2]; }
      return V(x / n, y / n, z / n);
    };

    // 3) facing: toes stick out in front of the ankles
    {
      const foot = centroid(slice(0.02 * H, 0.02 * H));
      const ankle = centroid(slice(0.09 * H, 0.015 * H));
      let back = foot && ankle ? foot.z < ankle.z : false;
      if (process.env.RIG_DEBUG) log('  facing', foot, ankle);
      if (flip !== null) back = flip;
      if (back) {
        const r = new THREE.Matrix4().makeRotationY(Math.PI);
        for (const mesh of meshes) transformMesh(mesh, r.toArray());
        for (let i = 0; i < P.length; i += 3) { P[i] = -P[i]; P[i + 2] = -P[i + 2]; }
        log('  autorig: model faced -z, turned it around');
      }
    }

    // 4) landmarks
    // crotch: scanning up from the knees, legs are separate until the center fills in
    let crotch = 0.47 * H;
    {
      let separated = 0;
      for (let y = 0.3 * H; y < 0.6 * H; y += 0.005 * H) {
        const sl = slice(y, 0.004 * H, (x) => Math.abs(x) < 0.12 * H);
        if (sl.length < 6) continue;
        let center = false;
        for (let i = 0; i < sl.length; i += 3) if (Math.abs(sl[i]) < 0.012 * H) { center = true; break; }
        if (!center) separated++;
        else if (separated >= 5) { crotch = y; break; }
      }
      crotch = THREE.MathUtils.clamp(crotch, 0.38 * H, 0.56 * H);
    }
    const sideCentroid = (y, half, sign, xMax = 0.2 * H) => centroid(slice(y, half, (x) => x * sign > 0.004 * H && x * sign < xMax));
    const hipY = crotch + 0.045 * H;
    const ankleY = 0.055 * H;
    const legs = {};
    for (const [side, sign] of [['L', 1], ['R', -1]]) {
      const top = sideCentroid(crotch - 0.05 * H, 0.01 * H, sign) ?? V(sign * 0.055 * H, 0, 0);
      const ank = sideCentroid(0.085 * H, 0.015 * H, sign) ?? V(sign * 0.06 * H, 0, 0);
      const kneeY = (hipY + ankleY) / 2 + 0.01 * H;
      const kn = sideCentroid(kneeY, 0.01 * H, sign) ?? V(sign * 0.06 * H, 0, 0);
      const hip = V(top.x * 0.9, hipY, top.z);
      const knee = V(kn.x, kneeY, kn.z);
      const ankle = V(ank.x, ankleY, ank.z);
      // toe: farthest-forward low vertex on this side
      let toeZ = ankle.z + 0.06 * H;
      for (let i = 0; i < P.length; i += 3) if (P[i + 1] < 0.06 * H && P[i] * sign > 0 && P[i + 2] > toeZ) toeZ = P[i + 2];
      legs[side] = { hip, knee, ankle, toe: V(ankle.x, 0.015 * H, toeZ) };
    }

    // torso half-width: walk out from the center on each side until a gap, at several heights below the
    // armpits; the median is robust to sleeves touching the torso at one height
    let torsoW = 0.11 * H;
    {
      const bin = 0.004 * H;
      const widths = [];
      for (let y = 0.56 * H; y <= 0.7 * H; y += 0.02 * H) {
        const sl = sliceSegs(y);
        for (const sign of [1, -1]) {
          const occ = new Set();
          for (let i = 0; i < sl.length; i += 6) {
            const a = sl[i] * sign, b = sl[i + 3] * sign;
            const lo = Math.max(0, Math.min(a, b)), hi = Math.max(a, b);
            if (hi < 0) continue;
            for (let k = Math.floor(lo / bin); k <= Math.floor(hi / bin); k++) occ.add(k);
          }
          let gap = 0;
          for (let k = 0; k < 120; k++) {
            if (occ.has(k)) gap = 0;
            else if (++gap * bin >= 0.008 * H) { if (k - gap + 1 > 0) widths.push((k - gap + 1) * bin); break; }
          }
        }
      }
      widths.sort((a, b) => a - b);
      if (widths.length) torsoW = widths[Math.floor(widths.length / 2)];
      torsoW = THREE.MathUtils.clamp(torsoW, 0.07 * H, 0.17 * H);
    }

    // neck: narrowest central slice between the shoulders and the chin
    let neckY = 0.83 * H;
    {
      let best = Infinity;
      for (let y = 0.8 * H; y < 0.9 * H; y += 0.004 * H) {
        const sl = slice(y, 0.003 * H, (x) => Math.abs(x) < 0.12 * H);
        if (sl.length < 6) continue;
        let w = 0;
        for (let i = 0; i < sl.length; i += 3) w = Math.max(w, Math.abs(sl[i]));
        if (w < best) { best = w; neckY = y; }
      }
    }
    const zAt = (y) => (centroid(slice(y, 0.01 * H, (x) => Math.abs(x) < 0.08 * H)) ?? V(0, 0, 0)).z;

    const shoulderY = Math.min(neckY - 0.015 * H, 0.815 * H);
    const arms = {};
    for (const [side, sign] of [['L', 1], ['R', -1]]) {
      // hand tip: the farthest vertex sideways (A or T pose)
      let tip = null, best = -Infinity;
      for (let i = 0; i < P.length; i += 3) {
        const y = P[i + 1];
        if (y < crotch - 0.2 * H || y > neckY) continue;
        const v = P[i] * sign;
        if (v > best) { best = v; tip = V(P[i], y, P[i + 2]); }
      }
      const sh = V(sign * torsoW * 0.8, shoulderY, zAt(shoulderY - 0.03 * H));
      if (!tip || best < torsoW * 1.3) tip = V(sign * torsoW * 0.8, crotch - 0.05 * H, sh.z); // arms down fallback
      const dir = tip.clone().sub(sh).normalize();
      const wrist = tip.clone().addScaledVector(dir, -0.1 * H);
      const elbow = sh.clone().lerp(wrist, 0.5);
      arms[side] = { shoulder: sh, elbow, wrist, tip };
    }

    // sleeve thickness around the upper arm -> how far the arms must splay to clear the torso when lowered
    let armOut = 0;
    {
      const { shoulder: S, elbow: E } = arms.L;
      const ax = E.clone().sub(S); const len = ax.length(); ax.normalize();
      const radii = [];
      const q = V(0, 0, 0);
      for (let i = 0; i < P.length; i += 3) {
        if (P[i] < torsoW) continue; // sleeve only, not the torso
        q.set(P[i] - S.x, P[i + 1] - S.y, P[i + 2] - S.z);
        const t = q.dot(ax) / len;
        if (t < 0.35 || t > 0.65) continue;
        const d = q.addScaledVector(ax, -t * len).length();
        if (d < 0.09 * H) radii.push(d);
      }
      radii.sort((a, b) => a - b);
      const armR = radii.length ? radii[Math.floor(radii.length * 0.6)] : 0.04 * H;
      armOut = THREE.MathUtils.clamp(Math.atan2(torsoW + armR - S.x, len) - 0.12, 0, 0.38);
    }

    const joints = {
      hips: V(0, hipY + 0.005 * H, zAt(hipY)),
      spine: V(0, hipY + 0.03 * H, zAt(hipY + 0.03 * H)),
      chest: V(0, 0.7 * H, zAt(0.7 * H)),
      neck: V(0, neckY, zAt(neckY)),
      head: V(0, neckY + 0.045 * H, zAt(neckY + 0.045 * H)),
      shoulderL: arms.L.shoulder, elbowL: arms.L.elbow, handL: arms.L.wrist,
      shoulderR: arms.R.shoulder, elbowR: arms.R.elbow, handR: arms.R.wrist,
      hipL: legs.L.hip, kneeL: legs.L.knee, footL: legs.L.ankle,
      hipR: legs.R.hip, kneeR: legs.R.knee, footR: legs.R.ankle,
    };

    // 5) skeleton (three.js objects -> local transforms + inverse bind matrices)
    const bones = {};
    const armature = new THREE.Object3D();
    const down = V(0, -1, 0);
    const worldQ = {};
    for (const name of RIG_BONES) {
      const b = new THREE.Bone(); b.name = `la_${name}`; bones[name] = b;
      const parent = PARENT[name];
      (parent ? bones[parent] : armature).add(b);
      // limb bones point their -Y axis down the limb so the animator's "rotation 0" = limb hanging straight down
      const child = { shoulderL: 'elbowL', shoulderR: 'elbowR', elbowL: 'handL', elbowR: 'handR', hipL: 'kneeL', hipR: 'kneeR', kneeL: 'footL', kneeR: 'footR' }[name];
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

    // 6) weights: inverse-distance to bone segments with left/right gating
    const seg = {
      hips: [V(0, crotch - 0.02 * H, joints.hips.z), joints.spine],
      spine: [joints.spine, joints.chest],
      chest: [joints.chest, joints.neck],
      neck: [joints.neck, joints.head],
      head: [joints.head, V(0, H, joints.head.z)],
    };
    for (const sd of ['L', 'R']) {
      seg[`shoulder${sd}`] = [arms[sd].shoulder, arms[sd].elbow];
      seg[`elbow${sd}`] = [arms[sd].elbow, arms[sd].wrist];
      seg[`hand${sd}`] = [arms[sd].wrist, arms[sd].tip];
      seg[`hip${sd}`] = [legs[sd].hip, legs[sd].knee];
      seg[`knee${sd}`] = [legs[sd].knee, legs[sd].ankle];
      seg[`foot${sd}`] = [legs[sd].ankle, legs[sd].toe];
    }
    const segs = RIG_BONES.map((name, idx) => {
      const [a, b] = seg[name];
      const side = name.endsWith('L') ? 1 : name.endsWith('R') ? -1 : 0;
      const leg = /^(hip|knee|foot)[LR]$/.test(name);
      return { idx, ax: a.x, ay: a.y, az: a.z, dx: b.x - a.x, dy: b.y - a.y, dz: b.z - a.z, len2: Math.max(1e-9, a.distanceToSquared(b)), side, leg };
    });
    const sideTol = 0.02 * H, legTop = hipY + 0.04 * H, floor = 0.004 * H;

    for (const p of prims) {
      const pos = readVec3(p.getAttribute('POSITION'));
      const n = pos.length / 3;
      const J = new Uint8Array(n * 4), W = new Float32Array(n * 4);
      const cand = new Array(segs.length);
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        let k = 0;
        for (const sg of segs) {
          if (sg.side && x * sg.side < -sideTol) continue;
          if (sg.leg && y > legTop) continue;
          const px = x - sg.ax, py = y - sg.ay, pz = z - sg.az;
          const t = Math.min(1, Math.max(0, (px * sg.dx + py * sg.dy + pz * sg.dz) / sg.len2));
          const ex = px - sg.dx * t, ey = py - sg.dy * t, ez = pz - sg.dz * t;
          const d = Math.max(floor, Math.sqrt(ex * ex + ey * ey + ez * ez));
          cand[k++] = [sg.idx, 1 / (d * d * d * d)];
        }
        const top = cand.slice(0, k).sort((a, b) => b[1] - a[1]).slice(0, 4);
        let sum = 0; for (const c of top) sum += c[1];
        let kept = 0;
        for (let j = 0; j < top.length; j++) {
          const w = top[j][1] / sum;
          if (w < 0.02 && j > 0) continue;
          J[i * 4 + kept] = top[j][0]; W[i * 4 + kept] = w; kept++;
        }
        let s2 = 0; for (let j = 0; j < 4; j++) s2 += W[i * 4 + j];
        for (let j = 0; j < 4; j++) W[i * 4 + j] /= s2;
      }
      const buf = root.listBuffers()[0] ?? doc.createBuffer();
      p.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(J).setBuffer(buf));
      p.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(W).setBuffer(buf));
    }

    // 7) write the skeleton into the glTF
    const gNodes = {};
    const gArm = doc.createNode('la_armature').setExtras({ laRig: 1, armOut });
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
    log(`  autorig: arm splay ${armOut.toFixed(2)} rad`);
    log(`  autorig: crotch ${crotch.toFixed(2)} m, torso half-width ${torsoW.toFixed(2)} m, neck ${neckY.toFixed(2)} m, hands ${f(arms.L.tip)} / ${f(arms.R.tip)}`);
    return { joints, crotch, torsoW, neckY, armOut };
  });
}
