import * as THREE from 'three';
import type { HeroDef, HeroKit } from '../game/types';
import type { Hero } from '../game/Hero';
import type { Game } from '../game/Game';
import { Shape } from '../vfx/Particles';
import { TrailStyle } from '../vfx/Trails';
import { screenFx } from '../vfx/ScreenFx';
import { InstancedPool } from '../vfx/Vfx';
import { clamp, rand, TAU, _v1, _v2 } from '../core/math';
import { TrexModel, beastPose, type BeastPose } from '../render/TrexModel';
import type { RigBuilder } from '../render/HeroRig';
import { ICONS } from './icons';

/**
 * The T-Rex, the Tyrant King. A Vanguard who wins by being enormous and impossible to ignore:
 *  - LMB Tyrant Bite: lunging bites that heal him for part of the damage; every third swing is a full 360° tail
 *    sweep that bowls everyone around him over.
 *  - RMB Stampede: head down, he charges. The first enemy in his path is scooped up in his jaws and flung at the
 *    end of the run (or slammed into the wall he crashes into); anyone else in the way is trampled aside.
 *  - SHIFT Extinction Event: he rears up and roars, terrifying everyone in front of him (slowed and silenced),
 *    then the sky burns and a meteor shower hammers the ground around him while he rages on, tougher and faster.
 */

const AMBER = new THREE.Color(3.4, 1.9, 0.6);
const BONE = new THREE.Color(2.6, 2.4, 2.0);
const FIRE = new THREE.Color(4, 1.5, 0.3);
const FIRE_HOT = new THREE.Color(4.4, 3.2, 1.6);
const EMBER = new THREE.Color(2.8, 0.7, 0.1);
const ROAR = new THREE.Color(2.6, 1.0, 0.35);
const DIRT = new THREE.Color(0.42, 0.34, 0.26);
const SMOKE = new THREE.Color(0.16, 0.13, 0.12);

// Tyrant Bite
const BITE_T = 0.5, BITE_HIT = 0.45, BITE_DMG = 48, BITE_REACH = 4.6, BITE_CONE = 0.62, LIFESTEAL = 0.3, RAGE_LIFESTEAL = 0.5;
const SWEEP_T = 0.62, SWEEP_HIT = 0.42, SWEEP_DMG = 36, SWEEP_R = 5.4;
const COMBO_WINDOW = 1.4;
// Stampede
const CHARGE_T = 1.35, CHARGE_SPEED = 17, CHARGE_TURN = 1.8, CATCH_DMG = 45, FLING_DMG = 35, TRAMPLE_DMG = 30, CRASH_DMG = 40;
// Extinction Event
const REAR_T = 0.62, ROAR_R = 15, ROAR_NEAR = 6, ROAR_CONE = 1.05, ROAR_DMG = 45, TERROR = 2.2;
const SHOWER_T = 4.6, METEOR_EVERY = 0.16, METEOR_FALL = 0.75, METEOR_R = 3.2, METEOR_DMG = 34, RAGE_T = 6.2;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

const rex = (h: Hero) => h.model as TrexModel;
function pose(h: Hero): BeastPose { return (h.anim.beast ??= beastPose()); }

interface Charge {
  t: number;
  dir: THREE.Vector3;
  carried: Hero | null;
  hit: Set<number>;
  stall: number;
  last: THREE.Vector3;
}


function meteorPool() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  // a lumpy rock: push the vertices in and out a little
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    _a.fromBufferAttribute(p, i);
    const k = 1 + 0.18 * Math.sin(_a.x * 5.1 + _a.y * 3.7) * Math.cos(_a.z * 4.3 - _a.y * 2.1);
    p.setXYZ(i, _a.x * k, _a.y * k, _a.z * k);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b1d16, roughness: 0.85, metalness: 0, emissive: 0xff5a14, emissiveIntensity: 1.6, flatShading: true });
  return new InstancedPool(geo, mat, 48, false);
}

class TrexKit implements HeroKit {
  primary(h: Hero, g: Game) {
    const st = h.kitState;
    if (st.charge || st.rearT > 0 || st.biteT >= 0 || st.sweepT >= 0) return;
    st.combo = g.time - (st.comboT ?? -9) > COMBO_WINDOW ? 0 : ((st.combo ?? -1) + 1) % 3;
    st.comboT = g.time;
    if (st.combo === 2) {
      // the tail sweep: a full turn on the spot, the tail whips through everyone around him
      h.primaryCd = 0.95;
      st.sweepT = 0; st.swept = false;
      st.sweepDir = Math.random() < 0.5 ? 1 : -1;
      g.play('rexSweep', h.pos, 0.9);
      st.tailTrail = g.vfx.trail({ color: new THREE.Color(1.3, 1.1, 0.8), endColor: new THREE.Color(0.4, 0.3, 0.2), width: 0.22, life: 0.22, style: TrailStyle.Smooth, minDist: 0.12, alpha: 0.55 });
      if (h.isLocal) g.camRig.kick(2);
      return;
    }
    h.primaryCd = 0.62;
    st.biteT = 0; st.bit = false;
    st.biteSide = st.combo === 1 ? -1 : 1;
    g.play('rexSnap', h.pos, 0.8);
    if (h.grounded) h.applyImpulse(_v1.copy(h.forward).multiplyScalar(3.2));
  }

