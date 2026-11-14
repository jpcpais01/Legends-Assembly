import * as THREE from 'three';
import type { AnimState } from './HeroRig';
import type { AttackKind } from './RigAnimator';
import { BONES, FPS, IDX, NB, fkPose, solveTwoBone, type Baked, type MocapSet } from './mocap';
import { clamp, damp, lerp, smoothstep, angleDiff } from '../core/math';

/**
 * Runtime animation for motion-captured heroes.
 *
 * Layers, in order:
 *  1. locomotion: idle / walk / jog / sprint blended by speed on one shared, stride-synced phase;
 *  2. direction: the pelvis turns part of the way toward the travel direction and the strides are swung the rest
 *     of the way around each foot's home spot (stride warping), so strafes and diagonals step where the hero is
 *     really going while the chest stays on the crosshair; backpedaling runs the cycle in reverse;
 *  3. air (jump, fall, land), hit reactions, and attacks: hand-authored gestures whose hand paths are solved with
 *     arm IK along the crosshair, with the chest winding up and driving through;
 *  4. body dynamics: lean into acceleration, bank into strafes, aim pitch through the spine;
 *  5. legs solved with IK onto their goals, feet pinned to the ground while they carry weight, and real steps
 *     when the hero turns on the spot;
 *  6. arms kept clear of bulky jackets and coats.
 */

