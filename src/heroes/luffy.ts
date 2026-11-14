import * as THREE from 'three';
import type { HeroDef, HeroKit } from '../game/types';
import type { Hero } from '../game/Hero';
import { HERO_RADIUS } from '../game/Hero';
import type { Game } from '../game/Game';
import { Shape } from '../vfx/Particles';
import { clamp, damp, rand, segmentVsCapsule, TAU } from '../core/math';
import type { RigBuilder } from '../render/HeroRig';
import { propMesh } from '../render/props';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ICONS } from './icons';
import { audio } from '../core/Audio';
import { screenFx } from '../vfx/ScreenFx';
import { TrailStyle, type Trail } from '../vfx/Trails';

/*
 * Monkey D. Luffy, the rubber pirate.
 *   LMB  Gum-Gum Pistol: alternating fists that stretch down the crosshair and snap back.
 *   RMB  Gum-Gum Rocket: both arms shoot out, grab whatever they hit, and slingshot him in. Body-slams enemies.
 *   SHIFT Gear Fifth: the Drums of Liberation. He turns white, floats on clouds, bounces, and his fists turn giant.
 * The rubber limbs are his own rigged arms: the hand bone is pushed out along the forearm (AnimState.stretchL/R)
 * and the skin stretches between, so the Meshy model drops in with no extra parts.
 */

const RED = new THREE.Color(3.2, 0.42, 0.32);
const RED_SOFT = new THREE.Color(1.6, 0.25, 0.2);
const STRAW = new THREE.Color(3.2, 2.4, 0.7);
const WHITE = new THREE.Color(3.4, 3.4, 3.6);
const CLOUD = new THREE.Color(0.92, 0.93, 0.98);
const CLOUD_GLOW = new THREE.Color(2.2, 2.3, 2.8);
const SKY = new THREE.Color(1.2, 1.9, 3.4);
const SPEED = new THREE.Color(2.4, 2.3, 2.2);

/** Shoulder-to-fist length of an unstretched arm (m). */
const ARM = 0.58;
const PISTOL = { range: 21, out: 150, back: 125, dmg: 40, cd: 0.36, r: 0.2 };
const DAWN = { range: 25, out: 135, back: 110, dmg: 62, splash: 2.6, splashDmg: 34, cd: 0.44, r: 0.62, fist: 3.1 };
const ROCKET = { range: 26, reach: 0.17, speed: 36, speedG5: 46, maxFly: 0.95, dmg: 75, dmgG5: 110 };
const g5RocketCd = 3.5;
const GEAR = { awaken: 1.05, dur: 10, speed: 1.28, armor: 0.72, idleFist: 1.35, blast: 7.5, blastDmg: 45 };

interface Fist {
  /** 0 idle, 1 shooting out, 2 snapping back */
  phase: 0 | 1 | 2;
  ext: number;
  max: number;
  dir: THREE.Vector3;
  giant: boolean;
  prevTip: THREE.Vector3;
  trail: Trail | null;
  hit: boolean;
}
interface Rocket {
  phase: 'reach' | 'fly';
  t: number;
  anchor: THREE.Vector3;
  target: Hero | null;
  len: number;
  wall: boolean;
  trail: Trail | null;
  hitSet: Set<number>;
}
interface Gear { phase: 'awaken' | 'on' | 'tired'; t: number; drumT: number; hat: THREE.Object3D | null }

interface LuffyState { fists: [Fist, Fist]; rocket: Rocket | null; gear: Gear | null; bounce: number }

const newFist = (): Fist => ({ phase: 0, ext: 0, max: 0, dir: new THREE.Vector3(), giant: false, prevTip: new THREE.Vector3(), trail: null, hit: false });
function state(h: Hero): LuffyState {
  return (h.kitState.luffy ??= { fists: [newFist(), newFist()], rocket: null, gear: null, bounce: 0 }) as LuffyState;
}
const gearOn = (st: LuffyState) => st.gear?.phase === 'on';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

/** Shoulder joint in the world (0 = left, 1 = right), from the body frame so it doesn't jitter with the animation. */
function shoulder(h: Hero, k: number, out: THREE.Vector3) {
  const r = h.right, s = k ? 1 : -1;
  return out.copy(h.pos).addScaledVector(r, 0.2 * s).setY(h.pos.y + 1.36);
}

// ───────────────── Gum-Gum Pistol ─────────────────