  secondary(h: Hero, g: Game) {
    const st = h.kitState;
    if (st.charge || st.rearT > 0) return false;
    st.biteT = -1; st.sweepT = -1;
    st.charge = { t: 0, dir: h.forward.clone(), carried: null, hit: new Set(), stall: 0, last: h.pos.clone() } satisfies Charge;
    g.play('stampede', h.pos, 1);
    g.vfx.dustRing(h.pos, 1.6, 22, 0.9, 0.45);
    g.vfx.debris(h.pos, DIRT, 10, 6, 0.12, 5);
    if (h.isLocal) { g.camRig.kick(5); g.camRig.shake(0.18); screenFx.zoomPunch(0.25); }
    return true;
  }

  ult(h: Hero, g: Game) {
    const st = h.kitState;
    if (st.charge) endCharge(h, g, false);
    st.biteT = -1; st.sweepT = -1;
    st.rearT = REAR_T;
    st.roared = false;
    h.channel = Math.max(h.channel, REAR_T + 0.15);
    g.play('rexRumble', h.pos, 1);
    if (h.isLocal) g.events.onAnnounce('EXTINCTION EVENT', 'The sky is falling', 'red');
    else if (g.local && g.local.team !== h.team && g.local.pos.distanceTo(h.pos) < 40) g.events.onAnnounce('EXTINCTION EVENT', 'Take cover!', 'red');
    return true;
  }

  update(h: Hero, g: Game, dt: number) {
    const st = h.kitState;
    const bp = pose(h);
    st.biteT ??= -1; st.sweepT ??= -1;
    // Tyrant Bite
    if (st.biteT >= 0) {
      st.biteT += dt / BITE_T;
      bp.bite = Math.min(0.999, st.biteT); bp.biteSide = st.biteSide;
      if (!st.bit && st.biteT >= BITE_HIT) { st.bit = true; if (h.alive) bite(h, g); }
      if (st.biteT >= 1) { st.biteT = -1; bp.bite = 0; }
    } else bp.bite = 0;
    // tail sweep
    if (st.sweepT >= 0) {
      st.sweepT += dt / SWEEP_T;
      bp.sweep = Math.min(0.999, st.sweepT); bp.sweepDir = st.sweepDir;
      if (st.tailTrail) st.tailTrail.push(rex(h).tailWorld(_v1));
      if (!st.swept && st.sweepT >= SWEEP_HIT) { st.swept = true; if (h.alive) sweep(h, g); }
      if (st.sweepT >= 1) { st.sweepT = -1; bp.sweep = 0; st.tailTrail?.stop(); st.tailTrail = null; }
    } else bp.sweep = 0;
    // Stampede
    if (st.charge) updateCharge(h, g, dt, st.charge);
    bp.charge = clamp(bp.charge + (st.charge ? dt * 6 : -dt * 4), 0, 1);
    bp.carry = clamp(bp.carry + (st.charge?.carried ? dt * 8 : -dt * 5), 0, 1);
    // Extinction Event
    if (st.rearT > 0) updateRear(h, g, dt);
    bp.rear = clamp(bp.rear + (st.rearT > 0 ? dt / (REAR_T * 0.8) : -dt * 3), 0, 1);
    st.roarT = Math.max(0, (st.roarT ?? 0) - dt);
    bp.roar = clamp(st.roarT > 0 ? Math.min(1, st.roarT * 3) : 0, 0, 1);
    if (st.showerT > 0) updateShower(h, g, dt);
    if (st.rageT > 0) {
      st.rageT -= dt;
      h.dmgTakenMult *= 0.75;
      h.speedMult *= 1.15;
      h.model.fx.uTint.value.setRGB(1.25, 0.82, 0.7);
      h.model.fx.uTintAmt.value = Math.min(1, st.rageT * 2) * 0.55;
      if (Math.random() < dt * 10) {
        const c = h.center;
        g.vfx.p({ x: c.x + rand(-0.8, 0.8), y: c.y + rand(-0.4, 1), z: c.z + rand(-1, 1), vx: rand(-0.4, 0.4), vy: rand(1, 2.2), vz: rand(-0.4, 0.4), r: EMBER.r, g: EMBER.g, b: EMBER.b, r2: 0.6, g2: 0.1, b2: 0, size: rand(0.05, 0.1), life: rand(0.6, 1.1), shape: Shape.Dot });
      }
    } else if (h.model.fx.uTintAmt.value > 0) h.model.fx.uTintAmt.value = 0;
    footfalls(h, g, dt);
    // hot breath on the air now and then
    if (h.alive && !st.charge && Math.random() < dt * 0.7) {
      const m = rex(h).mouthWorld(_v1);
      g.vfx.pa({ x: m.x, y: m.y, z: m.z, vx: h.forward.x * 0.8, vy: 0.3, vz: h.forward.z * 0.8, r: 0.8, g: 0.78, b: 0.74, a: 0.08, size: 0.25, grow: 3, life: 0.9, drag: 1.5, shape: Shape.Smoke, rot: rand(0, TAU) });
    }
  }

