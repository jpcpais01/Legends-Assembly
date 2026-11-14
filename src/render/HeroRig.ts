import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeHeroFxUniforms, patchRigMaterial, type HeroFxUniforms } from './materials';
import { RigAnimator, STYLE_ATTACK, type AttackKind, type MotionStyle } from './RigAnimator';
import type { BeastPose } from './TrexModel';

export { RigAnimator, STYLE_ATTACK };

export interface AnimState {
  speed: number;
  fwd: number; // local forward velocity
  side: number; // local right velocity
  grounded: boolean;
  pitch: number;
  attack: number; // 0..1 pulse (decays)
  attackSide: number; // -1 left, 1 right
  cast: number; // 0..1 sustained
  levitate: number; // 0..1
  dash: number; // 0..1
  dead: boolean;
  time: number;
  /** Body yaw (world), so the animator can bank into turns and keep feet planted while turning in place. */
  yaw?: number;
  /** Vertical velocity (jump rise vs fall poses, landing impact). */
  vy?: number;
  /** 0..1 pulse when damaged (flinch). */
  hit?: number;
  /** Direction of the last blow's push in the body frame (x right, z forward) and its weight 0..1. */
  hitX?: number;
  hitZ?: number;
  hitK?: number;
  /** Which attack gesture the next attack pulse plays (defaults to the hero's style). */
  attackKind?: AttackKind;
  /** The attack is two-fisted: both arms play the gesture. */
  attackBoth?: boolean;
  /** 0..1: both arms reach straight down the crosshair (grabs, Gum-Gum Rocket). */
  reach?: number;
  /** Rubber limbs: metres each hand is pushed out along its forearm, and each fist's scale (Luffy). */
  stretchL?: number;
  stretchR?: number;
  /** Telescoping arm (Blitzcrank's Rocket Grab): the right arm straightens, aims at this point and its forearm extends to reach it. */
  armTarget?: THREE.Vector3 | null;
  /** 0..1 blend of armTarget over the animated pose. */
  armTargetW?: number;
  /** Which segment telescopes: the forearm (default) or the upper arm, so a big forearm + fist flies out whole. */
  armReach?: 'fore' | 'upper';
  fistL?: number;
  fistR?: number;
  /** Non-humanoid legends (the T-Rex): what the beast's body is doing, set by its kit. */
  beast?: BeastPose;
  /** Which held item is out (HeroDef.items ids); the others are hidden. */
  item?: string;
  /** 0..1 archer's stance: the bow arm straight down the crosshair, the string hand back toward the cheek. */
  bow?: number;
  /** 0..1 how far the string is drawn (moves the string hand from the bow to the cheek). */
  bowDraw?: number;
}

export interface HeroModel {
  root: THREE.Group;
  fx: HeroFxUniforms;
  update(dt: number, s: AnimState): void;
  handWorld(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3;
  headWorld(out: THREE.Vector3): THREE.Vector3;
  /** Shrink a hand away (its owner fired it off on a chain) and bring it back with 1. */
  setHandScale?(side: 'L' | 'R', s: number): void;
  /** Resolves once a loaded model is showing. */
  ready?: Promise<void>;
  /** The object shown for a held item (HeroDef.items), once the model is up. */
  itemObject?(id: string): THREE.Object3D | null;
  dispose(): void;
}

export interface RigLook {
  /** Dress the base mannequin: colors + accessories. */
  build(r: RigBuilder): void;
  /** Extra shoulder abduction (radians) for bulky torsos. */
  armOut?: number;
  /** Body language for the procedural stand-in. */
  style?: MotionStyle;
}

type Bone = THREE.Bone;

export interface MatSpec { color: THREE.Color; rough: number; metal: number; emissive: THREE.Color }
interface Part { proxy: THREE.Object3D; geo: THREE.BufferGeometry; mat: MatSpec }

/**
 * Procedural humanoid with readable silhouettes, used until Meshy models are dropped in.
 * Every part is baked into ONE rigidly-skinned mesh with per-vertex PBR (color, roughness,
 * metalness, emissive), so each hero costs a single draw call (+1 for shadows).
 */
export class RigBuilder {
  root = new THREE.Group(); // faces +z
  body = new THREE.Group();
  hips: Bone; spine: Bone; chest: Bone; neck: Bone; head: Bone;
  shoulderL: Bone; shoulderR: Bone; elbowL: Bone; elbowR: Bone; handL: Bone; handR: Bone;
  hipL: Bone; hipR: Bone; kneeL: Bone; kneeR: Bone; footL: Bone; footR: Bone;
  fx: HeroFxUniforms;
  bones: Bone[] = [];
  private parts: Part[] = [];
  mesh: THREE.SkinnedMesh | null = null;
  private material: THREE.MeshStandardMaterial | null = null;

