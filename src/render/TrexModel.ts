import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { makeHeroFxUniforms, patchHeroMaterial, type HeroFxUniforms } from './materials';
import type { AnimState, HeroModel } from './HeroRig';
import { clamp, damp } from '../core/math';

/**
 * What a beast is doing this frame, set by its kit (all 0 when idle).
 * Progress values run 0..1 through one move; weights are 0..1 blends.
 */
export interface BeastPose {
  /** Progress through a bite (0 = none). */
  bite: number;
  biteSide: number;
  /** Progress through a 360° tail sweep (0 = none). */
  sweep: number;
  sweepDir: number;
  /** Head-down ram (Stampede). */
  charge: number;
  /** Jaws clamped on a victim. */
  carry: number;
  /** Rearing up before the roar. */
  rear: number;
  /** Roaring. */
  roar: number;
}

export const beastPose = (): BeastPose => ({ bite: 0, biteSide: 1, sweep: 0, sweepDir: 1, charge: 0, carry: 0, rear: 0, roar: 0 });
const IDLE = beastPose();

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<THREE.Object3D | null>>();
function load(url: string) {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((g) => g.scene).catch((e) => { console.warn('[Legends] T-Rex model failed to load:', url, e); return null; });
    cache.set(url, p);
  }
  return p;
}