  onNet(h: Hero, g: Game, ev: string) {
    const ch: Charge | null = h.kitState.charge;
    if (!ev.startsWith('catch:') || !ch || ch.carried) return;
    const e = g.heroes[+ev.slice(6)];
    if (e && e.alive) catchVictim(h, g, ch, e);
  }

  onDeath(h: Hero, g: Game) {
    const st = h.kitState;
    if (st.charge) endCharge(h, g, false);
    st.biteT = -1; st.sweepT = -1; st.rearT = 0; st.roarT = 0; st.rageT = 0; st.showerT = 0;
    st.tailTrail?.stop(); st.tailTrail = null;
    const bp = pose(h);
    Object.assign(bp, beastPose());
    h.model.fx.uTintAmt.value = 0;
  }
}

// ───────────────────────── footfalls ─────────────────────────

/** Every footfall lands: a thud, a puff of dust, and the ground shakes for whoever is close. Synced to the walk cycle. */
function footfalls(h: Hero, g: Game, dt: number) {
  const st = h.kitState;
  const sp = Math.hypot(h.vel.x, h.vel.z);
  if (!h.alive || !h.grounded || sp < 1.2) { st.stepAcc = 0.35; return; }
  const freq = clamp(0.8 + sp * 0.19, 0.8, 3.4);
  st.stepAcc = (st.stepAcc ?? 0) + dt * freq * 2;
  if (st.stepAcc < 1) return;
  st.stepAcc -= 1;
  st.foot = -(st.foot ?? 1);
  const at = _v1.copy(h.pos).addScaledVector(h.right, -0.6 * st.foot).addScaledVector(h.forward, 0.25);
  const k = clamp(sp / 9, 0.45, 1.3);
  g.play('rexStep', at, 0.55 + k * 0.4);
  g.vfx.dust(at, 2, 0.45 * k + 0.2, 0.22, 0.8);
  if (st.charge) { g.vfx.dustRing(at, 0.9, 10, 0.6, 0.35); g.vfx.debris(at, DIRT, 4, 4, 0.08, 3); }
  // the ground trembles under you when he's close (and for him, a little)
  if (g.local) {
    const d = g.local.pos.distanceTo(h.pos);
    if (g.local === h) g.camRig.shake(0.03 * k);
    else if (d < 16) g.camRig.shake((1 - d / 16) * 0.06 * k);
  }
}

// ───────────────────────── Tyrant Bite ─────────────────────────

function bite(h: Hero, g: Game) {
  const f = h.forward;
  const mouth = rex(h).mouthWorld(new THREE.Vector3());
  const rage = (h.kitState.rageT ?? 0) > 0;
  // the snap itself: teeth flash and the air cracks in front of the jaws
  g.vfx.flare(mouth, BONE, 1.4, 0.08, rand(-0.3, 0.3));
  g.vfx.p({ x: mouth.x, y: mouth.y, z: mouth.z, r: 1.6, g: 1.4, b: 1.1, size: 0.35, grow: 4, life: 0.14, shape: Shape.Ring, aux: 0.12 });
  let hits = 0, healed = 0;
  for (const e of g.heroes) {
    if (!e.alive || e.team === h.team) continue;
    const dx = e.pos.x - h.pos.x, dz = e.pos.z - h.pos.z, d = Math.hypot(dx, dz);
    if (d > BITE_REACH + e.hitR || e.pos.y > h.pos.y + 3.2 || e.pos.y + e.hitH < h.pos.y - 1) continue;
    const ang = Math.acos(clamp((dx * f.x + dz * f.z) / Math.max(1e-3, d), -1, 1));
    if (d > 1.8 && ang > BITE_CONE) continue;
    if (!g.los(_a.copy(h.pos).setY(h.pos.y + 1.6), e.chest)) continue;
    hits++;
    const at = e.chest;
    healed += g.damage(e, BITE_DMG, h, { at, knock: new THREE.Vector3(f.x * 3, 1.2, f.z * 3) }) * (rage ? RAGE_LIFESTEAL : LIFESTEAL);
    g.play('rexChomp', at, 1);
    g.vfx.burst(at, BONE, 12, 6, 0.08, 0.3);
    g.vfx.sparks(at, AMBER, 10, 8, f);
    g.vfx.flare(at, new THREE.Color(3.2, 2.4, 1.6), 1.6, 0.1, rand(-0.3, 0.3));
    // two rows of teeth marks closing on them
    for (const sy of [1, -1]) {
      const row = g.vfx.trail({ color: BONE, endColor: new THREE.Color(0.8, 0.7, 0.6), width: 0.05, life: 0.12, style: TrailStyle.Smooth, minDist: 0.01, taper: 0 });
      const r = h.right;
      row?.push(_b.copy(at).addScaledVector(r, -0.45).setY(at.y + sy * 0.32));
      row?.push(_b.copy(at).addScaledVector(f, 0.1).setY(at.y + sy * 0.12));
      row?.push(_b.copy(at).addScaledVector(r, 0.45).setY(at.y + sy * 0.32));
      row?.stop();
    }
    if (e.isLocal) { screenFx.punch(0.35); g.camRig.shake(0.18); }
  }
  if (healed > 0.5) {
    g.heal(h, healed, h);
    const c = h.chest;
    g.vfx.burst(c, new THREE.Color(1.2, 3, 0.9), 8, 2, 0.08, 0.6, { vy: 1.5 });
  }
  if (hits) {
    g.voice.say(h, 'primary');
    if (h.isLocal) { g.camRig.shake(0.12); g.hitStop(0.04); screenFx.punch(0.2); }
  }
}