  constructor(rim: THREE.Color) {
    this.fx = makeHeroFxUniforms(rim);
    const B = (parent: THREE.Object3D, x: number, y: number, z: number) => {
      const b = new THREE.Bone(); b.position.set(x, y, z); parent.add(b); this.bones.push(b); return b;
    };
    this.root.add(this.body);
    this.hips = B(this.body, 0, 0.95, 0);
    this.spine = B(this.hips, 0, 0.05, 0);
    this.chest = B(this.spine, 0, 0.3, 0);
    this.neck = B(this.chest, 0, 0.16, 0);
    this.head = B(this.neck, 0, 0.1, 0);
    this.shoulderL = B(this.chest, 0.2, 0.1, 0);
    this.shoulderR = B(this.chest, -0.2, 0.1, 0);
    this.elbowL = B(this.shoulderL, 0, -0.28, 0);
    this.elbowR = B(this.shoulderR, 0, -0.28, 0);
    this.handL = B(this.elbowL, 0, -0.26, 0);
    this.handR = B(this.elbowR, 0, -0.26, 0);
    this.hipL = B(this.hips, 0.1, -0.02, 0);
    this.hipR = B(this.hips, -0.1, -0.02, 0);
    this.kneeL = B(this.hipL, 0, -0.43, 0);
    this.kneeR = B(this.hipR, 0, -0.43, 0);
    this.footL = B(this.kneeL, 0, -0.43, 0);
    this.footR = B(this.kneeR, 0, -0.43, 0);
  }

  mat(color: THREE.ColorRepresentation, rough = 0.7, metal = 0, extra: { emissive?: THREE.Color } = {}): MatSpec {
    return { color: new THREE.Color(color), rough, metal, emissive: extra.emissive ? extra.emissive.clone() : new THREE.Color(0, 0, 0) };
  }

  /** Attach a part to a bone (or to another part). Returns a transform proxy you may tweak until finalize(). */
  add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: MatSpec, p: [number, number, number] = [0, 0, 0], r: [number, number, number] = [0, 0, 0], s: [number, number, number] = [1, 1, 1]) {
    const proxy = new THREE.Object3D();
    proxy.position.set(...p); proxy.rotation.set(...r); proxy.scale.set(...s);
    parent.add(proxy);
    this.parts.push({ proxy, geo, mat });
    return proxy;
  }

  capsule(r: number, len: number, seg = 10) { return new THREE.CapsuleGeometry(r, len, 3, seg); }
  sphere(r: number, w = 14, h = 10) { return new THREE.SphereGeometry(r, w, h); }

