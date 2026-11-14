import * as THREE from 'three';
import type { HeroDef, HeroInput, HeroKit } from './types';
import { ProceduralHeroModel, type HeroModel, type AnimState } from '../render/HeroRig';
import { GltfHeroModel } from '../render/GltfHeroModel';
import { clamp, damp, dampAngle } from '../core/math';
import type { World } from '../world/collision';

export const HERO_RADIUS = 0.45;
export const HERO_HEIGHT = 1.8;
const GRAVITY = 22;
const JUMP = 7.6;

let nextId = 1;

export class Hero {
  readonly id = nextId++;
  /** Seat in the match roster: the same on every machine in an online match. */
  idx = 0;
  /** Who drives this legend here: you, a bot this machine simulates, or another machine (online). */
  ctrl: 'local' | 'bot' | 'remote' = 'bot';
  /** Online: seconds to keep your own special charge instead of the host's (it is still catching up to your cast). */
  ultGuardT = 0;
  def: HeroDef;
  name: string;
  team: number;
  isLocal: boolean;
  kit: HeroKit;
  model: HeroModel;

  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  impulse = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  bodyYaw = 0;
  grounded = true;

  hp: number;
  maxHp: number;
  alive = true;
  respawnT = 0;
  deathT = 0;
  spawnT = 0; // seconds since spawn (dissolve-in + protection)

  primaryCd = 0;
  secondaryCd = 0;
  ult = 0;
  ultReadyNotified = false;

  // status
  slowT = 0;
  slowAmt = 0;
  speedMult = 1;
  dmgMult = 1;
  dmgTakenMult = 1;
  channel = 0; // >0 = can't act or move freely
  /** >0 = silenced: abilities (RMB and SHIFT) are offline, basic attacks still work. */
  silenceT = 0;
  /** >0 = stunned: no actions and no steering, but gravity and knockback still apply (unlike a channel). */
  stunT = 0;
  moveLock = 0;
  overrideVel: THREE.Vector3 | null = null;
  flashT = 0;
  healGlowT = 0;

  // anim signals
  anim: AnimState = { speed: 0, fwd: 0, side: 0, grounded: true, pitch: 0, attack: 0, attackSide: 1, cast: 0, levitate: 0, dash: 0, dead: false, time: 0 };
  hand: 1 | -1 = 1;

  stats = { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, streak: 0, bestStreak: 0 };
  recentAttackers = new Map<number, number>(); // heroId -> game time
  lastAttacker: Hero | null = null;
  /** The last legend who eliminated this one (a kill on them is revenge). */
  nemesis: Hero | null = null;
  /** Game time each ability was last used (credits the kill feed with the right ability). */
  abT = { primary: -99, secondary: -99, ult: -99 };

  input: HeroInput = { forward: 0, strafe: 0, jump: false, primary: false, secondary: false, ult: false, yaw: 0, pitch: 0, aim: new THREE.Vector3() };
  kitState: Record<string, any> = {};

  constructor(def: HeroDef, team: number, name: string, isLocal: boolean, rim: THREE.Color) {
    this.def = def;
    this.team = team;
    this.name = name;
    this.isLocal = isLocal;
    this.kit = def.createKit();
    this.maxHp = def.maxHp;
    this.hp = def.maxHp;
    this.model = def.modelUrl ? new GltfHeroModel(def, rim) : new ProceduralHeroModel(def.look, rim);
  }

