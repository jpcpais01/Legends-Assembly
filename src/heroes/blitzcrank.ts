import * as THREE from 'three';
import type { HeroDef, HeroKit } from '../game/types';
import { HERO_RADIUS, type Hero } from '../game/Hero';
import type { Game } from '../game/Game';
import { Shape } from '../vfx/Particles';
import { TrailStyle, type Trail } from '../vfx/Trails';
import { screenFx } from '../vfx/ScreenFx';
import { clamp, rand, segmentVsCapsule, TAU, _v1, _v2 } from '../core/math';
import type { RigBuilder } from '../render/HeroRig';
import { ICONS } from './icons';

/**
 * Blitzcrank, the Great Steam Golem. A Vanguard who wins fights by choosing who is in them:
 *  - LMB Power Fist: alternating piston jabs; every third blow is an uppercut that launches the target.
 *  - RMB Rocket Grab: the right forearm telescopes out behind a rocketing fist, clamps the first enemy it meets and reels them in.
 *    A caught enemy is stunned on arrival and primes the next punch into the uppercut.
 *  - SHIFT Static Field: the boilers overload, both fists hammer the floor and a lightning shockwave shocks,
 *    slows and silences everyone around him. For a few seconds after, stray bolts jump to anyone close.
 */

const ELEC = new THREE.Color(0.9, 2.6, 4.2);
const ELEC_HOT = new THREE.Color(2.8, 3.6, 4.4);
const BRASS = new THREE.Color(3.2, 2.1, 0.55);
const FIRE = new THREE.Color(3.6, 1.6, 0.35);
const STEAM = new THREE.Color(0.86, 0.88, 0.92);

// Power Fist
const JAB_DMG = 32, UPPER_DMG = 55, REACH = 4.3, CONE = 0.8;
const COMBO_WINDOW = 1.3;
// Rocket Grab
const GRAB_SPEED = 58, GRAB_RANGE = 24, GRAB_RADIUS = 0.5, GRAB_DMG = 40, PULL_SPEED = 30, REEL_SPEED = 70;
// Static Field
const FIELD_R = 10, FIELD_DMG = 85, SILENCE = 2.5, WINDUP = 0.62, OVERCHARGE = 6, ZAP_R = 7.5, ZAP_DMG = 15;

// ───────────────────────── lightning ─────────────────────────

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3(), _n1 = new THREE.Vector3(), _n2 = new THREE.Vector3();

/**
 * A jagged bolt from a to b, drawn as an energy ribbon pushed all at once (so it flashes and fades as one),
 * with a thin white-hot core and a fork or two. Costs a couple of trail slots for a tenth of a second.
 */
function bolt(g: Game, a: THREE.Vector3, b: THREE.Vector3, o: { width?: number; jag?: number; life?: number; forks?: number; color?: THREE.Color } = {}) {
  const width = o.width ?? 0.07, jag = o.jag ?? 0.35, life = o.life ?? 0.12;
  _a.copy(a); _b.copy(b);
  const d = _p.subVectors(_b, _a), len = d.length();
  if (len < 0.05) return;
  d.divideScalar(len);
  _n1.set(-d.z, 0, d.x); if (_n1.lengthSq() < 1e-4) _n1.set(1, 0, 0);
  _n1.normalize();
  _n2.crossVectors(d, _n1).normalize();
  const n = clamp(Math.round(len / 0.55), 4, 20);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, env = Math.sin(Math.PI * u) * jag * Math.min(1.5, 0.4 + len * 0.12);
    pts.push(new THREE.Vector3().lerpVectors(_a, _b, u).addScaledVector(_n1, i && i < n ? rand(-1, 1) * env : 0).addScaledVector(_n2, i && i < n ? rand(-1, 1) * env : 0));
  }
  const glow = g.vfx.trail({ color: o.color ?? ELEC, endColor: o.color ?? ELEC, width, life, style: TrailStyle.Energy, minDist: 0.01, taper: 0 });
  const core = g.vfx.trail({ color: ELEC_HOT, endColor: ELEC_HOT, width: width * 0.35, life: life * 0.8, style: TrailStyle.Smooth, minDist: 0.01, taper: 0 });
  for (const p of pts) { glow?.push(p); core?.push(p); }
  glow?.stop(); core?.stop();
  const forks = o.forks ?? (len > 3 ? 1 : 0);
  for (let f = 0; f < forks; f++) {
    const from = pts[Math.floor(rand(0.25, 0.75) * n)];
    const to = from.clone().addScaledVector(d, rand(0.4, 1.2) * Math.min(3, len * 0.3)).addScaledVector(_n1, rand(-1, 1)).addScaledVector(_n2, rand(-1, 1));
    const fk = g.vfx.trail({ color: o.color ?? ELEC, endColor: o.color ?? ELEC, width: width * 0.55, life: life * 0.8, style: TrailStyle.Energy, minDist: 0.01, taper: 1 });
    fk?.push(from);
    fk?.push(from.clone().lerp(to, 0.5).addScaledVector(_n2, rand(-0.25, 0.25)));
    fk?.push(to);
    fk?.stop();
  }
  // a pinprick flash at each end
  g.vfx.p({ x: b.x, y: b.y, z: b.z, r: ELEC_HOT.r, g: ELEC_HOT.g, b: ELEC_HOT.b, size: width * 6, life: 0.08, shape: Shape.Flare });
}

