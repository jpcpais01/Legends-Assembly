import * as THREE from 'three';
import type { HeroDef, HeroKit, Projectile } from '../game/types';
import type { Hero } from '../game/Hero';
import type { Game } from '../game/Game';
import { InstancedPool } from '../vfx/Vfx';
import { Shape } from '../vfx/Particles';
import { rand, TAU, _m1, _q1, _v1 } from '../core/math';
import type { RigBuilder } from '../render/HeroRig';
import { screenFx } from '../vfx/ScreenFx';
import { TrailStyle } from '../vfx/Trails';
import { propMesh } from '../render/props';

/**
 * Bob Marley: a reggae Strategist who fights with rhythm.
 *  LMB  Skank Chords: offbeat guitar chords fly out as rings of sound in red, gold and green. Every 4th strum
 *       is the "drop": a heavy bass wave that splashes enemies and heals allies near where it lands.
 *  RMB  Kaya Cloud: he blows a big rolling cloud of smoke ahead. Enemies inside are slowed and Drowsy: their
 *       own screen sways, swims and doubles.
 *  SHIFT One Love: a giant Jamaican sound system rises from the ground and pumps bass on the one drop. Every
 *       pulse heals allies around it and hits, slows and drowses enemies.
 */

const RED = new THREE.Color(3.2, 0.5, 0.35);
const GOLD = new THREE.Color(3.4, 2.4, 0.5);
const GREEN = new THREE.Color(0.45, 2.8, 0.75);
const RASTA = [RED, GOLD, GREEN];
const WARM = new THREE.Color(4, 3.2, 1.6);
const SMOKE = new THREE.Color(0.72, 0.76, 0.68);
const HAZE = new THREE.Color(0.55, 0.85, 0.45);
const Z = new THREE.Vector3(0, 0, 1);

export const CHORD = { dmg: 20, cd: 0.3, speed: 68, drop: 38, dropSplash: 14, dropHeal: 18, dropR: 3.2 };
export const CLOUD = { dur: 5, radius: 4.8, dist: 9, tick: 0.25, dmg: 4, slow: 0.35 };
export const LOVE = { dur: 7, beat: 0.8, radius: 14, heal: 30, dmg: 18 };

const ICONS = {
  chord: '<path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" fill="currentColor"/><circle cx="16.5" cy="16" r="2.5" fill="currentColor"/><path d="M9 9.5l10-2" opacity=".7"/>',
  cloud: '<path d="M6 16a3.5 3.5 0 0 1 .4-7 4.6 4.6 0 0 1 8.8-.9A3.8 3.8 0 0 1 18 16z" fill="currentColor" fill-opacity=".25"/><path d="M6 16a3.5 3.5 0 0 1 .4-7 4.6 4.6 0 0 1 8.8-.9A3.8 3.8 0 0 1 18 16z"/><path d="M15 19.5h2.5M18.5 20.8h1.5" opacity=".7"/><text x="19.5" y="7" font-size="5.5" font-weight="900" fill="currentColor" stroke="none" font-family="Barlow Condensed,sans-serif">z</text>',
  love: '<rect x="7" y="3" width="10" height="18" rx="1.5" fill="currentColor" fill-opacity=".25"/><rect x="7" y="3" width="10" height="18" rx="1.5"/><circle cx="12" cy="15.5" r="3" /><circle cx="12" cy="8" r="1.8"/><path d="M3 9c-1 2-1 4 0 6M21 9c1 2 1 4 0 6" opacity=".7"/>',
};

// ───────────────── shared meshes ─────────────────

/** A ring of sound: a thin torus facing its direction of travel (per-instance colour). */
function wavePool() {
  return new InstancedPool(
    new THREE.TorusGeometry(1, 0.13, 6, 28),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true }),
    96, true,
  );
}
function corePool() {
  return new InstancedPool(
    new THREE.SphereGeometry(1, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    64, true,
  );
}

/** Code-built guitar, only shown until the Meshy prop loads (neck along +y, strings face +z). */
let guitarCache: THREE.Group | null = null;
function guitarFallback(): THREE.Object3D {
  if (!guitarCache) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0xd9c08e, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a2516, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.05, 20).rotateX(Math.PI / 2), wood);
    body.scale.set(1, 1.2, 1);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 18).rotateX(Math.PI / 2), wood);
    upper.position.y = 0.2;
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.025), dark);
    neck.position.set(0, 0.52, 0.01);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.02), dark);
    head.position.set(0, 0.83, 0.005);
    g.add(body, upper, neck, head);
    guitarCache = g;
  }
  return guitarCache.clone();
}

