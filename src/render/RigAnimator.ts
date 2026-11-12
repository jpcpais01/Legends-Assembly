import * as THREE from 'three';
import type { AnimState, RigBones } from './HeroRig';
import { clamp, damp, lerp, smoothstep, angleDiff, TAU } from '../core/math';

/** Damped spring (semi-implicit Euler, sub-stepped so it stays stable at low frame rates). */
class Spring {
  v = 0;
  constructor(public x = 0) {}
  step(target: number, freq: number, zeta: number, dt: number) {
    const w = TAU * freq;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (w * w * (target - this.x) - 2 * zeta * w * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  reset(x = 0) { this.x = x; this.v = 0; }
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qInv = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _a = new THREE.Vector3(), _p = new THREE.Vector3(), _t = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _rel = new THREE.Vector3(), _air = new THREE.Vector3(), _pole = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);

interface LegRig { hip: THREE.Object3D; knee: THREE.Object3D; foot: THREE.Object3D; joint: THREE.Vector3; L1: number; L2: number; side: 1 | -1 }

const easeInOut = (s: number) => s * s * (3 - 2 * s);

export type AttackKind = 'flick' | 'ring' | 'stroke' | 'throw' | 'toss';
export type MotionStyle = 'default' | 'swagger' | 'scholar' | 'artist';

/**
 * One key of an attack gesture, for the attacking arm. Angles in radians, side-relative:
 * x = shoulder pitch (negative raises the arm forward), z = shoulder abduction (positive = away from the body),
 * e = elbow bend (negative bends), w = wrist flex, cy = chest yaw driving the attacking shoulder forward,
 * cp = chest pitch (positive leans in), hp = how much of the aim pitch the arm follows.
 */
interface GKey { t: number; x: number; z: number; e: number; w: number; cy: number; cp: number; hp: number }
interface Gesture { keys: GKey[]; end: number; dip: number; shake?: number; off?: { x: number; z: number; e: number } }
const k = (t: number, x: number, z: number, e: number, w: number, cy: number, cp: number, hp = 1): GKey => ({ t, x, z, e, w, cy, cp, hp });
/** Anticipation, strike, follow-through, recovery. The arm springs track these, so they overshoot and settle. */
const GESTURES: Record<AttackKind, Gesture> = {
  // quick alternating palm thrust (Einstein's photons)
  flick: { end: 0.34, dip: 0.25, keys: [k(0, -0.45, 0.22, -1.6, 0.35, -0.2, -0.02), k(0.05, -0.3, 0.28, -2.05, 0.5, -0.3, -0.05), k(0.1, -1.55, 0.02, -0.1, -0.35, 0.3, 0.08), k(0.2, -1.45, 0.06, -0.28, -0.1, 0.22, 0.05), k(0.34, -1.15, 0.12, -0.7, 0, 0.08, 0.02)] },
  // bell raised high, then snapped down and shaken (Yeat)
  ring: { end: 0.62, dip: 0.6, shake: 1, keys: [k(0, -1.4, 0.35, -1.2, 0.3, -0.1, -0.06, 0.4), k(0.09, -2.35, 0.42, -1.05, 0.6, -0.22, -0.14, 0.2), k(0.17, -1.25, 0.18, -0.35, -0.55, 0.32, 0.16), k(0.32, -1.35, 0.22, -0.45, -0.2, 0.22, 0.1), k(0.62, -1.1, 0.25, -0.75, 0, 0.05, 0.02)] },
  // diagonal brush stroke from high-outside across the body (Van Gogh)
  stroke: { end: 0.56, dip: 0.4, keys: [k(0, -1.4, 0.55, -0.9, 0.3, -0.2, -0.04), k(0.1, -2.15, 0.95, -0.75, 0.55, -0.42, -0.1), k(0.21, -1.05, -0.38, -0.2, -0.45, 0.42, 0.14), k(0.34, -0.8, -0.5, -0.35, -0.2, 0.34, 0.1), k(0.56, -0.9, 0.0, -0.7, 0, 0.08, 0.02)] },
  // overhand throw: cock the arm behind the head, whip it through (Einstein's gravity orb)
  throw: { end: 0.72, dip: 0.8, keys: [k(0, -1.6, 0.5, -1.4, 0.2, -0.25, -0.08, 0.3), k(0.14, -2.75, 0.55, -2.0, 0.5, -0.5, -0.2, 0), k(0.25, -1.35, 0.1, -0.15, -0.5, 0.5, 0.26), k(0.42, -0.75, -0.2, -0.3, -0.2, 0.38, 0.18, 0.5), k(0.72, -0.6, 0.1, -0.6, 0, 0.08, 0.03, 0.3)] },
  // underhand lob (Van Gogh's seeds)
  toss: { end: 0.66, dip: 0.55, keys: [k(0, -0.2, 0.2, -0.3, 0.1, -0.1, 0.04, 0), k(0.13, 0.65, 0.25, -0.2, 0.3, -0.28, 0.12, 0), k(0.26, -1.55, 0.05, -0.35, -0.4, 0.3, -0.04, 0.4), k(0.42, -1.95, 0.1, -0.45, -0.2, 0.2, -0.06, 0.4), k(0.66, -1.2, 0.15, -0.6, 0, 0.05, 0, 0.3)] },
};

interface ArmGesture { g: Gesture | null; t: number; struck: boolean; x: Spring; z: Spring; e: Spring; w: Spring }

/**
 * Procedural locomotion with real foot placement.
 * - Distance-driven gait: cadence and stride follow ground speed, stance feet stay planted (two-bone leg IK).
 * - 8-way movement: the pelvis turns toward the move direction, the chest counter-twists to keep aiming.
 * - Weight: lean into acceleration, bank into turns, spring overshoot when stopping, landing compression.
 * - Idle: combat stance with contrapposto weight shift and breathing; feet stay put and re-step when turning.
 * - Jump / fall / levitate poses, hit flinch, gravity-driven death fall.
 * Works on both procedural rigs and auto-rigged Meshy GLBs (limb bones point -Y down the limb).
 */
export class RigAnimator {
  private legs: [LegRig, LegRig];
  private hipsY0: number;
  private ankleY0: number;
  private legLen: number;
  /** armature units per meter */
  private upm: number;
  private armOut: number;

  private phase = 0;
  private moveW = 0;
  private runK = 0;
  private psi = 0; // pelvis yaw relative to aim
  private moveDir = 0;
  private backpedal = false;
  private legYaw: number | null = null; // world yaw of the planted lower body while idle
  private turnStep = 0; // 0..1 progress of an idle re-step
  private turnFrom = 0;
  private prevWX = 0; private prevWZ = 0;
  private accF = 0; private accR = 0;
  private air = 0;
  private rise = 0;
  private wasGrounded = true;
  private lastVy = 0;
  private airLead: 1 | -1 = 1;
  private lastHit = 0;
  private lastAttack = 0;

  private pitchS = new Spring();
  private bankS = new Spring();
  private dropS = new Spring();
  private headS = new Spring();
  private armLS = new Spring();
  private armRS = new Spring();

  private armG: [ArmGesture, ArmGesture] = [0, 1].map(() => ({ g: null, t: 0, struck: false, x: new Spring(), z: new Spring(), e: new Spring(), w: new Spring() })) as [ArmGesture, ArmGesture];
  private chestYawS = new Spring();
  private chestPitchS = new Spring();
  private twistS = new Spring();
  private style: MotionStyle;

  private deadT = 0;
  private fallA = 0; private fallV = 0; private fallSide = 0;

  constructor(private r: RigBones, opts: { armOut?: number; style?: MotionStyle } = {}) {
    this.armOut = opts.armOut ?? 0;
    this.style = opts.style ?? 'default';
    this.hipsY0 = r.hips.position.y;
    const mk = (hip: THREE.Object3D, knee: THREE.Object3D, foot: THREE.Object3D, side: 1 | -1): LegRig => ({
      hip, knee, foot, side, joint: hip.position.clone(), L1: Math.max(1e-3, knee.position.length()), L2: Math.max(1e-3, foot.position.length()),
    });
    this.legs = [mk(r.hipL, r.kneeL, r.footL, 1), mk(r.hipR, r.kneeR, r.footR, -1)];
    this.legLen = (this.legs[0].L1 + this.legs[0].L2 + this.legs[1].L1 + this.legs[1].L2) / 2;
    // rest ankle height + unit scale, measured in the hips' parent (armature) space
    const space = r.hips.parent ?? r.body;
    r.body.updateWorldMatrix(true, true);
    const ay = (f: THREE.Object3D) => space.worldToLocal(f.getWorldPosition(new THREE.Vector3())).y;
    this.ankleY0 = (ay(r.footL) + ay(r.footR)) / 2;
    const bodyS = r.body.getWorldScale(new THREE.Vector3()).y;
    const spaceS = space.getWorldScale(new THREE.Vector3()).y;
    this.upm = bodyS / Math.max(1e-6, spaceS);
  }

  update(dt: number, s: AnimState) {
    const r = this.r;
    dt = Math.min(dt, 1 / 20);
    const t = s.time;
    const upm = this.upm;
    const yaw = s.yaw ?? 0;

    if (s.dead) { this.updateDead(dt); return; }
    if (this.deadT > 0) {
      this.deadT = 0; this.fallA = 0; this.fallV = 0;
      r.body.rotation.set(0, 0, 0); r.body.position.set(0, 0, 0);
      this.dropS.reset(); this.pitchS.reset(); this.bankS.reset();
      this.legYaw = null;
    }

    // ── velocity in model space (model faces +z, left = +x) ──
    const mx = -s.side, mz = s.fwd;
    const speed = s.speed;
    // world-space acceleration -> local (forward / right) for leaning + banking
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const wx = mx * cy + mz * sy, wz = -mx * sy + mz * cy;
    const ax = (wx - this.prevWX) / Math.max(dt, 1e-4), az = (wz - this.prevWZ) / Math.max(dt, 1e-4);
    this.prevWX = wx; this.prevWZ = wz;
    const alx = ax * cy - az * sy, alz = ax * sy + az * cy;
    this.accF = damp(this.accF, clamp(alz, -40, 40), 12, dt);
    this.accR = damp(this.accR, clamp(-alx, -40, 40), 12, dt);

    // ── ground / air state ──
    const grounded = s.grounded && s.levitate < 0.05;
    const vy = s.vy ?? 0;
    if (!grounded && this.wasGrounded) this.airLead = Math.sin(this.phase * TAU) > 0 ? 1 : -1;
    if (grounded && !this.wasGrounded) {
      // landing: compress the legs, harder for bigger falls
      const impact = clamp(-this.lastVy / 12, 0.15, 1.1);
      this.dropS.v -= impact * 2.4;
      this.pitchS.v += impact * 1.6;
      this.armLS.v += impact * 3; this.armRS.v += impact * 3;
    }
    this.wasGrounded = grounded;
    this.lastVy = vy;
    this.air = damp(this.air, grounded ? 0 : 1, grounded ? 18 : 9, dt);
    this.rise = damp(this.rise, smoothstep(-3, 2.5, vy), 8, dt);

    // ── gait parameters ──
    const moving = speed > 0.35;
    this.moveW = damp(this.moveW, smoothstep(0.3, 1.6, speed), moving ? 9 : 7, dt);
    this.runK = damp(this.runK, smoothstep(2.4, 4.6, speed), 6, dt);
    const runK = this.runK, mw = this.moveW;
    const stepFreq = lerp(1.6 + 0.26 * speed, 2.2 + 0.22 * speed, runK);
    const duty = lerp(0.6, 0.26, runK);
    const hDrop = (r.hips.position.y + (this.legs[0].joint.y + this.legs[1].joint.y) / 2 - this.ankleY0) / upm;
    const L = this.legLen / upm * 0.985;
    const maxStance = Math.sqrt(Math.max(0.0025, L * L - hDrop * hDrop)) * 2.2;
    const fc = Math.max(stepFreq / 2, speed * duty / (maxStance * 1.15));
    const stanceLen = Math.min(speed * duty / fc, maxStance);
    if (grounded) this.phase = (this.phase + fc * dt * (moving ? 1 : mw)) % 1;

    // ── pelvis direction: 8-way (forward / strafe / backpedal) ──
    if (moving) {
      this.moveDir = Math.atan2(mx, mz);
      if (mz < -0.35 * speed) this.backpedal = true;
      else if (mz > 0.35 * speed) this.backpedal = false;
    }
    const dirRel = this.backpedal ? angleDiff(0, this.moveDir - Math.PI) : this.moveDir;
    let psiTarget = clamp(dirRel * 0.6, -0.8, 0.8) * mw;

    // idle: keep the feet planted while the upper body turns, then re-step
    if (!moving && grounded && mw < 0.2) {
      if (this.legYaw === null) this.legYaw = yaw + this.psi;
      let rel = angleDiff(yaw, this.legYaw);
      if (this.turnStep <= 0 && Math.abs(rel) > 0.75) { this.turnStep = 1e-4; this.turnFrom = rel; }
      if (this.turnStep > 0) {
        this.turnStep = Math.min(1, this.turnStep + dt / 0.34);
        rel = this.turnFrom * (1 - easeInOut(this.turnStep));
        this.legYaw = yaw + rel;
        if (this.turnStep >= 1) this.turnStep = 0;
      }
      psiTarget = rel;
      this.psi = psiTarget;
    } else {
      this.legYaw = null; this.turnStep = 0;
      this.psi = damp(this.psi, psiTarget, 9, dt);
    }
    const psi = this.psi;

    // ── attack gestures: per-arm timelines (anticipation -> strike -> follow-through), whole body drives them ──
    const attackRise = s.attack > this.lastAttack + 0.3;
    this.lastAttack = s.attack;
    if (attackRise) {
      const kind: AttackKind = s.attackKind ?? (this.style === 'swagger' ? 'ring' : this.style === 'artist' ? 'stroke' : 'flick');
      const arm = this.armG[kind === 'ring' || s.attackSide >= 0 ? 1 : 0];
      arm.g = GESTURES[kind]; arm.t = 0; arm.struck = false;
    }
    let gYaw = 0, gPitch = 0;
    const gPose: ({ x: number; z: number; e: number; w: number; wgt: number } | null)[] = [null, null];
    for (let i = 0; i < 2; i++) {
      const a = this.armG[i];
      if (!a.g) continue;
      a.t += dt;
      const g = a.g;
      if (a.t > g.end + 0.3) { a.g = null; continue; }
      const keys = g.keys;
      let j = 0;
      while (j < keys.length - 2 && a.t > keys[j + 1].t) j++;
      const k0 = keys[j], k1 = keys[j + 1];
      const u = easeInOut(clamp((a.t - k0.t) / Math.max(1e-3, k1.t - k0.t), 0, 1));
      const L = (p: keyof GKey) => lerp(k0[p], k1[p], u);
      const wgt = 1 - smoothstep(g.end - 0.04, g.end + 0.3, a.t);
      const pose = { x: L('x') - s.pitch * L('hp'), z: L('z'), e: L('e'), w: L('w'), wgt };
      if (g.shake && a.t > keys[2].t) {
        const ts = a.t - keys[2].t, d = Math.exp(-ts * 6.5);
        pose.w += Math.sin(ts * 46) * 0.55 * d;
        pose.e += Math.sin(ts * 46 + 1.2) * 0.14 * d;
        pose.x += Math.sin(ts * 23) * 0.08 * d;
      }
      gPose[i] = pose;
      const drive = i === 1 ? 1 : -1; // right arm forward = chest turns left (+y)
      gYaw += L('cy') * drive * wgt;
      gPitch += L('cp') * wgt;
      if (!a.struck && a.t >= keys[2].t - 0.02) {
        a.struck = true;
        this.dropS.v -= g.dip * 0.75;
        this.pitchS.v += g.dip * 0.9;
        this.headS.v += g.dip * 1.2;
      }
    }
    const gy = this.chestYawS.step(gYaw, 6.5, 0.5, dt);
    const gp = this.chestPitchS.step(gPitch, 6, 0.55, dt);

    // ── hips ──
    const cyc = this.phase * TAU;
    const bobAmp = lerp(0.022, -0.045, runK) * mw;
    const bob = bobAmp * Math.cos(2 * (cyc - duty * Math.PI));
    const crouch = lerp(0.035, 0.1, runK * mw) * this.legLen / upm;
    const breathe = Math.sin(t * 2.0) * 0.004;
    const drop = this.dropS.step(0, 2.6, 0.5, dt);
    this.dropS.x = Math.max(this.dropS.x, -0.22);
    const shift = Math.sin(t * 0.8) * (1 - mw) * (1 - this.air); // contrapposto weight shift
    const pelvisTwist = -0.13 * Math.cos(cyc) * mw * (0.5 + 0.5 * runK) * (this.backpedal ? -0.6 : 1);
    r.hips.position.y = this.hipsY0 + (bob - crouch + breathe + drop - Math.abs(shift) * 0.012) * upm + this.air * 0.04 * upm * (1 - s.levitate);
    // weight rides over the stance foot (strongest when walking)
    const sway = Math.cos(cyc - duty * Math.PI) * lerp(0.03, 0.012, runK) * mw * (this.style === 'swagger' ? 1.4 : 1);
    r.hips.position.x = (shift * 0.025 + sway) * upm;
    r.hips.rotation.set(0, psi + pelvisTwist + gy * 0.25, -shift * 0.05 + Math.sin(cyc) * 0.035 * mw * (1 - runK * 0.5) - sway * 0.6);

    // ── legs (two-bone IK) ──
    r.hips.updateMatrix();
    _qInv.copy(r.hips.quaternion).invert();
    const stepLift = this.turnStep > 0 ? Math.sin(this.turnStep * Math.PI) * 0.07 : 0;
    for (const leg of this.legs) {
      const lp = (this.phase + (leg.side === 1 ? 0 : 0.5)) % 1;
      let along = 0, lift = 0, toe = 0;
      if (lp < duty) {
        const k = lp / duty;
        along = (0.42 - k) * stanceLen;
        toe = lerp(-0.22, 0, smoothstep(0, 0.25, k)) + smoothstep(0.62, 1, k) * lerp(0.35, 0.65, runK);
        lift = smoothstep(0.6, 1, k) * lerp(0.03, 0.09, runK);
      } else {
        const k = (lp - duty) / (1 - duty);
        along = (easeInOut(Math.pow(k, lerp(1, 1.35, runK))) * 1.0 - 0.58) * stanceLen;
        const liftH = lerp(0.09, 0.3, runK) * clamp(speed / 4.5, 0.35, 1.05);
        lift = liftH * Math.sin(Math.PI * Math.pow(k, lerp(1, 0.7, runK)));
        toe = lerp(0.65, -0.25, smoothstep(0.1, 0.9, k)) * lerp(0.5, 1, runK);
      }
      along *= mw; lift *= mw; toe *= mw;
      // movement direction in the pelvis frame (feet track it), stance width narrows when running
      const ux = Math.sin(this.moveDir - psi), uz = Math.cos(this.moveDir - psi);
      const width = lerp(1.18, 0.78, runK * mw);
      const stagger = (1 - mw) * (leg.side === 1 ? 0.07 : -0.05); // combat stance: left foot slightly forward
      const idleStep = leg.side === (this.turnFrom > 0 ? 1 : -1) ? stepLift : stepLift * 0.4;
      // ground target in pelvis-yawed body space (meters), then into hips space
      _p.set(
        leg.joint.x * width + ux * along * upm,
        this.ankleY0 + (lift + idleStep) * upm,
        leg.joint.z + (uz * along + stagger) * upm,
      );
      _p.applyAxisAngle(_y.set(0, 1, 0), psi);
      _rel.copy(_p).sub(r.hips.position).applyQuaternion(_qInv).sub(leg.joint);

      // air / levitate pose (relative to the hip joint)
      const airW = Math.max(this.air, s.levitate);
      if (airW > 0.001) {
        const L = this.legLen;
        const lead = leg.side === this.airLead;
        if (s.levitate > 0.01) {
          const sw = Math.sin(t * 1.6 + leg.side) * 0.04;
          _air.set(0, -0.93 * L, (0.06 + sw) * L * (lead ? 1 : 0.4));
        } else {
          const rz = lead ? 0.3 : -0.22, ry = lead ? -0.6 : -0.86; // tucked knee / trailing leg
          const fz = lead ? 0.12 : 0.0, fy = lead ? -0.86 : -0.92; // reach for the ground when falling
          _air.set(0, lerp(fy, ry, this.rise) * L, lerp(fz, rz, this.rise) * L);
        }
        _rel.lerp(_air, airW);
        toe = lerp(toe, s.levitate > 0.01 ? 0.75 : lerp(0.25, 0.45, this.rise), airW);
      }

      // knee pole: forward along the feet, slightly outward
      _pole.set(leg.side * 0.12, 0, 1).applyAxisAngle(_y.set(0, 1, 0), psi).applyQuaternion(_qInv);
      this.solveLeg(leg, _rel, _pole);

      // foot orientation: flat on the ground (yawed with the pelvis), toe pitch on top
      _e.set(toe, psi + leg.side * 0.08, 0, 'YXZ');
      _q.setFromEuler(_e).premultiply(_qInv);
      _q2.copy(leg.hip.quaternion).multiply(leg.knee.quaternion).invert();
      leg.foot.quaternion.copy(_q2.multiply(_q));
    }

    // ── torso: lean into acceleration, bank into turns, overshoot when stopping ──
    const hit = s.hit ?? 0;
    if (hit > this.lastHit + 0.3) {
      this.pitchS.v -= 2.6;
      this.bankS.v += (Math.random() - 0.5) * 3;
      this.headS.v -= 4;
    }
    this.lastHit = hit;
    const st = this.style;
    const posture = st === 'scholar' ? 0.09 : st === 'artist' ? 0.04 : st === 'swagger' ? -0.03 : 0;
    const leanTarget = posture + 0.12 * runK * mw * (this.backpedal ? -0.4 : 1) + clamp(this.accF * 0.024, -0.26, 0.34) + s.dash * 0.5 + this.air * (0.08 - 0.18 * this.rise);
    const lean = this.pitchS.step(leanTarget, 2.2, 0.42, dt);
    const bank = this.bankS.step(clamp(this.accR * 0.018, -0.32, 0.32), 2, 0.5, dt);
    const shoulderCounter = 0.2 * Math.cos(cyc) * mw * (0.4 + 0.6 * runK);
    const pitch = s.pitch;
    // the chest follows the pelvis twist with a little lag, so direction changes ripple up the spine
    const twist = this.twistS.step(-(psi + pelvisTwist), 4.5, 0.7, dt);
    // swagger: shoulders roll with each step
    const roll = st === 'swagger' ? Math.sin(cyc) * 0.07 * mw : 0;
    r.spine.rotation.set(lean * 0.6 - pitch * 0.2 + gp * 0.4, twist * 0.55 + gy * 0.4, bank * 0.6 + shift * 0.04 + roll * 0.5);
    r.chest.rotation.set(lean * 0.4 - pitch * 0.25 + Math.sin(t * 2.0) * 0.012 + gp * 0.6, twist * 0.45 + shoulderCounter + gy * 0.6, bank * 0.4 + roll);

    // ── head: stabilized gaze (keeps looking at the target while the body works) ──
    const headKick = this.headS.step(0, 3.5, 0.35, dt);
    const nod = st === 'swagger' ? Math.sin(t * 3.6) * 0.035 * (1 - mw) + Math.cos(cyc * 2) * 0.03 * mw : 0;
    r.neck.rotation.set(-lean * 0.3 - gp * 0.4 + posture * 0.6, -shoulderCounter * 0.4 - gy * 0.45, -bank * 0.4 - roll * 0.5);
    r.head.rotation.set(-pitch * 0.45 - lean * 0.45 + headKick * 0.25 - gp * 0.4 - posture + nod, -shoulderCounter * 0.5 - gy * 0.5 + Math.sin(t * 0.55) * 0.06 * (1 - mw), -bank * 0.3 + (st === 'artist' ? 0.06 : 0));

    // ── arms: locomotion pose ──
    const swingK = st === 'swagger' ? 1.15 : st === 'scholar' ? 0.8 : 1;
    const swingAmp = lerp(0.32, 0.72, runK) * mw * (this.backpedal ? 0.5 : 1) * swingK;
    const swing = Math.cos(cyc);
    let lx = this.armLS.step(swingAmp * swing + 0.06 - this.air * 0.5 * this.rise, 3.2, 0.5, dt);
    let rx = this.armRS.step(-swingAmp * swing + 0.06 - this.air * 0.5 * this.rise, 3.2, 0.5, dt);
    const spread = 0.1 + this.armOut + 0.08 * runK * mw + Math.sin(t * 1.3) * 0.015 + this.air * 0.45 + (st === 'swagger' ? 0.08 : 0);
    // hands drift toward the midline on the forward swing
    let lz = spread - Math.max(0, -lx) * 0.18 * runK, rz = -spread + Math.max(0, -rx) * 0.18 * runK;
    const pump = Math.sin(cyc * 2) * 0.12 * runK * mw;
    // elbows bend more as the arm swings forward
    let le = -0.22 - lerp(0.15, 1.2, runK) * mw - pump - Math.max(0, -lx) * 0.35 * mw;
    let re = -0.22 - lerp(0.15, 1.2, runK) * mw + pump - Math.max(0, -rx) * 0.35 * mw;
    // weapon-ready right arm, steadier while sprinting
    const aimPose = 0.32 * (1 - 0.35 * runK * mw);
    rx = lerp(rx, -1.0 - pitch * 0.6, aimPose);
    re = lerp(re, -0.75, aimPose);

    // ── arms: blend in the attack gestures through fast springs (overshoot + settle reads as weight) ──
    const base = [[lx, lz, le], [rx, -rz, re]];
    const out: number[][] = [];
    for (let i = 0; i < 2; i++) {
      const a = this.armG[i], gp2 = gPose[i];
      let [x, z, e] = base[i];
      let w = 0;
      if (gp2) { x = lerp(x, gp2.x, gp2.wgt); z = lerp(z, gp2.z, gp2.wgt); e = lerp(e, gp2.e, gp2.wgt); w = gp2.w * gp2.wgt; }
      const active = !!gp2;
      const f = active ? 10 : 7;
      out.push([a.x.step(x, f, 0.5, dt), a.z.step(z, f, 0.6, dt), a.e.step(e, f * 1.1, 0.5, dt), a.w.step(w, 12, 0.45, dt)]);
    }
    [lx, lz, le] = out[0]; [rx, rz, re] = out[1]; rz = -rz;
    if (s.cast > 0) {
      lx = lerp(lx, -2.7, s.cast); rx = lerp(rx, -2.7, s.cast);
      lz = lerp(lz, 0.35, s.cast); rz = lerp(rz, -0.35, s.cast);
      le = lerp(le, -0.15, s.cast); re = lerp(re, -0.15, s.cast);
      r.chest.rotation.x -= 0.12 * s.cast;
    }
    if (s.levitate > 0) {
      lz = lerp(lz, 1.25, s.levitate); rz = lerp(rz, -1.25, s.levitate);
      lx = lerp(lx, -0.3, s.levitate); rx = lerp(rx, -0.3, s.levitate);
    }
    if (s.dash > 0) { lx = lerp(lx, 0.9, s.dash); rx = lerp(rx, 0.9, s.dash); le = lerp(le, -0.3, s.dash); re = lerp(re, -0.3, s.dash); }
    r.shoulderL.rotation.set(lx, 0, lz);
    r.shoulderR.rotation.set(rx, 0, rz);
    r.elbowL.rotation.set(le, 0, 0);
    r.elbowR.rotation.set(re, 0, 0);
    r.handL.rotation.set(out[0][3], 0, 0);
    r.handR.rotation.set(out[1][3], 0, 0);
  }

  /** Two-bone IK: hip rotation as a basis (knee hinge = local X), knee as a pure hinge. `rel` is hip-joint -> ankle in hips space. */
  private solveLeg(leg: LegRig, rel: THREE.Vector3, pole: THREE.Vector3) {
    const { L1, L2 } = leg;
    const d = clamp(rel.length(), Math.abs(L1 - L2) + 1e-3, (L1 + L2) * 0.9995);
    _a.copy(rel).normalize();
    if (!Number.isFinite(_a.x) || _a.lengthSq() < 0.5) _a.set(0, -1, 0);
    const cosG = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
    const g = Math.acos(cosG);
    _p.copy(pole).addScaledVector(_a, -_a.dot(pole));
    if (_p.lengthSq() < 1e-8) _p.set(0, 0, 1);
    _p.normalize();
    _t.copy(_a).multiplyScalar(Math.cos(g)).addScaledVector(_p, Math.sin(g)); // thigh dir
    // shin dir = (a*d - thigh*L1) / L2
    _x.copy(_a).multiplyScalar(d).addScaledVector(_t, -L1).normalize();
    const knee = Math.acos(clamp(_t.dot(_x), -1, 1));
    _y.copy(_t).negate();
    _z.copy(_p).addScaledVector(_t, -_t.dot(_p)).normalize();
    _x.crossVectors(_y, _z);
    _m.makeBasis(_x, _y, _z);
    leg.hip.quaternion.setFromRotationMatrix(_m);
    leg.knee.quaternion.setFromAxisAngle(X_AXIS, knee);
  }

  /** Knees buckle, then the body tips over under gravity and bounces once. */
  private updateDead(dt: number) {
    const r = this.r;
    if (this.deadT === 0) { this.fallSide = (Math.random() - 0.5) * 0.5; this.fallA = 0; this.fallV = 0.4; }
    this.deadT += dt;
    const buckle = smoothstep(0, 0.28, this.deadT);
    if (this.deadT > 0.1) {
      this.fallV += (4 + 22 * Math.sin(this.fallA + 0.15)) * dt;
      this.fallA += this.fallV * dt;
      if (this.fallA > 1.48) { this.fallA = 1.48; this.fallV = Math.abs(this.fallV) > 0.6 ? -this.fallV * 0.22 : 0; }
    }
    r.body.rotation.set(-this.fallA, 0, this.fallSide * this.fallA * 0.4);
    r.body.position.y = 0.06 * Math.sin(this.fallA) - 0.3 * buckle * (1 - this.fallA / 1.48);
    r.hips.rotation.set(0, 0, 0);
    r.hips.position.y = this.hipsY0;
    const limp = smoothstep(0.3, 0.9, this.deadT);
    for (const leg of this.legs) {
      const settle = smoothstep(0.35, 1.0, this.deadT);
      leg.hip.rotation.set(lerp(lerp(0, -0.9, buckle), leg.side === 1 ? -0.15 : 0.05, settle), 0, leg.side * (0.12 + 0.1 * settle));
      leg.knee.rotation.set(lerp(lerp(0, 1.3, buckle), leg.side === 1 ? 0.35 : 0.15, settle), 0, 0);
      leg.foot.rotation.set(0.3 * buckle, 0, 0);
    }
    r.spine.rotation.set(0.25 * buckle, 0, 0);
    r.chest.rotation.set(0.1 * buckle, 0, 0);
    r.neck.rotation.set(0, 0, 0);
    r.head.rotation.set(lerp(0.3, -0.4, limp), 0.3 * limp * Math.sign(this.fallSide || 1), 0);
    const flail = Math.sin(Math.min(1, this.deadT * 2.5) * Math.PI);
    r.shoulderL.rotation.set(lerp(-0.8 * flail, -2.4, limp), 0, 0.3 + flail * 0.9 + 0.5 * limp);
    r.shoulderR.rotation.set(lerp(-0.8 * flail, -2.2, limp), 0, -0.3 - flail * 0.9 - 0.6 * limp);
    r.elbowL.rotation.set(-0.5 * (1 - limp) - 0.2, 0, 0);
    r.elbowR.rotation.set(-0.5 * (1 - limp) - 0.2, 0, 0);
  }
}