function sweep(h: Hero, g: Game) {
  const pos = h.pos.clone();
  g.play('rexSweepHit', pos, 0.7);
  g.vfx.dustRing(pos, SWEEP_R * 0.75, 30, 1.0, 0.45);
  g.vfx.shockwave(pos, new THREE.Color(1.1, 0.9, 0.6), SWEEP_R, 0.4, 0.09);
  g.vfx.debris(pos, DIRT, 14, 7, 0.1, 5);
  let hits = 0;
  for (const e of g.enemiesNear(h.team, pos, SWEEP_R)) {
    if (Math.abs(e.pos.y - pos.y) > 2.6) continue;
    const away = _v1.subVectors(e.pos, pos).setY(0);
    const d = away.length() || 1;
    away.multiplyScalar(8 / d);
    g.damage(e, SWEEP_DMG, h, { at: e.chest, knock: new THREE.Vector3(away.x, 3.5, away.z) });
    e.applySlow(0.25, 1);
    hits++;
    g.play('rexChomp', e.chest, 0.6);
    g.vfx.sparks(e.chest, AMBER, 12, 9, away.normalize());
    g.vfx.flare(e.chest, new THREE.Color(3, 2.2, 1.2), 1.5, 0.1);
    g.vfx.dust(e.pos, 4, 0.5, 0.3, 1.2);
    if (e.isLocal) { screenFx.punch(0.4); g.camRig.shake(0.22); }
  }
  if (h.isLocal) { g.camRig.shake(hits ? 0.2 : 0.1); if (hits) { g.hitStop(0.05); screenFx.punch(0.25); } }
}

// ───────────────────────── Stampede ─────────────────────────