/** Code-built speaker stack, only used if the Meshy sound system is missing (1 m tall, front +z). */
function stackFallback(): THREE.Object3D {
  const g = new THREE.Group();
  const cab = new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.7 });
  const cone = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  const stripes = [0xc8202a, 0xf2c230, 0x1d8a3c];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.32, 0.4), cab);
    b.position.y = 0.16 + i * 0.33;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 20).rotateX(Math.PI / 2), cone);
    c.position.set(0, b.position.y, -0.205);
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.71, 0.04, 0.41), new THREE.MeshStandardMaterial({ color: stripes[i], roughness: 0.5 }));
    s.position.y = b.position.y + 0.14;
    g.add(b, c, s);
  }
  return g;
}

function mouth(h: Hero, out = new THREE.Vector3()) {
  return out.copy(h.pos).addScaledVector(h.forward, 0.25).setY(h.pos.y + 1.62);
}
/** Where the chords leave: the guitar body at his right hip, lifted toward the crosshair. */
function soundhole(h: Hero, out = new THREE.Vector3()) {
  return out.copy(h.pos).addScaledVector(h.forward, 0.42).addScaledVector(h.right, 0.12).setY(h.pos.y + 1.12);
}

function noteBurst(g: Game, at: THREE.Vector3, n: number, speed: number, up = 1.5) {
  for (let i = 0; i < n; i++) {
    const c = RASTA[i % 3];
    g.vfx.p({ x: at.x, y: at.y, z: at.z, vx: rand(-speed, speed), vy: rand(0.5, speed) * up, vz: rand(-speed, speed), r: c.r, g: c.g, b: c.b, size: rand(0.16, 0.26), life: rand(0.6, 1), drag: 2, shape: Shape.Note, spin: rand(-3, 3), fadeIn: 0.05 });
  }
}

// ───────────────── Skank Chords ─────────────────