const BONES = ['pelvis', 'spine1', 'spine2', 'neck1', 'neck2', 'head', 'jaw', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6',
  'thighL', 'shinL', 'metaL', 'toeL', 'thighR', 'shinR', 'metaR', 'toeR', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR'] as const;
type BoneName = (typeof BONES)[number];
const TAILS = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6'] as const;

/** The rig is built at 5.8 m nose to tail; the legend plays a fifth bigger than that. */
export const REX_SCALE = 1.2;
/** The mouth is modelled wide open (a roar): this much jaw rotation closes it. */
const JAW_SHUT = -0.5;
/** Wrist-to-claw-tip of the toes in the bind pose (rig-trex.mjs: tip - ball). */
const TOE = new THREE.Vector3(0.03, -0.09, 0.34).normalize();

const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const easeInOut = (x: number) => { const t = clamp(x, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

interface Leg {
  thigh: THREE.Object3D; shin: THREE.Object3D; meta: THREE.Object3D; toe: THREE.Object3D;
  l1: number; l2: number; lm: number;
  dThigh: THREE.Vector3; dShin: THREE.Vector3; dMeta: THREE.Vector3;
  side: number; off: number;
}

const _e = new THREE.Euler(), _m = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1);
const _H = new THREE.Vector3(), _K = new THREE.Vector3(), _A = new THREE.Vector3(), _B = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _pole = new THREE.Vector3(), _toe = new THREE.Vector3(), _ank = new THREE.Vector3();
const _qp = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _qm = new THREE.Quaternion(), _qx = new THREE.Quaternion(), _qi = new THREE.Quaternion();

/**
 * The T-Rex: João's Meshy model on its own 27-bone `rex_*` skeleton (scripts/rig-trex.mjs), animated procedurally:
 * a digitigrade walk with foot IK (feet stay planted through the stance), body bob and roll, a tail that swings
 * against the stride and drags through turns, a neck that tracks the aim, and kit-driven bites, a tail sweep,
 * a head-down charge and a rearing roar. Implements HeroModel, so the rest of the game treats it like any legend.
 */
export class TrexModel implements HeroModel {
  root = new THREE.Group();
  fx: HeroFxUniforms;
  ready: Promise<void>;
  private inner = new THREE.Group();
  private b: Record<BoneName, THREE.Object3D> | null = null;
  private legs: Leg[] = [];
  private pelvisRest = new THREE.Vector3();
  private disposed = false;
  private obj: THREE.Object3D | null = null;
  // animation state
  private phase = 0;
  private gaitK = 0;
  private airK = 0;
  private lastYaw: number | null = null;
  private yawRate = 0;
  private deathK = 0;
  private jaw = 0;

  constructor(url: string, rim: THREE.Color) {
    this.fx = makeHeroFxUniforms(rim);
    this.root.add(this.inner);
    this.ready = load(url).then((scene) => {
      if (!scene || this.disposed) return;
      const obj = SkeletonUtils.clone(scene);
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.frustumCulled = false;
        const src = m.material as THREE.MeshStandardMaterial;
        const mat = src && (src as any).isMeshStandardMaterial ? src.clone() : new THREE.MeshStandardMaterial({ color: 0x777755 });
        patchHeroMaterial(mat, this.fx);
        m.material = mat;
      });
      const b = {} as Record<BoneName, THREE.Object3D>;
      for (const n of BONES) {
        const o = obj.getObjectByName(`rex_${n}`);
        if (!o) { console.warn('[Legends] T-Rex rig is missing', n); return; }
        b[n] = o;
      }
      this.b = b;
      this.pelvisRest.copy(b.pelvis.position);
      for (const [s, side, off] of [['L', 1, 0], ['R', -1, 0.5]] as const) {
        const thigh = b[`thigh${s}`], shin = b[`shin${s}`], meta = b[`meta${s}`], toe = b[`toe${s}`];
        this.legs.push({
          thigh, shin, meta, toe, side, off,
          l1: shin.position.length(), l2: meta.position.length(), lm: toe.position.length(),
          dThigh: shin.position.clone().normalize(), dShin: meta.position.clone().normalize(), dMeta: toe.position.clone().normalize(),
        });
      }
      obj.scale.setScalar(REX_SCALE);
      this.inner.add(obj);
      this.obj = obj;
    });
  }

  update(dt: number, s: AnimState) {
    const b = this.b;
    if (!b) return;
    dt = Math.max(1e-4, Math.min(dt, 0.1));
    const p = s.beast ?? IDLE;
    const t = s.time;

    // turning in place still takes steps
    if (s.yaw !== undefined) {
      if (this.lastYaw !== null) {
        let dy = s.yaw - this.lastYaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yawRate = damp(this.yawRate, clamp(dy / dt, -8, 8), 10, dt);
      }
      this.lastYaw = s.yaw;
    }
    const alive = !s.dead;
    this.deathK = alive ? 0 : Math.min(1, this.deathK + dt / 0.9);
    const speed = alive ? s.speed : 0;
    const turn = alive && p.sweep <= 0 ? Math.min(2.6, Math.abs(this.yawRate) * 1.1) : 0;
    const stepSpeed = Math.max(speed, turn);
    const freq = clamp(0.8 + stepSpeed * 0.19, 0.8, 3.4);
    this.phase = (this.phase + dt * freq) % 1;
    this.gaitK = damp(this.gaitK, clamp(stepSpeed / 1.3, 0, 1), 6, dt);
    this.airK = damp(this.airK, s.grounded || !alive ? 0 : 1, s.grounded ? 14 : 7, dt);
    const g = this.gaitK, ph = this.phase * Math.PI * 2;
    const stride = Math.max(Math.min(1.7, speed * 0.5 / freq), turn * 0.25);
    // which way the feet travel, in the model frame (+z forward, +x the model's left = the hero's -right)
    let mx = -s.side, mz = s.fwd;
    const ml = Math.hypot(mx, mz);
    if (ml > 0.3) { mx /= ml; mz /= ml; } else { mx = 0; mz = 1; }

    // ── actions
    let pitch = clamp(s.fwd * 0.012, -0.05, 0.1), lunge = 0, lift = 0, spin = 0, hop = 0;
    let neckP = 0, neckY = 0, open = 0.12 + 0.05 * Math.sin(t * 1.7), headZ = 0, tailLift = 0, tailCurl = 0, tailStill = 0, armUp = 0;
    if (p.bite > 0 && p.bite < 1) {
      const q = p.bite;
      if (q < 0.3) { const k = smooth(q / 0.3); neckP = -0.38 * k; open = Math.max(open, 0.95 * k); pitch -= 0.05 * k; }
      else if (q < 0.48) { const k = smooth((q - 0.3) / 0.18); neckP = -0.38 + 0.85 * k; lunge = 0.38 * k; pitch += 0.1 * k; open = q < 0.43 ? 1.05 : Math.max(0, 1 - (q - 0.43) / 0.05); }
      else { const k = 1 - smooth((q - 0.48) / 0.52); neckP = 0.47 * k; lunge = 0.38 * k; pitch += 0.1 * k; open = 0; }
      neckY += p.biteSide * 0.22 * Math.sin(Math.PI * q);
    }
    if (p.sweep > 0 && p.sweep < 1) {
      const q = p.sweep;
      spin = p.sweepDir * Math.PI * 2 * easeInOut(q);
      hop = Math.sin(Math.PI * q);
      neckY -= p.sweepDir * 0.4 * hop;
      tailCurl = p.sweepDir * 0.1 * hop;
      tailStill = hop;
      tailLift = 0.08 * hop;
      pitch += 0.08 * hop;
      open = Math.max(open, 0.4 * hop);
    }
    if (p.charge > 0) {
      const c = p.charge;
      pitch += 0.2 * c; neckP += 0.3 * c; open = Math.max(open, 0.5 * c); tailLift += 0.1 * c; tailStill = Math.max(tailStill, 0.5 * c);
    }
    if (p.carry > 0) { open = Math.max(open, 0.38 * p.carry); neckP -= 0.25 * p.carry; }
    if (p.rear > 0) { const r = smooth(p.rear); pitch -= 0.4 * r; neckP -= 0.35 * r; open = Math.max(open, 0.35 * r); tailLift += 0.3 * r; armUp = r; lift += 0.06 * r; }
    if (p.roar > 0) {
      const r = p.roar;
      pitch -= 0.14 * r; neckP += 0.2 * r; open = Math.max(open, 1.12 * r);
      headZ += Math.sin(t * 34) * 0.08 * r; neckY += Math.sin(t * 21) * 0.06 * r; armUp = Math.max(armUp, r);
    }
    const hit = s.hit ?? 0;
    if (hit > 0) { neckP -= 0.2 * hit; neckY += (s.hitX ?? 0) * 0.25 * hit; headZ += (s.hitX ?? 0) * 0.12 * hit; }
    if (!alive) { open = 0.6; pitch = 0; neckP = 0.15 * this.deathK; }
    this.jaw = damp(this.jaw, open, p.bite > 0.4 && p.bite < 0.55 ? 60 : 16, dt);

    // ── body: bob on each footfall, roll over the stance leg, sway against the stride
    const bob = -0.075 * g * (0.5 + 0.5 * Math.cos(ph * 2)) + 0.012 * Math.sin(t * 1.7) * (1 - g);
    const roll = 0.045 * g * Math.sin(ph);
    const sway = 0.06 * g * Math.sin(ph);
    const look = clamp(s.pitch, -0.6, 0.75);
    b.pelvis.position.set(this.pelvisRest.x, this.pelvisRest.y + bob + lift + hop * 0.28 - this.airK * 0.1, this.pelvisRest.z + lunge);
    b.pelvis.quaternion.setFromEuler(_e.set(pitch, sway + spin, roll, 'YXZ'));
    // the spine takes back the sway so the chest and head stay steady
    this.rot(b.spine1, 0.015 * Math.sin(t * 1.7) * (1 - g), -sway * 0.6, -roll * 0.5);
    this.rot(b.spine2, 0, -sway * 0.3, -roll * 0.3);
    const turnLook = clamp(-this.yawRate * 0.07, -0.3, 0.3) * (alive ? 1 : 0);
    this.rot(b.neck1, -look * 0.25 + neckP * 0.4, turnLook * 0.6 + neckY * 0.6, 0);
    this.rot(b.neck2, -look * 0.25 + neckP * 0.35, turnLook * 0.4 + neckY * 0.4, 0);
    // the head stays level through bob and lean (pitch + neck already carried it), then aims
    const carried = pitch + (-look * 0.5 + neckP * 0.75);
    const headP = -look * 0.6 + neckP * 1.0 - 0.025 * Math.cos(ph * 2) * g;
    this.rot(b.head, headP - carried, 0, headZ);
    this.rot(b.jaw, JAW_SHUT + this.jaw * 0.62, 0, 0);
    // tail: a travelling wave against the stride, a lazy idle swish, and it drags behind turns
    for (let i = 0; i < TAILS.length; i++) {
      const k = 0.5 + i * 0.16;
      const wave = (0.09 * g * Math.sin(ph - i * 0.6) + 0.05 * Math.sin(t * 0.8 - i * 0.55)) * (1 - tailStill * 0.85);
      const drag = clamp(-this.yawRate * 0.045 * k, -0.22, 0.22);
      const droop = alive ? 0.012 * Math.sin(t * 1.1 - i * 0.4) - tailLift * (i < 2 ? 1 : 0.3) : 0.05 + 0.06 * this.deathK;
      this.rot(b[TAILS[i]], droop, (wave * k + drag + tailCurl) * (alive ? 1 : 0.2), 0);
    }
    // tiny arms: a twitch at idle, raised when rearing and roaring
    for (const [s2, sd] of [['L', 1], ['R', -1]] as const) {
      const tw = 0.08 * Math.sin(t * 1.3 + sd);
      this.rot(b[`arm${s2}`], -0.15 + tw - armUp * 0.6, 0, sd * armUp * 0.25);
      this.rot(b[`fore${s2}`], -0.35 - armUp * 0.4 + 0.1 * Math.sin(t * 2.1 + sd), 0, 0);
      this.rot(b[`hand${s2}`], -0.2 - armUp * 0.3, 0, 0);
    }

    // ── legs: feet planted through the stance, an arc through the swing, IK from the hip
    const cs = Math.cos(spin), sn = Math.sin(spin);
    for (const L of this.legs) {
      const q = (this.phase + L.off) % 1;
      let o: number, up = 0, swingU = 0;
      if (q < 0.5) o = stride / 2 - stride * (q / 0.5);
      else { swingU = (q - 0.5) / 0.5; const e = swingU * swingU * (3 - 2 * swingU); o = -stride / 2 + stride * e; up = (0.1 + stride * 0.2) * Math.sin(Math.PI * swingU); }
      // neutral stance under the hip, feet a little apart
      let bx = L.side * 0.5 + mx * o * g, bz = 0.22 + mz * o * g;
      let by = 0.14 + up * g;
      // in the air (and during the sweep's hop) the feet tuck up under the belly
      const tuck = Math.max(this.airK, hop * 0.8);
      by += 0.55 * tuck; bz += 0.15 * tuck;
      if (!alive) { by += 0.25 * this.deathK; bz += 0.25 * this.deathK; }
      // the sweep pivots the feet with the body
      const px = this.pelvisRest.x, pz = this.pelvisRest.z;
      const rx = bx - px, rz = bz - pz;
      _B.set(px + rx * cs + rz * sn, by, pz - rx * sn + rz * cs);
      const heel = 0.62 - 0.3 * Math.sin(Math.PI * swingU) * g - 0.25 * tuck;
      _ank.set(0, Math.cos(heel), -Math.sin(heel));
      _toe.set(0, -0.15 - 0.9 * Math.sin(Math.PI * swingU) * g - 0.6 * tuck, 1);
      _pole.set(L.side * 0.15, -0.2, 1);
      if (spin) { rotY(_ank, cs, sn); rotY(_toe, cs, sn); rotY(_pole, cs, sn); }
      this.solveLeg(L, _B, _ank, _toe.normalize(), _pole);
    }

    // ── death: topple onto the side
    const dk = smooth(this.deathK);
    this.inner.rotation.z = 1.38 * dk;
    this.inner.position.y = -1.05 * REX_SCALE * dk;
    this.inner.position.x = 0.4 * REX_SCALE * dk;
  }

  private rot(o: THREE.Object3D, x: number, y: number, z: number) { o.quaternion.setFromEuler(_e.set(x, y, z, 'YXZ')); }

  /** Two-bone IK hip -> ankle (knee bends forward toward the pole), the metatarsus from the ankle down to the ball of the foot, toes along toeDir. All in the model frame. */
  private solveLeg(L: Leg, ball: THREE.Vector3, ankleDir: THREE.Vector3, toeDir: THREE.Vector3, pole: THREE.Vector3) {
    const pel = this.b!.pelvis;
    _m.compose(pel.position, pel.quaternion, _one);
    _H.copy(L.thigh.position).applyMatrix4(_m);
    _A.copy(ball).addScaledVector(ankleDir, L.lm);
    _d.subVectors(_A, _H);
    let dist = _d.length();
    _d.divideScalar(dist || 1);
    const maxD = (L.l1 + L.l2) * 0.995, minD = Math.abs(L.l1 - L.l2) + 0.02;
    if (dist > maxD || dist < minD) { dist = clamp(dist, minD, maxD); _A.copy(_H).addScaledVector(_d, dist); }
    const cosA = clamp((L.l1 * L.l1 + dist * dist - L.l2 * L.l2) / (2 * L.l1 * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    _n.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
    _K.copy(_H).addScaledVector(_d, L.l1 * cosA).addScaledVector(_n, L.l1 * sinA);
    // model-frame rotations of each bone (minimal arc from its bind direction), then local = parent^-1 * own
    _qp.copy(pel.quaternion);
    _qt.setFromUnitVectors(L.dThigh, _t1.subVectors(_K, _H).normalize());
    L.thigh.quaternion.copy(_qx.copy(_qp).invert().multiply(_qt));
    _qs.setFromUnitVectors(L.dShin, _t1.subVectors(_A, _K).normalize());
    L.shin.quaternion.copy(_qx.copy(_qt).invert().multiply(_qs));
    _qm.setFromUnitVectors(L.dMeta, _t2.copy(ankleDir).negate());
    L.meta.quaternion.copy(_qx.copy(_qs).invert().multiply(_qm));
    _qi.setFromUnitVectors(_t1.set(TOE.x * L.side, TOE.y, TOE.z), toeDir);
    L.toe.quaternion.copy(_qx.copy(_qm).invert().multiply(_qi));
  }

  /** Between the jaws, in world space. */
  mouthWorld(out: THREE.Vector3) {
    if (!this.b) return out.copy(this.root.position).add(_t1.set(0, 2, 0));
    return this.b.head.localToWorld(out.set(0, -0.2, 0.62));
  }

  /** The tip of the tail, in world space (the tail sweep's trail). */
  tailWorld(out: THREE.Vector3) {
    if (!this.b) return out.copy(this.root.position).setY(this.root.position.y + 1.5);
    return this.b.tail6.localToWorld(out.set(-0.06, -0.18, -0.37));
  }

  handWorld(side: 'L' | 'R', out: THREE.Vector3) {
    if (!this.b) return out.copy(this.root.position).setY(this.root.position.y + 1.2);
    return (side === 'L' ? this.b.handL : this.b.handR).getWorldPosition(out);
  }

  headWorld(out: THREE.Vector3) {
    if (!this.b) return out.copy(this.root.position).setY(this.root.position.y + 2.2);
    return this.b.head.localToWorld(out.set(0, 0.1, 0.4));
  }

  dispose() {
    this.disposed = true;
    this.obj?.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) (m.material as THREE.Material).dispose(); });
  }
}

function rotY(v: THREE.Vector3, c: number, s: number) {
  const x = v.x, z = v.z;
  v.x = x * c + z * s; v.z = -x * s + z * c;
}