function firePistol(h: Hero, g: Game, k: number, st: LuffyState) {
  const f = st.fists[k];
  const giant = gearOn(st);
  const P = giant ? DAWN : PISTOL;
  const sh = shoulder(h, k, _a);
  f.dir.copy(h.aimDir(sh));
  f.phase = 1; f.ext = 0; f.giant = giant; f.hit = false;
  // the fist flies to whatever the crosshair is on, or its full reach
  const aimD = h.input.aim.distanceTo(sh) - ARM + 0.4;
  f.max = clamp(Number.isFinite(aimD) && aimD > 1 ? aimD : P.range, 2.5, P.range);
  f.prevTip.copy(sh).addScaledVector(f.dir, ARM);
  f.trail?.stop();
  f.trail = g.vfx.trail({ color: giant ? WHITE : SPEED, endColor: giant ? SKY : RED_SOFT, width: giant ? 0.32 : 0.09, life: giant ? 0.16 : 0.09, style: TrailStyle.Smooth, minDist: 0.4, alpha: giant ? 0.7 : 0.55 });
  f.trail?.push(f.prevTip);
  h.anim.attack = 1; h.anim.attackSide = k ? 1 : -1; h.anim.attackKind = 'punch';
  g.play('rubberStretch', sh, giant ? 0.9 : 0.6, { rate: giant ? 0.8 : 1 });
  // the snap: a ring of air bursts off the shoulder as the arm leaves
  const m = _b.copy(sh).addScaledVector(f.dir, ARM);
  g.vfx.p({ x: m.x, y: m.y, z: m.z, r: 2, g: 2, b: 2, size: giant ? 0.5 : 0.2, grow: 3, life: 0.14, shape: Shape.Ring, aux: 0.2 });
  for (let i = 0; i < (giant ? 8 : 4); i++) {
    const s = rand(8, 16);
    g.vfx.p({ x: m.x, y: m.y, z: m.z, vx: f.dir.x * s + rand(-1.5, 1.5), vy: f.dir.y * s + rand(-1.5, 1.5), vz: f.dir.z * s + rand(-1.5, 1.5), r: SPEED.r, g: SPEED.g, b: SPEED.b, size: rand(0.04, 0.07), life: rand(0.12, 0.2), shape: Shape.Spark, stretch: 0.05, drag: 3 });
  }
}

function updateFist(h: Hero, g: Game, k: number, f: Fist, dt: number) {
  if (!f.phase) return;
  const P = f.giant ? DAWN : PISTOL;
  const sh = shoulder(h, k, _a);
  if (f.phase === 1) {
    f.ext = Math.min(f.max, f.ext + P.out * dt);
    const tip = _b.copy(sh).addScaledVector(f.dir, ARM + f.ext);
    // world first, then legends along the swept segment
    let best = 2, hit: Hero | null = null;
    const wt = g.world.raycast(f.prevTip, tip, 0.05);
    if (wt >= 0) best = wt;
    for (const e of g.heroes) {
      if (!e.alive || e.team === h.team) continue;
      const t = segmentVsCapsule(f.prevTip, tip, e.pos.x, e.pos.z, e.pos.y + 0.15, e.pos.y + 1.7, HERO_RADIUS + P.r);
      if (t >= 0 && t < best) { best = t; hit = e; }
    }
    if (best <= 1) {
      const at = _c.lerpVectors(f.prevTip, tip, best);
      f.ext = Math.max(0, at.distanceTo(sh) - ARM);
      fistImpact(h, g, f, at.clone(), hit);
      f.phase = 2; f.hit = true;
    } else if (f.ext >= f.max) {
      f.phase = 2;
      // whiffs still punch the air
      g.vfx.p({ x: tip.x, y: tip.y, z: tip.z, r: 1.6, g: 1.6, b: 1.6, size: f.giant ? 0.8 : 0.3, grow: 2.5, life: 0.12, shape: Shape.Ring, aux: 0.15 });
    }
    f.prevTip.copy(tip);
    f.trail?.push(tip);
    // streaks of torn air around the fist
    if (Math.random() < 0.8) {
      const s = rand(2, 4);
      g.vfx.p({ x: tip.x + rand(-0.15, 0.15), y: tip.y + rand(-0.15, 0.15), z: tip.z + rand(-0.15, 0.15), vx: -f.dir.x * s, vy: -f.dir.y * s, vz: -f.dir.z * s, r: SPEED.r, g: SPEED.g, b: SPEED.b, size: f.giant ? 0.12 : 0.05, life: 0.12, shape: Shape.Spark, stretch: 0.06 });
    }
    if (f.giant && Math.random() < 0.7) g.vfx.pa({ x: tip.x + rand(-0.4, 0.4), y: tip.y + rand(-0.4, 0.4), z: tip.z + rand(-0.4, 0.4), vx: -f.dir.x * 2, vy: rand(0, 0.6), vz: -f.dir.z * 2, r: CLOUD.r, g: CLOUD.g, b: CLOUD.b, a: 0.45, size: rand(0.4, 0.7), grow: 1.8, life: rand(0.35, 0.55), shape: Shape.Smoke, drag: 2, spin: rand(-2, 2) });
  } else {
    // snapping back: fast, and a wobble at the very end like a rubber band settling
    f.ext = Math.max(0, f.ext - P.back * dt);
    const tip = _b.copy(sh).addScaledVector(f.dir, ARM + f.ext);
    f.trail?.push(tip);
    if (f.ext <= 0) {
      f.phase = 0;
      f.trail?.stop(); f.trail = null;
      if (f.ext <= 0 && (k === 1 || Math.random() < 0.5)) g.play('rubberSnap', sh, 0.35);
    }
  }
}

