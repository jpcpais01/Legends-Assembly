import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp } from '../core/math';

/**
 * Motion-capture clips for the auto-rigged hero GLBs.
 *
 * The clips come from Quaternius' Universal Animation Library (CC0, public/models/anim/ual.glb). The hero rig
 * (scripts/autorig.mjs) has the same 22 bones as the library skeleton, so retargeting is bone for bone:
 *
 *  - torso, neck, head, collarbones, feet and toes copy the actor's rotation away from the rest pose, so a hero
 *    stands exactly as modelled when the actor stands at rest (no slouch from mismatched joint guesses);
 *  - arm and leg bones match the actor's limb DIRECTIONS, so arms hang and swing like the actor's whatever pose
 *    the hero was modelled in (A-pose heroes, T-pose actor);
 *  - the pelvis height and both ankles are then solved with IK against the ground, scaled by leg length, so feet
 *    land flat and never sink or float on heroes with short or long legs.
 *
 * Everything is baked once per hero model into flat arrays the runtime (MocapAnimator) samples.
 */

export const BONES = [
  'hips', 'spine', 'spine2', 'chest', 'neck', 'head',
  'clavicleL', 'clavicleR', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR',
  'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR', 'toeL', 'toeR',
] as const;
export type BoneName = (typeof BONES)[number];
export const NB = BONES.length;
export const IDX = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<BoneName, number>;

/** Source bone for each game bone. */
const SRC: Record<BoneName, string> = {
  hips: 'DEF-hips', spine: 'DEF-spine.001', spine2: 'DEF-spine.002', chest: 'DEF-spine.003', neck: 'DEF-neck', head: 'DEF-head',
  clavicleL: 'DEF-shoulder.L', clavicleR: 'DEF-shoulder.R', shoulderL: 'DEF-upper_arm.L', shoulderR: 'DEF-upper_arm.R',
  elbowL: 'DEF-forearm.L', elbowR: 'DEF-forearm.R', handL: 'DEF-hand.L', handR: 'DEF-hand.R',
  hipL: 'DEF-thigh.L', hipR: 'DEF-thigh.R', kneeL: 'DEF-shin.L', kneeR: 'DEF-shin.R', footL: 'DEF-foot.L', footR: 'DEF-foot.R', toeL: 'DEF-toe.L', toeR: 'DEF-toe.R',
};
/** Limb bones whose direction (toward this child) is matched to the actor's. */
const DIR: Partial<Record<BoneName, BoneName>> = {
  shoulderL: 'elbowL', shoulderR: 'elbowR', elbowL: 'handL', elbowR: 'handR', hipL: 'kneeL', hipR: 'kneeR', kneeL: 'footL', kneeR: 'footR',
};
/** Hands share their forearm's alignment. */
const INHERIT: Partial<Record<BoneName, BoneName>> = { handL: 'elbowL', handR: 'elbowR' };

/** Clips the game plays (attacks are hand-authored IK gestures in MocapAnimator, on top of these). */
const CLIPS = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Hit_Chest', 'Hit_Head', 'Death01'] as const;
export type ClipName = (typeof CLIPS)[number];
const LOOPS = new Set<ClipName>(['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Loop']);
export const FPS = 30;

export interface Baked {
  n: number; dur: number; loop: boolean;
  /** local quaternions, frame-major: [frame][bone][xyzw] */
  q: Float32Array;
  /** hips local position per frame */
  p: Float32Array;
  /** ground speed the cycle was performed at (m/s, hero scale), 0 for non-locomotion */
  speed: number;
  /** normalized phase of the left foot's heel strike */
  offset: number;
  /** locomotion: mean ankle position over the cycle per foot [Lx, Lz, Rx, Rz] (model space) */
  home: Float32Array;
}
export interface MocapSet {
  clips: Record<string, Baked>;
  /** model-space height of the ankle joint when the foot is flat on the ground */
  footY: number;
  /** armature orientation in model space and the rig hierarchy */
  armQ: THREE.Quaternion; armP: THREE.Vector3; armS: THREE.Vector3;
  parent: number[];
  /** rest local positions / rotations per bone */
  lp: Float32Array; lq: Float32Array;
  /** rest model-space joint positions and rotations */
  restP: Float32Array; restQ: Float32Array;
  /** from the rig: arm angle from vertical that keeps the sleeve off the body, sleeve radius, sole extents */
  armMin: number;
}

