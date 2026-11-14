import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ProceduralHeroModel, RigAnimator, STYLE_ATTACK, RIG_BONE_NAMES, stretchArm, reachArm, type AnimState, type HeroModel, type RigBones } from './HeroRig';
import { patchHeroMaterial, type HeroFxUniforms } from './materials';
import { PROPS } from './props';
import { bakeMocap, snapshotRest } from './mocap';
import { MocapAnimator } from './MocapAnimator';
import type { HeroDef } from '../game/types';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] } | null>>();

function load(url: string) {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((g) => ({ scene: g.scene, animations: g.animations })).catch((e) => {
      console.warn('[Legends] model failed to load, using procedural rig:', url, e);
      return null;
    });
    cache.set(url, p);
  }
  return p;
}

/**
 * Meshy (or any rigged humanoid GLB) hero model. Auto-normalizes scale to 1.8 m, plants feet,
 * maps clips by name (idle / walk|run / attack / jump), and keeps the procedural rig visible until loaded.
 */
export class GltfHeroModel implements HeroModel {
  root = new THREE.Group();
  fx: HeroFxUniforms;
  private fallback: ProceduralHeroModel;
  private obj: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Record<string, THREE.AnimationAction | undefined> = {};
  private current: THREE.AnimationAction | null = null;
  private handR: THREE.Object3D | null = null;
  private handL: THREE.Object3D | null = null;
  private head: THREE.Object3D | null = null;
  private inner = new THREE.Group();
  /** Set when the GLB was auto-rigged onto the game skeleton (scripts/autorig.mjs): procedural animation drives it. */
  private animator: RigAnimator | null = null;
  /** Motion-capture animator; replaces the procedural one once the clips are retargeted. */
  private mocap: MocapAnimator | null = null;
  private heldMesh: THREE.Mesh | null = null;
  private heldGrip: THREE.Group | null = null;
  private heldRest = new THREE.Euler();
  /** Swappable hand items (HeroDef.items), shown one at a time by AnimState.item. */
  private items = new Map<string, THREE.Object3D>();
  private ringT = 1;
  private lastAttack = 0;
  private disposed = false;
  /** Right shoulder / elbow / hand of an auto-rigged GLB (telescoping arm). */
  private armBones: [THREE.Object3D, THREE.Object3D, THREE.Object3D] | null = null;
  private reaching = false;
  /** Rest offsets of the hands from the elbows (rubber arms push them out from here). */
  private handRest: [THREE.Vector3, THREE.Vector3] | null = null;
  /** Resolves once the GLB is shown (or failed and the procedural rig stays). */
  ready: Promise<void>;