function updateCharge(h: Hero, g: Game, dt: number, ch: Charge) {
  ch.t += dt;
  // steer toward the crosshair, but a charging tyrant turns like a truck
  const want = h.forward;
  const cur = Math.atan2(ch.dir.x, ch.dir.z), tgt = Math.atan2(want.x, want.z);
  let da = tgt - cur; da = Math.atan2(Math.sin(da), Math.cos(da));
  const na = cur + clamp(da, -CHARGE_TURN * dt, CHARGE_TURN * dt);
  ch.dir.set(Math.sin(na), 0, Math.cos(na));
  h.dmgTakenMult *= 0.7;
  if (g.owns(h)) {
    h.overrideVel = (h.overrideVel ?? new THREE.Vector3()).set(ch.dir.x * CHARGE_SPEED, h.grounded ? 0 : Math.max(-14, (h.vel.y || 0) - 22 * dt), ch.dir.z * CHARGE_SPEED);
    h.vel.y = h.overrideVel.y;
  }
  // tearing up the ground
  if (Math.random() < dt * 30) g.vfx.dust(_v1.copy(h.pos).addScaledVector(ch.dir, rand(-1.5, 0.5)).addScaledVector(h.right, rand(-0.7, 0.7)), 1, 0.6, 0.3, 1.2);
  if (Math.random() < dt * 14) g.vfx.debris(h.pos, DIRT, 2, 4, 0.08, 3);
  if (h.isLocal && Math.random() < dt * 6) g.camRig.shake(0.05);
  // the horn of the charge: a speed shimmer ahead of the head
  const m = rex(h).mouthWorld(_v2);
  if (Math.random() < dt * 20) g.vfx.pa({ x: m.x + ch.dir.x * 0.6, y: m.y, z: m.z + ch.dir.z * 0.6, vx: -ch.dir.x * 6, vy: rand(-0.2, 0.3), vz: -ch.dir.z * 6, r: 0.9, g: 0.85, b: 0.8, a: 0.12, size: rand(0.3, 0.5), grow: 2.5, life: 0.35, drag: 2, shape: Shape.Smoke, rot: rand(0, TAU) });

  // the victim rides in the jaws
  if (ch.carried) {
    const e = ch.carried;
    if (!e.alive) ch.carried = null;
    else {
      const goal = _a.copy(m).addScaledVector(ch.dir, 0.3);
      goal.y -= (e.def.body?.chestY ?? 1.3);
      const d = _b.subVectors(goal, e.pos);
      e.overrideVel = (e.overrideVel ?? new THREE.Vector3()).copy(d).multiplyScalar(18).clampLength(0, 40);
      e.applyStun(0.15);
      if (Math.random() < dt * 12) g.vfx.dust(e.pos, 1, 0.35, 0.25, 0.4);
    }
  }
  // the head hits whoever is in the way: the first is caught, the rest trampled
  const front = _a.copy(h.pos).addScaledVector(ch.dir, 2.1);
  for (const e of g.heroes) {
    if (!e.alive || e.team === h.team || e === ch.carried || ch.hit.has(e.id)) continue;
    const dx = e.pos.x - front.x, dz = e.pos.z - front.z;
    if (Math.hypot(dx, dz) > 1.6 + e.hitR || Math.abs(e.pos.y - h.pos.y) > 2.2) continue;
    ch.hit.add(e.id);
    if (!ch.carried && g.owns(h)) { catchVictim(h, g, ch, e); g.net?.kitEvent(h, `catch:${e.idx}`); continue; }
    if (ch.carried === e) continue;
    // trampled aside
    const side = Math.sign(dx * ch.dir.z - dz * ch.dir.x) || 1;
    const push = new THREE.Vector3(ch.dir.z * side * 10 + ch.dir.x * 5, 4.5, -ch.dir.x * side * 10 + ch.dir.z * 5);
    g.damage(e, TRAMPLE_DMG, h, { at: e.chest, knock: push });
    g.play('rexChomp', e.chest, 0.6);
    g.vfx.sparks(e.chest, AMBER, 10, 9);
    g.vfx.dust(e.pos, 4, 0.5, 0.3, 1);
    if (e.isLocal) { screenFx.punch(0.4); g.camRig.shake(0.25); }
  }
  // a wall stops him dead
  const moved = Math.hypot(h.pos.x - ch.last.x, h.pos.z - ch.last.z);
  ch.last.copy(h.pos);
  if (ch.t > 0.12 && moved < CHARGE_SPEED * dt * 0.35) ch.stall++; else ch.stall = 0;
  if (ch.stall >= 2) { crash(h, g, ch); return; }
  if (ch.t >= CHARGE_T) endCharge(h, g, true);
}

function catchVictim(h: Hero, g: Game, ch: Charge, e: Hero) {
  ch.carried = e;
  ch.hit.add(e.id);
  g.damage(e, CATCH_DMG, h, { at: e.chest });
  e.applyStun(0.4);
  g.play('rexChomp', e.chest, 1);
  g.vfx.flare(e.chest, BONE, 2.2, 0.12);
  g.vfx.burst(e.chest, AMBER, 16, 7, 0.09, 0.35);
  g.voice.say(h, 'secondaryHit');
  if (h.isLocal) { g.camRig.shake(0.18); g.hitStop(0.05); }
  if (e.isLocal) { screenFx.punch(0.5); g.camRig.shake(0.3); g.events.onAnnounce('CAUGHT', 'In the jaws of the king', 'red'); }
}

/** Ran into a wall: the whole charge stops on the spot, and whoever was in his jaws takes the hit. */
function crash(h: Hero, g: Game, ch: Charge) {
  const at = rex(h).mouthWorld(new THREE.Vector3());
  g.play('rexCrash', at, 1);
  g.shake(at, 0.5, 22);
  g.vfx.shockwave(h.pos, new THREE.Color(1.2, 0.95, 0.6), 4.5, 0.4, 0.1);
  g.vfx.debris(at, DIRT, 20, 9, 0.12, 6);
  g.vfx.dust(at, 8, 0.8, 0.4, 1.6);
  g.vfx.flare(at, new THREE.Color(3, 2.4, 1.6), 3, 0.12);
  g.vfx.crack(_v1.copy(at).setY(h.pos.y), 2.2, 6, 0.7);
  if (ch.carried && ch.carried.alive) {
    const e = ch.carried;
    ch.carried = null;
    e.overrideVel = null;
    g.damage(e, CRASH_DMG, h, { at: e.chest, knock: new THREE.Vector3(-ch.dir.x * 3, 3, -ch.dir.z * 3) });
    e.applyStun(0.8);
    if (e.isLocal) { screenFx.punch(0.6); g.camRig.shake(0.4); }
  }
  h.moveLock = Math.max(h.moveLock, 0.35);
  if (h.isLocal) { g.camRig.shake(0.35); screenFx.punch(0.35); g.hitStop(0.06); }
  endCharge(h, g, false);
}