function fireChord(g: Game, h: Hero, n: number) {
  const drop = n % 4 === 3;
  const col = drop ? WARM : RASTA[n % 3];
  const m = soundhole(h);
  const dir = h.aimDir(m);
  h.anim.attack = 1; h.anim.attackSide = 1; h.anim.attackKind = 'strum';
  g.play(drop ? 'skankDrop' : 'skank', m, drop ? 0.75 : 0.5, { variant: n % 4 });
  g.vfx.flare(m, col, drop ? 1.6 : 0.9, 0.08, rand(-0.4, 0.4));
  g.vfx.p({ x: m.x, y: m.y, z: m.z, r: col.r, g: col.g, b: col.b, size: 0.2, grow: drop ? 5 : 3, life: 0.14, shape: Shape.Ring, aux: 0.2 });
  noteBurst(g, m, drop ? 4 : 1, 1.2);
  const trail = g.vfx.trail({ color: col, endColor: new THREE.Color(col.r * 0.2, col.g * 0.2, col.b * 0.2), width: drop ? 0.14 : 0.07, life: 0.12, style: TrailStyle.Energy, minDist: 0.4 });
  trail?.push(m);
  const tint = col.clone().multiplyScalar(0.45);
  g.spawnProjectile({
    owner: h, kind: drop ? 'marleyDrop' : 'marleyChord', pos: m.clone(), vel: dir.multiplyScalar(drop ? 58 : CHORD.speed), gravity: 0,
    radius: drop ? 0.32 : 0.22, life: 0.8, damage: drop ? CHORD.drop : CHORD.dmg, color: col,
    render(p, g) {
      // three rings ride the shot like the echo of a chord, swelling as they travel
      const pool = g.pool('marleyWave', wavePool);
      const fwd = _v1.copy(p.vel).normalize();
      _q1.setFromUnitVectors(Z, fwd);
      const base = (drop ? 0.36 : 0.2) * (1 + p.age * 1.4);
      for (let i = 0; i < 3; i++) {
        const s = base * (1 - i * 0.22);
        const at = new THREE.Vector3().copy(p.pos).addScaledVector(fwd, -i * 0.5);
        _m1.compose(at, _q1, new THREE.Vector3(s, s, s * 0.7));
        pool.add(_m1, i === 0 ? col : tint);
      }
      const core = g.pool('marleyCore', corePool);
      const cs = drop ? 0.13 : 0.07;
      _m1.compose(p.pos, _q1, new THREE.Vector3(cs, cs, cs * 3));
      core.add(_m1, col);
      trail?.push(p.pos);
      if (Math.random() < (drop ? 0.7 : 0.35)) {
        const c = RASTA[Math.floor(Math.random() * 3)];
        g.vfx.p({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: rand(-0.8, 0.8), vy: rand(0.4, 1.4), vz: rand(-0.8, 0.8), r: c.r, g: c.g, b: c.b, size: rand(0.12, 0.2), life: rand(0.35, 0.6), drag: 2, shape: Shape.Note, spin: rand(-3, 3) });
      }
    },
    onExpire() { trail?.stop(); },
    onHit(p, g, hit, point) {
      trail?.push(point); trail?.stop();
      if (hit) g.damage(hit, p.damage, p.owner, { crit: point.y > hit.pos.y + 1.42, at: point, fx: false });
      g.play('noteHit', point, hit ? 0.6 : 0.4);
      g.vfx.p({ x: point.x, y: point.y, z: point.z, r: col.r, g: col.g, b: col.b, size: 0.25, grow: drop ? 9 : 4, life: drop ? 0.3 : 0.18, shape: Shape.Ring, aux: 0.15 });
      g.vfx.flare(point, col, drop ? 2.2 : 1.1, 0.1, rand(-0.3, 0.3));
      noteBurst(g, point, drop ? 8 : 3, drop ? 3 : 1.8);
      if (!drop) return;
      // the bass drops: everyone close feels it, and it lifts your own people
      g.vfx.shockwave(point, GOLD, CHORD.dropR, 0.4, 0.1, false);
      g.vfx.flash(point, new THREE.Color(1, 0.75, 0.35), 10, 0.2, 8);
      for (const e of g.enemiesNear(p.owner.team, point, CHORD.dropR)) if (e !== hit) g.damage(e, CHORD.dropSplash, p.owner, { at: e.chest, fx: false, silent: !!hit });
      for (const a of g.alliesNear(p.owner.team, point, CHORD.dropR + 1)) g.heal(a, CHORD.dropHeal, p.owner);
    },
  } as Omit<Projectile, 'prev' | 'age' | 'dead' | 'seed'>);
}

// ───────────────── Kaya Cloud ─────────────────