function fistImpact(h: Hero, g: Game, f: Fist, at: THREE.Vector3, hit: Hero | null) {
  const giant = f.giant;
  const P = giant ? DAWN : PISTOL;
  const back = _d.copy(f.dir).multiplyScalar(-1);
  if (hit) {
    const crit = at.y > hit.pos.y + 1.42;
    g.damage(hit, P.dmg, h, { crit, at, knock: _c.copy(f.dir).setY(0).normalize().multiplyScalar(giant ? 11 : 4.5).setY(giant ? 4 : 1.2) });
    if (crit && !giant) g.vfx.glyph('POW!', at.clone().setY(at.y + 0.6), { color: '#fff3d6', glow: '#ff4b3a', scale: 0.9, dur: 0.5, vy: 1.4 });
    if (h.isLocal) g.camRig.kick(giant ? 3 : 1);
  }
  g.play(giant ? 'dawnHit' : 'pistolHit', at, hit ? 1 : 0.7);
  // a meaty punch: a hot core, rings of displaced air, sparks thrown back toward Luffy
  g.vfx.flare(at, hit ? WHITE : SPEED, giant ? 4.5 : 1.8, giant ? 0.18 : 0.1, rand(-0.3, 0.3));
  g.vfx.p({ x: at.x, y: at.y, z: at.z, r: 2.6, g: 2.4, b: 2.2, size: giant ? 0.9 : 0.3, grow: giant ? 5 : 4, life: giant ? 0.26 : 0.16, shape: Shape.Ring, aux: 0.18 });
  g.vfx.shockwave(at, hit ? RED : SPEED, giant ? 3.6 : 1.3, giant ? 0.35 : 0.22, giant ? 0.1 : 0.14, false);
  g.vfx.sparks(at, giant ? WHITE : RED, giant ? 26 : 10, giant ? 16 : 9, back);
  g.vfx.burst(at, hit ? RED_SOFT : SPEED, giant ? 18 : 6, giant ? 7 : 3, 0.12, 0.24);
  const ground = g.world.heightAt(at.x, at.z, at.y);
  if (!hit || at.y - ground < 0.6) {
    const gp = _c.set(at.x, ground, at.z);
    g.vfx.dust(at, giant ? 10 : 4, giant ? 1 : 0.45, 0.3, giant ? 2.6 : 1.4);
    if (at.y - ground < 0.6) g.vfx.dustRing(gp, giant ? 1.4 : 0.5, giant ? 18 : 8, giant ? 0.9 : 0.4, 0.35);
    if (!hit) g.vfx.debris(at, new THREE.Color(0.3, 0.26, 0.22), giant ? 14 : 5, giant ? 9 : 5, giant ? 0.14 : 0.07, 3);
  }
  if (giant) {
    // Dawn Pistol: the giant fist detonates into the crowd
    g.shake(at, 0.35, 22);
    g.vfx.flash(at, new THREE.Color(1.4, 1.4, 1.6), 30, 0.25, 12);
    screenFx.ripple(at, 4, 0.5, 0.35);
    for (let i = 0; i < 10; i++) {
      const a = rand(0, TAU), s = rand(3, 6);
      g.vfx.pa({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * s, vy: rand(-1, 2.5), vz: Math.sin(a) * s, r: CLOUD.r, g: CLOUD.g, b: CLOUD.b, a: 0.5, size: rand(0.5, 0.9), grow: 2.2, life: rand(0.5, 0.8), shape: Shape.Smoke, drag: 3.5, spin: rand(-1.5, 1.5) });
    }
    if (hit) g.vfx.glyph(Math.random() < 0.5 ? 'DOOM!' : 'BOOM!', at.clone().setY(at.y + 1), { color: '#ffffff', glow: '#8fb8ff', scale: 1.4, dur: 0.6, vy: 1.6 });
    for (const e of g.enemiesNear(h.team, at, DAWN.splash)) {
      if (e === hit) continue;
      const dir = e.center.sub(at).setY(0).normalize();
      g.damage(e, DAWN.splashDmg, h, { knock: dir.multiplyScalar(8).setY(3) });
    }
  } else if (hit) g.shake(at, 0.08, 10);
}

// ───────────────── Gum-Gum Rocket ─────────────────

function startRocket(h: Hero, g: Game, st: LuffyState) {
  const from = h.chest;
  const dir = h.aimDir(from, new THREE.Vector3());
  const to = _a.copy(from).addScaledVector(dir, ROCKET.range);
  let best = 2, target: Hero | null = null;
  const wt = g.world.raycast(from, to, 0.1);
  if (wt >= 0) best = wt;
  for (const e of g.heroes) {
    if (!e.alive || e.team === h.team) continue;
    const t = segmentVsCapsule(from, to, e.pos.x, e.pos.z, e.pos.y + 0.15, e.pos.y + 1.7, HERO_RADIUS + 0.35);
    if (t >= 0 && t < best) { best = t; target = e; }
  }
  const anchor = new THREE.Vector3().lerpVectors(from, to, Math.min(1, best));
  st.rocket = { phase: 'reach', t: 0, anchor, target, len: anchor.distanceTo(from), wall: !target && best <= 1, trail: null, hitSet: new Set() };
  h.moveLock = ROCKET.reach + 0.05;
  h.anim.reach = 1;
  g.play('rubberStretch', from, 1, { rate: 0.85 });
  // both hands leave with a crack of air
  const m = _b.copy(from).addScaledVector(dir, 0.8);
  g.vfx.p({ x: m.x, y: m.y, z: m.z, r: 2, g: 2, b: 2, size: 0.35, grow: 3.5, life: 0.16, shape: Shape.Ring, aux: 0.2 });
}