  /** Bake all parts into one skinned mesh. */
  finalize() {
    this.root.updateMatrixWorld(true);
    const geos: THREE.BufferGeometry[] = [];
    for (const part of this.parts) {
      let bone: THREE.Object3D | null = part.proxy.parent;
      while (bone && !(bone as THREE.Bone).isBone) bone = bone.parent;
      const bi = Math.max(0, this.bones.indexOf(bone as THREE.Bone));
      let g = part.geo.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      if (!g.index) {
        const n = g.attributes.position.count;
        const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
        for (let i = 0; i < n; i++) idx[i] = i;
        g.setIndex(new THREE.BufferAttribute(idx, 1));
      }
      g.applyMatrix4(part.proxy.matrixWorld);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3), pbr = new Float32Array(n * 2), em = new Float32Array(n * 3);
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      const c = part.mat.color, e = part.mat.emissive;
      for (let i = 0; i < n; i++) {
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        pbr[i * 2] = part.mat.rough; pbr[i * 2 + 1] = part.mat.metal;
        em[i * 3] = e.r; em[i * 3 + 1] = e.g; em[i * 3 + 2] = e.b;
        si[i * 4] = bi; sw[i * 4] = 1;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 2));
      g.setAttribute('aEmis', new THREE.BufferAttribute(em, 3));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      geos.push(g);
      part.proxy.parent?.remove(part.proxy);
    }
    const merged = mergeGeometries(geos, false)!;
    geos.forEach((g) => g.dispose());
    merged.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    patchRigMaterial(mat, this.fx);
    this.material = mat;
    const mesh = new THREE.SkinnedMesh(merged, mat);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    mesh.bind(new THREE.Skeleton(this.bones), new THREE.Matrix4());
    this.mesh = mesh;
    this.parts = [];
  }

  /** Shared anatomy: limbs, hands, head, face. Accessories are added by each hero look. */
  base(o: {
    skin: THREE.ColorRepresentation; shirt: THREE.ColorRepresentation; pants: THREE.ColorRepresentation; shoes: THREE.ColorRepresentation;
    sleeves?: THREE.ColorRepresentation; torsoScale?: [number, number, number]; legR?: number; armR?: number; eyes?: boolean; shoeScale?: number;
  }) {
    const skin = this.mat(o.skin, 0.55);
    const shirt = this.mat(o.shirt, 0.8);
    const sleeve = o.sleeves !== undefined ? this.mat(o.sleeves, 0.8) : shirt;
    const pants = this.mat(o.pants, 0.85);
    const shoes = this.mat(o.shoes, 0.45, 0.1);
    const ts = o.torsoScale ?? [1, 1, 1];
    // torso + pelvis
    this.add(this.spine, this.capsule(0.16, 0.22, 16), shirt, [0, 0.18, 0], [0, 0, 0], [1.22 * ts[0], 1 * ts[1], 0.82 * ts[2]]);
    this.add(this.hips, this.capsule(0.13, 0.08, 12), pants, [0, 0.02, 0], [0, 0, Math.PI / 2], [1, 1.35, 0.85]);
    // neck + head
    this.add(this.neck, this.capsule(0.05, 0.06, 8), skin, [0, 0.0, 0]);
    this.add(this.head, this.sphere(0.12, 20, 16), skin, [0, 0.06, 0.005], [0, 0, 0], [0.92, 1.08, 1]);
    // nose + ears
    this.add(this.head, this.sphere(0.022, 8, 6), skin, [0, 0.05, 0.112], [0, 0, 0], [1, 1.3, 1.1]);
    this.add(this.head, this.sphere(0.028, 8, 6), skin, [0.11, 0.05, 0], [0, 0, 0], [0.5, 1, 0.8]);
    this.add(this.head, this.sphere(0.028, 8, 6), skin, [-0.11, 0.05, 0], [0, 0, 0], [0.5, 1, 0.8]);
    if (o.eyes !== false) {
      const eyeW = this.mat(0xf4f1ea, 0.3);
      const eyeD = this.mat(0x1a1410, 0.2);
      for (const x of [0.04, -0.04]) {
        this.add(this.head, this.sphere(0.018, 10, 8), eyeW, [x, 0.085, 0.098]);
        this.add(this.head, this.sphere(0.01, 8, 6), eyeD, [x, 0.085, 0.112]);
      }
    }
    // arms
    const ar = o.armR ?? 0.055;
    for (const [sh, el, hd] of [[this.shoulderL, this.elbowL, this.handL], [this.shoulderR, this.elbowR, this.handR]] as const) {
      this.add(sh, this.sphere(ar * 1.15, 12, 10), sleeve, [0, -0.01, 0]);
      this.add(sh, this.capsule(ar, 0.2, 10), sleeve, [0, -0.14, 0]);
      this.add(el, this.sphere(ar * 0.92, 10, 8), sleeve, [0, 0, 0]);
      this.add(el, this.capsule(ar * 0.88, 0.19, 10), sleeve, [0, -0.12, 0]);
      this.add(hd, this.sphere(0.045, 10, 8), skin, [0, -0.02, 0.0], [0, 0, 0], [0.9, 1.2, 0.7]);
      this.add(hd, this.capsule(0.016, 0.04, 6), skin, [0.03 * (sh === this.shoulderL ? -1 : 1), -0.03, 0.025], [0.4, 0, 0]);
    }
    // legs
    const lr = o.legR ?? 0.075;
    for (const [hp, kn, ft] of [[this.hipL, this.kneeL, this.footL], [this.hipR, this.kneeR, this.footR]] as const) {
      this.add(hp, this.capsule(lr, 0.3, 10), pants, [0, -0.21, 0]);
      this.add(kn, this.sphere(lr * 0.9, 10, 8), pants, [0, 0, 0]);
      this.add(kn, this.capsule(lr * 0.85, 0.32, 10), pants, [0, -0.2, 0]);
      const ss = o.shoeScale ?? 1;
      this.add(ft, this.capsule(0.055 * ss, 0.12 * ss, 8), shoes, [0, -0.02, 0.05], [Math.PI / 2, 0, 0], [1.1, 1, 0.8]);
    }
    return { skin, shirt, pants, shoes };
  }

  disposeAll() {
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.mesh?.skeleton.dispose();
  }
}

