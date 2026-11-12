import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeHeroFxUniforms, patchRigMaterial, type HeroFxUniforms } from './materials';
import { clamp, damp, lerp } from '../core/math';

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
}

export interface HeroModel {
  root: THREE.Group;
  fx: HeroFxUniforms;
  update(dt: number, s: AnimState): void;
  handWorld(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3;
  headWorld(out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

export interface RigLook {
  /** Dress the base mannequin: colors + accessories. */
  build(r: RigBuilder): void;
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

export const RIG_BONE_NAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR'] as const;

/** Procedural locomotion / aim / attack / cast / levitate / death animation. Sets bone rotations absolutely. */
export class RigAnimator {
  private phase = 0;
  private deadT = 0;
  private lean = 0;
  private sideLean = 0;
  private air = 0;
  private hipsY: number;
  /** Extra outward shoulder angle so bulky sleeves (puffer jackets) clear the torso. */
  private armOut: number;
  constructor(private r: RigBones, opts: { armOut?: number } = {}) {
    this.hipsY = r.hips.position.y;
    this.armOut = opts.armOut ?? 0;
  }

  update(dt: number, s: AnimState) {
    const r = this.r;
    const t = s.time;
    const amp = clamp(s.speed / 6, 0, 1.3);
    this.phase += dt * (2.2 + s.speed * 1.45);
    const ph = this.phase;
    const fwdSign = s.fwd < -0.5 ? -1 : 1;
    const sideAmt = clamp(Math.abs(s.side) / Math.max(1, s.speed), 0, 1);
    this.air = damp(this.air, s.grounded ? 0 : 1, 10, dt);
    this.lean = damp(this.lean, clamp(s.fwd / 8, -0.4, 0.6) * 0.25 + s.dash * 0.45, 8, dt);
    this.sideLean = damp(this.sideLean, clamp(-s.side / 8, -1, 1) * 0.12, 8, dt);

    // dead: crumple + dissolve handled by game
    if (s.dead) {
      this.deadT = Math.min(1, this.deadT + dt * 2.2);
      r.body.rotation.x = lerp(r.body.rotation.x, -Math.PI / 2 * 0.95, this.deadT * 0.25);
      r.body.position.y = lerp(r.body.position.y, -0.75, this.deadT * 0.2);
      return;
    }
    this.deadT = 0;
    r.body.rotation.x = 0;
    r.body.position.y = 0;

    const walk = amp * (1 - this.air);
    const swing = Math.sin(ph) * 0.7 * walk * fwdSign;
    // legs
    r.hipL.rotation.x = -swing * (1 - sideAmt * 0.6) - this.air * 0.7 + s.levitate * 0.25;
    r.hipR.rotation.x = swing * (1 - sideAmt * 0.6) - this.air * 0.3 + s.levitate * 0.35;
    r.hipL.rotation.z = Math.sin(ph) * 0.25 * walk * sideAmt + s.levitate * 0.12;
    r.hipR.rotation.z = -Math.sin(ph) * 0.25 * walk * sideAmt - s.levitate * 0.12;
    r.kneeL.rotation.x = Math.max(0, Math.sin(ph + 1.6)) * 1.0 * walk + this.air * 1.1 + s.levitate * 0.5;
    r.kneeR.rotation.x = Math.max(0, Math.sin(ph + 1.6 + Math.PI)) * 1.0 * walk + this.air * 0.6 + s.levitate * 0.7;
    r.footL.rotation.x = -0.2 * walk;
    r.footR.rotation.x = -0.2 * walk;
    // body
    const bob = Math.abs(Math.sin(ph)) * 0.045 * walk;
    const breathe = Math.sin(t * 2.1) * 0.006;
    r.hips.position.y = this.hipsY + bob - 0.02 * walk + breathe;
    r.hips.rotation.y = Math.sin(ph) * 0.12 * walk;
    r.spine.rotation.y = -Math.sin(ph) * 0.18 * walk;
    r.spine.rotation.x = this.lean - s.pitch * 0.35;
    r.spine.rotation.z = this.sideLean;
    r.chest.scale.setScalar(1 + Math.sin(t * 2.1) * 0.008);
    r.head.rotation.x = -s.pitch * 0.45 - this.lean * 0.5;
    r.head.rotation.y = Math.sin(t * 0.7) * 0.05;

    // arms: base swing + idle + attack/cast overrides
    const armSwing = Math.sin(ph) * 0.55 * walk * fwdSign;
    let lx = armSwing + 0.05, rx = -armSwing + 0.05;
    let lz = 0.12 + this.armOut + Math.sin(t * 1.3) * 0.02, rz = -0.12 - this.armOut - Math.sin(t * 1.3) * 0.02;
    let le = -0.25 - walk * 0.25, re = -0.25 - walk * 0.25;
    // aim-ready pose blends in so the hero looks combat-ready
    const aimPose = 0.35;
    rx = lerp(rx, -1.0 - s.pitch * 0.6, aimPose);
    re = lerp(re, -0.7, aimPose);
    // attack punch (alternating hands)
    if (s.attack > 0) {
      const k = Math.sin(Math.min(1, s.attack) * Math.PI * 0.5);
      if (s.attackSide >= 0) { rx = lerp(rx, -1.55 - s.pitch, k); re = lerp(re, -0.05, k); rz = lerp(rz, 0.05, k); }
      else { lx = lerp(lx, -1.55 - s.pitch, k); le = lerp(le, -0.05, k); lz = lerp(lz, -0.05, k); }
    }
    // cast: both arms reach up/out
    if (s.cast > 0) {
      lx = lerp(lx, -2.7, s.cast); rx = lerp(rx, -2.7, s.cast);
      lz = lerp(lz, 0.35, s.cast); rz = lerp(rz, -0.35, s.cast);
      le = lerp(le, -0.15, s.cast); re = lerp(re, -0.15, s.cast);
    }
    if (s.levitate > 0) {
      lz = lerp(lz, 1.25, s.levitate); rz = lerp(rz, -1.25, s.levitate);
      lx = lerp(lx, -0.3, s.levitate); rx = lerp(rx, -0.3, s.levitate);
    }
    if (s.dash > 0) { lx = lerp(lx, 0.9, s.dash); rx = lerp(rx, 0.9, s.dash); }
    if (this.air > 0.01) { lz += this.air * 0.4; rz -= this.air * 0.4; }
    r.shoulderL.rotation.set(lx, 0, lz);
    r.shoulderR.rotation.set(rx, 0, rz);
    r.elbowL.rotation.x = le;
    r.elbowR.rotation.x = re;
  }

}

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
    this.anim = new RigAnimator(this.r);
  }

  update(dt: number, s: AnimState) { this.anim.update(dt, s); }

  handWorld(side: 'L' | 'R', out: THREE.Vector3) {
    const h = side === 'L' ? this.r.handL : this.r.handR;
    return h.getWorldPosition(out);
  }

  headWorld(out: THREE.Vector3) { return this.r.head.getWorldPosition(out); }

  dispose() { this.r.disposeAll(); }
}