/** The hero's rest pose, captured before anything animates the bones. */
export interface RestSnapshot {
  lq: Float32Array; lp: Float32Array;
  parent: number[]; // parent bone index (-1 = armature)
  arm: THREE.Matrix4; // armature (hips parent) model-space matrix
  extras: Record<string, number>;
}

/** Returns null when the model is not on the 22-bone rig. */
export function snapshotRest(obj: THREE.Object3D): { rest: RestSnapshot; bones: THREE.Object3D[] } | null {
  const bones: THREE.Object3D[] = [];
  for (const n of BONES) { const b = obj.getObjectByName(`la_${n}`); if (!b) return null; bones.push(b); }
  const lq = new Float32Array(NB * 4), lp = new Float32Array(NB * 3), parent: number[] = [];
  BONES.forEach((_, i) => {
    const b = bones[i];
    b.quaternion.toArray(lq, i * 4);
    b.position.toArray(lp, i * 3);
    parent.push(bones.indexOf(b.parent!));
  });
  obj.updateMatrixWorld(true);
  const arm = new THREE.Matrix4().copy(obj.matrixWorld).invert().multiply(bones[0].parent!.matrixWorld);
  const extras = (obj.getObjectByName('la_armature')?.userData ?? {}) as Record<string, number>;
  return { rest: { lq, lp, parent, arm, extras }, bones };
}

// ───────────────────────── library + retargeting ─────────────────────────

let libP: Promise<{ scene: THREE.Object3D; clips: THREE.AnimationClip[] } | null> | null = null;
function loadLibrary() {
  libP ??= new GLTFLoader().loadAsync('/models/anim/ual.glb')
    .then((g) => ({ scene: g.scene, clips: g.animations }))
    .catch((e) => { console.warn('[Legends] mocap library failed to load, using procedural motion', e); return null; });
  return libP;
}

const bakeCache = new Map<string, Promise<MocapSet | null>>();
/** Retargets the library onto a hero rig (cached per model). */
export function bakeMocap(key: string, rest: RestSnapshot): Promise<MocapSet | null> {
  let p = bakeCache.get(key);
  if (!p) { p = loadLibrary().then((lib) => (lib ? bake(lib, rest) : null)); bakeCache.set(key, p); }
  return p;
}