/** A ring of crawling arcs over a body (charging, overcharged, a caught enemy). */
function bodyArcs(g: Game, c: THREE.Vector3, r: number, h: number, count: number) {
  for (let i = 0; i < count; i++) {
    const a0 = rand(0, TAU), a1 = a0 + rand(0.6, 1.6) * (Math.random() < 0.5 ? -1 : 1);
    const y0 = c.y + rand(-h, h), y1 = y0 + rand(-0.4, 0.4);
    bolt(g, _v1.set(c.x + Math.cos(a0) * r, y0, c.z + Math.sin(a0) * r), _v2.set(c.x + Math.cos(a1) * r, y1, c.z + Math.sin(a1) * r), { width: 0.035, jag: 0.12, life: 0.07, forks: 0 });
  }
}

// ───────────────────────── telescoping arm ─────────────────────────

interface Grab {
  phase: 'out' | 'pull' | 'back';
  t: number;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  dir: THREE.Vector3;
  dist: number;
  target: Hero | null;
  trail: Trail | null;
}

// ───────────────────────── kit ─────────────────────────

class BlitzcrankKit implements HeroKit {
  primary(h: Hero, g: Game) {
    const st = h.kitState;
    if (st.grab || st.ultT > 0) return;
    st.combo = g.time - (st.comboT ?? -9) > COMBO_WINDOW ? 0 : ((st.combo ?? -1) + 1) % 3;
    if (st.primedT > g.time) { st.combo = 2; st.primedT = 0; }
    st.comboT = g.time;
    const upper = st.combo === 2;
    const side: 1 | -1 = st.combo === 1 ? -1 : 1;
    h.primaryCd = upper ? 0.74 : 0.42;
    h.anim.attack = 1; h.anim.attackSide = side; h.anim.attackKind = upper ? 'uppercut' : 'jab'; h.anim.attackBoth = false;
    const sh = h.muzzle(side > 0 ? 'R' : 'L');
    g.play(upper ? 'blitzUppercut' : 'blitzJab', sh, 0.85);
    // the piston vents: a jet of steam out of the elbow, behind the punch
    const f = h.forward, r = h.right;
    const el = _v1.copy(sh).addScaledVector(f, -0.5).addScaledVector(r, side * 0.25);
    for (let i = 0; i < 4; i++) g.vfx.pa({ x: el.x, y: el.y - 0.1, z: el.z, vx: -f.x * rand(2, 4) + r.x * side * rand(0.5, 1.5), vy: rand(0.3, 1.2), vz: -f.z * rand(2, 4) + r.z * side * rand(0.5, 1.5), r: STEAM.r, g: STEAM.g, b: STEAM.b, a: 0.28, size: rand(0.25, 0.4), grow: 3, life: rand(0.5, 0.8), drag: 2.5, shape: Shape.Smoke, rot: rand(0, TAU), spin: rand(-1, 1) });
    // a short lunge into the blow
    if (h.grounded) h.applyImpulse(_v2.copy(f).multiplyScalar(upper ? 5.5 : 3.6));
    st.pending = { t: upper ? 0.17 : 0.1, upper, side };
    if (h.isLocal) { g.camRig.kick(upper ? 2.5 : 1.2); g.camRig.shake(upper ? 0.08 : 0.04); }
  }

  secondary(h: Hero, g: Game) {
    const st = h.kitState;
    if (st.grab || st.ultT > 0) return false;
    const sh = h.muzzle('R');
    const dir = h.aimDir(sh);
    h.anim.attack = 1; h.anim.attackSide = 1; h.anim.attackKind = 'launch'; h.anim.attackBoth = false;
    h.channel = Math.max(h.channel, 0.18);
    g.play('grabLaunch', sh, 0.9);
    g.vfx.flare(sh, FIRE, 1.4, 0.12);
    g.vfx.sparks(sh, BRASS, 10, 8, dir);
    for (let i = 0; i < 6; i++) g.vfx.pa({ x: sh.x, y: sh.y, z: sh.z, vx: -dir.x * rand(1, 3) + rand(-1, 1), vy: rand(0, 1.5), vz: -dir.z * rand(1, 3) + rand(-1, 1), r: STEAM.r, g: STEAM.g, b: STEAM.b, a: 0.3, size: rand(0.3, 0.5), grow: 3, life: rand(0.6, 0.9), drag: 2, shape: Shape.Smoke, rot: rand(0, TAU) });
    const trail = g.vfx.trail({ color: FIRE, endColor: new THREE.Color(0.5, 0.25, 0.1), width: 0.09, life: 0.18, style: TrailStyle.Smooth, minDist: 0.3 });
    st.grab = { phase: 'out', t: 0, pos: sh.clone(), prev: sh.clone(), dir, dist: 0, target: null, trail } satisfies Grab;
    if (h.isLocal) g.camRig.kick(2);
    return true;
  }

  ult(h: Hero, g: Game) {
    const st = h.kitState;
    if (st.grab) endGrab(h, g);
    st.ultT = WINDUP;
    st.slammed = false;
    h.channel = Math.max(h.channel, WINDUP + 0.1);
    h.anim.cast = 1;
    g.play('staticCharge', h.pos, 1);
    g.vfx.groundGlow(h.pos, ELEC, 4, 0.8, 0.5);
    if (h.isLocal) g.events.onAnnounce('STATIC FIELD', 'Overload imminent', 'blue');
    return true;
  }