const I = IDX;
const UPPER = (['spine', 'spine2', 'chest', 'neck', 'head', 'clavicleL', 'clavicleR', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR'] as const).map((n) => I[n]);
const TORSO = [I.spine, I.spine2, I.chest], TORSO_W = [0.3, 0.35, 0.35];
const LEG = [[I.hipL, I.kneeL, I.footL, I.toeL], [I.hipR, I.kneeR, I.footR, I.toeR]] as const;

const slerpF = THREE.Quaternion.slerpFlat as unknown as (d: Float32Array, o: number, a: Float32Array, ao: number, b: Float32Array, bo: number, t: number) => void;
function sample(c: Baked, t: number, q: Float32Array, p: Float32Array) {
  let ft = t * FPS;
  if (c.loop) { ft %= c.n; if (ft < 0) ft += c.n; } else ft = clamp(ft, 0, c.n - 1);
  const f0 = Math.floor(ft), f1 = c.loop ? (f0 + 1) % c.n : Math.min(c.n - 1, f0 + 1), a = ft - f0;
  for (let i = 0; i < NB; i++) slerpF(q, i * 4, c.q, (f0 * NB + i) * 4, c.q, (f1 * NB + i) * 4, a);
  for (let k = 0; k < 3; k++) p[k] = lerp(c.p[f0 * 3 + k], c.p[f1 * 3 + k], a);
}
/** a = slerp(a, b, w) on a bone subset (all bones and the hips position when idx is null) */
function blend(aq: Float32Array, ap: Float32Array, bq: Float32Array, bp: Float32Array, w: number, idx: number[] | null = null, iw: number[] | null = null) {
  if (w <= 0) return;
  if (idx) { for (let k = 0; k < idx.length; k++) { const i = idx[k]; slerpF(aq, i * 4, aq, i * 4, bq, i * 4, w * (iw ? iw[k] : 1)); } return; }
  for (let i = 0; i < NB; i++) slerpF(aq, i * 4, aq, i * 4, bq, i * 4, w);
  for (let k = 0; k < 3; k++) ap[k] = lerp(ap[k], bp[k], w);
}

/** q[i] = rotation about a parent-frame axis * q[i] */
function pre(q: Float32Array, i: number, axis: THREE.Vector3, angle: number) {
  _qc.fromArray(q, i * 4).premultiply(_qd.setFromAxisAngle(axis, angle)).toArray(q, i * 4);
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

type V3 = readonly [number, number, number];
/**
 * One key of an attack gesture. `p` is where the striking hand is, relative to its shoulder, in arm lengths:
 * x away from the body, y up, z along the crosshair. `h` is where the fingers point and `n` where the palm faces
 * (same axes). `cy` turns the chest so the striking shoulder drives forward (negative winds up), `cp` leans it
 * in, `el` is where the elbow points.
 */
interface GKey { t: number; p: V3; h: V3; n: V3; cy: number; cp: number; el: V3 }
interface Gesture { keys: GKey[]; out: number; /** played on the body, not along the crosshair: follows only part of the aim pitch */ flat?: boolean }
const DOWN: V3 = [0.45, -1, -0.25];
const key = (t: number, p: V3, h: V3, n: V3, cy = 0, cp = 0, el: V3 = DOWN): GKey => ({ t, p, h, n, cy, cp, el });
/**
 * The shot leaves on the first frame, so every gesture reaches its strike pose fast and spends the rest on
 * follow-through and recovery. The arm starts from wherever the hand already is.
 */
const GESTURES: Record<AttackKind, Gesture> = {
  // palm thrust down the crosshair with a short recoil (Einstein's photons, alternating hands)
  flick: { out: 0.16, keys: [
    key(0.055, [0.14, 0.1, 0.98], [0, 0.15, 0.99], [0, -0.99, 0.15], 0.22, 0.04),
    key(0.1, [0.14, 0.13, 0.95], [0, 0.3, 0.95], [0, -0.95, 0.3], 0.2, 0.03),
    key(0.16, [0.14, 0.26, 0.78], [0, 0.78, 0.62], [0, -0.62, 0.78], 0.12, 0),
    key(0.26, [0.1, -0.2, 0.55], [0, 0.4, 0.92], [0, -0.92, 0.4], 0.04, 0),
  ] },
  // repulsor: the arm locks straight down the crosshair, fingers bent up so the palm faces the target, a kick of
  // recoil, and the aim held a beat before relaxing (Iron Man)
  blast: { out: 0.2, keys: [
    key(0.05, [0.08, 0.1, 1.05], [0, 0.93, -0.36], [0, 0.36, 0.93], 0.3, 0.05),
    key(0.1, [0.12, 0.2, 0.9], [0, 0.98, -0.18], [0, 0.18, 0.98], 0.2, -0.02),
    key(0.2, [0.08, 0.13, 1.03], [0, 0.95, -0.3], [0, 0.3, 0.95], 0.26, 0.03),
    key(0.34, [0.1, -0.2, 0.62], [0, 0.45, 0.89], [0, -0.89, 0.45], 0.06, 0),
  ] },
  // overhand throw: cock the hand by the ear, whip it through, follow across the body (Einstein's gravity orb)
  throw: { out: 0.22, keys: [
    key(0.085, [0.3, 0.78, -0.28], [0.1, 0.95, -0.3], [0, 0.3, 0.95], -0.4, -0.08, [0.9, -0.2, -0.5]),
    key(0.17, [-0.05, 0.4, 0.98], [0, 0.25, 0.97], [0, -0.97, 0.25], 0.4, 0.12),
    key(0.23, [-0.25, 0.0, 0.95], [-0.15, -0.3, 0.94], [0, -0.95, -0.3], 0.5, 0.16),
    key(0.32, [-0.55, -0.45, 0.6], [-0.35, -0.6, 0.72], [0, -0.75, -0.66], 0.5, 0.16),
    key(0.46, [-0.25, -0.6, 0.4], [-0.2, -0.7, 0.68], [0.6, -0.5, -0.6], 0.2, 0.06),
  ] },
  // bell cocked up, snapped down at the target, a second shake (Yeat)
  ring: { out: 0.2, keys: [
    key(0.07, [0.1, 0.4, 0.6], [0, 0.85, 0.52], [-0.9, 0, 0.3], -0.14, -0.03),
    key(0.135, [0.0, 0.14, 1.0], [0, -0.62, 0.78], [-0.9, 0, 0.3], 0.3, 0.1),
    key(0.21, [0.0, 0.2, 0.88], [0, 0.15, 0.99], [-0.9, 0, 0.3], 0.22, 0.06),
    key(0.29, [0.0, 0.12, 0.94], [0, -0.5, 0.86], [-0.9, 0, 0.3], 0.24, 0.07),
    key(0.42, [0.06, -0.15, 0.66], [0, -0.2, 0.98], [-0.9, 0, 0.3], 0.1, 0.02),
  ] },
  // diagonal brush stroke from high outside, across and down (Van Gogh)
  stroke: { out: 0.2, keys: [
    key(0.075, [0.55, 0.62, 0.5], [0.35, 0.8, 0.5], [-0.6, 0, 0.8], -0.32, -0.06, [0.8, -0.5, -0.3]),
    key(0.16, [-0.1, 0.16, 1.0], [-0.25, 0.3, 0.92], [-0.7, -0.5, 0.5], 0.22, 0.1),
    key(0.25, [-0.62, -0.32, 0.66], [-0.7, -0.4, 0.6], [-0.4, -0.8, -0.4], 0.5, 0.16),
    key(0.4, [-0.3, -0.5, 0.5], [-0.3, -0.6, 0.74], [0.5, -0.6, -0.6], 0.2, 0.06),
  ] },
  // straight rubber jab: the arm locks out down the crosshair and stays there while it stretches (Luffy)
  punch: { out: 0.14, keys: [
    key(0.04, [0.02, 0.04, 1.3], [0, 0.03, 1], [0, -1, 0.03], 0.22, 0.05),
    key(0.3, [0.02, 0.04, 1.3], [0, 0.03, 1], [0, -1, 0.03], 0.2, 0.04),
    key(0.42, [0.12, -0.3, 0.6], [0, 0.2, 0.98], [0, -0.98, 0.2], 0.06, 0.01),
  ] },
  // underhand lob: swing back low, scoop forward and up with an open palm (Van Gogh's seeds)
  toss: { out: 0.22, keys: [
    key(0.085, [0.16, -0.86, -0.36], [0, -0.92, -0.4], [0.2, -0.4, 0.9], -0.2, 0.12),
    key(0.19, [0.0, 0.0, 0.98], [0, 0.25, 0.97], [0, 0.97, -0.25], 0.26, -0.03),
    key(0.29, [0.0, 0.42, 0.82], [0, 0.8, 0.6], [0, 0.6, -0.8], 0.2, -0.06),
    key(0.44, [0.06, -0.3, 0.55], [0, 0.1, 1], [0, 0.6, -0.8], 0.06, 0),
  ] },
  // piston jab: fist chambered at the ribs, driven straight down the crosshair with the shoulder behind it (Blitzcrank)
  jab: { out: 0.16, keys: [
    key(0.05, [0.2, -0.08, 0.22], [0, 0.45, 0.89], [-0.95, -0.25, 0.15], -0.36, -0.05, [0.6, -0.75, -0.3]),
    key(0.11, [0.05, 0.1, 1.0], [0, 0.04, 1], [-0.72, -0.69, 0], 0.46, 0.12),
    key(0.19, [0.07, 0.08, 0.92], [0, 0.08, 0.99], [-0.72, -0.69, 0], 0.34, 0.08),
    key(0.36, [0.16, -0.18, 0.45], [0, 0.5, 0.86], [-0.95, -0.25, 0.15], 0.08, 0.02),
  ] },
  // uppercut: dip the fist to the hip, then drive it up past the chin with the chest rising behind it
  uppercut: { out: 0.2, keys: [
    key(0.08, [0.22, -0.78, 0.18], [0, 0.2, 0.98], [-0.9, 0.1, 0.3], -0.4, 0.2, [0.4, -0.9, -0.2]),
    key(0.17, [0.04, 0.5, 0.72], [0, 0.92, 0.38], [-0.3, 0, -0.95], 0.48, -0.14),
    key(0.27, [0.04, 0.72, 0.5], [0, 0.98, 0.15], [-0.3, 0, -0.95], 0.34, -0.2),
    key(0.46, [0.16, -0.15, 0.45], [0, 0.5, 0.86], [-0.95, -0.25, 0.15], 0.06, 0),
  ] },
  // rocket launch: cock the arm, punch it out straight and hold it there while the fist flies on its chain
  launch: { out: 0.24, keys: [
    key(0.07, [0.24, 0.0, 0.16], [0, 0.5, 0.86], [-0.95, -0.2, 0.2], -0.45, -0.06, [0.6, -0.7, -0.4]),
    key(0.13, [0.02, 0.06, 1.0], [0, 0.03, 1], [0, -1, 0.03], 0.52, 0.14),
    key(0.62, [0.02, 0.05, 1.0], [0, 0.03, 1], [0, -1, 0.03], 0.46, 0.12),
    key(0.8, [0.16, -0.2, 0.5], [0, 0.4, 0.92], [-0.95, -0.25, 0.15], 0.08, 0.02),
  ] },
  // two-fisted hammer slam into the floor (Static Field); played on both arms, so each arm carries half the lean
  slam: { out: 0.26, keys: [
    key(0.14, [0.3, 1.0, 0.12], [0.05, 0.99, 0.1], [0, 0.1, 0.99], 0, -0.08, [0.9, -0.1, -0.4]),
    key(0.25, [0.16, -0.62, 0.72], [0, -0.7, 0.71], [-0.95, -0.2, -0.2], 0, 0.26),
    key(0.45, [0.17, -0.6, 0.7], [0, -0.72, 0.69], [-0.95, -0.2, -0.2], 0, 0.22),
    key(0.72, [0.18, -0.5, 0.42], [0, -0.3, 0.95], [-0.95, -0.25, 0.15], 0, 0.04),
  ] },
  // guitar strum (Bob Marley): the picking hand brushes down across the strings at the hip and lifts off again;
  // it plays on the guitar, so it ignores where the crosshair points
  strum: { out: 0.16, flat: true, keys: [
    key(0.03, [0.00, -0.58, 0.56], [-0.3, -0.75, 0.6], [0.1, 0.3, -0.95], 0.06, 0.02, [0.7, -0.5, -0.5]),
    key(0.085, [-0.04, -0.86, 0.5], [-0.25, -0.9, 0.35], [0.1, 0.25, -0.96], -0.04, 0.03, [0.7, -0.5, -0.5]),
    key(0.17, [-0.02, -0.8, 0.52], [-0.28, -0.85, 0.45], [0.1, 0.25, -0.96], -0.02, 0.02, [0.7, -0.5, -0.5]),
    key(0.28, [-0.01, -0.68, 0.54], [-0.3, -0.8, 0.5], [0.1, 0.3, -0.95], 0, 0.01, [0.7, -0.5, -0.5]),
  ] },
};
/**
 * Holding a guitar slung on its strap (Bob Marley): the fretting hand cradles the neck up by the left shoulder,
 * the picking hand rests over the strings at the right hip. [left, right], in the same shoulder space as GESTURES.
 */
const GUITAR = [
  key(0, [0.12, -0.2, 0.62], [-0.2, 0.55, 0.8], [-0.85, 0.4, -0.3], 0, 0, [0.8, -0.55, 0.1]),
  key(0, [-0.01, -0.68, 0.6], [-0.3, -0.8, 0.5], [0.1, 0.3, -0.95], 0, 0, [0.7, -0.5, -0.5]),
];
/** How much of the aim pitch a body-held pose follows (the chest already carries some of it). */
const FLAT_PITCH = 0.35;
/** Sustained channels (ultimates). On the ground the striking arm sweeps up to the sky; floating, both arms open wide with the palms forward. */
const CAST_UP = key(0, [0.3, 0.8, 0.5], [0.05, 0.92, 0.38], [0, -0.38, 0.92], 0.16, -0.1, [0.9, -0.3, -0.3]);
const CAST_OPEN = key(0, [0.66, -0.22, 0.3], [0.78, -0.5, 0.36], [0, 0.58, 0.81], 0, -0.06, [0.3, -0.5, -0.8]);
/** Both arms straight down the crosshair, hands grabbing (Luffy's Gum-Gum Rocket). */
const REACH = key(0, [-0.06, 0.08, 1.3], [0, 0.08, 1], [0, -1, 0.08], 0, 0.08, [0.6, -0.6, -0.4]);

interface ArmState { g: Gesture | null; t: number; w: number; flat?: boolean; p0: number[]; h0: number[]; n0: number[]; sp: [Spring, Spring, Spring]; cy: number; cp: number; hold: number }
const newArm = (): ArmState => ({ g: null, t: 0, w: 0, p0: [0.1, -1, 0], h0: [0, -1, 0], n0: [-1, 0, 0], sp: [new Spring(), new Spring(), new Spring()], cy: 0, cp: 0, hold: 0 });
/** hand follow spring: stiff enough to hit the strike pose on time, loose enough to settle with a little life */
const SPR_F = 16, SPR_Z = 0.75;
const cr = (a: number, b: number, c: number, d: number, u: number) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);

const _Y = new THREE.Vector3(0, 1, 0), _X = new THREE.Vector3(1, 0, 0), _Z = new THREE.Vector3(0, 0, 1);
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _qd = new THREE.Quaternion(), _qe = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _tg = new THREE.Vector3();
const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _v4 = new THREE.Vector3();
const ARM_L = [I.shoulderL, I.elbowL, I.handL], ARM_R = [I.shoulderR, I.elbowR, I.handR];
const _tgs = [new THREE.Vector3(), new THREE.Vector3()], _yawFix = [0, 0];

interface FootLock { on: boolean; w: number; x: number; z: number; yaw: number; step: number; sx: number; sz: number; syaw: number; px: number; pz: number }
const newLock = (): FootLock => ({ on: false, w: 0, x: 0, z: 0, yaw: 0, step: -1, sx: 0, sz: 0, syaw: 0, px: 0, pz: 0 });

export class MocapAnimator {
  private q = new Float32Array(NB * 4); private p = new Float32Array(3);
  private q2 = new Float32Array(NB * 4); private p2 = new Float32Array(3);
  private q3 = new Float32Array(NB * 4); private p3 = new Float32Array(3);
  private last = new Float32Array(NB * 4); private lastP = new Float32Array(3);
  /** model-space pose scratch */
  private Q = BONES.map(() => new THREE.Quaternion()); private P = BONES.map(() => new THREE.Vector3());
  private goalP = [new THREE.Vector3(), new THREE.Vector3()]; private goalQ = [new THREE.Quaternion(), new THREE.Quaternion()];

  private phase = 0; private idleT = Math.random() * 10;
  private moveW = 0; private gait = 0;
  private dir = 0; private reverse = false; private revW = 0;
  private air = 0; private airT = 0; private wasGrounded = true; private landT = 9; private landK = 0;
  /** attack gestures, [left, right] */
  private arm = [newArm(), newArm()];
  private lock = [newLock(), newLock()];
  private lastAttack = 0; private lastHit = 0;
  private hit: { c: Baked; t: number } | null = null;
  private deadT = 0;
  private castW = 0; private lev = 0; private reachW = 0; private guitarW = 0;
  private prevVX = 0; private prevVZ = 0; private accF = 0; private accR = 0; private hasPrev = false;
  private lean = new Spring(); private bank = new Spring();
  /** hit recoil: the torso is shoved along the blow and springs back (pitch, roll, twist) */
  private recP = new Spring(); private recR = new Spring(); private recY = new Spring();
  private hipDrop = 0;
  private legLen: number; private ballY: number; private armLen: number;
  /** per arm: rest finger direction, palm normal and hand rotation (model space) */
  private handRest: { m: THREE.Matrix4; q: THREE.Quaternion }[] = [];
  private kind: AttackKind;
  /** Rubber-hose cartoon timing (Mickey): hips dip on every footfall, and he bops to a beat while standing. */
  private bounce: number;
  /** 0..1: how much of the clips' forward pitch to drop (a top-heavy robot walks upright instead of tipping over). */
  private upright: number;
  /** dev viewer: freeze on one clip */
  debugClip: { name: string; t: number } | null = null;

  constructor(private body: THREE.Object3D, private b: THREE.Object3D[], private set: MocapSet, opts: { attack?: AttackKind; bounce?: number; upright?: number } = {}) {
    this.kind = opts.attack ?? 'flick';
    this.bounce = opts.bounce ?? 0;
    this.upright = opts.upright ?? 0;
    body.rotation.set(0, 0, 0); body.position.set(0, 0, 0);
    const rp = (i: number) => _v.fromArray(set.restP, i * 3).clone();
    this.legLen = rp(I.hipL).distanceTo(rp(I.kneeL)) + rp(I.kneeL).distanceTo(rp(I.footL));
    this.ballY = set.restP[I.toeL * 3 + 1];
    this.armLen = rp(I.shoulderL).distanceTo(rp(I.elbowL)) + rp(I.elbowL).distanceTo(rp(I.handL));
    for (let k = 0; k < 2; k++) {
      const el = k ? I.elbowR : I.elbowL, hd = k ? I.handR : I.handL;
      // fingers continue the forearm; in the modelled A-pose the palms face down and in toward the body
      const d = rp(hd).sub(rp(el)).normalize();
      const n = new THREE.Vector3().crossVectors(d, _Z).multiplyScalar(k ? -1 : 1).normalize();
      const m = new THREE.Matrix4().makeBasis(d, n, new THREE.Vector3().crossVectors(d, n));
      this.handRest.push({ m, q: new THREE.Quaternion().fromArray(set.restQ, hd * 4) });
    }
  }

  update(dt: number, s: AnimState) {
    dt = Math.min(dt, 1 / 20);
    const S = this.set.clips, q = this.q, p = this.p;

    if (this.debugClip) {
      sample(S[this.debugClip.name] ?? S.Idle_Loop, this.debugClip.t, q, p);
      this.apply();
      return;
    }

    // ── death: the mocap fall, blended from the last live pose ──
    if (s.dead) {
      this.deadT += dt;
      sample(S.Death01, this.deadT * 1.1, q, p);
      const w = 1 - smoothstep(0, 0.15, this.deadT);
      if (w > 0) blend(q, p, this.last, this.lastP, w);
      this.apply();
      for (const L of this.lock) { L.on = false; L.w = 0; L.step = -1; }
      return;
    }
    if (this.deadT > 0) { this.deadT = 0; this.hit = null; this.hasPrev = false; for (const a of this.arm) { a.g = null; a.w = 0; } }

    const grounded = s.grounded && s.levitate < 0.05;
    const lev = this.lev = damp(this.lev, s.levitate, 12, dt);
    const yaw = s.yaw ?? 0;

    // ── locomotion ──
    const speed = s.speed;
    this.gait = damp(this.gait, speed, 12, dt);
    const v = this.gait;
    this.moveW = damp(this.moveW, smoothstep(0.2, 1.1, v), speed > v ? 14 : 9, dt);
    const mw = this.moveW;

    // travel direction in model space (0 = forward, + = toward the hero's left); backpedal past ~110 degrees
    if (speed > 0.5) {
      const th = Math.atan2(-s.side, s.fwd);
      if (!this.reverse && Math.abs(th) > 1.95) this.reverse = true;
      else if (this.reverse && Math.abs(th) < 1.65) this.reverse = false;
      const want = this.reverse ? angleDiff(0, th - Math.PI) : th;
      this.dir += angleDiff(this.dir, want) * (1 - Math.exp(-11 * dt));
    } else this.dir = damp(this.dir, 0, 5, dt);
    this.revW = damp(this.revW, this.reverse ? 1 : 0, 10, dt);
    // split: the pelvis turns part of the way, the strides swing the rest
    const psi = clamp(this.dir * 0.5, -0.8, 0.8) * mw;
    const phi = (this.dir - clamp(this.dir * 0.5, -0.8, 0.8)) * mw;
    const sideways = Math.abs(Math.sin(this.dir));

    // gait weights: walk -> jog -> sprint by speed; the phase advances by stride length so feet match the ground
    const W = S.Walk_Loop, J = S.Jog_Fwd_Loop, R = S.Sprint_Loop;
    const vw = W.speed, vj = Math.max(J.speed, vw + 0.8), vr = Math.max(R.speed, vj + 1.2);
    let ww = 0, wj = 0, wr = 0;
    if (v <= vw) ww = 1;
    else if (v <= vj) { wj = (v - vw) / (vj - vw); ww = 1 - wj; }
    else if (v <= vr) { wr = (v - vj) / (vr - vj); wj = 1 - wr; }
    else wr = 1;
    // sideways and backwards the long sprint stride gives way to the tighter jog
    const tight = Math.max(sideways, this.revW) * 0.75;
    wj += wr * tight; wr *= 1 - tight;
    // strides shorten below walking pace (instead of a slow-motion cycle) and a little when stepping sideways
    const slow = clamp(v / (vw * 0.75), 0.25, 1);
    const stride = (ww * W.speed * W.dur + wj * J.speed * J.dur + wr * R.speed * R.dur) * slow * (1 - 0.18 * sideways);
    const strideK = slow * (1 - 0.18 * sideways);
    const dPhase = (Math.max(v, 0.3) / Math.max(0.1, stride)) * dt;
    this.phase = (this.phase + (this.reverse ? -dPhase : dPhase) + 1) % 1;
    this.idleT += dt;

    sample(S.Idle_Loop, this.idleT, q, p);
    let homeLX = 0, homeLZ = 0, homeRX = 0, homeRZ = 0;
    if (mw > 0.001) {
      const gq = this.q2, gp = this.p2;
      let acc = 0;
      for (let g = 0; g < 3; g++) {
        const c = g === 0 ? W : g === 1 ? J : R, w = g === 0 ? ww : g === 1 ? wj : wr;
        if (w <= 0.001) continue;
        const t = (this.phase + c.offset) * c.dur;
        homeLX += c.home[0] * w; homeLZ += c.home[1] * w; homeRX += c.home[2] * w; homeRZ += c.home[3] * w;
        if (acc === 0) { sample(c, t, gq, gp); acc = w; continue; }
        sample(c, t, this.q3, this.p3);
        acc += w;
        blend(gq, gp, this.q3, this.p3, w / acc);
      }
      blend(q, p, gq, gp, mw);
    }

    // ── air: jump start / airborne loop, then a landing that softens when running ──
    if (!grounded && this.wasGrounded) this.airT = 0;
    if (grounded && !this.wasGrounded && this.airT > 0.15) { this.landT = 0; this.landK = clamp(-(s.vy ?? -6) / 10, 0.5, 1); }
    this.wasGrounded = grounded;
    this.air = damp(this.air, grounded ? 0 : 1, grounded ? 18 : 12, dt);
    if (!grounded) this.airT += dt;
    if (this.air > 0.01) {
      const js = S.Jump_Start, rising = (s.vy ?? 0) > 1.5 && this.airT < 0.5;
      if (rising) sample(js, Math.min(js.dur, 0.42 + this.airT * 1.2), this.q2, this.p2);
      else sample(S.Jump_Loop, this.airT, this.q2, this.p2);
      // keep the hips height from the ground cycle: the game moves the body through the air
      this.p2[0] = p[0]; this.p2[1] = p[1]; this.p2[2] = p[2];
      blend(q, p, this.q2, this.p2, this.air * (1 - lev));
    }
    if (this.landT < 1) {
      this.landT += dt;
      const fast = smoothstep(1.5, 4, speed);
      const len = lerp(0.5, 0.26, fast);
      const w = (1 - smoothstep(len * 0.35, len, this.landT)) * this.landK * (1 - 0.6 * fast);
      if (w > 0.001) { sample(S.Jump_Land, 0.08 + this.landT * 1.3, this.q2, this.p2); blend(q, p, this.q2, this.p2, w); }
    }
    if (lev > 0.01) {
      // floating: the standing pose with the chest lifted, the legs hanging loose and the toes pointed, drifting slowly
      const lq = this.q2, d1 = Math.sin(s.time * 1.3) * 0.04, d2 = Math.sin(s.time * 0.9 + 1.2) * 0.04;
      sample(S.Idle_Loop, this.idleT, lq, this.p2);
      pre(lq, 0, _X, -0.05); pre(lq, I.spine2, _X, -0.06); pre(lq, I.chest, _X, -0.09); pre(lq, I.head, _X, -0.06);
      pre(lq, I.hipL, _X, -0.34 + d1); pre(lq, I.hipL, _Z, -0.07); pre(lq, I.kneeL, _X, 0.66 - d1); pre(lq, I.footL, _X, 0.42);
      pre(lq, I.hipR, _X, 0.05 + d2); pre(lq, I.hipR, _Z, 0.07); pre(lq, I.kneeR, _X, 0.24 + d2); pre(lq, I.footR, _X, 0.55);
      blend(q, p, lq, this.p2, lev);
    }

    // ── foot goals from the full-body pose, before the upper body is layered ──
    const set = this.set, Q = this.Q, P = this.P;
    fkPose(set, q, p, Q, P);
    const hx = P[0].x, hz = P[0].z;
    // the sprint and jog clips pitch far forward: keep part of it going forward, stand up when strafing, lean back when backpedaling
    const lean0 = Math.atan2(P[I.neck].z - P[0].z, P[I.neck].y - P[0].y);
    const leanWant = lerp(lean0 * lerp(0.55, 0.3, sideways) * (1 - this.upright), -0.07, this.revW);
    const posture = (leanWant - lean0) * mw * (1 - this.air);
    const cph = Math.cos(phi), sph = Math.sin(phi), cps = Math.cos(psi), sps = Math.sin(psi);
    // lanes: keep the feet from colliding when strides run across the pelvis
    const lane = Math.max(0, 0.8 - cph) * mw;
    for (let k = 0; k < 2; k++) {
      const f = LEG[k][2];
      const g = this.goalP[k].copy(P[f]);
      if (mw > 0.001) {
        const hX = k ? homeRX : homeLX, hZ = k ? homeRZ : homeLZ, sgn = k ? -1 : 1;
        let dx = (g.x - hX) * lerp(1, strideK, mw), dz = (g.z - hZ) * lerp(1, strideK, mw);
        // swing the stride around the foot's home spot
        const rx = dx * cph + dz * sph, rz = -dx * sph + dz * cph;
        dx = rx; dz = rz;
        const ox = hX + sgn * Math.abs(hX) * lane * cph, oz = hZ - sgn * Math.abs(hX) * lane * sph;
        // then turn everything with the pelvis
        const lx = ox + dx - hx, lz = oz + dz - hz;
        g.x = hx + lx * cps + lz * sps; g.z = hz - lx * sps + lz * cps;
      }
      // standing: the captured stance is a wide brace; bring the feet in under the hips a little
      g.x = hx + (g.x - hx) * lerp(1, 0.8, (1 - mw) * (1 - this.air));
      this.goalQ[k].copy(Q[f]).premultiply(_qa.setFromAxisAngle(_Y, psi + phi * 0.55));
    }

    // ── attacks: start a gesture on the striking arm ──
    this.castW = damp(this.castW, s.cast, 9, dt);
    this.reachW = damp(this.reachW, s.reach ?? 0, 16, dt);
    this.guitarW = damp(this.guitarW, s.guitar ?? 0, 8, dt);
    if (s.attack > this.lastAttack + 0.3) {
      const side = (s.attackSide ?? 1) < 0 ? 0 : 1;
      for (let k = 0; k < 2; k++) {
        if (k !== side && !s.attackBoth) continue;
        const a = this.arm[k];
        a.g = GESTURES[s.attackKind ?? this.kind]; a.t = 0; a.hold = 0;
        // start from wherever the hand is: mid-gesture that is the spring, otherwise the animated pose (captured below)
        if (a.w > 0.3) { a.p0[0] = a.sp[0].x; a.p0[1] = a.sp[1].x; a.p0[2] = a.sp[2].x; } else a.hold = -1;
      }
    }
    this.lastAttack = s.attack;

    // ── hit reaction (additive on the upper body) ──
    const hit = s.hit ?? 0;
    if (hit > this.lastHit + 0.3) {
      this.hit = { c: Math.random() < 0.5 ? S.Hit_Chest : S.Hit_Head, t: 0 };
      // directional shove: heavier blows throw the chest further along the push
      const k = clamp(s.hitK ?? 0.5, 0.2, 1);
      this.recP.v += (s.hitZ ?? -1) * k * 5;
      this.recR.v += (s.hitX ?? 0) * k * 4;
      this.recY.v += (Math.random() < 0.5 ? -1 : 1) * k * 2.4;
    }
    this.lastHit = hit;
    if (this.hit) {
      const h = this.hit;
      h.t += dt * 1.3;
      if (h.t >= h.c.dur) this.hit = null;
      else {
        // the clips open on the flinch and recover from it: layer their offset from the recovered last frame
        const w = smoothstep(0, 0.045, h.t) * (1 - smoothstep(h.c.dur * 0.45, h.c.dur, h.t));
        sample(h.c, h.t, this.q2, this.p2);
        sample(h.c, h.c.dur, this.q3, this.p3);
        for (let k = 0; k < UPPER.length; k++) {
          const i = UPPER[k];
          _qa.fromArray(this.q3, i * 4).invert().premultiply(_qb.fromArray(this.q2, i * 4)); // delta = hit(t) * hit(end)^-1
          _qb.identity().slerp(_qa, w);
          _qa.fromArray(q, i * 4).premultiply(_qb).toArray(q, i * 4);
        }
      }
    }

    // ── body dynamics ──
    // acceleration in the body frame -> lean into speed changes, bank into strafes
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const vx = -s.side * cy + s.fwd * sy, vz = s.side * sy + s.fwd * cy;
    if (!this.hasPrev) { this.prevVX = vx; this.prevVZ = vz; this.hasPrev = true; }
    const ax = (vx - this.prevVX) / Math.max(dt, 1e-4), az = (vz - this.prevVZ) / Math.max(dt, 1e-4);
    this.prevVX = vx; this.prevVZ = vz;
    this.accF = damp(this.accF, clamp(ax * sy + az * cy, -30, 30), 10, dt);
    this.accR = damp(this.accR, clamp(-(ax * cy - az * sy), -30, 30), 10, dt);
    const gnd = 1 - this.air;
    const lean = this.lean.step(clamp(this.accF * 0.011, -0.14, 0.16), 2.2, 0.6, dt) * gnd;
    const bank = this.bank.step(clamp(this.accR * 0.009, -0.12, 0.12) + clamp(s.side * 0.012, -0.08, 0.08), 2.0, 0.65, dt) * gnd;

    // pelvis: turn toward the travel direction, lean and bank about the feet
    this.preRot(0, _qa.setFromAxisAngle(_Y, psi));
    this.preRot(0, _qa.setFromAxisAngle(_X, lean + posture * 0.35));
    this.preRot(0, _qa.setFromAxisAngle(_Z, bank));
    p[2] += lean * 0.45; p[0] -= bank * 0.45;
    if (this.bounce > 0) {
      // rubber-hose timing: a springy dip on every footfall when moving (feet stay planted, the knees take it),
      // and standing still he bops along to a tune only he can hear: knees on the beat, head and chest swaying
      const k = this.bounce * gnd * (1 - lev);
      const foot = Math.pow(1 - Math.abs(Math.sin(this.phase * Math.PI * 2)), 3);
      const beat = this.idleT * 2.2, bop = Math.pow(0.5 - 0.5 * Math.cos(beat * Math.PI * 2), 2), sway = Math.sin(beat * Math.PI);
      const still = (1 - mw) * (1 - smoothstep(0, 0.2, this.castW));
      p[1] -= (foot * 0.045 * mw + bop * 0.03 * still) * k;
      this.preRot(I.chest, _qa.setFromAxisAngle(_Z, sway * 0.05 * still * k));
      this.preRot(I.head, _qa.setFromAxisAngle(_Z, -sway * 0.13 * still * k));
      this.preRot(I.head, _qa.setFromAxisAngle(_X, -bop * 0.06 * still * k));
      this.preRot(I.spine, _qa.setFromAxisAngle(_X, foot * 0.06 * mw * k));
    }
    // the spine untwists so the chest stays on the crosshair, and straightens some of the lean
    for (let k = 0; k < 3; k++) {
      const i = TORSO[k], w = TORSO_W[k];
      this.preRot(i, _qa.setFromAxisAngle(_Y, -psi * w));
      this.preRot(i, _qa.setFromAxisAngle(_X, -lean * w * 0.5 + posture * 0.65 * w));
      this.preRot(i, _qa.setFromAxisAngle(_Z, -bank * w * 0.7));
    }
    // hit recoil on top: a damped spring per axis, so a blow snaps the chest and it wobbles back
    const rP = this.recP.step(0, 3.4, 0.42, dt), rR = this.recR.step(0, 3.4, 0.42, dt), rY = this.recY.step(0, 3, 0.5, dt);
    if (Math.abs(rP) + Math.abs(rR) + Math.abs(rY) > 1e-3) {
      this.preRot(0, _qa.setFromAxisAngle(_X, rP * 0.25));
      for (let k = 0; k < 3; k++) {
        const i = TORSO[k], w = TORSO_W[k];
        this.preRot(i, _qa.setFromAxisAngle(_X, rP * w * 0.9));
        this.preRot(i, _qa.setFromAxisAngle(_Z, rR * w * 0.8));
        this.preRot(i, _qa.setFromAxisAngle(_Y, rY * w * 0.5));
      }
      this.preRot(I.head, _qa.setFromAxisAngle(_X, -rP * 0.5));
      p[2] += rP * 0.08; p[0] -= rR * 0.06;
    }
    // aim: the spine bends toward the camera pitch (arms follow, so attacks track the crosshair)
    const pitch = clamp(s.pitch, -0.9, 0.9) * (1 - this.air * 0.4);
    this.preRot(I.spine, _qa.setFromAxisAngle(_X, -pitch * 0.12));
    this.preRot(I.spine2, _qa.setFromAxisAngle(_X, -pitch * 0.18));
    this.preRot(I.chest, _qa.setFromAxisAngle(_X, -pitch * 0.2));
    // (the head keeps its own gaze when the torso is straightened)
    this.preRot(I.neck, _qa.setFromAxisAngle(_X, -pitch * 0.15 - posture * 0.45));
    this.preRot(I.head, _qa.setFromAxisAngle(_X, -pitch * 0.25 - posture * 0.45));

    // ── arms ──
    fkPose(set, q, p, Q, P, I.hipL);
    this.gestures(dt, s, pitch);
    this.clearArms();

    // ── legs ──
    this.solveLegs(dt, grounded && this.air < 0.25, yaw);

    this.last.set(q); this.lastP.set(p);
    this.apply();
  }

  /** local' = d * local (rotation in the parent's frame) */
  private preRot(i: number, d: THREE.Quaternion) {
    _qc.fromArray(this.q, i * 4).premultiply(d).toArray(this.q, i * 4);
  }
  /** Applies a model-space rotation `d` to bone i (expects this.Q to hold the current model-space pose of its parent). */
  private modelRot(i: number, d: THREE.Quaternion) {
    const pi = this.set.parent[i];
    const pq = pi < 0 ? this.set.armQ : this.Q[pi];
    // local' = P^-1 * d * P * local
    _qe.copy(pq).invert().multiply(d).multiply(pq).multiply(_qd.fromArray(this.q, i * 4)).toArray(this.q, i * 4);
    this.Q[i].premultiply(d);
  }

  /**
   * Attack gestures and the channel pose: evaluates each arm's hand path, turns the chest into the strike and
   * solves the arm onto its target along the crosshair. Expects this.Q / this.P to hold the upper body.
   */
  private gestures(dt: number, s: AnimState, pitch: number) {
    const set = this.set, Q = this.Q, P = this.P, A = this.armLen, lev = this.lev;
    const cpF = Math.cos(pitch * FLAT_PITCH), spF = Math.sin(pitch * FLAT_PITCH);
    let yaw = 0, lean = 0, any = false;
    for (let k = 0; k < 2; k++) {
      const a = this.arm[k], sgn = k ? -1 : 1;
      const sh = k ? I.shoulderR : I.shoulderL, hd = k ? I.handR : I.handL;
      // channel: the striking arm on the ground, both arms when floating
      const rw = this.reachW;
      const castK = this.castW * (k ? 1 : lev);
      const gw = this.guitarW;
      const cw = Math.max(castK, rw, gw);
      const casting = !a.g && cw > 0.01;
      const holding = rw <= 0.01 && gw > castK;
      a.flat = a.g ? !!a.g.flat : holding;
      const cp0 = a.flat ? cpF : Math.cos(pitch), sp0 = a.flat ? spF : Math.sin(pitch);
      if (!a.g && !casting && a.w < 0.005) { a.w = 0; a.cy = a.cp = 0; continue; }
      any = true;
      if (a.hold < 0 || (casting && a.w < 0.02)) {
        // capture the animated hand in aim space as the path's first point
        _v.subVectors(P[hd], P[sh]).divideScalar(A);
        a.p0[0] = _v.x * sgn; a.p0[1] = _v.y * cp0 - _v.z * sp0; a.p0[2] = _v.y * sp0 + _v.z * cp0;
        for (let i = 0; i < 3; i++) { a.sp[i].x = a.p0[i]; a.sp[i].v = 0; }
        a.hold = 0;
      }
      let tx: number, ty: number, tz: number, cy = 0, cpv = 0;
      if (a.g) {
        a.t += dt;
        const K = a.g.keys, last = K[K.length - 1];
        if (a.t >= last.t) {
          tx = last.p[0]; ty = last.p[1]; tz = last.p[2]; cy = last.cy; cpv = last.cp;
          // a body-held pose (the guitar) takes the hand straight back from the gesture's last key
          if (holding) { a.g = null; a.hold = 0; }
          else { a.w -= dt / a.g.out; if (a.w <= 0) { a.w = 0; a.g = null; } }
        } else {
          a.w = Math.min(1, a.w + dt * 28);
          let i = 0;
          while (K[i].t <= a.t) i++;
          // segment i-1 -> i (key -1 is the captured start)
          const t0 = i ? K[i - 1].t : 0, u = (a.t - t0) / (K[i].t - t0);
          const pA = i > 1 ? K[i - 2].p : a.p0, pB = i ? K[i - 1].p : a.p0, pC = K[i].p, pD = K[Math.min(K.length - 1, i + 1)].p;
          tx = cr(i ? pA[0] : pB[0], pB[0], pC[0], pD[0], u); ty = cr(i ? pA[1] : pB[1], pB[1], pC[1], pD[1], u); tz = cr(i ? pA[2] : pB[2], pB[2], pC[2], pD[2], u);
          const e = u * u * (3 - 2 * u);
          cy = lerp(i ? K[i - 1].cy : 0, K[i].cy, e); cpv = lerp(i ? K[i - 1].cp : 0, K[i].cp, e);
          a.hold = i + u; // key cursor, for the hand orientation
        }
      } else {
        a.w = damp(a.w, cw, rw > 0.01 ? 18 : 10, dt);
        if (rw > 0.01) { tx = REACH.p[0]; ty = REACH.p[1]; tz = REACH.p[2]; cy = 0; cpv = REACH.cp; }
        else if (holding) { const G = GUITAR[k]; tx = G.p[0]; ty = G.p[1] + Math.sin(s.time * 2.3 + k) * 0.012; tz = G.p[2]; }
        else {
          tx = lerp(CAST_UP.p[0], CAST_OPEN.p[0], lev); ty = lerp(CAST_UP.p[1], CAST_OPEN.p[1], lev) + Math.sin(s.time * 2.1 + k * 1.7) * 0.04; tz = lerp(CAST_UP.p[2], CAST_OPEN.p[2], lev);
          cy = lerp(CAST_UP.cy, CAST_OPEN.cy, lev); cpv = lerp(CAST_UP.cp, CAST_OPEN.cp, lev);
        }
      }
      a.sp[0].step(tx, SPR_F, SPR_Z, dt); a.sp[1].step(ty, SPR_F, SPR_Z, dt); a.sp[2].step(tz, SPR_F, SPR_Z, dt);
      a.cy = cy; a.cp = cpv;
      yaw -= sgn * cy * a.w; lean += cpv * a.w;
    }
    if (!any) return;

    // shoulders before the chest turns: the hand paths are anchored there, so the turn adds reach
    const s0 = _tgs[0].copy(P[I.shoulderL]), s1 = _tgs[1].copy(P[I.shoulderR]);
    if (Math.abs(yaw) > 1e-4 || Math.abs(lean) > 1e-4) {
      this.preRot(I.spine2, _qa.setFromAxisAngle(_Y, yaw * 0.4)); this.preRot(I.chest, _qa.setFromAxisAngle(_Y, yaw * 0.6));
      this.preRot(I.spine2, _qa.setFromAxisAngle(_X, lean * 0.5)); this.preRot(I.chest, _qa.setFromAxisAngle(_X, lean * 0.5));
      // the eyes stay on the target
      this.preRot(I.neck, _qa.setFromAxisAngle(_Y, -yaw * 0.45)); this.preRot(I.head, _qa.setFromAxisAngle(_Y, -yaw * 0.45));
      this.preRot(I.head, _qa.setFromAxisAngle(_X, -lean * 0.7));
      fkPose(set, this.q, this.p, Q, P, I.hipL);
    }
    for (let k = 0; k < 2; k++) {
      const a = this.arm[k];
      if (a.w <= 0.005) continue;
      const sgn = k ? -1 : 1;
      const cp0 = a.flat ? cpF : Math.cos(pitch), sp0 = a.flat ? spF : Math.sin(pitch);
      const g = a.g;
      // hand orientation: blend the keys around the cursor
      let h: V3 = CAST_UP.h, n: V3 = CAST_UP.n, el: V3 = CAST_UP.el, h2: V3 = CAST_OPEN.h, n2: V3 = CAST_OPEN.n, el2: V3 = CAST_OPEN.el, u = lev;
      if (g) {
        const K = g.keys, i = Math.min(K.length - 1, Math.floor(a.hold));
        u = Math.min(1, a.hold - i);
        const kb = K[i], ka = i ? K[i - 1] : K[0];
        h = ka.h; n = ka.n; el = ka.el; h2 = kb.h; n2 = kb.n; el2 = kb.el;
        if (a.t >= K[K.length - 1].t) u = 1;
      } else if (this.reachW > 0.01) { h = h2 = REACH.h; n = n2 = REACH.n; el = el2 = REACH.el; }
      else if (a.flat) { const G = GUITAR[k]; h = h2 = G.h; n = n2 = G.n; el = el2 = G.el; }
      const aim = (v: V3, w: V3, out: THREE.Vector3) => {
        const x = lerp(v[0], w[0], u) * sgn, y = lerp(v[1], w[1], u), z = lerp(v[2], w[2], u);
        return out.set(x, y * cp0 + z * sp0, -y * sp0 + z * cp0);
      };
      const origin = k ? s1 : s0;
      const x = a.sp[0].x * sgn, y = a.sp[1].x, z = a.sp[2].x;
      _tg.set(x, y * cp0 + z * sp0, -y * sp0 + z * cp0).multiplyScalar(this.armLen).add(origin);
      this.armIK(k, _tg, aim(h, h2, _v).normalize(), aim(n, n2, _v2), aim(el, el2, _v3), a.w);
    }
  }

  /** Solves one arm onto a hand target (model space) with the fingers along `dir`, palm facing `palm`, elbow toward `pole`. */
  private armIK(k: number, target: THREE.Vector3, dir: THREE.Vector3, palm: THREE.Vector3, pole: THREE.Vector3, w: number) {
    const sh = k ? I.shoulderR : I.shoulderL, el = k ? I.elbowR : I.elbowL, hd = k ? I.handR : I.handL;
    const Q = this.Q, P = this.P, q = this.q, par = this.set.parent[sh];
    solveTwoBone(Q, P, sh, el, hd, target, pole);
    // hand: fingers and palm as asked
    palm.addScaledVector(dir, -palm.dot(dir));
    if (palm.lengthSq() < 1e-6) palm.set(0, -1, 0).addScaledVector(dir, dir.y);
    palm.normalize();
    const R = this.handRest[k];
    _m.makeBasis(dir, palm, _v4.crossVectors(dir, palm)).multiply(_m2.copy(R.m).transpose());
    Q[hd].setFromRotationMatrix(_m).multiply(R.q);
    // share the wrist's twist with the forearm so neither joint wrings the sleeve
    _qa.copy(Q[el]).invert().multiply(Q[hd]);
    _qb.set(0, _qa.y, 0, _qa.w);
    if (_qb.lengthSq() > 1e-8) { _qb.normalize(); Q[el].multiply(_qc.identity().slerp(_qb, 0.5)); }
    // write back, blended over the animated pose
    _qa.copy(Q[par]).invert().multiply(Q[sh]);
    _qd.fromArray(q, sh * 4).slerp(_qa, w).toArray(q, sh * 4);
    _qa.copy(Q[sh]).invert().multiply(Q[el]);
    _qd.fromArray(q, el * 4).slerp(_qa, w).toArray(q, el * 4);
    _qa.copy(Q[el]).invert().multiply(Q[hd]);
    _qd.fromArray(q, hd * 4).slerp(_qa, w).toArray(q, hd * 4);
    // refresh the chain for the layers that follow
    const chain = k ? ARM_R : ARM_L;
    for (let j = 0; j < 3; j++) {
      const i = chain[j], pi = this.set.parent[i];
      P[i].fromArray(this.set.lp, i * 3).applyQuaternion(Q[pi]).add(P[pi]);
      Q[i].fromArray(q, i * 4).premultiply(Q[pi]);
    }
  }

  /**
   * Arms: mocap elbows flare (and jump poses spread) wider than these characters should carry them, so arms raised
   * out to the side are drawn in toward the body, but never closer than the rig's clearance angle (bulky jackets
   * and coats need room). Arms raised forward (aiming, striking) are left alone.
   */
  private clearArms() {
    const min = this.set.armMin * 0.75;
    const keep = lerp(0.55, 0.4, this.air);
    const chest = this.Q[I.chest];
    for (let k = 0; k < 2; k++) {
      const sh = k ? I.shoulderR : I.shoulderL, el = k ? I.elbowR : I.elbowL, sgn = k ? -1 : 1;
      const free = 1 - this.arm[k].w;
      // arm direction relative to the chest (torso bones rest unrotated in model space)
      _v.subVectors(this.P[el], this.P[sh]).normalize().applyQuaternion(_qa.copy(chest).invert());
      const horiz = Math.hypot(_v.x, _v.z), elev = Math.atan2(horiz, -_v.y);
      const lat = horiz > 1e-4 ? clamp((_v.x * sgn) / horiz, 0, 1) : 1;
      const ex = elev * lat - min;
      if (ex > 0) {
        // swing toward straight down
        const add = (1 - lerp(1, keep, free)) * ex * lat;
        if (add < 0.003 || horiz < 1e-4) continue;
        _v2.set(_v.z, 0, -_v.x).normalize().applyQuaternion(chest); // v x down
        this.modelRot(sh, _qc.setFromAxisAngle(_v2, add));
      } else {
        // hanging inside the clearance: swing outward about the chest's forward axis
        const hang = smoothstep(0.2, 0.75, -_v.y);
        const add = -ex * hang;
        if (add < 0.003) continue;
        _v2.set(0, 0, 1).applyQuaternion(chest);
        this.modelRot(sh, _qc.setFromAxisAngle(_v2, add * sgn));
      }
    }
  }

  /**
   * Legs: IK onto the foot goals. A foot that carries weight is pinned to its spot in the world (no skating
   * through blends, speed changes or turns); standing heroes take real steps when they turn on the spot.
   */
  private solveLegs(dt: number, allowed: boolean, yaw: number) {
    const set = this.set, Q = this.Q, P = this.P, q = this.q, p = this.p;
    const body = this.body;
    body.updateWorldMatrix(true, false);
    const M = body.matrixWorld;
    _inv.copy(M).invert();
    const idle = this.moveW < 0.35;
    const footY = set.footY;

    // world-space ankle targets; feet are pinned by the ball of the foot, which is what carries the weight
    const tg = _tgs, yawFix = _yawFix;
    for (let k = 0; k < 2; k++) {
      const L = this.lock[k], O = this.lock[1 - k];
      const g = this.goalP[k];
      const o = _v3.fromArray(set.lp, LEG[k][3] * 3).applyQuaternion(this.goalQ[k]); // ankle -> ball
      // blends can dip a heel or toe under the floor
      let h = Math.min(g.y - footY, g.y + o.y - this.ballY);
      if (allowed && h < 0) { g.y -= h; h = 0; }
      const w = _tg.copy(g).applyMatrix4(M); // ankle
      const bw = _v.copy(g).add(o).applyMatrix4(M); // ball
      // a foot only takes weight once it has stopped travelling over the ground (not while it skims in to land)
      const gv = Math.hypot(bw.x - L.px, bw.z - L.pz) / Math.max(dt, 1e-4);
      L.px = bw.x; L.pz = bw.z;
      const contact = allowed && h < (L.on ? 0.05 : 0.024) && (L.on || gv < 2.2);
      // teleported (respawn, blink): drop the pin instead of stepping back to it
      if ((L.on || L.step >= 0) && Math.hypot(bw.x - (L.step >= 0 ? L.sx : L.x), bw.z - (L.step >= 0 ? L.sz : L.z)) > 0.8) { L.on = false; L.step = -1; L.w = 0; }
      if (!allowed) { L.on = false; L.step = -1; }
      let bx = bw.x, bz = bw.z, lift = 0;
      yawFix[k] = 0;
      if (L.step >= 0) {
        // stepping to the animated spot
        L.step += dt / 0.2;
        const t = Math.min(1, L.step), e = t * t * (3 - 2 * t);
        bx = lerp(L.sx, bw.x, e); bz = lerp(L.sz, bw.z, e); lift = Math.sin(Math.PI * t) * 0.07;
        yawFix[k] = angleDiff(yaw, L.syaw) * (1 - e);
        if (t >= 1) { L.step = -1; L.on = true; L.x = bw.x; L.z = bw.z; L.yaw = yaw; L.w = 1; }
      } else {
        if (contact && !L.on) { L.on = true; L.x = bw.x; L.z = bw.z; L.yaw = yaw; }
        if (L.on) {
          const slip = Math.hypot(bw.x - L.x, bw.z - L.z), twist = Math.abs(angleDiff(L.yaw, yaw));
          if (!contact) L.on = false;
          else if (idle) {
            // standing: re-step once the foot is left behind or twisted, one foot at a time unless it is a big spin
            if ((slip > 0.11 || twist > 0.55) && (O.step < 0 || twist > 1.4) && L.w > 0.9) { L.on = false; L.step = 0; L.sx = L.x; L.sz = L.z; L.syaw = L.yaw; }
          } else if (slip > 0.3) L.on = false;
        }
        L.w = damp(L.w, L.on || L.step >= 0 ? 1 : 0, L.on ? 40 : 16, dt);
        if (L.step >= 0) { bx = L.sx; bz = L.sz; yawFix[k] = angleDiff(yaw, L.syaw); }
        else if (L.w > 0.001) { bx = lerp(bw.x, L.x, L.w); bz = lerp(bw.z, L.z, L.w); yawFix[k] = angleDiff(yaw, L.yaw) * L.w; }
      }
      // ankle from the ball: the foot pivots on its ball when it is held against a turn
      const ox = bw.x - w.x, oz = bw.z - w.z, c = Math.cos(yawFix[k]), sn = Math.sin(yawFix[k]);
      tg[k].set(bx - (ox * c + oz * sn), w.y + lift, bz - (-ox * sn + oz * c));
    }

    // pelvis drops a little when a pinned foot would otherwise be out of reach
    let need = 0;
    for (let k = 0; k < 2; k++) {
      tg[k].applyMatrix4(_inv);
      const hj = P[LEG[k][0]];
      const d = hj.distanceTo(tg[k]) - this.legLen * 0.992;
      if (d > need) need = d;
    }
    this.hipDrop = damp(this.hipDrop, Math.min(need, 0.1), need > this.hipDrop ? 30 : 8, dt);
    p[1] -= this.hipDrop;
    fkPose(set, q, p, Q, P, 1);
    for (let k = 0; k < 2; k++) {
      const h = LEG[k][0], kn = LEG[k][1], f = LEG[k][2];
      // leg chain from the adjusted pelvis
      for (let j = 0; j < 3; j++) {
        const i = LEG[k][j], pi = set.parent[i];
        P[i].fromArray(set.lp, i * 3).applyQuaternion(Q[pi]).add(P[pi]);
        Q[i].fromArray(q, i * 4).premultiply(Q[pi]);
      }
      solveTwoBone(Q, P, h, kn, f, tg[k]);
      Q[f].copy(this.goalQ[k]).premultiply(_qa.setFromAxisAngle(_Y, yawFix[k]));
      _qa.copy(Q[0]).invert().multiply(Q[h]).toArray(q, h * 4);
      _qa.copy(Q[h]).invert().multiply(Q[kn]).toArray(q, kn * 4);
      _qa.copy(Q[kn]).invert().multiply(Q[f]).toArray(q, f * 4);
    }
  }

  private apply() {
    const b = this.b, q = this.q;
    for (let i = 0; i < NB; i++) b[i].quaternion.fromArray(q, i * 4);
    b[0].position.fromArray(this.p);
  }
}