function endCharge(h: Hero, g: Game, fling: boolean) {
  const ch: Charge | null = h.kitState.charge;
  if (!ch) return;
  h.kitState.charge = null;
  h.overrideVel = null;
  h.vel.set(ch.dir.x * 4, Math.min(0, h.vel.y), ch.dir.z * 4);
  const e = ch.carried;
  if (e) {
    e.overrideVel = null;
    if (fling && e.alive) {
      // a toss of the head: up and away
      g.damage(e, FLING_DMG, h, { at: e.chest, knock: new THREE.Vector3(ch.dir.x * 13, 7.5, ch.dir.z * 13) });
      e.applyStun(0.5);
      g.play('rexSweepHit', e.chest, 0.8);
      g.vfx.burst(e.chest, AMBER, 14, 8, 0.08, 0.4);
      const tr = g.vfx.trail({ color: new THREE.Color(1.6, 1.3, 0.9), endColor: new THREE.Color(0.4, 0.3, 0.2), width: 0.12, life: 0.3, style: TrailStyle.Smooth, minDist: 0.05 });
      tr?.push(rex(h).mouthWorld(_v1)); tr?.push(_v1.copy(e.chest).addScaledVector(ch.dir, 2).setY(e.chest.y + 1.5)); tr?.stop();
      if (h.isLocal) { g.camRig.shake(0.15); screenFx.punch(0.2); }
    }
  }
  g.vfx.dustRing(h.pos, 1.4, 16, 0.8, 0.4);
}

// ───────────────────────── Extinction Event ─────────────────────────

function updateRear(h: Hero, g: Game, dt: number) {
  const st = h.kitState;
  st.rearT -= dt;
  const k = 1 - Math.max(0, st.rearT) / REAR_T;
  // the air is sucked in and the sky starts to burn
  g.doom = Math.max(g.doom, k * 0.6);
  g.doomKind = 1;
  if (Math.random() < dt * 30) {
    const a = rand(0, TAU), r = rand(3, 8), life = rand(0.3, 0.5);
    const m = rex(h).mouthWorld(_v1);
    g.vfx.p({ x: m.x + Math.cos(a) * r, y: m.y + rand(-1, 2), z: m.z + Math.sin(a) * r, vx: -Math.cos(a) * r / life, vy: 0, vz: -Math.sin(a) * r / life, r: 1.2, g: 0.9, b: 0.6, size: rand(0.05, 0.09), life, shape: Shape.Spark, stretch: 0.05 });
  }
  if (Math.random() < dt * 8) g.vfx.dust(h.pos, 1, 0.5, 0.25, 2.5);
  if (st.rearT <= 0 && !st.roared) { st.roared = true; roar(h, g); }
}

function roar(h: Hero, g: Game) {
  const st = h.kitState;
  st.rearT = 0;
  st.roarT = 1.1;
  st.showerT = SHOWER_T;
  st.meteorT = 0.25;
  st.rageT = RAGE_T;
  const m = rex(h).mouthWorld(new THREE.Vector3());
  const f = h.forward;
  g.play('rexRoar', m, 1.3);
  g.shake(h.pos, 0.8, 40);
  g.vfx.flash(m, new THREE.Color(2.2, 0.9, 0.3), 40, 0.5, 22);
  // the roar itself: rings of pressure rolling out of the jaws
  for (let i = 0; i < 5; i++) {
    const at = _v1.copy(m).addScaledVector(f, 1 + i * 2.2);
    g.vfx.p({ x: at.x, y: at.y, z: at.z, r: ROAR.r * (1 - i * 0.15), g: ROAR.g * (1 - i * 0.15), b: ROAR.b, size: 0.5 + i * 0.4, grow: 4 + i, life: 0.35 + i * 0.08, shape: Shape.Ring, aux: 0.08, fadeIn: 0.05 * i });
  }
  g.vfx.shockwave(h.pos, ROAR, ROAR_R, 0.6, 0.08);
  g.vfx.shockwave(h.pos, new THREE.Color(1.4, 0.8, 0.4), ROAR_NEAR, 0.45, 0.12);
  g.vfx.dustRing(h.pos, 3, 30, 1.3, 0.5);
  g.vfx.debris(h.pos, DIRT, 18, 7, 0.1, 6);
  g.vfx.glyph('Extinction', _v1.copy(h.pos).setY(h.pos.y + 6), { color: '#ffe2c4', glow: '#ff5a14', scale: 2.4, dur: 2.2, vy: 0.4 });
  screenFx.ripple(m, ROAR_R, 1.2, 0.8);
  if (h.isLocal) { screenFx.zoomPunch(0.5); screenFx.punch(0.5); g.camRig.shake(0.5); g.hitStop(0.06); }
  for (const e of g.enemiesNear(h.team, h.pos, ROAR_R)) {
    const dx = e.pos.x - h.pos.x, dz = e.pos.z - h.pos.z, d = Math.hypot(dx, dz) || 1;
    const ang = Math.acos(clamp((dx * f.x + dz * f.z) / d, -1, 1));
    if (d > ROAR_NEAR && ang > ROAR_CONE) continue;
    if (Math.abs(e.pos.y - h.pos.y) > 5 || !g.los(m, e.chest)) continue;
    g.damage(e, ROAR_DMG, h, { at: e.chest, knock: new THREE.Vector3((dx / d) * 7, 3, (dz / d) * 7) });
    e.applySlow(0.5, TERROR + 0.4);
    e.applySilence(TERROR);
    g.vfx.burst(e.center, ROAR, 10, 3, 0.08, 0.5, { vy: 1 });
    if (e.isLocal) {
      g.events.onAnnounce('TERRIFIED', 'Slowed and silenced', 'red');
      screenFx.flashScreen(new THREE.Color(1.6, 0.5, 0.15), 0.12);
      screenFx.punch(0.5);
      g.camRig.shake(0.45);
    }
  }
}