function updateRocket(h: Hero, g: Game, dt: number, st: LuffyState) {
  const r = st.rocket!;
  r.t += dt;
  if (r.target && r.target.alive) r.anchor.copy(r.target.center);
  const from = h.chest;
  const toAnchor = _a.subVectors(r.anchor, from);
  const dist = toAnchor.length();
  if (r.phase === 'reach') {
    // both arms shoot out and latch on
    const k = Math.min(1, r.t / ROCKET.reach);
    const ext = Math.max(0, (dist - ARM) * k);
    h.anim.stretchL = ext; h.anim.stretchR = ext;
    h.anim.reach = 1;
    h.overrideVel = (h.overrideVel ?? new THREE.Vector3()).set(0, h.grounded ? 0 : -2, 0);
    if (k >= 1) {
      r.phase = 'fly'; r.t = 0;
      g.play('rocketLaunch', from, 1);
      const grip = r.anchor;
      g.vfx.p({ x: grip.x, y: grip.y, z: grip.z, r: 2.4, g: 2.2, b: 2, size: 0.35, grow: 3, life: 0.18, shape: Shape.Ring, aux: 0.22 });
      if (r.wall) { g.vfx.dust(grip, 5, 0.5, 0.3, 1.2); g.vfx.debris(grip, new THREE.Color(0.3, 0.26, 0.22), 5, 4, 0.06, 2); }
      const feet = _b.copy(h.pos);
      g.vfx.dustRing(feet, 0.6, 12, 0.55, 0.4);
      g.vfx.shockwave(feet, SPEED, 2, 0.3, 0.1);
      r.trail = g.vfx.trail({ color: gearOn(st) ? WHITE : SPEED, endColor: gearOn(st) ? SKY : RED_SOFT, width: 0.35, life: 0.22, style: TrailStyle.Smooth, minDist: 0.3, alpha: 0.5 });
      if (h.isLocal) { screenFx.zoomPunch(0.25); g.camRig.kick(2); }
    }
    return;
  }
  // slingshot: the arms reel him in; he arrives head first
  const sp = gearOn(st) ? ROCKET.speedG5 : ROCKET.speed;
  const dir = toAnchor.normalize();
  h.overrideVel = (h.overrideVel ?? new THREE.Vector3()).copy(dir).multiplyScalar(sp);
  if (!r.wall && !r.target) h.overrideVel.y = Math.max(h.overrideVel.y, -6);
  h.anim.reach = 1; h.anim.dash = 1;
  const ext = Math.max(0, dist - ARM);
  h.anim.stretchL = ext; h.anim.stretchR = ext;
  r.trail?.push(_b.copy(h.pos).setY(h.pos.y + 1.1));
  if (Math.random() < 0.9) {
    const c = h.center;
    g.vfx.p({ x: c.x + rand(-0.4, 0.4), y: c.y + rand(-0.6, 0.6), z: c.z + rand(-0.4, 0.4), vx: -dir.x * 6, vy: -dir.y * 6, vz: -dir.z * 6, r: SPEED.r, g: SPEED.g, b: SPEED.b, size: 0.06, life: 0.18, shape: Shape.Spark, stretch: 0.07 });
  }
  // body slam anything in the way
  for (const e of g.enemiesNear(h.team, h.pos, 1.35)) {
    if (r.hitSet.has(e.id)) continue;
    r.hitSet.add(e.id);
    rocketHit(h, g, e, dir, st);
    endRocket(h, g, st, true);
    return;
  }
  if (dist < 1.1 || r.t > ROCKET.maxFly) endRocket(h, g, st, false);
}

function rocketHit(h: Hero, g: Game, e: Hero, dir: THREE.Vector3, st: LuffyState) {
  const g5 = gearOn(st);
  const at = e.chest;
  g.damage(e, g5 ? ROCKET.dmgG5 : ROCKET.dmg, h, { at, knock: _c.copy(dir).setY(0).normalize().multiplyScalar(g5 ? 18 : 13).setY(g5 ? 7 : 5) });
  g.play('rocketHit', at, 1);
  g.vfx.flare(at, WHITE, 3.5, 0.18);
  g.vfx.shockwave(at, RED, 3, 0.35, 0.1, false);
  g.vfx.sparks(at, STRAW, 22, 13);
  g.vfx.burst(at, RED_SOFT, 16, 6, 0.12, 0.3);
  g.vfx.glyph('GUM-GUM ROCKET!', at.clone().setY(at.y + 1.1), { color: '#fff4dc', glow: '#ff3b30', scale: 1.1, dur: 0.75, vy: 1.2 });
  g.shake(at, 0.4, 18);
  if (h.isLocal) { g.hitStop(0.07); screenFx.punch(0.45); }
  g.voice.say(h, 'secondaryHit');
}

