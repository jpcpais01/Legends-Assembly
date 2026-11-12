import * as THREE from 'three';
import { ParticleSystem, Shape, type ParticleOpts } from './Particles';
import { QUALITY, settings } from '../core/settings';
import { rand, TAU } from '../core/math';
import { makeTextTexture } from '../render/textures';

/** Instanced mesh pool rebuilt each frame (projectiles, orbs...). One draw call per kind. */
export class InstancedPool {
  mesh: THREE.InstancedMesh;
  private n = 0;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, color = false) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    if (color) this.mesh.setColorAt(0, new THREE.Color());
  }
  begin() { this.n = 0; }
  add(m: THREE.Matrix4, c?: THREE.Color) {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    this.mesh.setMatrixAt(this.n, m);
    if (c && this.mesh.instanceColor) this.mesh.setColorAt(this.n, c);
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

interface Flash { light: THREE.PointLight; t: number; dur: number; peak: number }
interface Glyph { sprite: THREE.Sprite; t: number; dur: number; follow?: () => THREE.Vector3 | null; vy: number; scale: number }

export class Vfx {
  add: ParticleSystem;
  alpha: ParticleSystem;
  scene: THREE.Scene;
  private flashes: Flash[] = [];
  private glyphs: Glyph[] = [];
  private texCache = new Map<string, THREE.Texture>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const q = QUALITY[settings.quality];
    this.add = new ParticleSystem(q.particles, true);
    this.alpha = new ParticleSystem(Math.floor(q.particles * 0.5), false);
    scene.add(this.add.mesh, this.alpha.mesh);
    // two always-present flash lights (constant light count = no shader recompiles)
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 18, 2);
      light.castShadow = false;
      scene.add(light);
      this.flashes.push({ light, t: 1, dur: 1, peak: 0 });
    }
  }

  p(o: ParticleOpts) { this.add.spawn(o); }
  pa(o: ParticleOpts) { this.alpha.spawn(o); }

  /** Radial burst of glowing particles. */
  burst(pos: THREE.Vector3, color: THREE.Color, count: number, speed: number, size: number, life: number, opts: Partial<ParticleOpts> = {}) {
    for (let i = 0; i < count; i++) {
      const u = rand(-1, 1), th = rand(0, TAU);
      const s = Math.sqrt(1 - u * u);
      const sp = speed * rand(0.35, 1);
      this.add.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: Math.cos(th) * s * sp, vy: u * sp + (opts.vy ?? 0), vz: Math.sin(th) * s * sp,
        r: color.r, g: color.g, b: color.b,
        size: size * rand(0.6, 1.2), life: life * rand(0.6, 1.2),
        drag: 2.5, shape: Shape.Dot, ...opts,
      });
    }
  }

  sparks(pos: THREE.Vector3, color: THREE.Color, count: number, speed = 10, dir?: THREE.Vector3) {
    for (let i = 0; i < count; i++) {
      const u = rand(-1, 1), th = rand(0, TAU);
      const s = Math.sqrt(1 - u * u);
      let vx = Math.cos(th) * s, vy = Math.abs(u) * 0.8 + 0.2, vz = Math.sin(th) * s;
      if (dir) { vx = vx * 0.6 + dir.x; vy = vy * 0.6 + dir.y; vz = vz * 0.6 + dir.z; }
      const sp = speed * rand(0.4, 1.1);
      this.add.spawn({
        x: pos.x, y: pos.y, z: pos.z, vx: vx * sp, vy: vy * sp, vz: vz * sp,
        r: color.r, g: color.g, b: color.b, size: rand(0.04, 0.08), life: rand(0.2, 0.5),
        gravity: 14, drag: 1.5, stretch: 0.06, shape: Shape.Spark,
      });
    }
  }

  shockwave(pos: THREE.Vector3, color: THREE.Color, radius: number, life = 0.5, thickness = 0.12, flat = true) {
    this.add.spawn({
      x: pos.x, y: pos.y + 0.08, z: pos.z, r: color.r, g: color.g, b: color.b,
      size: radius * 0.2, grow: 10, life, shape: Shape.Ring, flat, aux: thickness, fadeIn: 0.01, rot: 0,
    });
  }

  splat(pos: THREE.Vector3, color: THREE.Color, size: number, life = 7) {
    this.alpha.spawn({
      x: pos.x, y: pos.y + 0.035, z: pos.z, r: color.r, g: color.g, b: color.b, a: 0.95,
      size, life, shape: Shape.Splat, flat: true, aux: Math.random(), hold: 0.7, fadeIn: 0.01, grow: 1.08,
    });
  }

  smoke(pos: THREE.Vector3, color: THREE.Color, count: number, size = 0.8, life = 1.2, alpha = 0.5) {
    for (let i = 0; i < count; i++) {
      this.alpha.spawn({
        x: pos.x + rand(-0.3, 0.3), y: pos.y + rand(0, 0.3), z: pos.z + rand(-0.3, 0.3),
        vx: rand(-1, 1), vy: rand(0.5, 1.8), vz: rand(-1, 1),
        r: color.r, g: color.g, b: color.b, a: alpha,
        size: size * rand(0.7, 1.3), grow: 2.4, life: life * rand(0.7, 1.3), drag: 1.5, shape: Shape.Smoke, spin: rand(-1, 1), fadeIn: 0.15,
      });
    }
  }

  flash(pos: THREE.Vector3, color: THREE.Color, intensity: number, dur: number, distance = 18) {
    // reuse the light with the least remaining energy
    let best = this.flashes[0];
    for (const f of this.flashes) if (f.peak * (1 - f.t / f.dur) < best.peak * (1 - best.t / best.dur)) best = f;
    best.light.position.copy(pos);
    best.light.color.copy(color);
    best.light.distance = distance;
    best.t = 0; best.dur = dur; best.peak = intensity;
  }

  glyph(text: string, pos: THREE.Vector3, opts: { color?: string; glow?: string; scale?: number; dur?: number; vy?: number; follow?: () => THREE.Vector3 | null } = {}) {
    const key = `${text}|${opts.color}|${opts.glow}`;
    let tex = this.texCache.get(key);
    if (!tex) { tex = makeTextTexture(text, { color: opts.color, glow: opts.glow }); this.texCache.set(key, tex); }
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    const scale = opts.scale ?? 2;
    s.scale.set(scale * 2, scale, 1);
    s.renderOrder = 30;
    this.scene.add(s);
    const g: Glyph = { sprite: s, t: 0, dur: opts.dur ?? 1.5, follow: opts.follow, vy: opts.vy ?? 0.4, scale };
    this.glyphs.push(g);
    return g;
  }

  update(dt: number) {
    this.add.update(dt);
    this.alpha.update(dt);
    for (const f of this.flashes) {
      f.t += dt;
      const k = Math.max(0, 1 - f.t / f.dur);
      f.light.intensity = f.peak * k * k;
    }
    for (let i = this.glyphs.length - 1; i >= 0; i--) {
      const g = this.glyphs[i];
      g.t += dt;
      const k = g.t / g.dur;
      if (k >= 1) {
        this.scene.remove(g.sprite);
        g.sprite.material.dispose();
        this.glyphs.splice(i, 1);
        continue;
      }
      if (g.follow) { const p = g.follow(); if (p) g.sprite.position.copy(p); }
      else g.sprite.position.y += g.vy * dt;
      const pop = Math.min(1, g.t * 6);
      const sc = g.scale * (0.6 + 0.4 * pop) * (1 + k * 0.15);
      g.sprite.scale.set(sc * 2, sc, 1);
      g.sprite.material.opacity = Math.min(1, (1 - k) * 3) * pop;
    }
  }

  clear() {
    this.add.clear(); this.alpha.clear();
    for (const g of this.glyphs) { this.scene.remove(g.sprite); g.sprite.material.dispose(); }
    this.glyphs.length = 0;
    for (const f of this.flashes) { f.peak = 0; f.light.intensity = 0; }
  }
}