  update(h: Hero, g: Game, dt: number) {
    const st = h.kitState;
    if (st.pending) {
      st.pending.t -= dt;
      if (st.pending.t <= 0) { const p = st.pending; st.pending = null; if (h.alive) strike(h, g, p.upper, p.side); }
    }
    if (st.grab) updateGrab(h, g, dt, st.grab);
    if (st.ultT > 0) updateWindup(h, g, dt);
    if (st.overT > 0) updateOvercharge(h, g, dt);
    // the boiler breathes: a wisp of steam from the stacks now and then
    if (Math.random() < dt * (st.overT > 0 ? 6 : 1.6)) {
      const b = _v1.copy(h.pos).addScaledVector(h.forward, -0.3).addScaledVector(h.right, rand(-0.18, 0.18)).setY(h.pos.y + 1.9);
      g.vfx.pa({ x: b.x, y: b.y, z: b.z, vx: rand(-0.2, 0.2), vy: rand(0.8, 1.4), vz: rand(-0.2, 0.2), r: STEAM.r, g: STEAM.g, b: STEAM.b, a: 0.18, size: rand(0.18, 0.28), grow: 3.5, life: rand(1, 1.6), drag: 0.8, shape: Shape.Smoke, rot: rand(0, TAU), spin: rand(-0.5, 0.5) });
    }
  }

  onNet(h: Hero, g: Game, ev: string) {
    const gr: Grab | null = h.kitState.grab;
    if (!ev.startsWith('grab:') || !gr || gr.phase === 'pull') return;
    const e = g.heroes[+ev.slice(5)];
    if (!e || !e.alive) return;
    gr.pos.copy(e.chest);
    catchTarget(h, g, gr, e);
  }

  onDeath(h: Hero, g: Game) {
    const st = h.kitState;
    if (st.grab) endGrab(h, g);
    st.pending = null; st.ultT = 0; st.overT = 0;
    h.anim.cast = 0;
    h.anim.armTarget = null;
  }
}

// ───────────────────────── Power Fist ─────────────────────────

function strike(h: Hero, g: Game, upper: boolean, side: 1 | -1) {
  const f = h.forward, r = h.right;
  const reach = REACH + (upper ? 0.5 : 0);
  const fistAt = _v1.copy(h.pos).addScaledVector(f, 1.7).addScaledVector(r, side * 0.2).setY(h.pos.y + (upper ? 1.6 : 1.3));
  // the strike itself: a streak of the fist, a compression ring and a flash of brass
  const from = h.muzzle(side > 0 ? 'R' : 'L');
  const streak = g.vfx.trail({ color: BRASS, endColor: new THREE.Color(1.2, 0.8, 0.3), width: upper ? 0.16 : 0.11, life: 0.12, style: TrailStyle.Smooth, minDist: 0.05 });
  if (upper) {
    streak?.push(_v2.copy(from).addScaledVector(f, 0.3).setY(h.pos.y + 0.7));
    streak?.push(_v2.copy(from).addScaledVector(f, 1.1).setY(h.pos.y + 1.1));
  } else streak?.push(from);
  streak?.push(fistAt);
  streak?.stop();
  g.vfx.p({ x: fistAt.x, y: fistAt.y, z: fistAt.z, r: BRASS.r * 0.5, g: BRASS.g * 0.5, b: BRASS.b * 0.5, size: 0.3, grow: upper ? 6 : 4, life: 0.16, shape: Shape.Ring, aux: 0.12 });
  g.vfx.flare(fistAt, BRASS, upper ? 1.6 : 0.9, 0.08, rand(-0.3, 0.3));
  let hits = 0;
  for (const e of g.heroes) {
    if (!e.alive || e.team === h.team) continue;
    const dx = e.pos.x - h.pos.x, dz = e.pos.z - h.pos.z, d = Math.hypot(dx, dz);
    if (d > reach + HERO_RADIUS || Math.abs(e.pos.y - h.pos.y) > 2.4) continue;
    const ang = Math.acos(clamp((dx * f.x + dz * f.z) / Math.max(1e-3, d), -1, 1));
    if (d > 1.4 && ang > CONE) continue;
    if (!g.los(h.chest, e.chest)) continue;
    hits++;
    const at = e.chest;
    if (upper) {
      g.damage(e, UPPER_DMG, h, { at, knock: new THREE.Vector3(f.x * 3, 9.5, f.z * 3) });
      e.applyStun(0.5);
      g.vfx.pillar(e.pos, ELEC, 3, 14, 0.5);
      g.vfx.shockwave(e.pos, BRASS, 2.4, 0.35, 0.1);
      bolt(g, _v2.copy(at).setY(at.y - 0.6), _a.copy(at).setY(at.y + 2.2), { width: 0.06, jag: 0.2, forks: 1 });
      g.vfx.debris(e.pos, new THREE.Color(0.5, 0.42, 0.32), 8, 6, 0.1, 7);
    } else {
      g.damage(e, JAB_DMG, h, { at, knock: new THREE.Vector3(f.x * 2.6, 0, f.z * 2.6) });
    }
    g.play('blitzPunchHit', at, upper ? 1 : 0.8);
    g.vfx.sparks(at, BRASS, upper ? 18 : 10, upper ? 12 : 9, f);
    g.vfx.flare(at, new THREE.Color(3.4, 2.6, 1.2), upper ? 2.2 : 1.3, 0.1, rand(-0.3, 0.3));
    g.vfx.p({ x: at.x, y: at.y, z: at.z, r: 3, g: 2.2, b: 0.9, size: 0.3, grow: upper ? 7 : 4.5, life: 0.18, shape: Shape.Ring, aux: 0.18 });
  }
  if (hits && h.isLocal) { g.camRig.shake(upper ? 0.2 : 0.09); if (upper) screenFx.punch(0.25); }
  if (upper) g.vfx.dustRing(h.pos, 1.2, 12, 0.6, 0.35);
}