  constructor(def: HeroDef, rim: THREE.Color) {
    this.fallback = new ProceduralHeroModel(def.look, rim);
    this.fx = this.fallback.fx;
    this.root.add(this.fallback.root);
    this.root.add(this.inner);
    this.ready = load(def.modelUrl!).then(async (res) => {
      if (!res || this.disposed) return;
      const obj = SkeletonUtils.clone(res.scene);
      const laRig = obj.getObjectByName('la_hips');
      if (!laRig) {
        // foreign rig: normalize to 1.8 m, feet on the ground (auto-rigged models are baked that way already)
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const s = 1.8 / Math.max(0.01, size.y);
        obj.scale.setScalar(s);
        const c = box.getCenter(new THREE.Vector3());
        obj.position.set(-c.x * s, -box.min.y * s, -c.z * s);
      }
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.frustumCulled = false;
          const src = m.material as THREE.MeshStandardMaterial;
          const mat = (src && (src as any).isMeshStandardMaterial) ? src.clone() : new THREE.MeshStandardMaterial({ color: 0xcccccc });
          patchHeroMaterial(mat, this.fx);
          m.material = mat;
        }
        const n = o.name.toLowerCase();
        if (!this.handR && /(right|_r\b|\.r\b|r_).*hand|hand.*(right|_r\b|\.r\b)/.test(n)) this.handR = o;
        if (!this.handL && /(left|_l\b|\.l\b|l_).*hand|hand.*(left|_l\b|\.l\b)/.test(n)) this.handL = o;
        if (!this.head && /head/.test(n) && !/top|end/.test(n)) this.head = o;
      });
      // motion capture is retargeted before the hero is shown, so it never appears in its modelled pose
      const snap = laRig ? snapshotRest(obj) : null;
      const set = snap ? await bakeMocap(def.modelUrl!, snap.rest) : null;
      if (this.disposed) return;
      this.inner.add(obj);
      this.obj = obj;
      if (laRig) {
        const bones = { body: this.inner } as Record<string, THREE.Object3D>;
        for (const n of RIG_BONE_NAMES) bones[n] = obj.getObjectByName(`la_${n}`) ?? new THREE.Object3D();
        // the procedural animator only stands in when the motion library could not be loaded
        this.animator = new RigAnimator(bones as unknown as RigBones, { style: def.motion });
        if (snap && set) this.mocap = new MocapAnimator(this.inner, snap.bones, set, { attack: STYLE_ATTACK[def.motion ?? 'default'], bounce: def.motion === 'cartoon' ? 1 : 0, upright: def.motion === 'heavy' ? 1.1 : 0 });
        this.handL = bones.handL; this.handR = bones.handR; this.head = bones.head;
        this.armBones = [bones.shoulderR, bones.elbowR, bones.handR];
        this.handRest = [bones.handL.position.clone(), bones.handR.position.clone()];
        if (def.rubber) obj.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) rubberHands(o as THREE.SkinnedMesh, [bones.handL, bones.handR]); });
        const held = def.held, t = held ? PROPS[held.prop] : undefined;
        if (held && t) {
          const m = new THREE.Mesh(t.geometry, t.material);
          const sc = held.size / Math.max(t.size.x, t.size.z);
          m.scale.setScalar(sc);
          m.castShadow = true;
          const grip = new THREE.Group();
          grip.position.set(...held.pos);
          grip.rotation.set(...held.rot);
          if (held.ring) m.position.y = -sc; // hangs from its handle
          grip.add(m);
          (held.hand === 'L' ? bones.handL : bones.handR).add(grip);
          this.heldMesh = m;
          this.heldGrip = held.ring ? grip : null;
          this.heldRest.copy(grip.rotation);
        }
        for (const it of def.items ?? []) {
          const t = it.prop ? PROPS[it.prop] : undefined;
          const grip = new THREE.Group();
          grip.name = `item_${it.id}`;
          if (t) {
            const m = new THREE.Mesh(t.geometry, t.material);
            m.scale.setScalar((it.size ?? 1) / Math.max(t.size.x, t.size.y, t.size.z));
            m.castShadow = true;
            grip.position.set(...(it.pos ?? [0, 0, 0]));
            grip.rotation.set(...(it.rot ?? [0, 0, 0]));
            grip.add(m);
          } else {
            const o = it.build();
            o.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.castShadow = true; });
            grip.add(o);
          }
          grip.visible = false;
          (it.hand === 'L' ? bones.handL : bones.handR).add(grip);
          this.items.set(it.id, grip);
        }
      } else if (res.animations.length) {
        this.mixer = new THREE.AnimationMixer(obj);
        const find = (re: RegExp) => res.animations.find((a) => re.test(a.name));
        const map: Record<string, THREE.AnimationClip | undefined> = {
          idle: find(/idle|stand/i),
          run: find(/run|sprint/i) ?? find(/walk/i),
          walk: find(/walk/i),
          attack: find(/attack|punch|shoot|cast|throw|slash/i),
          jump: find(/jump|fall/i),
        };
        for (const [k, clip] of Object.entries(map)) if (clip) this.actions[k] = this.mixer.clipAction(clip);
        this.play('idle');
      }
      this.fallback.root.visible = false;
    });
  }

  private play(name: string, fade = 0.18) {
    const a = this.actions[name] ?? this.actions.idle;
    if (!a || a === this.current) return;
    a.reset().fadeIn(fade).play();
    this.current?.fadeOut(fade);
    this.current = a;
  }

  update(dt: number, s: AnimState) {
    if (!this.obj) { this.fallback.update(dt, s); return; }
    if (this.animator) {
      (this.mocap ?? this.animator).update(dt, s);
      if (this.armBones && (s.armTarget || this.reaching)) {
        this.root.updateWorldMatrix(true, false);
        reachArm(this.armBones[0], this.armBones[1], this.armBones[2], s.armTarget, s.armTargetW ?? 1, s.armReach);
        this.reaching = !!s.armTarget;
      }
      if (this.handRest && (s.stretchL !== undefined || s.stretchR !== undefined)) {
        stretchArm(this.handL!, this.handRest[0], s.stretchL ?? 0, s.fistL ?? 1);
        stretchArm(this.handR!, this.handRest[1], s.stretchR ?? 0, s.fistR ?? 1);
      }
      if (this.heldMesh) this.heldMesh.visible = this.fx.uDissolve.value < 0.25;
      if (this.items.size) for (const [id, o] of this.items) o.visible = id === s.item && this.fx.uDissolve.value < 0.25;
      if (this.heldGrip) {
        // a fresh attack rings the bell: a quick damped clapper swing about the grip
        if (s.attack > this.lastAttack + 0.3) this.ringT = 0;
        this.lastAttack = s.attack;
        this.ringT = Math.min(3, this.ringT + dt);
        const e = Math.exp(-this.ringT * 5), w = this.ringT * Math.PI * 2 * 4.2;
        this.heldGrip.rotation.set(this.heldRest.x + Math.sin(w) * 0.75 * e, this.heldRest.y, this.heldRest.z + Math.sin(w * 0.7 + 1) * 0.3 * e);
      }
      return;
    }
    if (this.mixer) {
      if (s.dead) { /* freeze */ }
      else if (!s.grounded && this.actions.jump) this.play('jump');
      else if (s.attack > 0.6 && this.actions.attack) this.play('attack', 0.08);
      else if (s.speed > 4.5) this.play('run');
      else if (s.speed > 0.6) this.play(this.actions.walk ? 'walk' : 'run');
      else if (s.attack <= 0.2) this.play('idle');
      if (this.current && (this.current === this.actions.run || this.current === this.actions.walk)) {
        this.current.timeScale = Math.max(0.6, s.speed / 5.5);
      }
      this.mixer.update(dt);
    }
    // procedural layer on top: lean + death topple + levitation
    this.inner.rotation.x = s.dead ? Math.max(this.inner.rotation.x - dt * 3, -1.45) : Math.min(0.35, s.fwd / 30 + s.dash * 0.3);
    this.inner.position.y = s.levitate * 0.15;
    if (!this.mixer) this.inner.position.y += Math.abs(Math.sin(s.time * 9)) * 0.04 * Math.min(1, s.speed / 6);
  }

  setHandScale(side: 'L' | 'R', s: number) {
    this.fallback.setHandScale(side, s);
    const h = side === 'L' ? this.handL : this.handR;
    if (h && this.obj && this.animator) h.scale.setScalar(Math.max(1e-3, s));
  }

  itemObject(id: string) { return this.items.get(id) ?? null; }

  handWorld(side: 'L' | 'R', out: THREE.Vector3) {
    const h = side === 'L' ? this.handL : this.handR;
    if (h && this.obj) return h.getWorldPosition(out);
    return this.fallback.handWorld(side, out);
  }

  headWorld(out: THREE.Vector3) {
    if (this.head && this.obj) return this.head.getWorldPosition(out);
    return this.fallback.headWorld(out);
  }

  dispose() {
    this.disposed = true;
    this.fallback.dispose();
    this.obj?.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) (m.material as THREE.Material).dispose(); });
  }
}