  get forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  get right() { return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  get center() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.0, this.pos.z); }
  get chest() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.3, this.pos.z); }

  /** Direction from a muzzle point to the aim point. */
  aimDir(from: THREE.Vector3, out = new THREE.Vector3()) {
    out.copy(this.input.aim).sub(from);
    if (out.lengthSq() < 0.25) out.copy(this.lookDir());
    return out.normalize();
  }

  lookDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  muzzle(side: 'L' | 'R' = 'R', out = new THREE.Vector3()) {
    // stable muzzle based on body frame (independent of animation jitter)
    const f = this.forward, r = this.right;
    const s = side === 'R' ? 1 : -1;
    return out.copy(this.pos).addScaledVector(r, 0.32 * s).addScaledVector(f, 0.45).setY(this.pos.y + 1.38);
  }

  applySlow(amount: number, dur: number) {
    if (amount >= this.slowAmt || this.slowT <= 0) this.slowAmt = amount;
    this.slowT = Math.max(this.slowT, dur);
  }

  applyStun(dur: number) { this.stunT = Math.max(this.stunT, dur); }

  applySilence(dur: number) { this.silenceT = Math.max(this.silenceT, dur); }

  applyImpulse(v: THREE.Vector3) {
    this.impulse.add(v);
    if (v.y > 0) { this.grounded = false; }
  }

  physics(dt: number, world: World) {
    const inp = this.input;
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.slowAmt = 0; }
    const speed = this.def.speed * this.speedMult * (1 - this.slowAmt) * (this.channel > 0 ? 0.25 : 1);

    // desired horizontal velocity in world space
    let mx = 0, mz = 0;
    if (this.alive && this.moveLock <= 0 && this.stunT <= 0) {
      const f = this.forward, r = this.right;
      mx = f.x * inp.forward + r.x * inp.strafe;
      mz = f.z * inp.forward + r.z * inp.strafe;
      const l = Math.hypot(mx, mz);
      if (l > 1) { mx /= l; mz /= l; }
    }
    if (this.overrideVel) {
      this.vel.x = this.overrideVel.x; this.vel.z = this.overrideVel.z;
      this.vel.y = this.overrideVel.y;
    } else {
      const accel = this.grounded ? 16 : 3.5;
      this.vel.x = damp(this.vel.x, mx * speed, accel, dt);
      this.vel.z = damp(this.vel.z, mz * speed, accel, dt);
      if (this.channel <= 0) this.vel.y -= GRAVITY * dt;
      if (inp.jump && this.grounded && this.alive && this.moveLock <= 0 && this.channel <= 0 && this.stunT <= 0) {
        this.vel.y = JUMP;
        this.grounded = false;
      }
    }
    // impulses decay (knockback)
    this.pos.addScaledVector(this.vel, dt);
    this.pos.addScaledVector(this.impulse, dt);
    if (this.impulse.y > 0) { this.vel.y += this.impulse.y; this.impulse.y = 0; }
    const fr = this.grounded ? 7 : 1.5;
    this.impulse.x = damp(this.impulse.x, 0, fr, dt);
    this.impulse.z = damp(this.impulse.z, 0, fr, dt);

    world.resolve(this.pos, HERO_RADIUS, this.pos.y);
    const h = world.heightAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= h) {
      this.pos.y = h;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y > h + 0.05) {
      this.grounded = this.pos.y - h < 0.08 && this.vel.y <= 0;
      // stick to gentle slopes when walking down
      if (!this.grounded && this.vel.y <= 0 && this.pos.y - h < 0.25 && this.channel <= 0 && !this.overrideVel) { this.pos.y = h; this.grounded = true; this.vel.y = 0; }
    }
  }

  updateAnim(dt: number, time: number) {
    const a = this.anim;
    const f = this.forward, r = this.right;
    a.fwd = this.vel.x * f.x + this.vel.z * f.z;
    a.side = this.vel.x * r.x + this.vel.z * r.z;
    a.speed = Math.hypot(this.vel.x, this.vel.z);
    a.grounded = this.grounded;
    a.pitch = clamp(this.pitch, -0.9, 0.9);
    a.attack = Math.max(0, a.attack - dt * 4.5);
    a.hit = Math.max(0, (a.hit ?? 0) - dt * 5);
    a.dead = !this.alive;
    a.time = time;
    a.vy = this.vel.y;
    this.bodyYaw = dampAngle(this.bodyYaw, this.yaw, 18, dt);
    a.yaw = this.bodyYaw;
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.bodyYaw + Math.PI;
    this.model.update(dt, a);

    // fx uniforms
    this.flashT = Math.max(0, this.flashT - dt * 6);
    this.model.fx.uFlash.value = this.flashT;
    this.healGlowT = Math.max(0, this.healGlowT - dt * 2);
  }

  respawnAt(p: THREE.Vector3, yaw: number) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.impulse.set(0, 0, 0);
    this.yaw = this.bodyYaw = yaw;
    this.pitch = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.spawnT = 0;
    this.slowT = 0; this.slowAmt = 0; this.silenceT = 0; this.stunT = 0;
    this.channel = 0; this.moveLock = 0; this.overrideVel = null;
    this.speedMult = 1; this.dmgMult = 1; this.dmgTakenMult = 1;
    this.anim.cast = 0; this.anim.levitate = 0; this.anim.dash = 0;
    this.recentAttackers.clear();
    this.lastAttacker = null;
    this.model.fx.uDissolve.value = 1;
    this.model.root.visible = true;
  }

  dispose() { this.model.dispose(); }
}