// ───────────────────────── Rocket Grab ─────────────────────────

function updateGrab(h: Hero, g: Game, dt: number, gr: Grab) {
  gr.t += dt;
  const sh = h.muzzle('R', new THREE.Vector3());
  // the punch lands first, then the forearm telescopes out after the fist
  h.anim.armTarget = gr.pos;
  h.anim.armTargetW = clamp((gr.t - 0.05) / 0.06, 0, 1);
  gr.prev.copy(gr.pos);
  if (gr.phase === 'out') {
    const step = GRAB_SPEED * dt;
    gr.pos.addScaledVector(gr.dir, step);
    gr.dist += step;
    // heroes first, then the world
    // online, only the machine that drives Blitzcrank decides who the claw catches (the others hear it via onNet)
    let best = 2, hit: Hero | null = null;
    for (const e of g.heroes) {
      if (!e.alive || e.team === h.team || !g.owns(h)) continue;
      const t = segmentVsCapsule(gr.prev, gr.pos, e.pos.x, e.pos.z, e.pos.y + 0.15, e.pos.y + 1.65, HERO_RADIUS + GRAB_RADIUS);
      if (t >= 0 && t < best) { best = t; hit = e; }
    }
    const wt = g.world.raycast(gr.prev, gr.pos, 0.15);
    if (wt >= 0 && wt < best) { best = wt; hit = null; }
    if (best <= 1) {
      gr.pos.lerpVectors(gr.prev, gr.pos, best);
      if (hit) { catchTarget(h, g, gr, hit); g.net?.kitEvent(h, `grab:${hit.idx}`); }
      else {
        // clank off the scenery and reel back
        g.play('blitzPunchHit', gr.pos, 0.55);
        g.vfx.sparks(gr.pos, BRASS, 14, 9);
        g.vfx.flare(gr.pos, BRASS, 1.1, 0.1);
        g.vfx.dust(gr.pos, 4, 0.4, 0.3, 1);
        startReel(g, gr);
      }
    } else if (gr.dist >= GRAB_RANGE) startReel(g, gr);
    // rocket exhaust off the back of the cuff
    const back = _v1.copy(gr.pos).addScaledVector(gr.dir, -0.4);
    gr.trail?.push(back);
    g.vfx.p({ x: back.x, y: back.y, z: back.z, vx: -gr.dir.x * 3 + rand(-0.5, 0.5), vy: rand(-0.3, 0.5), vz: -gr.dir.z * 3 + rand(-0.5, 0.5), r: FIRE.r, g: FIRE.g, b: FIRE.b, r2: 0.6, g2: 0.15, b2: 0.05, size: rand(0.18, 0.3), life: 0.16, shape: Shape.Flare, drag: 3 });
    if (Math.random() < 0.6) g.vfx.pa({ x: back.x, y: back.y, z: back.z, vx: rand(-0.4, 0.4), vy: rand(0.2, 0.8), vz: rand(-0.4, 0.4), r: 0.35, g: 0.34, b: 0.34, a: 0.3, size: rand(0.18, 0.3), grow: 3, life: rand(0.4, 0.7), drag: 1.5, shape: Shape.Smoke, rot: rand(0, TAU) });
  } else if (gr.phase === 'pull') {
    const e = gr.target;
    if (!e || !e.alive || !h.alive) { if (e) e.overrideVel = null; gr.target = null; startReel(g, gr); }
    else {
      const goal = _v1.copy(h.pos).addScaledVector(h.forward, 1.7);
      const d = _v2.subVectors(goal, e.pos);
      const flat = Math.hypot(d.x, d.z);
      if (flat < 0.9 || gr.t > 1.1) {
        // arrival: the claw lets go and they're left stunned in front of him
        e.overrideVel = null;
        e.vel.set(0, Math.min(0, e.vel.y), 0);
        e.applyStun(0.45);
        h.kitState.primedT = g.time + 1.6;
        g.vfx.shockwave(e.pos, ELEC, 1.8, 0.3, 0.1);
        bodyArcs(g, e.center, 0.5, 0.6, 3);
        gr.target = null;
        endGrab(h, g);
        return;
      }
      const sp = Math.min(PULL_SPEED, flat / Math.max(dt, 1e-3));
      e.overrideVel = (e.overrideVel ?? new THREE.Vector3()).set((d.x / flat) * sp, clamp((goal.y - e.pos.y) * 6, -8, 8), (d.z / flat) * sp);
      e.applyStun(0.15);
      gr.pos.copy(e.chest).addScaledVector(gr.dir, -0.2);
      if (Math.random() < dt * 20) bodyArcs(g, e.center, 0.48, 0.6, 1);
      if (Math.random() < dt * 30) g.vfx.dust(e.pos, 1, 0.35, 0.25, 0.5);
    }
  } else {
    // reel back to the shoulder
    const d = _v1.subVectors(sh, gr.pos), l = d.length();
    const step = REEL_SPEED * dt;
    if (l <= step + 0.3) { endGrab(h, g); return; }
    gr.pos.addScaledVector(d, step / l);
    gr.dir.copy(d).multiplyScalar(-1 / l);
  }
  armFx(h, g, dt, gr, sh);
}