function endRocket(h: Hero, g: Game, st: LuffyState, bounced: boolean) {
  const r = st.rocket;
  if (!r) return;
  st.rocket = null;
  r.trail?.stop();
  h.overrideVel = null;
  h.anim.reach = 0; h.anim.dash = 0;
  h.anim.stretchL = 0; h.anim.stretchR = 0;
  const dir = _a.subVectors(r.anchor, h.pos).setY(0);
  const l = dir.length() || 1;
  if (bounced) {
    // rubber recoil: he pops back and up off the target
    h.vel.set(-dir.x / l * 4, 6.5, -dir.z / l * 4);
    h.grounded = false;
  } else {
    // keep some of the momentum, plus a hop if he slammed into a wall
    h.vel.set(dir.x / l * 5, r.wall ? 5 : 3, dir.z / l * 5);
    h.grounded = false;
    if (r.wall) { g.play('rubberSnap', h.center, 0.8); g.vfx.dust(h.center, 6, 0.6, 0.3, 1.4); }
  }
}

// ───────────────── Gear Fifth ─────────────────

let hatGeo: THREE.BufferGeometry | null = null;
let hatMat: THREE.MeshStandardMaterial | null = null;
/** The big straw hat that spins up over him as he awakens (Meshy luffy_hat when delivered, else built here). */
function bigHat(): THREE.Object3D {
  const m = propMesh('luffy_hat', 1);
  if (m) { const g = new THREE.Group(); m.position.y = -0.5; g.add(m); return g; }
  if (!hatGeo) {
    const crown = new THREE.CylinderGeometry(0.42, 0.46, 0.38, 32, 1);
    crown.translate(0, 0.2, 0);
    const brim = new THREE.CylinderGeometry(0.95, 1.0, 0.05, 48, 1);
    const band = new THREE.CylinderGeometry(0.47, 0.47, 0.11, 32, 1, true);
    band.translate(0, 0.08, 0);
    const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
      const n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      g.deleteAttribute('uv');
      return g;
    };
    const straw = new THREE.Color('#e9c35b'), red = new THREE.Color('#c41e28');
    hatGeo = mergeGeometries([paint(crown, straw), paint(brim, straw), paint(band, red)], false);
    hatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, emissive: new THREE.Color(0.25, 0.2, 0.05) });
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(hatGeo!, hatMat!));
  return g;
}

function startGear(h: Hero, g: Game, st: LuffyState) {
  const hat = bigHat();
  hat.position.copy(h.pos).setY(h.pos.y + 2.2);
  hat.scale.setScalar(0.01);
  g.scene.add(hat);
  st.gear = { phase: 'awaken', t: 0, drumT: 0, hat };
  h.channel = GEAR.awaken;
  h.secondaryCd = 0;
  g.play('gearAwaken', h.pos, 1.1);
  audio.duck(1.1, 0.7, 0.4);
  const feet = _a.copy(h.pos); feet.y = g.world.heightAt(feet.x, feet.z, feet.y + 0.5);
  g.vfx.rune(feet, CLOUD_GLOW, 4.5, GEAR.awaken, 1.6, 0.8, 0.8);
  g.vfx.groundGlow(feet, new THREE.Color(1.2, 1.3, 1.8), 5, GEAR.awaken, 0.3);
  if (h.isLocal) g.events.onAnnounce('GEAR FIFTH', 'The Drums of Liberation', 'gold');
}

function awaken(h: Hero, g: Game, st: LuffyState) {
  const gear = st.gear!;
  gear.phase = 'on'; gear.t = 0;
  const c = h.center;
  const feet = _a.copy(h.pos); feet.y = g.world.heightAt(feet.x, feet.z, feet.y + 0.5);
  g.play('gearBurst', c, 1.2);
  g.vfx.flash(c, new THREE.Color(1.6, 1.7, 2), 120, 0.7, 30);
  g.vfx.flare(c, WHITE, 9, 0.45);
  g.vfx.flare(c, SKY, 7, 0.6, Math.PI / 2);
  g.vfx.shockwave(feet, WHITE, GEAR.blast + 2, 0.6, 0.08);
  g.vfx.shockwave(c, CLOUD_GLOW, GEAR.blast, 0.5, 0.1, false);
  g.vfx.dustRing(feet, 2.5, 30, 1.4, 0.45, CLOUD);
  g.vfx.pillar(feet, WHITE, 14, 50, 0.9);
  // a ring of clouds blooms out of him
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * TAU + rand(-0.1, 0.1), s = rand(5, 9);
    g.vfx.pa({ x: c.x, y: c.y + rand(-0.6, 0.6), z: c.z, vx: Math.cos(a) * s, vy: rand(0.3, 2), vz: Math.sin(a) * s, r: CLOUD.r, g: CLOUD.g, b: CLOUD.b, a: 0.6, size: rand(0.8, 1.4), grow: 2.4, life: rand(0.9, 1.4), shape: Shape.Smoke, drag: 2.6, spin: rand(-1, 1), fadeIn: 0.05 });
  }
  g.vfx.burst(c, WHITE, 70, 14, 0.12, 0.9, { drag: 2 });
  g.shake(c, 0.8, 30);
  const prox = Math.max(g.near(c, 35), h.isLocal ? 1 : 0);
  screenFx.flashScreen(new THREE.Color(1.6, 1.65, 1.8), 0.6 * prox);
  screenFx.ripple(c, 12, 1.2, 0.7);
  screenFx.punch(0.6 * prox);
  if (prox > 0.3) g.hitStop(0.08);
  for (const e of g.enemiesNear(h.team, h.pos, GEAR.blast)) {
    const d = e.pos.distanceTo(h.pos);
    const dir = e.center.sub(c).setY(0).normalize();
    g.damage(e, GEAR.blastDmg * (1 - (d / GEAR.blast) * 0.4), h, { knock: dir.multiplyScalar(14).setY(6) });
  }
}