/** Model-space transforms from local rotations (lq) and the hips position. */
export function fkPose(set: { armQ: THREE.Quaternion; armP: THREE.Vector3; armS: THREE.Vector3; parent: number[]; lp: Float32Array }, lq: ArrayLike<number>, hipsP: ArrayLike<number>, outQ: THREE.Quaternion[], outP: THREE.Vector3[], count: number = NB) {
  for (let i = 0; i < count; i++) {
    const pi = set.parent[i];
    const pq = pi < 0 ? set.armQ : outQ[pi], pp = pi < 0 ? set.armP : outP[pi];
    const o = outP[i];
    if (i === 0) o.set(hipsP[0], hipsP[1], hipsP[2]); else o.set(set.lp[i * 3], set.lp[i * 3 + 1], set.lp[i * 3 + 2]);
    if (pi < 0) o.multiply(set.armS);
    o.applyQuaternion(pq).add(pp);
    outQ[i].set(lq[i * 4], lq[i * 4 + 1], lq[i * 4 + 2], lq[i * 4 + 3]).premultiply(pq);
  }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _u = new THREE.Vector3(), _n = new THREE.Vector3(), _k = new THREE.Vector3(), _kn = new THREE.Vector3();
const _q = new THREE.Quaternion();
/**
 * Two-bone IK in model space on (rotation, position) arrays: moves joint c to `target` by turning a and b, keeping
 * the middle joint in its current bend plane (or bending toward `pole` when given). Rotations of a and b are updated in place; positions of b and c too.
 */
export function solveTwoBone(Q: THREE.Quaternion[], P: THREE.Vector3[], ia: number, ib: number, ic: number, target: THREE.Vector3, pole: THREE.Vector3 | null = null) {
  _a.copy(P[ia]); _b.copy(P[ib]); _c.copy(P[ic]);
  const la = _a.distanceTo(_b), lb = _b.distanceTo(_c);
  _u.subVectors(target, _a);
  const d = clamp(_u.length(), Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
  _u.normalize();
  // bend direction: the middle joint's offset from the a->c line (falls back to the bone's forward when straight)
  _n.subVectors(_c, _a).normalize();
  if (pole) _k.copy(pole);
  else { _k.subVectors(_b, _a); _k.addScaledVector(_n, -_k.dot(_n)); }
  _k.addScaledVector(_u, -_k.dot(_u));
  if (_k.lengthSq() < 1e-8) { _k.set(0, 0, 1).applyQuaternion(Q[ia]); _k.addScaledVector(_u, -_k.dot(_u)); }
  if (_k.lengthSq() < 1e-10) return;
  _k.normalize();
  const cosA = clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
  _kn.copy(_a).addScaledVector(_u, la * cosA).addScaledVector(_k, la * Math.sqrt(1 - cosA * cosA));
  _q.setFromUnitVectors(_n.subVectors(_b, _a).normalize(), _k.subVectors(_kn, _a).normalize());
  Q[ia].premultiply(_q);
  // the lower bone followed its parent; now point it at the target
  _c.sub(_b).applyQuaternion(_q);
  Q[ib].premultiply(_q);
  P[ib].copy(_kn);
  _n.copy(_a).addScaledVector(_u, d).sub(_kn).normalize();
  _q.setFromUnitVectors(_c.normalize(), _n);
  Q[ib].premultiply(_q);
  P[ic].copy(_kn).addScaledVector(_n, lb);
}

function bake(lib: { scene: THREE.Object3D; clips: THREE.AnimationClip[] }, rest: RestSnapshot): MocapSet {
  const src = lib.scene.clone(true);
  src.updateMatrixWorld(true);
  const node = (n: string) => src.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n))!;
  const srcNodes = BONES.map((n) => node(SRC[n]));

  const armQ = new THREE.Quaternion(), armP = new THREE.Vector3(), armS = new THREE.Vector3();
  rest.arm.decompose(armP, armQ, armS);
  const armInv = rest.arm.clone().invert();
  const rig = { armQ, armP, armS, parent: rest.parent, lp: rest.lp };
  const mk = () => ({ Q: BONES.map(() => new THREE.Quaternion()), P: BONES.map(() => new THREE.Vector3()) });

  // rest poses (model space)
  const sRestQ = srcNodes.map((o) => o.getWorldQuaternion(new THREE.Quaternion()));
  const sRestP = srcNodes.map((o) => o.getWorldPosition(new THREE.Vector3()));
  const tRest = mk();
  fkPose(rig, rest.lq, rest.lp, tRest.Q, tRest.P);
  const tRestQ = tRest.Q, tRestP = tRest.P;

  // per-bone constant C, so that target(t) = source(t) * C
  const S = BONES.map(() => new THREE.Quaternion());
  BONES.forEach((n, i) => {
    const c = DIR[n];
    if (!c) return;
    const ds = sRestP[IDX[c]].clone().sub(sRestP[i]).normalize();
    const dt = tRestP[IDX[c]].clone().sub(tRestP[i]).normalize();
    S[i].setFromUnitVectors(ds, dt);
  });
  BONES.forEach((n, i) => { const p = INHERIT[n]; if (p) S[i].copy(S[IDX[p]]); });
  const C = BONES.map((_, i) => sRestQ[i].clone().invert().multiply(S[i].clone().invert()).multiply(tRestQ[i]));

  const I = IDX;
  const len = (P: THREE.Vector3[], a: number, b: number) => P[a].distanceTo(P[b]);
  const legS = len(sRestP, I.hipL, I.kneeL) + len(sRestP, I.kneeL, I.footL);
  const legT = len(tRestP, I.hipL, I.kneeL) + len(tRestP, I.kneeL, I.footL);
  const K = legT / legS;
  const ankS = (sRestP[I.footL].y + sRestP[I.footR].y) / 2, ankT = (tRestP[I.footL].y + tRestP[I.footR].y) / 2;
  const ballT = (tRestP[I.toeL].y + tRestP[I.toeR].y) / 2;
  // midpoint of the hip joints in the hips bone's frame
  const hipMidLocal = new THREE.Vector3().fromArray(rest.lp, I.hipL * 3).add(new THREE.Vector3().fromArray(rest.lp, I.hipR * 3)).multiplyScalar(0.5);

  const mixer = new THREE.AnimationMixer(src);
  const out: Record<string, Baked> = {};
  const G = mk();
  const sP = BONES.map(() => new THREE.Vector3());
  const tmpQ = new THREE.Quaternion(), v = new THREE.Vector3(), v2 = new THREE.Vector3(), tgt = new THREE.Vector3(), mid = new THREE.Vector3();
  const footQ = [new THREE.Quaternion(), new THREE.Quaternion()], toeQ = [new THREE.Quaternion(), new THREE.Quaternion()];
  const LEG = [[I.hipL, I.kneeL, I.footL, I.toeL], [I.hipR, I.kneeR, I.footR, I.toeR]];

  /** World-space G.Q / G.P for one frame: FK retarget, then pelvis height and ankles against the ground. */
  const solveFrame = (g: { Q: THREE.Quaternion[]; P: THREE.Vector3[] }) => {
    // pelvis: hip-joint midpoint keeps the actor's height above the ankles, scaled by leg length
    mid.addVectors(sP[I.hipL], sP[I.hipR]).multiplyScalar(0.5);
    mid.set(mid.x * K, ankT + (mid.y - ankS) * K, mid.z * K);
    g.P[0].copy(mid).sub(v.copy(hipMidLocal).applyQuaternion(g.Q[0]));
    // positions down the chains
    for (let i = 1; i < NB; i++) {
      const pi = rest.parent[i];
      g.P[i].fromArray(rest.lp, i * 3).applyQuaternion(g.Q[pi]).add(g.P[pi]);
    }
    for (let k = 0; k < 2; k++) {
      const [h, kn, f, t] = LEG[k];
      const sk = LEG[k];
      footQ[k].copy(g.Q[f]); toeQ[k].copy(g.Q[t]);
      // ankle: the actor's offset from his own hip joint, scaled; height measured from the ground
      v.subVectors(sP[sk[2]], sP[sk[0]]);
      tgt.set(g.P[h].x + v.x * K, ankT + (sP[sk[2]].y - ankS) * K, g.P[h].z + v.z * K);
      // keep the ball of the foot and the toes above the floor when the heel lifts
      const ball = tgt.y + v2.fromArray(rest.lp, t * 3).applyQuaternion(footQ[k]).y;
      if (ball < ballT) tgt.y += ballT - ball;
      solveTwoBone(g.Q, g.P, h, kn, f, tgt);
      g.Q[f].copy(footQ[k]); g.Q[t].copy(toeQ[k]);
      g.P[t].fromArray(rest.lp, t * 3).applyQuaternion(g.Q[f]).add(g.P[f]);
    }
  };
  const toLocal = (g: { Q: THREE.Quaternion[]; P: THREE.Vector3[] }, q: Float32Array, p: Float32Array, f: number) => {
    for (let i = 0; i < NB; i++) {
      const pi = rest.parent[i];
      tmpQ.copy(pi < 0 ? armQ : g.Q[pi]).invert().multiply(g.Q[i]).toArray(q, (f * NB + i) * 4);
    }
    v.copy(g.P[0]).applyMatrix4(armInv).toArray(p, f * 3);
  };

  for (const name of CLIPS) {
    const clip = lib.clips.find((c) => c.name === name);
    if (!clip) continue;
    const loop = LOOPS.has(name);
    const n = Math.max(2, Math.round(clip.duration * FPS) + (loop ? 0 : 1));
    const q = new Float32Array(n * NB * 4), p = new Float32Array(n * 3);
    const act = mixer.clipAction(clip);
    act.play();
    for (let f = 0; f < n; f++) {
      mixer.setTime(Math.min(clip.duration, f / FPS));
      src.updateMatrixWorld(true);
      for (let i = 0; i < NB; i++) {
        srcNodes[i].getWorldQuaternion(G.Q[i]).multiply(C[i]);
        sP[i].setFromMatrixPosition(srcNodes[i].matrixWorld);
      }
      solveFrame(G);
      toLocal(G, q, p, f);
    }
    act.stop();
    mixer.uncacheAction(clip);
    // loops: remove root drift so the cycle stays in place and closes
    if (loop) {
      const dx = p[(n - 1) * 3] - p[0], dz = p[(n - 1) * 3 + 2] - p[2];
      for (let f = 0; f < n; f++) { p[f * 3] -= (dx * f) / n; p[f * 3 + 2] -= (dz * f) / n; }
    }
    const dur = loop ? n / FPS : (n - 1) / FPS;
    out[name] = { n, dur, loop, q, p, speed: 0, offset: 0, home: new Float32Array(4) };
  }

  const F = mk();
  const frame = (c: Baked, f: number) => fkPose(rig, c.q.subarray(f * NB * 4, (f + 1) * NB * 4), c.p.subarray(f * 3, f * 3 + 3), F.Q, F.P);
  // locomotion cycles: stance-foot speed (so playback matches ground speed), left heel strike, mean foot positions
  for (const name of ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'] as const) {
    const c = out[name];
    if (!c) continue;
    const L: THREE.Vector3[] = [], R: THREE.Vector3[] = [], BL: THREE.Vector3[] = [], BR: THREE.Vector3[] = [];
    for (let f = 0; f < c.n; f++) { frame(c, f); L.push(F.P[I.footL].clone()); R.push(F.P[I.footR].clone()); BL.push(F.P[I.toeL].clone()); BR.push(F.P[I.toeR].clone()); }
    // the ball of the foot carries the stance (heels stay up when sprinting): its backward speed on the ground is the pace
    const vs: number[] = [];
    for (const A of [BL, BR]) {
      const minY = Math.min(...A.map((a) => a.y));
      for (let f = 0; f < c.n; f++) {
        const a = A[f], b = A[(f + 1) % c.n];
        if (a.y < minY + 0.02 && b.y < minY + 0.02 && b.z < a.z) vs.push((a.z - b.z) * FPS);
      }
    }
    vs.sort((x, y) => x - y);
    c.speed = vs.length ? vs[Math.floor(vs.length * 0.5)] : 3;
    let best = 0;
    for (let f = 1; f < c.n; f++) if (L[f].z > L[best].z) best = f;
    c.offset = best / c.n;
    const avg = (A: THREE.Vector3[], k: 'x' | 'z') => A.reduce((s, a) => s + a[k], 0) / A.length;
    c.home.set([avg(L, 'x'), avg(L, 'z'), avg(R, 'x'), avg(R, 'z')]);
  }
  const restP = new Float32Array(NB * 3);
  const restQ = new Float32Array(NB * 4);
  tRestP.forEach((p, i) => p.toArray(restP, i * 3));
  tRestQ.forEach((q, i) => q.toArray(restQ, i * 4));
  return { clips: out, footY: ankT, armQ, armP, armS, parent: rest.parent, lp: rest.lp, lq: rest.lq, restP, restQ, armMin: Number(rest.extras.armMin ?? 0.12) };
}