/** Pistons along the extended forearm: steam venting from the joints and a stray arc now and then. */
function armFx(h: Hero, g: Game, dt: number, gr: Grab, sh: THREE.Vector3) {
  const len = sh.distanceTo(gr.pos);
  if (len < 1.5) return;
  const n = Math.min(3, Math.floor(dt * len * 4 + Math.random()));
  for (let i = 0; i < n; i++) {
    const at = _a.lerpVectors(sh, gr.pos, rand(0.12, 0.92));
    g.vfx.pa({ x: at.x, y: at.y, z: at.z, vx: rand(-0.4, 0.4), vy: rand(0.4, 1.1), vz: rand(-0.4, 0.4), r: STEAM.r, g: STEAM.g, b: STEAM.b, a: 0.22, size: rand(0.16, 0.28), grow: 3, life: rand(0.4, 0.7), drag: 2, shape: Shape.Smoke, rot: rand(0, TAU) });
  }
  if (Math.random() < dt * (gr.phase === 'pull' ? 14 : 5)) {
    const u = rand(0.1, 0.8);
    bolt(g, _v1.lerpVectors(sh, gr.pos, u), _v2.lerpVectors(sh, gr.pos, Math.min(1, u + rand(0.1, 0.25))), { width: 0.03, jag: 0.15, life: 0.07, forks: 0 });
  }
}

function catchTarget(h: Hero, g: Game, gr: Grab, e: Hero) {
  gr.phase = 'pull';
  gr.target = e;
  gr.t = 0.2; // the pull gets its own clock (arrival times out at 1.1)
  gr.trail?.stop(); gr.trail = null;
  const at = e.chest;
  g.damage(e, GRAB_DMG, h, { at });
  e.applyStun(0.3);
  g.play('grabHit', at, 1);
  g.vfx.flare(at, ELEC_HOT, 2.4, 0.14);
  g.vfx.burst(at, ELEC, 18, 6, 0.1, 0.35);
  g.vfx.p({ x: at.x, y: at.y, z: at.z, r: ELEC.r, g: ELEC.g, b: ELEC.b, size: 0.4, grow: 6, life: 0.2, shape: Shape.Ring, aux: 0.15 });
  bodyArcs(g, e.center, 0.5, 0.7, 4);
  bolt(g, h.muzzle('R'), at, { width: 0.05, jag: 0.3, life: 0.14 });
  g.voice.say(h, 'secondaryHit');
  if (h.isLocal) { g.camRig.shake(0.15); g.hitStop(0.05); }
  if (e.isLocal) { screenFx.punch(0.4); g.camRig.shake(0.2); }
}

function startReel(g: Game, gr: Grab) {
  gr.phase = 'back';
  gr.trail?.stop(); gr.trail = null;
  g.play('grabReel', gr.pos, 0.7);
}

function endGrab(h: Hero, g: Game) {
  const gr: Grab | null = h.kitState.grab;
  if (!gr) return;
  if (gr.target) { gr.target.overrideVel = null; gr.target = null; }
  gr.trail?.stop();
  h.kitState.grab = null;
  h.anim.armTarget = null;
  // the arm snaps home with a puff of steam
  const sh = h.muzzle('R');
  g.vfx.sparks(sh, BRASS, 6, 5);
  g.vfx.pa({ x: sh.x, y: sh.y, z: sh.z, vy: 0.8, r: STEAM.r, g: STEAM.g, b: STEAM.b, a: 0.3, size: 0.35, grow: 3, life: 0.6, drag: 2, shape: Shape.Smoke, rot: rand(0, TAU) });
}

// ───────────────────────── Static Field ─────────────────────────

function updateWindup(h: Hero, g: Game, dt: number) {
  const st = h.kitState;
  st.ultT -= dt;
  const k = 1 - Math.max(0, st.ultT) / WINDUP;
  // lightning crawls over the boiler and leaps to the raised fist, the air is sucked in
  const c = h.center;
  if (Math.random() < dt * (14 + 30 * k)) bodyArcs(g, c, 0.55, 0.75, 1);
  if (Math.random() < dt * (8 + 20 * k)) {
    const a = rand(0, TAU), r = rand(3, 7);
    const p = _v1.set(h.pos.x + Math.cos(a) * r, h.pos.y + rand(0.1, 2.5), h.pos.z + Math.sin(a) * r);
    bolt(g, p, _v2.copy(c).setY(c.y + rand(0, 0.9)), { width: 0.04 + k * 0.03, jag: 0.4, life: 0.08, forks: 0 });
  }
  if (Math.random() < dt * 40) {
    const a = rand(0, TAU), r = rand(2.5, 6);
    const life = rand(0.3, 0.5);
    g.vfx.p({ x: h.pos.x + Math.cos(a) * r, y: h.pos.y + rand(0.1, 2), z: h.pos.z + Math.sin(a) * r, vx: -Math.cos(a) * r / life, vy: 0.5, vz: -Math.sin(a) * r / life, r: ELEC.r, g: ELEC.g, b: ELEC.b, size: rand(0.06, 0.1), life, shape: Shape.Spark, stretch: 0.04 });
  }
  if (Math.random() < dt * 10) g.vfx.dust(h.pos, 1, 0.4, 0.25, 2.5);
  // both fists come down a beat before the blast
  if (st.ultT <= 0.24 && !st.slammed) {
    st.slammed = true;
    h.anim.cast = 0;
    h.anim.attack = 1; h.anim.attackSide = 1; h.anim.attackKind = 'slam'; h.anim.attackBoth = true;
  }
  if (st.ultT <= 0) { st.ultT = 0; h.anim.attackBoth = false; discharge(h, g); }
}