function updateGear(h: Hero, g: Game, dt: number, st: LuffyState) {
  const gear = st.gear!;
  gear.t += dt;
  const fx = h.model.fx;
  const c = h.center;
  if (gear.phase === 'awaken') {
    const k = Math.min(1, gear.t / GEAR.awaken);
    h.dmgTakenMult *= 0.5;
    h.anim.levitate = Math.min(0.7, k * 1.6);
    h.anim.cast = Math.min(1, k * 2.5);
    h.overrideVel = (h.overrideVel ?? new THREE.Vector3()).set(0, k < 0.7 ? 1.6 : 0.1, 0);
    fx.uWhite.value = k * k * 0.85;
    fx.uRim.value = 0.35 + k * 1.2;
    // the heartbeat: four drum hits, quickening
    gear.drumT -= dt;
    if (gear.drumT <= 0) {
      gear.drumT = 0.32 - k * 0.12;
      g.play('gearDrum', c, 0.6 + k * 0.5);
      g.vfx.p({ x: c.x, y: c.y + 0.2, z: c.z, r: 2, g: 2.1, b: 2.6, size: 0.6, grow: 4 + k * 4, life: 0.3, shape: Shape.Ring, aux: 0.12 });
      if (h.isLocal) screenFx.punch(0.12 + k * 0.15);
    }
    // the hat spins up above him
    if (gear.hat) {
      const s = Math.sin(Math.min(1, k * 1.4) * Math.PI * 0.5) * 1.6;
      gear.hat.scale.setScalar(Math.max(0.01, s));
      gear.hat.position.set(h.pos.x, h.pos.y + 2.4 + k * 1.2, h.pos.z);
      gear.hat.rotation.set(Math.sin(gear.t * 5) * 0.15, gear.t * (6 + k * 18), 0);
    }
    // clouds gather
    if (Math.random() < dt * 40) {
      const a = rand(0, TAU), r = rand(2.5, 4.5), life = 0.6;
      g.vfx.pa({ x: c.x + Math.cos(a) * r, y: c.y + rand(-1, 1.5), z: c.z + Math.sin(a) * r, vx: -Math.cos(a) * r / life * 0.8, vy: 0, vz: -Math.sin(a) * r / life * 0.8, r: CLOUD.r, g: CLOUD.g, b: CLOUD.b, a: 0.45, size: rand(0.5, 0.9), life, shape: Shape.Smoke, drag: 0.5, fadeIn: 0.2 });
    }
    if (h.isLocal) screenFx.zoomHold = k * 0.15;
    if (gear.t >= GEAR.awaken) {
      if (h.isLocal) screenFx.zoomHold = 0;
      h.overrideVel = null;
      h.anim.levitate = 0; h.anim.cast = 0;
      if (gear.hat) { g.scene.remove(gear.hat); gear.hat = null; }
      awaken(h, g, st);
    }
    return;
  }
  if (gear.phase === 'on') {
    const left = GEAR.dur - gear.t;
    const fade = Math.min(1, left / 0.6);
    fx.uWhite.value = 0.85 * fade;
    fx.uRim.value = 0.35 + 1.1 * fade + Math.sin(gear.t * 9) * 0.15 * fade;
    h.speedMult *= GEAR.speed;
    h.dmgTakenMult *= GEAR.armor;
    // rubber bounce: jumps launch him much higher
    if (h.input.jump && h.grounded && h.moveLock <= 0 && h.channel <= 0 && st.bounce <= 0) {
      // (set directly: the regular jump only fires from the ground, and an impulse would lift him off it first)
      h.vel.y = 11.5; h.grounded = false;
      st.bounce = 0.4;
      g.play('rubberSnap', h.pos, 0.5, { rate: 0.7 });
      g.vfx.pa({ x: h.pos.x, y: h.pos.y + 0.1, z: h.pos.z, r: CLOUD.r, g: CLOUD.g, b: CLOUD.b, a: 0.5, size: 1.1, grow: 2, life: 0.5, shape: Shape.Smoke, drag: 2 });
    }
    // drums of liberation: a heartbeat that never stops
    gear.drumT -= dt;
    if (gear.drumT <= 0) {
      gear.drumT = 0.75;
      g.play('gearDrum', c, 0.55);
      g.vfx.p({ x: c.x, y: c.y, z: c.z, r: 1.4, g: 1.5, b: 1.9, size: 0.7, grow: 3.2, life: 0.35, shape: Shape.Ring, aux: 0.08 });
    }
    // white flames of cloud trailing off him, and a few stars
    if (Math.random() < dt * 22) {
      const a = rand(0, TAU), r = rand(0.3, 0.6);
      g.vfx.pa({ x: c.x + Math.cos(a) * r, y: c.y + rand(-0.8, 0.9), z: c.z + Math.sin(a) * r, vx: Math.cos(a) * 0.4 - h.vel.x * 0.3, vy: rand(0.8, 1.6), vz: Math.sin(a) * 0.4 - h.vel.z * 0.3, r: CLOUD.r, g: CLOUD.g, b: CLOUD.b, a: 0.38 * fade, size: rand(0.3, 0.55), grow: 2, life: rand(0.5, 0.8), shape: Shape.Smoke, drag: 1.2, spin: rand(-2, 2), fadeIn: 0.1 });
    }
    if (Math.random() < dt * 10) {
      const a = gear.t * 3 + rand(0, TAU);
      g.vfx.p({ x: c.x + Math.cos(a) * 0.8, y: c.y + rand(0.2, 1.1), z: c.z + Math.sin(a) * 0.8, vy: 0.6, r: WHITE.r, g: WHITE.g, b: WHITE.b, size: rand(0.08, 0.14), life: 0.5, shape: Shape.Star, spin: 4 });
    }
    // floating clouds under his feet while airborne
    if (!h.grounded && Math.random() < dt * 18) g.vfx.pa({ x: h.pos.x + rand(-0.4, 0.4), y: h.pos.y - 0.1, z: h.pos.z + rand(-0.4, 0.4), vy: -0.3, r: CLOUD.r, g: CLOUD.g, b: CLOUD.b, a: 0.45, size: rand(0.45, 0.7), grow: 1.6, life: 0.6, shape: Shape.Smoke, drag: 1 });
    if (gear.t >= GEAR.dur) {
      gear.phase = 'tired'; gear.t = 0;
      g.play('gearEnd', c, 0.8);
      // the transformation burns out in a puff of steam and leaves him winded for a moment
      for (let i = 0; i < 14; i++) g.vfx.pa({ x: c.x + rand(-0.4, 0.4), y: c.y + rand(-0.6, 0.6), z: c.z + rand(-0.4, 0.4), vx: rand(-1, 1), vy: rand(1.5, 3), vz: rand(-1, 1), r: 0.8, g: 0.8, b: 0.82, a: 0.4, size: rand(0.4, 0.7), grow: 2.4, life: rand(0.8, 1.2), shape: Shape.Smoke, drag: 1.5 });
      h.applySlow(0.35, 1.4);
    }
    return;
  }
  // tired: the colour comes back
  fx.uWhite.value = 0; fx.uRim.value = damp(fx.uRim.value, 0.35, 6, dt);
  if (gear.t > 1.4) { fx.uRim.value = 0.35; st.gear = null; }
}