function kayaCloud(g: Game, h: Hero) {
  const start = mouth(h);
  const dir = h.lookDir().setY(0).normalize();
  const vel = dir.clone().multiplyScalar(16);
  const pos = start.clone();
  const ground = () => g.world.heightAt(pos.x, pos.z, pos.y + 1);
  let tick = 0, emit = 0;
  g.play('smokeBlow', start, 0.8);
  // the exhale: a dense stream of smoke rolling out of his mouth
  for (let i = 0; i < 26; i++) {
    const sp = rand(4, 14);
    g.vfx.pa({ x: start.x, y: start.y, z: start.z, vx: dir.x * sp + rand(-1.5, 1.5), vy: rand(-0.6, 1), vz: dir.z * sp + rand(-1.5, 1.5), r: SMOKE.r, g: SMOKE.g, b: SMOKE.b, a: 0.4, size: rand(0.3, 0.6), grow: 6, life: rand(0.9, 1.5), drag: 2.4, shape: Shape.Smoke, spin: rand(-1, 1), fadeIn: 0.04 });
  }
  g.addZone({
    owner: h, team: h.team, pos, radius: 1.5, t: 0, dur: CLOUD.dur, dead: false, kind: 'kayaCloud',
    update(z, g, dt) {
      // roll forward and settle; the cloud swells as it slows, then sinks a little toward the floor
      const k = Math.exp(-dt * 2.2);
      const wt = g.world.raycast(pos, _v1.copy(pos).addScaledVector(vel, dt * 3), 0.6);
      if (wt >= 0) vel.multiplyScalar(0.2);
      pos.addScaledVector(vel, dt);
      vel.multiplyScalar(k);
      const gy = ground();
      pos.y += (gy + 1.1 - pos.y) * Math.min(1, dt * 2.5);
      const grow = Math.min(1, z.t / 0.9);
      z.radius = 1.5 + (CLOUD.radius - 1.5) * (1 - (1 - grow) * (1 - grow));
      const fade = Math.min(1, (z.dur - z.t) / 0.9);
      // keep it full of slow-churning smoke
      emit += dt * (z.t < 1 ? 46 : 20) * fade;
      while (emit >= 1) {
        emit--;
        const a = rand(0, TAU), r = Math.sqrt(Math.random()) * z.radius * 0.85;
        const hz = Math.random() < 0.15;
        const c = hz ? HAZE : SMOKE;
        g.vfx.pa({ x: pos.x + Math.cos(a) * r, y: gy + rand(0.2, 2.4), z: pos.z + Math.sin(a) * r, vx: -Math.sin(a) * 0.5 + vel.x * 0.4, vy: rand(-0.05, 0.25), vz: Math.cos(a) * 0.5 + vel.z * 0.4, r: c.r, g: c.g, b: c.b, a: (hz ? 0.16 : 0.28) * fade, size: rand(1.1, 2.1), grow: 1.5, life: rand(1.4, 2.1), drag: 0.8, shape: Shape.Smoke, spin: rand(-0.4, 0.4), fadeIn: 0.3, hold: 0.3 });
      }
      tick += dt;
      if (tick < CLOUD.tick) return;
      tick -= CLOUD.tick;
      for (const e of g.heroes) {
        if (!e.alive || e.team === z.team) continue;
        const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z;
        if (dx * dx + dz * dz > (z.radius + 0.4) ** 2 || e.pos.y > gy + 3.4 || e.pos.y < gy - 1.5) continue;
        e.applySlow(CLOUD.slow, 0.6);
        e.applyDrowsy(2.6);
        g.damage(e, CLOUD.dmg, z.owner, { at: e.chest, fx: false, silent: true });
        if (e.isLocal && (e.kitState.kayaHit ?? -9) < g.time - 3) { e.kitState.kayaHit = g.time; g.events.onAnnounce('Drowsy', 'Get out of the smoke', 'gold'); }
      }
    },
    dispose() {
      for (let i = 0; i < 10; i++) g.vfx.pa({ x: pos.x + rand(-3, 3), y: pos.y + rand(-0.5, 1.5), z: pos.z + rand(-3, 3), vy: rand(0.3, 0.8), r: SMOKE.r, g: SMOKE.g, b: SMOKE.b, a: 0.15, size: rand(1.4, 2.2), grow: 1.6, life: rand(1.2, 1.8), drag: 1, shape: Shape.Smoke, spin: rand(-0.4, 0.4), fadeIn: 0.2 });
    },
  });
}

// ───────────────── One Love ─────────────────

const STACK_H = 3.0;
/** Turns the Meshy sound system so its speakers face away from Bob (toward where he aims). */
const STACK_YAW = 0; // the Meshy tower's speakers face -z, which is Bob's forward at yaw 0
function soundSystem(): THREE.Object3D {
  const m = propMesh('sound_system', STACK_H);
  if (m) return m;
  const f = stackFallback();
  f.scale.setScalar(STACK_H);
  return f;
}