function discharge(h: Hero, g: Game) {
  const st = h.kitState;
  const pos = h.pos.clone();
  pos.y = g.world.heightAt(pos.x, pos.z, pos.y + 0.5);
  g.play('staticBlast', pos, 1.2);
  g.shake(pos, 0.7, 34);
  g.vfx.flash(pos.clone().setY(pos.y + 2), new THREE.Color(0.6, 1.6, 3.2), 90, 0.5, 28);
  g.vfx.shockwave(pos, ELEC, FIELD_R, 0.5, 0.07);
  g.vfx.shockwave(pos, ELEC_HOT, FIELD_R * 0.6, 0.35, 0.1);
  g.vfx.shockwave(pos, BRASS, FIELD_R * 0.35, 0.3, 0.14);
  g.vfx.rune(pos, ELEC, FIELD_R * 1.9, 1.2, 1.4, 0.8, 1.05);
  g.vfx.groundGlow(pos, ELEC, FIELD_R * 1.4, 1.2, 0.2);
  g.vfx.crack(pos, 5.5, 8, 0.9);
  g.vfx.scorch(pos, 4, 10, 0.55);
  g.vfx.debris(pos, new THREE.Color(0.45, 0.4, 0.34), 22, 9, 0.14, 8);
  g.vfx.dustRing(pos, 2.5, 26, 1.1, 0.45);
  g.vfx.flare(_v1.copy(pos).setY(pos.y + 0.6), ELEC_HOT, 7, 0.3);
  g.vfx.burst(_v1.copy(pos).setY(pos.y + 0.5), ELEC, 50, 14, 0.12, 0.6, { gravity: 6 });
  g.vfx.glyph('Static Field', _v1.copy(pos).setY(pos.y + 5), { color: '#e8fbff', glow: '#3fd8ff', scale: 2.2, dur: 2, vy: 0.4 });
  screenFx.ripple(_v1.copy(pos).setY(pos.y + 1), FIELD_R, 1, 0.7);
  if (h.isLocal) { screenFx.zoomPunch(0.5); screenFx.punch(0.5); screenFx.flashScreen(new THREE.Color(0.5, 1.2, 2.4), 0.12); g.hitStop(0.08); }
  // lightning races out along the floor in every direction
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + rand(-0.15, 0.15), r = rand(FIELD_R * 0.6, FIELD_R);
    const end = _v2.set(pos.x + Math.cos(a) * r, 0, pos.z + Math.sin(a) * r);
    end.y = g.world.heightAt(end.x, end.z, pos.y + 1) + 0.15;
    bolt(g, _v1.copy(pos).setY(pos.y + 0.2), end, { width: 0.09, jag: 0.6, life: 0.22, forks: 2 });
  }
  for (const e of g.enemiesNear(h.team, pos, FIELD_R)) {
    if (Math.abs(e.pos.y - pos.y) > 4) continue;
    const away = _v1.subVectors(e.pos, pos).setY(0);
    const d = away.length() || 1;
    away.multiplyScalar(4 / d);
    g.damage(e, FIELD_DMG, h, { at: e.chest, knock: new THREE.Vector3(away.x, 5, away.z) });
    e.applySilence(SILENCE);
    e.applySlow(0.45, 2);
    // a bolt from the sky onto every victim
    const top = _v2.copy(e.chest).setY(e.pos.y + 9).add(new THREE.Vector3(rand(-1.5, 1.5), 0, rand(-1.5, 1.5)));
    bolt(g, top, e.chest, { width: 0.12, jag: 0.7, life: 0.25, forks: 2 });
    bodyArcs(g, e.center, 0.5, 0.7, 4);
    g.vfx.pillar(e.pos, ELEC, 4, 16, 0.4);
    if (e.isLocal) {
      g.events.onAnnounce('SILENCED', 'Abilities offline', 'blue');
      screenFx.flashScreen(new THREE.Color(0.4, 1, 2.2), 0.1);
    }
  }
  st.overT = OVERCHARGE;
  st.zapT = 0.4;
}

function updateOvercharge(h: Hero, g: Game, dt: number) {
  const st = h.kitState;
  st.overT -= dt;
  h.speedMult *= 1.2;
  const c = h.center;
  if (Math.random() < dt * 9) bodyArcs(g, c, 0.55, 0.75, 1);
  if (Math.random() < dt * 14) {
    const a = rand(0, TAU);
    g.vfx.p({ x: c.x + Math.cos(a) * 0.5, y: c.y + rand(-0.6, 0.9), z: c.z + Math.sin(a) * 0.5, vx: rand(-1, 1), vy: rand(0.5, 1.5), vz: rand(-1, 1), r: ELEC.r, g: ELEC.g, b: ELEC.b, size: rand(0.04, 0.08), life: rand(0.25, 0.45), shape: Shape.Spark, stretch: 0.03 });
  }
  st.zapT -= dt;
  if (st.zapT <= 0) {
    st.zapT = 0.55;
    let best: Hero | null = null, bd = ZAP_R;
    for (const e of g.enemiesNear(h.team, h.pos, ZAP_R)) {
      const d = e.pos.distanceTo(h.pos);
      if (d < bd && g.los(h.chest, e.chest)) { bd = d; best = e; }
    }
    if (best) {
      const from = _v1.copy(h.pos).addScaledVector(h.forward, -0.25).setY(h.pos.y + 1.85);
      bolt(g, from, best.chest, { width: 0.07, jag: 0.45, life: 0.14, forks: 1 });
      g.damage(best, ZAP_DMG, h, { at: best.chest, fx: false });
      best.applySlow(0.2, 0.5);
      g.play('staticZap', best.chest, 0.8);
      g.vfx.sparks(best.chest, ELEC, 8, 6);
    }
  }
  if (st.overT <= 0) {
    st.overT = 0;
    g.vfx.smoke(_v1.copy(h.pos).setY(h.pos.y + 1.8), STEAM, 6, 0.6, 1.2, 0.3);
  }
}