// ───────────────── Kit ─────────────────

class LuffyKit implements HeroKit {
  primary(h: Hero, g: Game) {
    const st = state(h);
    const giant = gearOn(st);
    h.primaryCd = giant ? DAWN.cd : PISTOL.cd;
    if (st.rocket) return;
    // alternate fists; if the next one is still out, throw the other again
    let k = h.hand > 0 ? 0 : 1;
    if (st.fists[k].phase) k = 1 - k;
    if (st.fists[k].phase) return;
    h.hand = k ? 1 : -1;
    firePistol(h, g, k, st);
  }

  secondary(h: Hero, g: Game) {
    const st = state(h);
    if (st.rocket || st.gear?.phase === 'awaken') return false;
    for (const f of st.fists) { f.phase = 0; f.ext = 0; f.trail?.stop(); f.trail = null; }
    startRocket(h, g, st);
    return true;
  }

  ult(h: Hero, g: Game) {
    const st = state(h);
    if (st.rocket) endRocket(h, g, st, false);
    if (st.gear?.hat) g.scene.remove(st.gear.hat);
    startGear(h, g, st);
    return true;
  }

  update(h: Hero, g: Game, dt: number) {
    const st = state(h);
    st.bounce = Math.max(0, st.bounce - dt);
    if (st.gear) updateGear(h, g, dt, st);
    if (st.rocket) { updateRocket(h, g, dt, st); return; }
    h.anim.reach = 0;
    for (let k = 0; k < 2; k++) updateFist(h, g, k, st.fists[k], dt);
    const g5 = gearOn(st);
    const idle = g5 ? GEAR.idleFist : 1;
    const [L, R] = st.fists;
    h.anim.stretchL = L.ext; h.anim.stretchR = R.ext;
    // fists swell while they fly in Gear Fifth (and stay a little big the whole time)
    h.anim.fistL = L.phase && L.giant ? DAWN.fist : damp(h.anim.fistL ?? 1, idle, 10, dt);
    h.anim.fistR = R.phase && R.giant ? DAWN.fist : damp(h.anim.fistR ?? 1, idle, 10, dt);
    // Gear Fifth: the Rocket recharges twice as fast
    if (g5 && h.secondaryCd > g5RocketCd) h.secondaryCd = g5RocketCd;
  }

