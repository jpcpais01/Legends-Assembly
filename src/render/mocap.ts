import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RIG_BONE_NAMES, type AnimState, type RigBones } from './HeroRig';
import type { AttackKind } from './RigAnimator';
import { clamp, damp, lerp, smoothstep, angleDiff } from '../core/math';

/**
 * Motion-capture animation for the auto-rigged hero GLBs.
 *
 * The clips come from Quaternius' Universal Animation Library (CC0, public/models/anim/ual.glb) and are
 * retargeted at load time onto each hero's 17-bone `la_*` skeleton: every bone takes the source bone's
 * rotation relative to a source rest pose that has been bent to match the hero's own rest pose (T-pose
 * source vs A-pose heroes), so arms, legs and spine follow the actor while keeping the hero's proportions.
 *
 * At runtime the animator blends idle / walk / jog / sprint by speed with a shared, stride-synced phase
 * (feet plant at the right rate), turns the hips into strafes and plays the cycle backwards when
 * backpedaling, layers attack clips on the upper body, adds hit reactions, jumps, landings and a real
 * mocap death, then aims the spine at the camera pitch.
 */

type BoneName = (typeof RIG_BONE_NAMES)[number];
const NB = RIG_BONE_NAMES.length;
const IDX = Object.fromEntries(RIG_BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;

/** Source bone for each game bone. */
const SRC: Record<BoneName, string> = {
  hips: 'DEF-hips', spine: 'DEF-spine.001', chest: 'DEF-spine.003', neck: 'DEF-neck', head: 'DEF-head',
  shoulderL: 'DEF-upper_arm.L', shoulderR: 'DEF-upper_arm.R', elbowL: 'DEF-forearm.L', elbowR: 'DEF-forearm.R', handL: 'DEF-hand.L', handR: 'DEF-hand.R',
  hipL: 'DEF-thigh.L', hipR: 'DEF-thigh.R', kneeL: 'DEF-shin.L', kneeR: 'DEF-shin.R', footL: 'DEF-foot.L', footR: 'DEF-foot.R',
};
/** Bone direction pairs used to bend the source rest pose onto the target rest pose. */
const DIR: Partial<Record<BoneName, [BoneName, string]>> = {
  spine: ['chest', 'DEF-spine.003'], chest: ['neck', 'DEF-neck'], neck: ['head', 'DEF-head'],
  shoulderL: ['elbowL', 'DEF-forearm.L'], shoulderR: ['elbowR', 'DEF-forearm.R'],
  elbowL: ['handL', 'DEF-hand.L'], elbowR: ['handR', 'DEF-hand.R'],
  hipL: ['kneeL', 'DEF-shin.L'], hipR: ['kneeR', 'DEF-shin.R'],
  kneeL: ['footL', 'DEF-foot.L'], kneeR: ['footR', 'DEF-foot.R'],
};
/** Terminal bones inherit their parent's alignment. */
const INHERIT: Partial<Record<BoneName, BoneName>> = { head: 'neck', handL: 'elbowL', handR: 'elbowR', footL: 'kneeL', footR: 'kneeR' };

const CLIPS = [
  'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land',
  'Hit_Chest', 'Hit_Head', 'Death01', 'Punch_Jab', 'Punch_Cross', 'Spell_Simple_Shoot', 'Spell_Simple_Idle_Loop',
  'Sword_Attack', 'Pistol_Shoot',
] as const;
type ClipName = (typeof CLIPS)[number];
/** Attack clips also get a mirrored copy (`<name>_M`) so either hand can perform them. */
const MIRRORED = new Set<ClipName>(['Punch_Jab', 'Punch_Cross', 'Spell_Simple_Shoot', 'Sword_Attack', 'Pistol_Shoot']);
const MIR = RIG_BONE_NAMES.map((n) => IDX[(n.endsWith('L') ? n.slice(0, -1) + 'R' : n.endsWith('R') ? n.slice(0, -1) + 'L' : n) as BoneName]);
const mirrorQ = (q: THREE.Quaternion) => q.set(q.x, -q.y, -q.z, q.w);
const LOOPS = new Set<ClipName>(['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Loop', 'Spell_Simple_Idle_Loop']);
const FPS = 30;

export interface Baked {
  n: number; dur: number; loop: boolean;
  /** local quaternions, frame-major: [frame][bone][xyzw] */
  q: Float32Array;
  /** hips local position per frame */
  p: Float32Array;
  /** ground speed the cycle was performed at (m/s, target scale), 0 for non-locomotion */
  speed: number;
  /** normalized phase of the left foot's heel strike */
  offset: number;
  /** attack clips: the hand that performs it (1 right, -1 left) */
  side: number;
  /** attack clips: per frame, model-space shoulder->hand direction of the striking arm and its length */
  reach?: Float32Array;
}
export interface MocapSet {
  clips: Record<string, Baked>;
  /** model-space height of the ankle bone when the foot is flat on the ground */
  footY: number;
  /** armature orientation in model space and the rig hierarchy (for model-space corrections at runtime) */
  armQ: THREE.Quaternion; armP: THREE.Vector3; armS: THREE.Vector3;
  parent: number[];
  /** rest local positions per bone */
  lp: Float32Array;
}

/** The hero's rest pose, captured before anything animates the bones. */
export interface RestSnapshot {
  lq: Float32Array; lp: Float32Array; // local rest quats / positions per bone
  parent: number[]; // parent bone index (-1 = armature)
  arm: THREE.Matrix4; // armature (hips parent) model-space matrix
}

export function snapshotRest(obj: THREE.Object3D, bones: Record<string, THREE.Object3D>): RestSnapshot {
  const lq = new Float32Array(NB * 4), lp = new Float32Array(NB * 3), parent: number[] = [];
  RIG_BONE_NAMES.forEach((n, i) => {
    const b = bones[n];
    b.quaternion.toArray(lq, i * 4);
    b.position.toArray(lp, i * 3);
    const pn = b.parent?.name.replace(/^la_/, '') as BoneName | undefined;
    parent.push(pn && pn in IDX ? IDX[pn] : -1);
  });
  obj.updateMatrixWorld(true);
  const arm = new THREE.Matrix4().copy(obj.matrixWorld).invert().multiply(bones.hips.parent!.matrixWorld);
  return { lq, lp, parent, arm };
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

/** Model-space rest transforms of the target from its local snapshot. */
function fkRest(rest: RestSnapshot, lq: Float32Array, hipsP: ArrayLike<number> | null, outQ: THREE.Quaternion[], outP: THREE.Vector3[]) {
  const armQ = new THREE.Quaternion(), armP = new THREE.Vector3(), s = new THREE.Vector3();
  rest.arm.decompose(armP, armQ, s);
  const lqq = new THREE.Quaternion(), lpp = new THREE.Vector3();
  for (let i = 0; i < NB; i++) {
    const pi = rest.parent[i];
    const pq = pi < 0 ? armQ : outQ[pi], pp = pi < 0 ? armP : outP[pi];
    lqq.fromArray(lq, i * 4);
    if (i === 0 && hipsP) lpp.set(hipsP[0], hipsP[1], hipsP[2]); else lpp.fromArray(rest.lp, i * 3);
    if (pi < 0) lpp.multiply(s);
    outQ[i].copy(pq).multiply(lqq);
    outP[i].copy(lpp).applyQuaternion(pq).add(pp);
  }
}

function bake(lib: { scene: THREE.Object3D; clips: THREE.AnimationClip[] }, rest: RestSnapshot): MocapSet {
  const src = lib.scene.clone(true);
  src.updateMatrixWorld(true);
  const node = (n: string) => src.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n))!;
  const wq = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion());
  const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

  // rest poses (model space)
  const sRestQ = RIG_BONE_NAMES.map((n) => wq(node(SRC[n])));
  const sRestP = RIG_BONE_NAMES.map((n) => wp(node(SRC[n])));
  const tRestQ = RIG_BONE_NAMES.map(() => new THREE.Quaternion()), tRestP = RIG_BONE_NAMES.map(() => new THREE.Vector3());
  fkRest(rest, rest.lq, null, tRestQ, tRestP);

  // alignment: swing that bends each source rest bone onto the target rest bone
  const S: THREE.Quaternion[] = RIG_BONE_NAMES.map(() => new THREE.Quaternion());
  RIG_BONE_NAMES.forEach((n, i) => {
    const d = DIR[n];
    if (!d) return;
    const ds = wp(node(d[1])).sub(sRestP[i]).normalize();
    const dt = tRestP[IDX[d[0]]].clone().sub(tRestP[i]).normalize();
    S[i].setFromUnitVectors(ds, dt);
  });
  RIG_BONE_NAMES.forEach((n, i) => { const p = INHERIT[n]; if (p) S[i].copy(S[IDX[p]]); });
  // per-bone constant: C = Qs_rest^-1 * S^-1 * Qt_rest, so Qt(t) = Qs(t) * C
  const C = RIG_BONE_NAMES.map((_, i) => sRestQ[i].clone().invert().multiply(S[i].clone().invert()).multiply(tRestQ[i]));

  const legS = sRestP[IDX.hipL].distanceTo(sRestP[IDX.kneeL]) + sRestP[IDX.kneeL].distanceTo(sRestP[IDX.footL]);
  const legT = tRestP[IDX.hipL].distanceTo(tRestP[IDX.kneeL]) + tRestP[IDX.kneeL].distanceTo(tRestP[IDX.footL]);
  const K = legT / legS;
  const armInv = rest.arm.clone().invert();
  const armQ = new THREE.Quaternion(); rest.arm.decompose(new THREE.Vector3(), armQ, new THREE.Vector3());

  const mixer = new THREE.AnimationMixer(src);
  const out: Record<string, Baked> = {};
  const gQ = RIG_BONE_NAMES.map(() => new THREE.Quaternion()), gM = RIG_BONE_NAMES.map(() => new THREE.Quaternion());
  // mirror correction: mirrored delta of bone i applied to the rest of its mirror bone
  const CM = RIG_BONE_NAMES.map((_, i) => mirrorQ(tRestQ[i].clone()).invert().multiply(tRestQ[MIR[i]]));
  const tmpQ = new THREE.Quaternion(), hp = new THREE.Vector3(), hp2 = new THREE.Vector3();
  const srcNodes = RIG_BONE_NAMES.map((n) => node(SRC[n]));
  for (const name of CLIPS) {
    const clip = lib.clips.find((c) => c.name === name);
    if (!clip) continue;
    const loop = LOOPS.has(name);
    const n = Math.max(2, Math.round(clip.duration * FPS) + (loop ? 0 : 1));
    const q = new Float32Array(n * NB * 4), p = new Float32Array(n * 3);
    const mir = MIRRORED.has(name);
    const qm = mir ? new Float32Array(n * NB * 4) : q, pm = mir ? new Float32Array(n * 3) : p;
    const act = mixer.clipAction(clip);
    act.play();
    for (let f = 0; f < n; f++) {
      mixer.setTime(Math.min(clip.duration, f / FPS));
      src.updateMatrixWorld(true);
      for (let i = 0; i < NB; i++) {
        srcNodes[i].getWorldQuaternion(gQ[i]).multiply(C[i]);
        const pi = rest.parent[i];
        tmpQ.copy(pi < 0 ? armQ : gQ[pi]).invert().multiply(gQ[i]);
        tmpQ.toArray(q, (f * NB + i) * 4);
      }
      srcNodes[0].getWorldPosition(hp).sub(sRestP[0]).multiplyScalar(K).add(tRestP[0]);
      if (mir) {
        for (let i = 0; i < NB; i++) mirrorQ(gM[MIR[i]].copy(gQ[i])).multiply(CM[i]);
        for (let i = 0; i < NB; i++) {
          const pi = rest.parent[i];
          tmpQ.copy(pi < 0 ? armQ : gM[pi]).invert().multiply(gM[i]).toArray(qm, (f * NB + i) * 4);
        }
        hp2.set(-hp.x, hp.y, hp.z).applyMatrix4(armInv).toArray(pm, f * 3);
      }
      hp.applyMatrix4(armInv).toArray(p, f * 3);
    }
    act.stop();
    mixer.uncacheAction(clip);
    // loops: remove root drift so the cycle stays in place and closes
    if (loop) {
      const dx = p[(n - 1) * 3] - p[0], dz = p[(n - 1) * 3 + 2] - p[2];
      for (let f = 0; f < n; f++) { p[f * 3] -= (dx * f) / n; p[f * 3 + 2] -= (dz * f) / n; }
    }
    const dur = loop ? n / FPS : (n - 1) / FPS;
    out[name] = { n, dur, loop, q, p, speed: 0, offset: 0, side: 1 };
    if (mir) out[name + '_M'] = { n, dur, loop, q: qm, p: pm, speed: 0, offset: 0, side: -1 };
  }

  const fq = RIG_BONE_NAMES.map(() => new THREE.Quaternion()), fp = RIG_BONE_NAMES.map(() => new THREE.Vector3());
  // which hand performs each attack: the one that reaches furthest forward
  for (const name of MIRRORED) {
    const c = out[name];
    if (!c) continue;
    let l = -9, r = -9;
    const dl = new Float32Array(c.n * 4), dr = new Float32Array(c.n * 4), d = new THREE.Vector3();
    for (let f = 0; f < c.n; f++) {
      fkRest(rest, c.q.subarray(f * NB * 4, (f + 1) * NB * 4), c.p.subarray(f * 3, f * 3 + 3), fq, fp);
      l = Math.max(l, fp[IDX.handL].z); r = Math.max(r, fp[IDX.handR].z);
      d.subVectors(fp[IDX.handL], fp[IDX.shoulderL]); dl[f * 4 + 3] = d.length(); d.normalize().toArray(dl, f * 4);
      d.subVectors(fp[IDX.handR], fp[IDX.shoulderR]); dr[f * 4 + 3] = d.length(); d.normalize().toArray(dr, f * 4);
    }
    c.side = r >= l ? 1 : -1;
    const m = out[name + '_M'];
    m.side = -c.side;
    c.reach = c.side > 0 ? dr : dl;
    // the mirror's striking arm is the other one, reflected
    const mr = (c.side > 0 ? dr : dl).slice();
    for (let f = 0; f < c.n; f++) mr[f * 4] = -mr[f * 4];
    m.reach = mr;
  }

  // locomotion cycles: measure the stance-foot speed (so playback rate matches ground speed) and the left heel strike
  let footY = 0.1;
  for (const name of ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'] as const) {
    const c = out[name];
    if (!c) continue;
    const L: THREE.Vector3[] = [], R: THREE.Vector3[] = [];
    for (let f = 0; f < c.n; f++) {
      fkRest(rest, c.q.subarray(f * NB * 4, (f + 1) * NB * 4), c.p.subarray(f * 3, f * 3 + 3), fq, fp);
      L.push(fp[IDX.footL].clone()); R.push(fp[IDX.footR].clone());
    }
    // stance speed: median backward foot velocity while the foot is on the ground
    const vs: number[] = [];
    for (const F of [L, R]) {
      const minY = Math.min(...F.map((v) => v.y));
      for (let f = 0; f < c.n; f++) {
        const a = F[f], b = F[(f + 1) % c.n];
        if (a.y < minY + 0.04 && b.y < minY + 0.04 && b.z < a.z) vs.push((a.z - b.z) * FPS);
      }
    }
    vs.sort((x, y) => x - y);
    c.speed = vs.length ? vs[Math.floor(vs.length * 0.75)] : 3;
    let best = 0;
    for (let f = 1; f < c.n; f++) if (L[f].z > L[best].z) best = f;
    c.offset = best / c.n;
    if (name === 'Walk_Loop') footY = Math.min(...L.map((v) => v.y), ...R.map((v) => v.y));
  }
  const armP = new THREE.Vector3(), armS = new THREE.Vector3();
  rest.arm.decompose(armP, new THREE.Quaternion(), armS);
  return { clips: out, footY, armQ, armP, armS, parent: rest.parent, lp: rest.lp };
}