// ───────────────────────── stand-in model ─────────────────────────

/**
 * Code-built steam golem used until the Meshy model lands: barrel boiler torso, dome head sunk between the
 * shoulders, glowing eyes and chest core, smokestacks, and long arms ending in huge three-fingered fists.
 */
function buildBlitzcrank(r: RigBuilder) {
  // proportions: short legs, a tall barrel and arms that reach the knees
  r.hips.position.y = 0.84;
  r.spine.position.y = 0.05;
  r.chest.position.y = 0.36;
  r.neck.position.y = 0.22;
  r.head.position.y = 0.1;
  r.shoulderL.position.set(0.5, 0.06, 0); r.shoulderR.position.set(-0.5, 0.06, 0);
  r.elbowL.position.y = r.elbowR.position.y = -0.36;
  r.handL.position.y = r.handR.position.y = -0.33;
  r.hipL.position.x = 0.17; r.hipR.position.x = -0.17;
  r.kneeL.position.y = r.kneeR.position.y = -0.38;
  r.footL.position.y = r.footR.position.y = -0.38;

  const brass = r.mat('#d9a336', 0.32, 0.9);
  const dark = r.mat('#8a5a22', 0.45, 0.85);
  const iron = r.mat('#3a3d42', 0.5, 0.8);
  const copper = r.mat('#b8673a', 0.35, 0.9);
  const black = r.mat('#121315', 0.6, 0.3);
  const eye = r.mat('#bff6ff', 0.2, 0, { emissive: new THREE.Color(0.7, 2.6, 3.4) });
  const core = r.mat('#7fe9ff', 0.2, 0, { emissive: new THREE.Color(0.4, 1.8, 2.6) });

  // ── boiler torso
  r.add(r.chest, r.sphere(0.42, 28, 20), brass, [0, -0.08, 0], [0, 0, 0], [1.05, 0.98, 0.9]);
  r.add(r.chest, new THREE.TorusGeometry(0.43, 0.03, 8, 40), iron, [0, -0.08, 0], [Math.PI / 2, 0, 0], [1.03, 0.9, 1]);
  r.add(r.chest, new THREE.TorusGeometry(0.36, 0.022, 8, 36), dark, [0, 0.2, 0], [Math.PI / 2, 0, 0], [1.03, 0.9, 1]);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI - Math.PI / 2 + Math.PI / 2;
    r.add(r.chest, r.sphere(0.018, 6, 4), dark, [Math.cos(a) * 0.45, -0.03, Math.sin(a) * 0.4]);
  }
  // chest core window
  r.add(r.chest, new THREE.CylinderGeometry(0.11, 0.11, 0.04, 24), core, [0, -0.04, 0.37], [Math.PI / 2 - 0.2, 0, 0]);
  r.add(r.chest, new THREE.TorusGeometry(0.12, 0.025, 8, 24), iron, [0, -0.04, 0.38], [-0.2, 0, 0]);
  // belly + pelvis
  r.add(r.spine, new THREE.CylinderGeometry(0.3, 0.25, 0.3, 20), iron, [0, 0.12, 0]);
  r.add(r.hips, new THREE.CylinderGeometry(0.26, 0.24, 0.16, 20), dark, [0, 0.0, 0]);
  r.add(r.hips, new THREE.TorusGeometry(0.255, 0.025, 6, 24), brass, [0, 0.06, 0], [Math.PI / 2, 0, 0]);
  // smokestacks on the back
  for (const x of [-0.16, 0.16]) {
    r.add(r.chest, new THREE.CylinderGeometry(0.055, 0.065, 0.38, 12), dark, [x, 0.3, -0.27], [-0.32, 0, x > 0 ? -0.1 : 0.1]);
    r.add(r.chest, new THREE.CylinderGeometry(0.072, 0.06, 0.05, 12), iron, [x * 1.08, 0.48, -0.33], [-0.32, 0, x > 0 ? -0.1 : 0.1]);
  }
  // shoulder pipes
  for (const x of [-0.3, 0.3]) r.add(r.chest, new THREE.TorusGeometry(0.11, 0.022, 6, 14, Math.PI), copper, [x, 0.22, -0.12], [0, Math.PI / 2, 0]);

  // ── head: a dome sunk between the shoulders
  r.add(r.neck, new THREE.CylinderGeometry(0.16, 0.2, 0.16, 20), iron, [0, 0.02, 0.03]);
  r.add(r.head, new THREE.SphereGeometry(0.17, 22, 12, 0, TAU, 0, Math.PI / 2), brass, [0, 0.03, 0.04]);
  r.add(r.head, new THREE.CylinderGeometry(0.17, 0.17, 0.1, 22), brass, [0, -0.02, 0.04]);
  r.add(r.head, new THREE.BoxGeometry(0.26, 0.07, 0.06), iron, [0, 0.05, 0.18]);
  for (const x of [-0.065, 0.065]) {
    r.add(r.head, r.sphere(0.045, 14, 10), eye, [x, 0.05, 0.205], [0, 0, 0], [1, 1, 0.6]);
    r.add(r.head, new THREE.TorusGeometry(0.048, 0.012, 6, 16), dark, [x, 0.05, 0.21]);
  }
  r.add(r.head, new THREE.BoxGeometry(0.16, 0.06, 0.03), black, [0, -0.03, 0.2]);
  for (let i = 0; i < 4; i++) r.add(r.head, new THREE.BoxGeometry(0.15, 0.006, 0.01), dark, [0, -0.048 + i * 0.012, 0.217]);
  // a little lightning rod
  r.add(r.head, new THREE.CylinderGeometry(0.008, 0.012, 0.12, 6), copper, [0, 0.24, 0.04]);
  r.add(r.head, r.sphere(0.02, 8, 6), copper, [0, 0.31, 0.04]);

  // ── arms
  for (const [sh, el, hd, sx] of [[r.shoulderL, r.elbowL, r.handL, 1], [r.shoulderR, r.elbowR, r.handR, -1]] as const) {
    r.add(sh, r.sphere(0.19, 18, 12), brass, [0, 0.0, 0], [0, 0, 0], [1, 0.85, 1]);
    r.add(sh, new THREE.TorusGeometry(0.17, 0.02, 6, 20), dark, [0, -0.06, 0], [Math.PI / 2, 0, 0]);
    r.add(sh, r.capsule(0.07, 0.2, 10), iron, [0, -0.19, 0]);
    r.add(sh, new THREE.CylinderGeometry(0.022, 0.022, 0.22, 8), copper, [0, -0.2, -0.09]);
    r.add(el, r.sphere(0.095, 12, 10), dark);
    r.add(el, new THREE.CylinderGeometry(0.11, 0.15, 0.27, 16), brass, [0, -0.16, 0]);
    r.add(el, new THREE.TorusGeometry(0.15, 0.02, 6, 18), iron, [0, -0.29, 0], [Math.PI / 2, 0, 0]);
    // the fist: a brass palm with three thick fingers curled forward and a thumb
    r.add(hd, r.sphere(0.15, 16, 12), brass, [0, -0.1, 0.02], [0, 0, 0], [1.05, 1, 1.12]);
    r.add(hd, new THREE.BoxGeometry(0.26, 0.05, 0.08), iron, [0, -0.14, 0.12]);
    for (const x of [-0.08, 0, 0.08]) {
      r.add(hd, r.capsule(0.045, 0.08, 8), brass, [x, -0.2, 0.1], [0.5, 0, 0]);
      r.add(hd, r.sphere(0.03, 8, 6), dark, [x, -0.26, 0.06]);
    }
    r.add(hd, r.capsule(0.04, 0.06, 8), brass, [0.11 * sx, -0.1, 0.1], [0.3, 0, -0.5 * sx]);
  }

  // ── legs
  for (const [hp, kn, ft] of [[r.hipL, r.kneeL, r.footL], [r.hipR, r.kneeR, r.footR]] as const) {
    r.add(hp, r.capsule(0.085, 0.22, 10), iron, [0, -0.19, 0]);
    r.add(kn, r.sphere(0.1, 12, 10), brass);
    r.add(kn, new THREE.CylinderGeometry(0.1, 0.13, 0.28, 16), brass, [0, -0.18, 0]);
    r.add(kn, new THREE.TorusGeometry(0.13, 0.018, 6, 18), iron, [0, -0.31, 0], [Math.PI / 2, 0, 0]);
    r.add(ft, new THREE.BoxGeometry(0.22, 0.09, 0.34), iron, [0, -0.02, 0.07]);
    r.add(ft, new THREE.CylinderGeometry(0.11, 0.11, 0.09, 16, 1, false, 0, Math.PI), dark, [0, -0.02, 0.24], [0, -Math.PI / 2, 0]);
  }
}