  onDeath(h: Hero, g: Game) {
    const st = state(h);
    for (const f of st.fists) { f.phase = 0; f.ext = 0; f.trail?.stop(); f.trail = null; }
    if (st.rocket) { st.rocket.trail?.stop(); st.rocket = null; }
    if (st.gear?.hat) g.scene.remove(st.gear.hat);
    if (h.isLocal && st.gear?.phase === 'awaken') screenFx.zoomHold = 0;
    st.gear = null;
    h.overrideVel = null;
    h.anim.reach = 0; h.anim.levitate = 0; h.anim.cast = 0; h.anim.dash = 0;
    h.anim.stretchL = 0; h.anim.stretchR = 0; h.anim.fistL = 1; h.anim.fistR = 1;
    h.model.fx.uWhite.value = 0; h.model.fx.uRim.value = 0.35;
  }
}

// ───────────────── Look (procedural stand-in while the model loads) ─────────────────
function buildLuffy(r: RigBuilder) {
  const { skin } = r.base({ skin: '#e6a777', shirt: '#c8202a', pants: '#3767b4', shoes: '#a8793e', sleeves: '#e6a777', torsoScale: [0.98, 1, 0.95], armR: 0.045, legR: 0.068 });
  const red = r.mat('#c8202a', 0.75), hair = r.mat('#141216', 0.9), straw = r.mat('#e9c35b', 0.85), band = r.mat('#c41e28', 0.6), sash = r.mat('#f2c230', 0.7);
  // open vest over a bare chest
  r.add(r.spine, r.capsule(0.07, 0.2, 8), skin, [0, 0.2, 0.09], [0, 0, 0], [1.1, 1, 0.5]);
  for (const x of [0.17, -0.17]) r.add(r.chest, r.sphere(0.06, 10, 8), red, [x * 1.1, 0.1, 0]);
  r.add(r.hips, new THREE.TorusGeometry(0.13, 0.025, 6, 20), sash, [0, 0.07, 0], [Math.PI / 2, 0, 0], [1.05, 0.8, 1]);
  // hat + hair
  r.add(r.head, r.sphere(0.12, 14, 10), hair, [0, 0.09, -0.02], [0, 0, 0], [1, 0.85, 1.02]);
  r.add(r.head, new THREE.CylinderGeometry(0.11, 0.12, 0.1, 18), straw, [0, 0.2, -0.01]);
  r.add(r.head, new THREE.CylinderGeometry(0.122, 0.122, 0.03, 18, 1, true), band, [0, 0.165, -0.01]);
  r.add(r.head, new THREE.CylinderGeometry(0.25, 0.26, 0.012, 28), straw, [0, 0.155, -0.01]);
}

export const LUFFY: HeroDef = {
  id: 'luffy',
  name: 'Monkey D. Luffy',
  title: 'The Rubber Pirate',
  role: 'Duelist',
  tagline: 'I\'m gonna be King of the Pirates!',
  color: '#ff3b30',
  accent: '#ffd23f',
  maxHp: 275,
  // Meshy model (scripts/build-luffy-standin.mjs made the old stand-in); bump ?v= whenever the file changes
  modelUrl: '/models/heroes/luffy.glb?v=2',
  motion: 'default',
  speed: 6.4,
  secondaryCd: 7,
  ultCost: 1650,
  botRange: 12,
  ratings: { damage: 0.8, mobility: 0.9, support: 0.1, difficulty: 0.6 },
  abilities: {
    primary: { key: 'LMB', name: 'Gum-Gum Pistol', desc: 'Alternate rubber punches that stretch out to whatever you aim at and snap back. Headshots deal 50% bonus damage.', stat: `${PISTOL.dmg} dmg · ${PISTOL.range} m reach`, icon: ICONS.pistol },
    secondary: { key: 'RMB', name: 'Gum-Gum Rocket', desc: 'Shoot both arms out, grab a wall or an enemy, and slingshot yourself in. Body-slams anyone in the way.', stat: `${ROCKET.dmg} dmg · ${ROCKET.range} m · ${7} s cd`, icon: ICONS.rocket },
    ult: { key: 'SHIFT', name: 'Gear Fifth', desc: 'The Drums of Liberation. Awaken in a blast of clouds, then fight for 10 s with giant Dawn fists that splash, faster legs, rubber jumps and tougher skin. Refreshes Gum-Gum Rocket and halves its cooldown.', stat: `${GEAR.dur} s · ${DAWN.dmg} dmg fists`, icon: ICONS.gear5 },
  },
  look: { build: buildLuffy },
  rubber: true,
  createKit: () => new LuffyKit(),
};

/** Pre-create the hat so its shader compiles during loading. */
export function warmupLuffy(_g: Game): THREE.Object3D[] {
  return [bigHat()];
}