function oneLove(g: Game, h: Hero) {
  // it lands at his right shoulder, a step ahead, so it never blocks his own view
  const fwd = h.forward, right = h.right;
  const pos = h.pos.clone().addScaledVector(right, 2.3).addScaledVector(fwd, 0.6);
  if (g.world.raycast(h.chest, _v1.copy(pos).setY(h.pos.y + 1), 0.6) >= 0) pos.copy(h.pos).addScaledVector(right, -2.3).addScaledVector(fwd, 0.6);
  if (g.world.raycast(h.chest, _v1.copy(pos).setY(h.pos.y + 1), 0.6) >= 0) pos.copy(h.pos).addScaledVector(fwd, -1.6);
  pos.y = g.world.heightAt(pos.x, pos.z, h.pos.y + 1);
  const root = new THREE.Group();
  const stack = new THREE.Group();
  stack.add(soundSystem());
  root.add(stack);
  root.position.copy(pos);
  // the speakers face the way he is looking
  root.rotation.y = h.yaw + STACK_YAW;
  root.traverse((o) => { o.castShadow = true; });
  g.scene.add(root);
  const top = pos.clone().setY(pos.y + STACK_H * 0.9);
  let beat = -0.35, n = 0, fxT = 0, pulseT = 9;
  g.play('loveRise', pos, 1);
  g.vfx.dustRing(pos, 2.2, 26, 1, 0.5);
  g.vfx.debris(pos, new THREE.Color(0.35, 0.28, 0.2), 12, 6, 0.14, 7);
  g.vfx.rune(pos, GOLD, 5, 1.2, 1.2, 0.8, 1.4);
  g.shake(pos, 0.25, 22);
  g.addZone({
    owner: h, team: h.team, pos, radius: LOVE.radius, t: 0, dur: LOVE.dur, dead: false, kind: 'oneLove',
    update(z, g, dt) {
      // rises out of the floor, then thumps with every pulse
      const rise = Math.min(1, z.t / 0.45);
      const sink = Math.min(1, (z.dur - z.t) / 0.4);
      const k = Math.min(rise, sink);
      const e = 1 - (1 - k) * (1 - k);
      pulseT += dt;
      const pump = Math.exp(-pulseT * 9);
      stack.position.y = -STACK_H * (1 - e);
      stack.scale.set(1 + pump * 0.06, 1 - pump * 0.035, 1 + pump * 0.06);
      // notes drifting off the speakers
      fxT += dt;
      if (fxT > 0.06 && k > 0.5) {
        fxT = 0;
        const c = RASTA[Math.floor(Math.random() * 3)];
        g.vfx.p({ x: pos.x + rand(-0.8, 0.8), y: pos.y + rand(0.5, STACK_H), z: pos.z + rand(-0.8, 0.8), vx: rand(-1.5, 1.5), vy: rand(0.6, 1.8), vz: rand(-1.5, 1.5), r: c.r, g: c.g, b: c.b, size: rand(0.2, 0.34), life: rand(1, 1.6), drag: 1, shape: Shape.Note, spin: rand(-2, 2), fadeIn: 0.1 });
      }
      beat += dt;
      if (beat < LOVE.beat || z.t > z.dur - 0.3) return;
      beat -= LOVE.beat;
      n++;
      pulseT = 0;
      // ── the one drop ──
      const big = n % 4 === 0;
      g.play('bassPulse', pos, big ? 1 : 0.85, { variant: n % 2 });
      const gp = _v1.copy(pos).setY(pos.y + 0.08).clone();
      RASTA.forEach((c, i) => g.vfx.shockwave(gp, c, LOVE.radius * (0.8 + i * 0.1), 0.55 + i * 0.08, 0.1));
      g.vfx.groundGlow(gp, new THREE.Color(1.4, 1.0, 0.35), LOVE.radius * 0.6, 0.6, 0.05);
      g.vfx.flash(top, new THREE.Color(1, 0.75, 0.4), 30, 0.25, LOVE.radius + 4);
      g.vfx.p({ x: top.x, y: top.y, z: top.z, r: WARM.r, g: WARM.g, b: WARM.b, size: 0.6, grow: 8, life: 0.25, shape: Shape.Ring, aux: 0.1 });
      noteBurst(g, top, big ? 10 : 5, 4, 0.8);
      screenFx.ripple(top, LOVE.radius * 0.7, big ? 0.5 : 0.3, 0.6);
      g.shake(pos, big ? 0.14 : 0.07, LOVE.radius + 6);
      for (const a of g.alliesNear(z.team, pos, LOVE.radius)) if (g.los(top, a.chest)) g.heal(a, LOVE.heal, z.owner);
      for (const en of g.enemiesNear(z.team, pos, LOVE.radius)) {
        if (!g.los(top, en.chest)) continue;
        const d = _v1.copy(en.pos).sub(pos).setY(0);
        const l = d.length() || 1;
        g.damage(en, LOVE.dmg, z.owner, { at: en.chest, knock: d.multiplyScalar((big ? 4 : 2) / l).setY(big ? 2 : 0) });
        en.applySlow(0.3, 0.9);
        en.applyDrowsy(1.8);
      }
    },
    dispose() {
      g.scene.remove(root);
      g.vfx.dust(pos, 10, 0.8, 0.4, 2);
      noteBurst(g, top, 8, 3, 1);
    },
  });
}

// ───────────────── Kit ─────────────────

class MarleyKit implements HeroKit {
  primary(h: Hero, g: Game) {
    h.primaryCd = CHORD.cd;
    const n = h.kitState.strum = ((h.kitState.strum ?? -1) + 1) % 4;
    fireChord(g, h, n);
  }