export const BLITZCRANK: HeroDef = {
  id: 'blitzcrank',
  name: 'Blitzcrank',
  title: 'The Great Steam Golem',
  role: 'Vanguard',
  tagline: 'Fully pressurized. Politely unstoppable.',
  color: '#f5b532',
  accent: '#3fd8ff',
  maxHp: 425,
  // modelUrl: '/models/heroes/blitzcrank.glb?v=1', // set once the Meshy model is processed (npm run models)
  motion: 'heavy',
  speed: 5.6,
  secondaryCd: 9,
  ultCost: 1600,
  botRange: 2.2,
  ratings: { damage: 0.65, mobility: 0.3, support: 0.6, difficulty: 0.5 },
  abilities: {
    primary: { key: 'LMB', name: 'Power Fist', desc: 'Piston-driven punches with both fists. Every third blow is an uppercut that launches the target into the air.', stat: '32 · 32 · 55 + launch', icon: ICONS.fist },
    secondary: { key: 'RMB', name: 'Rocket Grab', desc: 'Your arm telescopes out and the fist rockets ahead. The first enemy it catches is dragged back to you and stunned, and your next punch becomes the uppercut.', stat: '40 dmg + pull · 24 m · 9 s cd', icon: ICONS.grab },
    ult: { key: 'SHIFT', name: 'Static Field', desc: 'Overload your coils and slam the floor: enemies around you are shocked, slowed and silenced. For 6 s after, stray bolts zap anyone who stays close.', stat: '85 dmg · 10 m · 2.5 s silence', icon: ICONS.staticField },
  },
  look: { build: buildBlitzcrank, armOut: 0.12, style: 'heavy' },
  createKit: () => new BlitzcrankKit(),
};

/** The grab is the hero's own arm now, so there is nothing extra to pre-compile. */
export function warmupBlitzcrank(_g: Game): THREE.Object3D[] {
  return [];
}