// ───────────────────────── runtime ─────────────────────────

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0), _X = new THREE.Vector3(1, 0, 0), _Z = new THREE.Vector3(0, 0, 1);
const UPPER = ['spine', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR'].map((n) => IDX[n as BoneName]);
const UPPER_W = UPPER.map((i) => (i === IDX.spine ? 0.6 : 1));
/** Attack masks: the striking arm fully, the torso turning into it, the free arm mostly keeps running. */
const armMask = (side: number) => UPPER.map((i) => {
  const n = RIG_BONE_NAMES[i];
  if (n === 'spine') return 0.55;
  if (n === 'chest') return 0.9;
  if (n === 'neck') return 0.6;
  if (n === 'head') return 0.45;
  return n.endsWith(side > 0 ? 'R' : 'L') ? 1 : 0.2;
});
const MASK_R = armMask(1), MASK_L = armMask(-1);

const slerpF = THREE.Quaternion.slerpFlat as unknown as (d: Float32Array, o: number, a: Float32Array, ao: number, b: Float32Array, bo: number, t: number) => void;
function sample(c: Baked, t: number, q: Float32Array, p: Float32Array) {
  let ft = t * FPS;
  if (c.loop) { ft %= c.n; if (ft < 0) ft += c.n; } else ft = clamp(ft, 0, c.n - 1);
  const f0 = Math.floor(ft), f1 = c.loop ? (f0 + 1) % c.n : Math.min(c.n - 1, f0 + 1), a = ft - f0;
  for (let i = 0; i < NB; i++) slerpF(q, i * 4, c.q, (f0 * NB + i) * 4, c.q, (f1 * NB + i) * 4, a);
  for (let k = 0; k < 3; k++) p[k] = lerp(c.p[f0 * 3 + k], c.p[f1 * 3 + k], a);
}
/** a = slerp(a, b, w) on a bone subset (all bones when idx is null) */
function blend(aq: Float32Array, ap: Float32Array, bq: Float32Array, bp: Float32Array, w: number, idx: number[] | null = null, iw: number[] | null = null) {
  if (w <= 0) return;
  if (idx) { idx.forEach((i, k) => slerpF(aq, i * 4, aq, i * 4, bq, i * 4, w * (iw ? iw[k] : 1))); return; }
  for (let i = 0; i < NB; i++) slerpF(aq, i * 4, aq, i * 4, bq, i * 4, w);
  for (let k = 0; k < 3; k++) ap[k] = lerp(ap[k], bp[k], w);
}

class Spring {
  v = 0;
  constructor(public x = 0) {}
  step(target: number, freq: number, zeta: number, dt: number) {
    const w = Math.PI * 2 * freq, n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) { this.v += (w * w * (target - this.x) - 2 * zeta * w * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
}

/**
 * Upper-body attack clips per gesture: [clip, start, end, playback speed, aim]. `aim` is how strongly the
 * striking arm is turned so its full reach points down the crosshair (1 = straight at it).
 */
const ATTACKS: Record<AttackKind, [ClipName, number, number, number, number]> = {
  flick: ['Spell_Simple_Shoot', 0.0, 0.5, 1.25, 1],
  ring: ['Punch_Cross', 0.12, 0.9, 1.45, 0.85],
  stroke: ['Sword_Attack', 0.3, 1.25, 2.0, 0.5],
  throw: ['Sword_Attack', 0.15, 1.3, 1.5, 0.4],
  toss: ['Punch_Jab', 0.05, 0.75, 1.3, 0.9],
};

const _inv = new THREE.Matrix4(), _pF = new THREE.Vector3(), _pT = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _k = new THREE.Vector3(), _u = new THREE.Vector3(), _n = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qf = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _sc = new THREE.Vector3(), _ps = new THREE.Vector3(), _kn = new THREE.Vector3(), _va = new THREE.Vector3();
const _qp2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const _vc = new THREE.Vector3(), _vh = new THREE.Vector3(), _vs = new THREE.Vector3(), _vl = new THREE.Vector3();

/** Rotate `bone` (world delta `d`, applied before its world rotation) and refresh its matrices. */
function rotateWorld(bone: THREE.Object3D, d: THREE.Quaternion) {
  bone.matrixWorld.decompose(_ps, _q1, _sc);
  bone.parent!.matrixWorld.decompose(_ps, _qp, _sc);
  _q1.premultiply(d);
  bone.quaternion.copy(_qp.invert().multiply(_q1));
  bone.updateMatrixWorld(true);
}

/** Two-bone IK keeping the knee in its current bend plane and the foot's world orientation. */
function twoBoneIK(hip: THREE.Object3D, knee: THREE.Object3D, foot: THREE.Object3D, target: THREE.Vector3) {
  _a.setFromMatrixPosition(hip.matrixWorld);
  _b.setFromMatrixPosition(knee.matrixWorld);
  _c.setFromMatrixPosition(foot.matrixWorld);
  foot.matrixWorld.decompose(_ps, _qf, _sc);
  const la = _a.distanceTo(_b), lb = _b.distanceTo(_c);
  _u.subVectors(target, _a);
  const d = clamp(_u.length(), Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
  _u.normalize();
  // bend direction: the knee's offset from the hip->foot line
  _n.subVectors(_c, _a).normalize();
  _k.subVectors(_b, _a);
  _k.addScaledVector(_n, -_k.dot(_n));
  _k.addScaledVector(_u, -_k.dot(_u));
  if (_k.lengthSq() < 1e-8) return;
  _k.normalize();
  const cosA = clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
  const kneeNew = _kn.copy(_a).addScaledVector(_u, la * cosA).addScaledVector(_k, la * Math.sqrt(1 - cosA * cosA));
  // thigh
  _q2.setFromUnitVectors(_n.subVectors(_b, _a).normalize(), _k.subVectors(kneeNew, _a).normalize());
  rotateWorld(hip, _q2);
  // shin
  _b.setFromMatrixPosition(knee.matrixWorld);
  _c.setFromMatrixPosition(foot.matrixWorld);
  _q2.setFromUnitVectors(_n.subVectors(_c, _b).normalize(), _k.subVectors(target, _b).normalize());
  rotateWorld(knee, _q2);
  // foot keeps its animated world orientation
  knee.matrixWorld.decompose(_ps, _qp, _sc);
  foot.quaternion.copy(_qp.invert().multiply(_qf));
  foot.updateMatrixWorld(true);
}

export class MocapAnimator {
  private b: THREE.Object3D[];
  private q = new Float32Array(NB * 4); private p = new Float32Array(3);
  private q2 = new Float32Array(NB * 4); private p2 = new Float32Array(3);
  private q3 = new Float32Array(NB * 4); private p3 = new Float32Array(3);
  private last = new Float32Array(NB * 4); private lastP = new Float32Array(3);

  private phase = 0; private idleT = Math.random() * 10;
  private moveW = 0; private gaitSpeed = 0;
  private legYaw = 0; private reverse = false; private prevYaw: number | null = null; private turnRate = 0;
  private air = 0; private airT = 0; private wasGrounded = true; private landT = 9; private landK = 0;
  private atk: { c: Baked; t: number; t1: number; spd: number; t0: number; mask: number[]; aim: number; side: number; dir: THREE.Vector3 | null } | null = null; private atkW = 0;
  /** foot planting: locked world xz per foot and lock weight */
  private lock = [{ on: false, w: 0, x: 0, z: 0 }, { on: false, w: 0, x: 0, z: 0 }];
  private lastAttack = 0; private lastHit = 0;
  private hit: { c: Baked; t: number } | null = null;
  private deadT = 0;
  private castW = 0;
  private prevVX = 0; private prevVZ = 0; private accF = 0; private accR = 0;
  private lean = new Spring(); private bank = new Spring();

  constructor(private r: RigBones, private set: MocapSet, private opts: { armOut?: number } = {}) {
    this.b = RIG_BONE_NAMES.map((n) => r[n]);
    r.body.rotation.set(0, 0, 0); r.body.position.set(0, 0, 0);
  }

  update(dt: number, s: AnimState) {
    dt = Math.min(dt, 1 / 20);
    const S = this.set.clips, q = this.q, p = this.p;

    // ── death: the mocap fall, blended from the last live pose ──
    if (s.dead) {
      this.deadT += dt;
      sample(S.Death01, this.deadT * 1.1, q, p);
      const w = 1 - smoothstep(0, 0.15, this.deadT);
      if (w > 0) blend(q, p, this.last, this.lastP, w);
      this.apply();
      this.lock[0].on = this.lock[1].on = false; this.lock[0].w = this.lock[1].w = 0;
      return;
    }
    if (this.deadT > 0) { this.deadT = 0; this.atk = null; this.hit = null; }

    // ── locomotion ──
    const speed = s.speed;
    const yaw = s.yaw ?? 0;
    if (this.prevYaw !== null) this.turnRate = damp(this.turnRate, angleDiff(this.prevYaw, yaw) / Math.max(dt, 1e-4), 10, dt);
    this.prevYaw = yaw;
    // idle turning steps in place
    const turnStep = clamp((Math.abs(this.turnRate) - 1.2) * 0.4, 0, 0.9) * (1 - smoothstep(0.4, 1.2, speed));
    const gs = Math.max(speed, turnStep);
    this.gaitSpeed = damp(this.gaitSpeed, gs, 10, dt);
    const v = this.gaitSpeed;
    this.moveW = damp(this.moveW, smoothstep(0.15, 0.9, v), 8, dt);

    // direction: legs lead toward the move direction, backpedal runs the cycle in reverse
    if (speed > 0.4) {
      const th = Math.atan2(-s.side, s.fwd); // model space: left = +x
      if (!this.reverse && Math.abs(th) > 2.0) this.reverse = true;
      else if (this.reverse && Math.abs(th) < 1.7) this.reverse = false;
      const want = this.reverse ? angleDiff(0, th - Math.PI) : th;
      this.legYaw = damp(this.legYaw, clamp(want, -1.25, 1.25), 10, dt);
    } else this.legYaw = damp(this.legYaw, 0, 6, dt);

    // gait weights: walk -> jog -> sprint, blended by speed; phase advances by stride length
    const W = S.Walk_Loop, J = S.Jog_Fwd_Loop, R = S.Sprint_Loop;
    // anchors: heroes cruise on the jog (upright, shooter posture); the sprint only takes over above cruise speed
    const vw = W.speed, vj = Math.max(J.speed, vw + 1), vr = this.reverse ? 1e9 : Math.max(R.speed, vj + 1.6, 7.2);
    let ww = 0, wj = 0, wr = 0;
    if (v <= vw) ww = 1;
    else if (v <= vj) { wj = (v - vw) / (vj - vw); ww = 1 - wj; }
    else if (v <= vr) { wr = (v - vj) / (vr - vj); wj = 1 - wr; }
    else if (vr < 1e8) wr = 1; else wj = 1;
    const stride = ww * W.speed * W.dur + wj * J.speed * J.dur + wr * R.speed * R.dur;
    const dPhase = (Math.max(v, 0.25) / Math.max(0.1, stride)) * dt;
    this.phase = (this.phase + (this.reverse ? -dPhase : dPhase) + 1) % 1;
    this.idleT += dt;

    sample(S.Idle_Loop, this.idleT, q, p);
    if (this.moveW > 0.001) {
      const cyc = (c: Baked) => (this.phase + c.offset) * c.dur;
      const gq = this.q2, gp = this.p2;
      let acc = 0;
      for (const [c, w] of [[W, ww], [J, wj], [R, wr]] as [Baked, number][]) {
        if (w <= 0.001) continue;
        if (acc === 0) { sample(c, cyc(c), gq, gp); acc = w; continue; }
        sample(c, cyc(c), this.q3, this.p3);
        acc += w;
        blend(gq, gp, this.q3, this.p3, w / acc);
      }
      blend(q, p, gq, gp, this.moveW);
    }

    // ── air: jump start / airborne loop, then a landing that softens when running ──
    const grounded = s.grounded && s.levitate < 0.05;
    if (!grounded && this.wasGrounded) this.airT = 0;
    if (grounded && !this.wasGrounded && this.airT > 0.15) { this.landT = 0; this.landK = clamp(-(s.vy ?? -6) / 10, 0.5, 1); }
    this.wasGrounded = grounded;
    this.air = damp(this.air, grounded ? 0 : 1, grounded ? 20 : 12, dt);
    if (!grounded) this.airT += dt;
    if (this.air > 0.01) {
      const js = S.Jump_Start, rising = (s.vy ?? 0) > 1.5 && this.airT < 0.5;
      if (rising) sample(js, Math.min(js.dur, 0.42 + this.airT * 1.2), this.q2, this.p2);
      else sample(S.Jump_Loop, this.airT, this.q2, this.p2);
      // keep the hips height from the ground cycle: the game moves the body through the air
      this.p2[1] = p[1];
      blend(q, p, this.q2, this.p2, this.air);
    }
    if (this.landT < 1) {
      this.landT += dt;
      const fast = smoothstep(1.5, 4, speed);
      const len = lerp(0.55, 0.28, fast);
      const w = (1 - smoothstep(len * 0.35, len, this.landT)) * this.landK * (1 - 0.55 * fast);
      if (w > 0.001) { sample(S.Jump_Land, 0.08 + this.landT * 1.3, this.q2, this.p2); blend(q, p, this.q2, this.p2, w); }
    }
    if (s.levitate > 0.01) { sample(S.Jump_Loop, s.time * 0.6, this.q2, this.p2); this.p2[1] = p[1] + 0.02; blend(q, p, this.q2, this.p2, s.levitate * 0.8); }

    // ── upper body: casting, attacks ──
    this.castW = damp(this.castW, s.cast, 10, dt);
    if (this.castW > 0.01) { sample(S.Spell_Simple_Idle_Loop, s.time, this.q2, this.p2); blend(q, p, this.q2, this.p2, this.castW, UPPER, UPPER_W); }

    const rise = s.attack > this.lastAttack + 0.3;
    this.lastAttack = s.attack;
    if (rise) {
      const [cn, t0, t1, spd, aim] = ATTACKS[s.attackKind ?? 'flick'];
      const side = (s.attackSide ?? 1) < 0 ? -1 : 1;
      const c = S[cn].side === side || !S[cn + '_M'] ? S[cn] : S[cn + '_M'];
      const mask = side > 0 ? MASK_R : MASK_L;
      const a = this.atk;
      // rapid fire keeps the pose up instead of restarting the wind-up every shot
      if (a && a.c === c && a.t < a.t1 && a.t > a.t0 + (a.t1 - a.t0) * 0.35) a.t = a.t0 + (a.t1 - a.t0) * 0.3;
      else {
        // reference pose: the arm's fullest extension inside the window, which gets turned onto the crosshair
        let dir: THREE.Vector3 | null = null;
        if (c.reach) {
          let best = -1, bl = 0;
          for (let f = Math.floor(t0 * FPS); f <= Math.min(c.n - 1, Math.ceil(t1 * FPS)); f++) if (c.reach[f * 4 + 3] > bl) { bl = c.reach[f * 4 + 3]; best = f; }
          if (best >= 0) dir = new THREE.Vector3().fromArray(c.reach, best * 4);
        }
        this.atk = { c, t: t0, t0, t1, spd, mask, aim, side, dir };
      }
    }
    if (this.atk) {
      const a = this.atk;
      a.t += dt * a.spd;
      const k = (a.t - a.t0) / (a.t1 - a.t0);
      const w = smoothstep(0, 0.12, k) * (1 - smoothstep(0.78, 1, k));
      this.atkW = w;
      if (k >= 1) this.atk = null;
      else { sample(a.c, a.t, this.q2, this.p2); blend(q, p, this.q2, this.p2, w, UPPER, a.mask); }
    } else this.atkW = 0;

    // ── hit reaction (additive on the upper body) ──
    const hit = s.hit ?? 0;
    if (hit > this.lastHit + 0.3) this.hit = { c: Math.random() < 0.5 ? S.Hit_Chest : S.Hit_Head, t: 0 };
    this.lastHit = hit;
    if (this.hit) {
      const h = this.hit;
      h.t += dt * 1.3;
      if (h.t >= h.c.dur) this.hit = null;
      else {
        const w = 1 - smoothstep(h.c.dur * 0.4, h.c.dur, h.t);
        sample(h.c, h.t, this.q2, this.p2);
        sample(h.c, 0, this.q3, this.p3);
        for (const i of UPPER) {
          _qa.fromArray(this.q3, i * 4).invert().premultiply(_qb.fromArray(this.q2, i * 4)); // delta = hit(t) * hit(0)^-1
          _qb.identity().slerp(_qa, w);
          _qa.fromArray(q, i * 4).premultiply(_qb).toArray(q, i * 4);
        }
      }
    }

    // striking arm: the clip's arm was performed on its own hips and spine, so first restore the arm's
    // model-space direction from the clip on top of the running torso, then turn its full reach onto the
    // crosshair (the spine adds the rest of the pitch below)
    if (this.atk && this.atk.dir && this.atk.c.reach && this.atkW > 0.01) {
      const a = this.atk, sh = a.side > 0 ? IDX.shoulderR : IDX.shoulderL, hd = a.side > 0 ? IDX.handR : IDX.handL;
      const R = a.c.reach!, f = clamp(Math.round(a.t * FPS), 0, a.c.n - 1);
      _vc.fromArray(R, f * 4); // clip direction now
      this.modelPose(hd, _qp2, _vh);
      this.modelPose(sh, _qp2, _vs);
      _vh.sub(_vs).normalize(); // composite direction now
      _qa.setFromUnitVectors(_vh, _vc);
      _qb.identity().slerp(_qa, this.atkW);
      const pr = 0.35 * clamp(s.pitch, -0.9, 0.9);
      _va.set(0, Math.sin(pr), Math.cos(pr));
      _qa.setFromUnitVectors(a.dir!, _va);
      _qb.premultiply(_q3.identity().slerp(_qa, this.atkW * a.aim));
      this.modelQ(this.set.parent[sh], _qp2);
      // local' = P^-1 * R * P * local
      _qa.copy(_qp2).invert().multiply(_qb).multiply(_qp2).multiply(_q3.fromArray(q, sh * 4)).toArray(q, sh * 4);
    }

    this.last.set(q); this.lastP.set(p);
    this.apply();

    // ── procedural layers: strafe twist, aim, momentum lean ──
    const r = this.r;
    const ly = this.legYaw * this.moveW;
    r.hips.quaternion.premultiply(_qa.setFromAxisAngle(_Y, ly));
    r.spine.quaternion.premultiply(_qa.setFromAxisAngle(_Y, -ly * 0.35));
    r.chest.quaternion.premultiply(_qa.setFromAxisAngle(_Y, -ly * 0.4));
    r.neck.quaternion.premultiply(_qa.setFromAxisAngle(_Y, -ly * 0.25));

    // shooter posture: run more upright with the eyes up, and lean back when backpedaling
    const up = this.moveW * (0.14 + (this.reverse ? 0.16 : 0)) * (1 - this.air);
    r.spine.quaternion.premultiply(_qa.setFromAxisAngle(_X, -up * 0.6));
    r.chest.quaternion.premultiply(_qa.setFromAxisAngle(_X, -up * 0.4));
    r.neck.quaternion.premultiply(_qa.setFromAxisAngle(_X, -this.moveW * 0.1));
    r.head.quaternion.premultiply(_qa.setFromAxisAngle(_X, -this.moveW * 0.12));

    // acceleration in the body frame -> lean into speed changes, bank into turns
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const vx = -s.side * cy + s.fwd * sy, vz = s.side * sy + s.fwd * cy;
    const ax = (vx - this.prevVX) / Math.max(dt, 1e-4), az = (vz - this.prevVZ) / Math.max(dt, 1e-4);
    this.prevVX = vx; this.prevVZ = vz;
    this.accF = damp(this.accF, clamp(ax * sy + az * cy, -30, 30), 10, dt);
    this.accR = damp(this.accR, clamp(-(ax * cy - az * sy), -30, 30), 10, dt);
    const lean = this.lean.step(clamp(this.accF * 0.012, -0.12, 0.16), 2.4, 0.55, dt);
    const bank = this.bank.step(clamp(this.accR * 0.01, -0.14, 0.14), 2.2, 0.6, dt);
    r.spine.quaternion.premultiply(_qa.setFromAxisAngle(_X, lean)).premultiply(_qb.setFromAxisAngle(_Z, bank));

    // aim: the spine bends toward the camera pitch (arms follow, so attacks track the crosshair)
    const pitch = clamp(s.pitch, -0.9, 0.9) * (1 - this.air * 0.4);
    r.spine.quaternion.premultiply(_qa.setFromAxisAngle(_X, -pitch * 0.3));
    r.chest.quaternion.premultiply(_qa.setFromAxisAngle(_X, -pitch * 0.35));
    r.neck.quaternion.premultiply(_qa.setFromAxisAngle(_X, -pitch * 0.15));
    r.head.quaternion.premultiply(_qa.setFromAxisAngle(_X, -pitch * 0.2));

    // bulky outfits: keep the arms off the torso
    const ao = this.opts.armOut ?? 0;
    if (ao) {
      r.shoulderL.quaternion.multiply(_qa.setFromAxisAngle(_Z, ao * (1 - this.atkW * 0.5)));
      r.shoulderR.quaternion.multiply(_qa.setFromAxisAngle(_Z, -ao * (1 - this.atkW * 0.5)));
    }

    this.plantFeet(dt, grounded && this.air < 0.2);
  }

  /**
   * Foot planting: when an animated foot touches down its world position is pinned and the leg is solved
   * with two-bone IK until the clip lifts it again, so feet never skate during speed changes, turns or blends.
   */
  private plantFeet(dt: number, allowed: boolean) {
    const r = this.r;
    r.hips.parent!.updateWorldMatrix(true, false);
    r.hips.updateMatrixWorld(true);
    _inv.copy(r.body.matrixWorld).invert(); // model space (feet heights were measured there)
    const footY = this.set.footY;
    for (let k = 0; k < 2; k++) {
      const L = this.lock[k];
      const hip = k ? r.hipR : r.hipL, knee = k ? r.kneeR : r.kneeL, foot = k ? r.footR : r.footL;
      _pF.setFromMatrixPosition(foot.matrixWorld);
      const hLocal = _pT.copy(_pF).applyMatrix4(_inv).y; // armature space height
      const contact = allowed && hLocal < footY + 0.035;
      if (contact && !L.on) { L.on = true; L.x = _pF.x; L.z = _pF.z; }
      const slip = Math.hypot(_pF.x - L.x, _pF.z - L.z);
      if (L.on && (!contact || slip > 0.3)) L.on = false;
      L.w = damp(L.w, L.on ? 1 : 0, L.on ? 30 : 14, dt);
      // never let a grounded sole sink into the floor
      const floor = allowed ? r.body.matrixWorld.elements[13] + footY : -1e9;
      if (L.w < 0.01 && _pF.y >= floor) continue;
      _pT.set(lerp(_pF.x, L.x, L.w), Math.max(_pF.y, floor), lerp(_pF.z, L.z, L.w));
      if (_pT.distanceToSquared(_pF) < 1e-6) continue;
      twoBoneIK(hip, knee, foot, _pT);
    }
  }

  /** Model-space rotation of bone i from the current local pose. */
  /** Model-space rotation and position of bone i from the current pose. */
  private modelPose(i: number, oq: THREE.Quaternion, op: THREE.Vector3) {
    const S = this.set;
    if (i < 0) { oq.copy(S.armQ); op.copy(S.armP); return; }
    this.modelPose(S.parent[i], oq, op);
    if (i === 0) _vl.fromArray(this.p); else _vl.fromArray(S.lp, i * 3);
    if (S.parent[i] < 0) _vl.multiply(S.armS);
    op.add(_vl.applyQuaternion(oq));
    oq.multiply(_q4.fromArray(this.q, i * 4));
  }

  private modelQ(i: number, out: THREE.Quaternion): THREE.Quaternion {
    if (i < 0) return out.copy(this.set.armQ);
    this.modelQ(this.set.parent[i], out);
    return out.multiply(_q4.fromArray(this.q, i * 4));
  }

  private apply() {
    for (let i = 0; i < NB; i++) this.b[i].quaternion.fromArray(this.q, i * 4);
    this.r.hips.position.fromArray(this.p);
  }
}