/**
 * Auto-rig weights fade smoothly across the wrist, so a hand pushed metres out along the forearm would smear the
 * fist over the whole gap. Sharpen the hand bones' weights (once per shared geometry): the fist moves as one piece
 * and only the wrist band stretches into the rubber arm.
 */
function rubberHands(mesh: THREE.SkinnedMesh, hands: THREE.Object3D[]) {
  const g = mesh.geometry;
  if (g.userData.rubber) return;
  g.userData.rubber = true;
  const ids = hands.map((h) => mesh.skeleton.bones.indexOf(h as THREE.Bone)).filter((i) => i >= 0);
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute, sw = g.getAttribute('skinWeight') as THREE.BufferAttribute;
  if (!si || !sw || !ids.length) return;
  const w = [0, 0, 0, 0];
  for (let v = 0; v < sw.count; v++) {
    let hw = 0, other = 0, hi = -1;
    for (let k = 0; k < 4; k++) {
      w[k] = sw.getComponent(v, k);
      if (ids.includes(si.getComponent(v, k)) && w[k] > 0) { hw += w[k]; hi = k; } else other += w[k];
    }
    if (hi < 0 || hw >= 0.999) continue;
    const t = THREE.MathUtils.clamp((hw - 0.3) / 0.4, 0, 1), nh = t * t * (3 - 2 * t);
    for (let k = 0; k < 4; k++) {
      const isHand = ids.includes(si.getComponent(v, k));
      const nw = isHand ? (hw > 0 ? (w[k] / hw) * nh : 0) : (other > 0 ? (w[k] / other) * (1 - nh) : 0);
      sw.setComponent(v, k, nw);
    }
  }
  sw.needsUpdate = true;
}

/** Loads every hero GLB once (fills the cache) and returns posed instances so the main scene can pre-compile their shaders. */
export async function warmupHeroModels(defs: HeroDef[]) {
  const models = defs.filter((d) => d.modelUrl || d.createModel).map((d) => createHeroModel(d, new THREE.Color(d.color)));
  await Promise.all(models.map((m) => m.ready));
  return models;
}

/** The model a legend wears: its own (non-humanoid) model, the rigged Meshy GLB, or the procedural stand-in. */
export function createHeroModel(def: HeroDef, rim: THREE.Color): HeroModel {
  if (def.createModel) return def.createModel(rim);
  return def.modelUrl ? new GltfHeroModel(def, rim) : new ProceduralHeroModel(def.look, rim);
}