function updateShower(h: Hero, g: Game, dt: number) {
  const st = h.kitState;
  st.showerT -= dt;
  // the sky burns for the whole shower, then cools
  g.doom = Math.max(g.doom, Math.min(1, st.showerT * 1.5));
  g.doomKind = 1;
  st.meteorT -= dt;
  while (st.meteorT <= 0 && st.showerT > 0) {
    st.meteorT += METEOR_EVERY * rand(0.7, 1.3);
    spawnMeteor(h, g);
  }
  // ash drifting down everywhere near him
  if (Math.random() < dt * 25) {
    const a = rand(0, TAU), r = rand(2, 20);
    g.vfx.p({ x: h.pos.x + Math.cos(a) * r, y: h.pos.y + rand(6, 14), z: h.pos.z + Math.sin(a) * r, vx: rand(-0.5, 0.5), vy: rand(-1.5, -0.8), vz: rand(-0.5, 0.5), r: EMBER.r, g: EMBER.g, b: EMBER.b, r2: 0.3, g2: 0.05, b2: 0, size: rand(0.04, 0.08), life: rand(2, 3.5), shape: Shape.Dot });
  }
  if (st.showerT <= 0) st.showerT = 0;
}

function spawnMeteor(h: Hero, g: Game) {
  const target = new THREE.Vector3();
  // most fall on enemies near him (with a little lead), the rest scatter in front of him
  const foes = g.enemiesNear(h.team, h.pos, 26);
  if (foes.length && Math.random() < 0.65) {
    const e = foes[Math.floor(Math.random() * foes.length)];
    const a = rand(0, TAU), r = rand(0, 2.6);
    target.set(e.pos.x + e.vel.x * METEOR_FALL * 0.7 + Math.cos(a) * r, 0, e.pos.z + e.vel.z * METEOR_FALL * 0.7 + Math.sin(a) * r);
  } else {
    const f = h.forward, a = rand(-1.4, 1.4), r = rand(4, 18);
    const c = Math.cos(a), s = Math.sin(a);
    target.set(h.pos.x + (f.x * c - f.z * s) * r, 0, h.pos.z + (f.x * s + f.z * c) * r);
  }
  target.y = g.world.heightAt(target.x, target.z, h.pos.y + 4);
  const from = target.clone().add(new THREE.Vector3(rand(-8, 8), 34, rand(-8, 8)));
  const trail = g.vfx.trail({ color: FIRE, endColor: new THREE.Color(0.5, 0.12, 0.02), width: 0.35, life: 0.45, style: TrailStyle.Energy, minDist: 0.4 });
  const spin = new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)), size = rand(0.45, 0.75);
  // a falling rock is a projectile: it lands on the marker, or on whoever stands under it
  g.spawnProjectile({
    owner: h, kind: 'meteor', pos: from.clone(), vel: target.clone().sub(from).divideScalar(METEOR_FALL), gravity: 0, radius: 0.45,
    life: METEOR_FALL * 1.25, damage: METEOR_DMG, color: FIRE.clone(),
    onHit(pr, g2, _hit, point) { trail?.stop(); impact(h, g2, point.y < target.y + 1.5 ? point : target); },
    onExpire(pr, g2) { trail?.stop(); impact(h, g2, target); },
    render(pr, g2) {
      trail?.push(pr.pos);
      _q.setFromEuler(new THREE.Euler(spin.x * pr.age, spin.y * pr.age, spin.z * pr.age));
      g2.pool('rexMeteor', meteorPool).add(_m4.compose(pr.pos, _q, _s.setScalar(size)));
      const p = pr.pos;
      if (Math.random() < 0.6) g2.vfx.p({ x: p.x, y: p.y, z: p.z, vx: rand(-1, 1), vy: rand(0, 2), vz: rand(-1, 1), r: FIRE_HOT.r, g: FIRE_HOT.g, b: FIRE_HOT.b, r2: EMBER.r * 0.4, g2: EMBER.g * 0.3, b2: 0, size: rand(0.3, 0.55), life: 0.22, shape: Shape.Flare, drag: 2 });
      if (Math.random() < 0.4) g2.vfx.pa({ x: p.x, y: p.y, z: p.z, vx: rand(-0.5, 0.5), vy: rand(0.2, 1), vz: rand(-0.5, 0.5), r: SMOKE.r, g: SMOKE.g, b: SMOKE.b, a: 0.35, size: rand(0.5, 0.8), grow: 3, life: rand(0.8, 1.3), drag: 1, shape: Shape.Smoke, rot: rand(0, TAU) });
    },
  });
  if (Math.random() < 0.35) g.play('meteorFall', target, 0.7);
  // a burning marker where it will land
  g.vfx.add.spawn({ x: target.x, y: target.y + 0.06, z: target.z, r: FIRE.r * 0.6, g: FIRE.g * 0.5, b: FIRE.b * 0.4, size: METEOR_R * 0.3, grow: 3.4, life: METEOR_FALL, shape: Shape.Ring, flat: true, aux: 0.06, fadeIn: 0.2, rot: 0 });
  g.vfx.groundGlow(target, EMBER, METEOR_R * 1.4, METEOR_FALL, 0.1);
}