  secondary(h: Hero, g: Game) {
    h.anim.attack = 1; h.anim.attackSide = 1; h.anim.attackKind = 'strum';
    kayaCloud(g, h);
    return true;
  }

  ult(h: Hero, g: Game) {
    h.anim.attack = 1; h.anim.attackSide = 1; h.anim.attackKind = 'strum';
    oneLove(g, h);
    if (h.isLocal) g.events.onAnnounce('One Love', 'Heal your people, move your enemies', 'gold');
    return true;
  }

  update(h: Hero, _g: Game, dt: number) {
    // the guitar rides on its strap: hands go to the neck and strings unless something else needs them
    const want = h.alive ? 1 : 0;
    h.anim.guitar = (h.anim.guitar ?? 0) + (want - (h.anim.guitar ?? 0)) * Math.min(1, dt * 8);
  }

  onDeath(h: Hero) { h.anim.guitar = 0; h.kitState.strum = -1; }
}

// ───────────────── Look (procedural stand-in while the model loads) ─────────────────
function buildMarley(r: RigBuilder) {
  r.base({ skin: '#6b4430', shirt: '#4c6f9a', pants: '#2f4f7a', shoes: '#5a3a22', sleeves: '#4c6f9a', torsoScale: [0.98, 1, 0.95], armR: 0.045, legR: 0.066 });
  const locks = r.mat('#2a1a10', 0.9), tam = r.mat('#c8202a', 0.8);
  r.add(r.head, r.sphere(0.13, 14, 10), locks, [0, 0.06, -0.04], [0, 0, 0], [1.05, 1, 1.1]);
  r.add(r.head, r.capsule(0.07, 0.25, 8), locks, [0, -0.12, -0.1], [0.3, 0, 0], [1.5, 1, 0.8]);
  r.add(r.head, r.sphere(0.13, 14, 10), tam, [0, 0.15, -0.03], [0, 0, 0], [1.05, 0.6, 1.05]);
}

export const MARLEY: HeroDef = {
  id: 'marley',
  name: 'Bob Marley',
  title: 'The Natural Mystic',
  role: 'Strategist',
  tagline: 'Music heals. The bass does the rest.',
  color: '#2fbf5a',
  accent: '#ffcf2e',
  maxHp: 250,
  // Meshy model; bump ?v= whenever the file changes (models are cached forever on players' devices)
  modelUrl: '/models/heroes/marley.glb?v=1',
  motion: 'default',
  held: { prop: 'marley_guitar', hand: 'R', bone: 'chest', size: 1.0, pos: [0.2, -0.36, 0.19], rot: [0, 0, 0.56], fallback: guitarFallback },
  speed: 6.0,
  secondaryCd: 9,
  ultCost: 1550,
  botRange: 14,
  ratings: { damage: 0.6, mobility: 0.45, support: 0.9, difficulty: 0.45 },
  abilities: {
    primary: { key: 'LMB', name: 'Skank Chords', desc: 'Strum offbeat chords that fly as rings of sound. Every 4th strum is the drop: a heavy bass wave that splashes enemies and heals allies near where it lands.', stat: `${CHORD.dmg} dmg · drop ${CHORD.drop} + heal ${CHORD.dropHeal}`, icon: ICONS.chord },
    secondary: { key: 'RMB', name: 'Kaya Cloud', desc: 'Blow a big rolling cloud of smoke ahead. Enemies inside are slowed and turn Drowsy: their screen sways, swims and doubles.', stat: `${CLOUD.dur} s · ${Math.round(CLOUD.slow * 100)}% slow · 9 s cd`, icon: ICONS.cloud },
    ult: { key: 'SHIFT', name: 'One Love', desc: 'Raise a giant sound system that pumps bass for 7 s. Every pulse heals allies around it and hits, knocks back, slows and drowses enemies.', stat: `${LOVE.heal} heal / ${LOVE.dmg} dmg per beat · ${LOVE.radius} m`, icon: ICONS.love },
  },
  look: { build: buildMarley },
  createKit: () => new MarleyKit(),
};

/** Pre-create pools so the shaders compile during loading, not mid-fight. */
export function warmupMarley(g: Game): THREE.Object3D[] {
  g.pool('marleyWave', wavePool);
  g.pool('marleyCore', corePool);
  const s = soundSystem();
  return [s];
}
