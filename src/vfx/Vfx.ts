import * as THREE from 'three';
import { ParticleSystem, Shape, type ParticleOpts } from './Particles';
import { TrailSystem, TrailStyle, type Trail, type TrailOpts } from './Trails';
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

const DUST = new THREE.Color(0.62, 0.56, 0.48);

interface Flash { light: THREE.PointLight; t: number; dur: number; peak: number }
interface Glyph { sprite: THREE.Sprite; t: number; dur: number; follow?: () => THREE.Vector3 | null; vy: number; scale: number }

export class Vfx {
  add: ParticleSystem;
  alpha: ParticleSystem;
  /** Glowing ribbons (additive) and paint ribbons (alpha). */
  trailsAdd: TrailSystem;
  trailsAlpha: TrailSystem;
  scene: THREE.Scene;
  private flashes: Flash[] = [];
  private glyphs: Glyph[] = [];
  private texCache = new Map<string, THREE.Texture>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const q = QUALITY[settings.quality];
    this.add = new ParticleSystem(q.particles, true);
    this.alpha = new ParticleSystem(Math.floor(q.particles * 0.5), false);
    this.trailsAdd = new TrailSystem(q.particles >= 5000 ? 112 : 72, true);
    this.trailsAlpha = new TrailSystem(40, false);
    scene.add(this.add.mesh, this.alpha.mesh, this.trailsAdd.mesh, this.trailsAlpha.mesh);
    // two always-present flash lights (constant light count = no shader recompiles)
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 18, 2);
      light.castShadow = false;
      scene.add(light);
      this.flashes.push({ light, t: 1, dur: 1, peak: 0 });
    }
  }

  /** Follow the match world into another arena's scene. */
  moveTo(scene: THREE.Scene) {
    if (scene === this.scene) return;
    scene.add(this.add.mesh, this.alpha.mesh, this.trailsAdd.mesh, this.trailsAlpha.mesh);
    for (const f of this.flashes) scene.add(f.light);
    for (const g of this.glyphs) scene.add(g.sprite);
    this.scene = scene;
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

  /** Start a ribbon trail; push() its head every frame and stop() it when the emitter dies. */
  trail(o: TrailOpts): Trail | null {
    return (o.style === TrailStyle.Brush ? this.trailsAlpha : this.trailsAdd).create(o);
  }

  /** Anamorphic lens flare sprite (cheap stand-in for a light on small events). */
  flare(pos: THREE.Vector3, color: THREE.Color, size: number, life = 0.12, rot = 0) {
    this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, r: color.r, g: color.g, b: color.b, size, grow: 1.4, life, shape: Shape.Flare, rot, fadeIn: 0.01 });
  }

  /** Generic impact: flare + expanding ring + sparks, scaled by `k` (1 = a normal hit). */
  impact(pos: THREE.Vector3, color: THREE.Color, k = 1, dir?: THREE.Vector3) {
    this.flare(pos, color, 0.9 * k, 0.1 + 0.04 * k, rand(-0.15, 0.15));
    this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, r: color.r, g: color.g, b: color.b, size: 0.2 * k, grow: 5, life: 0.16 + 0.05 * k, shape: Shape.Ring, aux: 0.12, fadeIn: 0.01 });
    this.sparks(pos, color, Math.round(5 + 5 * k), 6 + 4 * k, dir);
  }

  /** Burnt mark on the ground (alpha). */
  scorch(pos: THREE.Vector3, size: number, life = 9, a = 0.7, color = new THREE.Color(0.03, 0.025, 0.02)) {
    this.alpha.spawn({ x: pos.x, y: pos.y + 0.03, z: pos.z, r: color.r, g: color.g, b: color.b, a, size, life, shape: Shape.Scorch, flat: true, aux: Math.random(), hold: 0.75, fadeIn: 0.02 });
  }

  /** Cracked crater decal (alpha). */
  crack(pos: THREE.Vector3, size: number, life = 7, a = 0.85) {
    this.alpha.spawn({ x: pos.x, y: pos.y + 0.032, z: pos.z, r: 0.02, g: 0.018, b: 0.015, a, size, life, shape: Shape.Crack, flat: true, aux: Math.random(), hold: 0.7, fadeIn: 0.01 });
  }

  /** Glowing flat disc on the ground (additive), e.g. residual heat. */
  groundGlow(pos: THREE.Vector3, color: THREE.Color, size: number, life = 1.2, hold = 0.2) {
    this.add.spawn({ x: pos.x, y: pos.y + 0.05, z: pos.z, r: color.r, g: color.g, b: color.b, size, life, shape: Shape.Dot, flat: true, hold, fadeIn: 0.02 });
  }

  /** Spinning rune circle on the ground. */
  rune(pos: THREE.Vector3, color: THREE.Color, size: number, life = 1, spin = 1.5, a = 1, grow = 1) {
    this.add.spawn({ x: pos.x, y: pos.y + 0.06, z: pos.z, r: color.r, g: color.g, b: color.b, a, size, life, grow, shape: Shape.Rune, flat: true, aux: 0.035, spin, rot: rand(0, TAU), hold: 0.6, fadeIn: 0.08 });
  }

  /** Tumbling chunks (alpha, lit-looking via the shard shading). */
  debris(pos: THREE.Vector3, color: THREE.Color, count: number, speed = 8, size = 0.14, up = 6) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU), sp = speed * rand(0.35, 1);
      this.alpha.spawn({
        x: pos.x + rand(-0.2, 0.2), y: pos.y + rand(0, 0.2), z: pos.z + rand(-0.2, 0.2),
        vx: Math.cos(a) * sp, vy: up * rand(0.5, 1.3), vz: Math.sin(a) * sp,
        r: color.r * rand(0.7, 1.1), g: color.g * rand(0.7, 1.1), b: color.b * rand(0.7, 1.1), a: 1,
        size: size * rand(0.6, 1.4), life: rand(0.7, 1.3), gravity: 22, drag: 0.4, shape: Shape.Shard, spin: rand(-12, 12), hold: 0.7,
      });
    }
  }

  /** Low dust puff kicked up along the ground. */
  dust(pos: THREE.Vector3, count: number, size = 0.5, a = 0.35, spread = 1.6, color = DUST) {
    for (let i = 0; i < count; i++) {
      const ang = rand(0, TAU), sp = spread * rand(0.4, 1);
      this.alpha.spawn({
        x: pos.x + Math.cos(ang) * 0.15, y: pos.y + 0.08, z: pos.z + Math.sin(ang) * 0.15,
        vx: Math.cos(ang) * sp, vy: rand(0.2, 0.7), vz: Math.sin(ang) * sp,
        r: color.r, g: color.g, b: color.b, a,
        size: size * rand(0.7, 1.2), grow: 2.4, life: rand(0.45, 0.8), drag: 3, shape: Shape.Smoke, spin: rand(-1, 1), fadeIn: 0.08,
      });
    }
  }

  /** Ring of dust rolling outward (landings, slams). */
  dustRing(pos: THREE.Vector3, radius: number, count = 18, size = 0.7, a = 0.4, color = DUST) {
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * TAU + rand(-0.1, 0.1), sp = radius * rand(2.2, 3.2);
      this.alpha.spawn({
        x: pos.x + Math.cos(ang) * 0.3, y: pos.y + 0.12, z: pos.z + Math.sin(ang) * 0.3,
        vx: Math.cos(ang) * sp, vy: rand(0.3, 1.2), vz: Math.sin(ang) * sp,
        r: color.r, g: color.g, b: color.b, a,
        size: size * rand(0.7, 1.3), grow: 2.8, life: rand(0.6, 1.1), drag: 3.2, shape: Shape.Smoke, spin: rand(-1, 1), fadeIn: 0.05,
      });
    }
  }

  /** Vertical beam of rising light streaks (respawns, casts). */
  pillar(pos: THREE.Vector3, color: THREE.Color, height = 6, count = 30, radius = 0.5) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * radius;
      const life = rand(0.35, 0.8);
      this.add.spawn({
        x: pos.x + Math.cos(a) * r, y: pos.y + rand(0, 0.6), z: pos.z + Math.sin(a) * r,
        vy: height / life * rand(0.6, 1), r: color.r, g: color.g, b: color.b,
        size: rand(0.06, 0.16), life, shape: Shape.Spark, stretch: 0.05, drag: 1.2,
      });
    }
  }

  /** Embers that rise, flicker from hot to dark and drift. */
  embers(pos: THREE.Vector3, hot: THREE.Color, cool: THREE.Color, count: number, spread = 1, up = 2.5) {
    for (let i = 0; i < count; i++) {
      this.add.spawn({
        x: pos.x + rand(-spread, spread), y: pos.y + rand(0, 0.6), z: pos.z + rand(-spread, spread),
        vx: rand(-0.8, 0.8), vy: up * rand(0.4, 1.2), vz: rand(-0.8, 0.8),
        r: hot.r, g: hot.g, b: hot.b, r2: cool.r, g2: cool.g, b2: cool.b,
        size: rand(0.04, 0.1), life: rand(0.8, 1.8), drag: 0.8, shape: Shape.Dot, fadeIn: 0.05,
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
    this.trailsAdd.update(dt);
    this.trailsAlpha.update(dt);
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
    this.trailsAdd.clear(); this.trailsAlpha.clear();
    for (const g of this.glyphs) { this.scene.remove(g.sprite); g.sprite.material.dispose(); }
    this.glyphs.length = 0;
    for (const f of this.flashes) { f.peak = 0; f.light.intensity = 0; }
  }
}