/** The 17 bones (+ body root) the procedural animator drives. Procedural rigs and auto-rigged Meshy GLBs share it. */
export interface RigBones {
  body: THREE.Object3D;
  hips: THREE.Object3D; spine: THREE.Object3D; chest: THREE.Object3D; neck: THREE.Object3D; head: THREE.Object3D;
  shoulderL: THREE.Object3D; shoulderR: THREE.Object3D; elbowL: THREE.Object3D; elbowR: THREE.Object3D; handL: THREE.Object3D; handR: THREE.Object3D;
  hipL: THREE.Object3D; hipR: THREE.Object3D; kneeL: THREE.Object3D; kneeR: THREE.Object3D; footL: THREE.Object3D; footR: THREE.Object3D;
}

/**
 * Rubber arm: pushes the hand out along the forearm (its rest offset from the elbow) by `extra` metres and scales
 * the fist. Skinning does the rest: vertices shared between forearm and hand spread across the gap, so the skin
 * stretches into a long rubber limb instead of tearing.
 */
export function stretchArm(hand: THREE.Object3D, rest: THREE.Vector3, extra: number, fist: number) {
  const L = rest.length() || 1;
  hand.position.copy(rest).multiplyScalar((L + Math.max(0, extra)) / L);
  hand.scale.setScalar(fist);
}

const _rS = new THREE.Vector3(), _rE = new THREE.Vector3(), _rH = new THREE.Vector3(), _rA = new THREE.Vector3(), _rB = new THREE.Vector3();
const _rq = new THREE.Quaternion(), _rp = new THREE.Quaternion(), _rw = new THREE.Quaternion(), _rI = new THREE.Quaternion();
/** Turn a bone by a world-space rotation (blended in by w). */
function turnWorld(b: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, w: number) {
  if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return;
  _rq.setFromUnitVectors(from.normalize(), to.normalize());
  _rq.copy(_rI.identity().slerp(_rq, w));
  b.parent!.getWorldQuaternion(_rp);
  b.getWorldQuaternion(_rw);
  b.quaternion.copy(_rp.invert().multiply(_rq.multiply(_rw)));
  b.updateWorldMatrix(false, true);
}