function impact(h: Hero, g: Game, at: THREE.Vector3) {
  g.play('meteorImpact', at, 1);
  g.shake(at, 0.35, 18);
  g.vfx.flash(_v1.copy(at).setY(at.y + 1), FIRE, 18, 0.25, 10);
  g.vfx.flare(_v1.copy(at).setY(at.y + 0.5), FIRE_HOT, 4, 0.16);
  g.vfx.shockwave(at, FIRE, METEOR_R * 1.1, 0.35, 0.12);
  g.vfx.burst(_v1.copy(at).setY(at.y + 0.3), FIRE, 16, 9, 0.1, 0.5, { gravity: 9 });
  g.vfx.embers(at, FIRE_HOT, EMBER, 10, 1.2, 4);
  g.vfx.debris(at, new THREE.Color(0.2, 0.15, 0.12), 10, 8, 0.12, 7);
  g.vfx.smoke(_v1.copy(at).setY(at.y + 0.6), SMOKE, 4, 1.1, 1.6, 0.45);
  g.vfx.scorch(at, METEOR_R * 0.9, 8, 0.7);
  g.vfx.crack(at, METEOR_R * 0.7, 6, 0.7);
  for (const e of g.enemiesNear(h.team, at, METEOR_R)) {
    if (Math.abs(e.pos.y - at.y) > 3) continue;
    const away = _v2.subVectors(e.pos, at).setY(0);
    const d = away.length() || 1;
    away.multiplyScalar(4 / d);
    g.damage(e, METEOR_DMG, h, { at: e.chest, knock: new THREE.Vector3(away.x, 5, away.z) });
    if (e.isLocal) { screenFx.punch(0.35); g.camRig.shake(0.25); }
  }
}

// ───────────────────────── def ─────────────────────────

/** The T-Rex has its own model (TrexModel), so the humanoid stand-in is never built; this is only a type filler. */
function noLook(_r: RigBuilder) { /* not used */ }

export const TREX: HeroDef = {
  id: 'trex',
  name: 'T-Rex',
  title: 'The Tyrant King',
  role: 'Vanguard',
  tagline: '66 million years. Still hungry.',
  color: '#7ccf4a',
  accent: '#ff6a1f',
  maxHp: 550,
  modelUrl: '/models/heroes/trex.glb?v=1',
  speed: 6,
  secondaryCd: 8,
  ultCost: 1700,
  botRange: 3.6,
  ratings: { damage: 0.75, mobility: 0.45, support: 0.25, difficulty: 0.35 },
  body: { hitR: 1, hitH: 3.1, worldR: 0.7, centerY: 1.9, chestY: 2.3, camY: 3.3, camDist: 3, portrait: { cam: [3.8, 3.1, 6.5], look: [0, 2, 0.5] } },
  abilities: {
    primary: { key: 'LMB', name: 'Tyrant Bite', desc: 'Lunging bites that heal you for part of the damage. Every third swing is a full tail sweep that knocks back everyone around you.', stat: '48 · 48 · 36 sweep · 30% lifesteal', icon: ICONS.bite },
    secondary: { key: 'RMB', name: 'Stampede', desc: 'Lower your head and charge. The first enemy you hit is caught in your jaws and flung at the end; anyone else is trampled aside. Hit a wall and whoever you carry takes the crash.', stat: '45 + 35 · 30 trample · 8 s cd', icon: ICONS.stampede },
    ult: { key: 'SHIFT', name: 'Extinction Event', desc: 'Rear up and roar: enemies in front are terrified (slowed and silenced). The sky burns and meteors rain around you while you rage, tougher and faster.', stat: '45 roar · 34 per meteor · 6 s rage', icon: ICONS.extinction },
  },
  look: { build: noLook },
  createModel: (rim) => new TrexModel(TREX.modelUrl!, rim),
  createKit: () => new TrexKit(),
};

/** Meteor rocks are an instanced mesh: create it at boot so its shader is compiled before the first Extinction Event. */
export function warmupTrex(g: Game): THREE.Object3D[] {
  g.pool('rexMeteor', meteorPool);
  return [];
}