/**
 * Telescoping arm: after the animation pose, straighten the elbow, swing the arm onto `target` and lengthen the
 * forearm or the upper arm (its bone scaled along the limb, the next bone counter-scaled so the rest keeps its
 * size) until the hand is there. Works on any rig whose limb bones point down -Y (procedural rigs and auto-rigged Meshy GLBs).
 * Call every frame while active, and once with target null to put the arm back.
 */
export function reachArm(sh: THREE.Object3D, el: THREE.Object3D, hd: THREE.Object3D, target: THREE.Vector3 | null | undefined, w = 1, seg: 'fore' | 'upper' = 'fore') {
  sh.scale.set(1, 1, 1); el.scale.set(1, 1, 1); hd.scale.set(1, 1, 1);
  if (!target || w <= 0.001) return;
  // the fist lines up with the forearm (also keeps the counter-scale below free of shear)
  hd.quaternion.slerp(_rI.identity(), w);
  sh.updateWorldMatrix(true, true);
  sh.getWorldPosition(_rS); el.getWorldPosition(_rE); hd.getWorldPosition(_rH);
  // straight elbow: the forearm continues the upper arm
  turnWorld(el, _rA.subVectors(_rH, _rE), _rB.subVectors(_rE, _rS), w);
  hd.getWorldPosition(_rH);
  // swing the whole arm onto the target
  turnWorld(sh, _rA.subVectors(_rH, _rS), _rB.subVectors(target, _rS), w);
  el.getWorldPosition(_rE); hd.getWorldPosition(_rH);
  const extra = (target.distanceTo(_rS) - _rH.distanceTo(_rS)) * w;
  // the stretched bone is scaled along the limb and its child counter-scaled, so only that segment grows
  // (the elbow was just straightened, so what's left between the two is a twist about the limb: no shear)
  const [b, c, len] = seg === 'upper' ? [sh, el, _rE.distanceTo(_rS)] : [el, hd, _rH.distanceTo(_rE)];
  if (extra <= 0 || len < 1e-4) return;
  const k = (len + extra) / len;
  b.scale.set(1, k, 1);
  c.scale.set(1, 1 / k, 1);
}

export const RIG_BONE_NAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR'] as const;

export class ProceduralHeroModel implements HeroModel {
  root: THREE.Group;
  fx: HeroFxUniforms;
  private r: RigBuilder;
  private anim: RigAnimator;

  constructor(look: RigLook, rim: THREE.Color) {
    this.r = new RigBuilder(rim);
    look.build(this.r);
    this.r.finalize();
    this.root = this.r.root;
    this.fx = this.r.fx;
    this.anim = new RigAnimator(this.r, { armOut: look.armOut, style: look.style });
  }

  private handRest: [THREE.Vector3, THREE.Vector3] | null = null;

  setHandScale(side: 'L' | 'R', s: number) { (side === 'L' ? this.r.handL : this.r.handR).scale.setScalar(Math.max(1e-3, s)); }

  private reaching = false;

  update(dt: number, s: AnimState) {
    this.anim.update(dt, s);
    if (s.armTarget || this.reaching) {
      this.root.updateWorldMatrix(true, false);
      reachArm(this.r.shoulderR, this.r.elbowR, this.r.handR, s.armTarget, s.armTargetW ?? 1, s.armReach);
      this.reaching = !!s.armTarget;
    }
    if (s.stretchL !== undefined || this.handRest) {
      this.handRest ??= [this.r.handL.position.clone(), this.r.handR.position.clone()];
      stretchArm(this.r.handL, this.handRest[0], s.stretchL ?? 0, s.fistL ?? 1);
      stretchArm(this.r.handR, this.handRest[1], s.stretchR ?? 0, s.fistR ?? 1);
    }
  }

  handWorld(side: 'L' | 'R', out: THREE.Vector3) {
    const h = side === 'L' ? this.r.handL : this.r.handR;
    return h.getWorldPosition(out);
  }

  headWorld(out: THREE.Vector3) { return this.r.head.getWorldPosition(out); }

  dispose() { this.r.disposeAll(); }
}
