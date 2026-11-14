import * as THREE from 'three';
import type { HeroDef, HeroKit, Projectile, Zone } from '../game/types';
import { HERO_RADIUS, type Hero } from '../game/Hero';
import type { Game } from '../game/Game';
import { InstancedPool } from '../vfx/Vfx';
import { Shape } from '../vfx/Particles';
import { TrailStyle } from '../vfx/Trails';
import { screenFx } from '../vfx/ScreenFx';
import { clamp, damp, distSqPointSegment, lerp, mulberry32, rand, TAU, _m1, _q1, _v1, _v2 } from '../core/math';
import type { RigBuilder } from '../render/HeroRig';
import type { DynBlock } from '../world/collision';
import type { LoopHandle } from '../core/Audio';
import { arrowGeometry, blockMaterials, bowGeometry, buildBow, buildDragon, buildSword, itemMaterial, type DragonRig } from './steveArt';

/**
 * Steve, the blocky miner.
 *
 *  LMB   Diamond Sword / Bow   the mouse wheel (or 1 / 2) swaps between them. The sword sweeps everyone in front of
 *                              him and crits when he strikes on the way down from a jump; the bow is held to draw,
 *                              released to loose, and a full draw flies flat and fast with a crit trail.
 *  RMB   Build Up              a hill of grass, dirt and stone blocks bursts out of the ground where he aims: a sheer
 *                              wall toward the enemy and a staircase on his side to climb for the high ground.
 *  SHIFT The Ender Dragon      the dragon bursts out of an End portal above him, circles the fight and dives on enemies
 *                              breathing purple, black and white dragon fire that leaves lingering clouds of breath.
 */

const DIAMOND = new THREE.Color(0.7, 3.4, 3.0);
const DIAMOND_HOT = new THREE.Color(2.6, 4.4, 4.2);
const CRIT = new THREE.Color(3.2, 3.2, 3.4);
const ENDER = new THREE.Color(2.6, 0.5, 3.8);
const ENDER_HOT = new THREE.Color(4, 2.6, 4.6);
const VOID = new THREE.Color(0.06, 0.015, 0.09);
const GRASS_C = new THREE.Color(0.25, 0.55, 0.14);
const DIRT_C = new THREE.Color(0.36, 0.22, 0.12);
const STONE_C = new THREE.Color(0.42, 0.42, 0.42);
const _up = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3(0, 0, 1);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _s1 = new THREE.Vector3(1, 1, 1);

type Weapon = 'sword' | 'bow';
const LOADOUT: Weapon[] = ['sword', 'bow'];

// Diamond Sword
const SWORD = { dmg: 40, sweep: 0.65, reach: 3.5, cone: 0.95, cd: 0.52, hitAt: 0.09 };
// Bow
const BOW = { full: 0.8, min: 0.12, cd: 0.2, dmg0: 16, dmg1: 54, speed0: 34, speed1: 66, grav0: 15, grav1: 7 };
// Build Up
const WALL = { life: 8, rise: 0.3, stagger: 0.035, near: 2.6, far: 10 };
// The Ender Dragon
const DRAGON = { dur: 10, arrive: 1.5, leave: 1.6, radius: 13, alt: 13, runAlt: 6.2, speed: 17, runSpeed: 22, reach: 26, tick: 0.1, flameDmg: 7, cloudDmg: 9, cloudR: 2.7, cloudDur: 3.2 };

// ───────────────────────── stuck arrows ─────────────────────────

interface Stuck { pos: THREE.Vector3; q: THREE.Quaternion; t: number }
/** Arrows that missed stay stuck in walls and floors for a few seconds, one instanced draw per arena. */
const stuckSets = new WeakMap<THREE.Scene, { mesh: THREE.InstancedMesh; list: Stuck[]; time: number }>();
function stuckFor(g: Game) {
  let s = stuckSets.get(g.scene);
  if (!s) {
    const mesh = new THREE.InstancedMesh(arrowGeometry(), itemMaterial(), 48);
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true;
    g.scene.add(mesh);
    s = { mesh, list: [], time: -1 };
    stuckSets.set(g.scene, s);
  }
  return s;
}
function stickArrow(g: Game, at: THREE.Vector3, dir: THREE.Vector3) {
  const s = stuckFor(g);
  if (s.list.length >= 48) s.list.shift();
  // buried a third of its length, with a little random tilt
  const q = new THREE.Quaternion().setFromUnitVectors(_z, _a.copy(dir).normalize().add(new THREE.Vector3(rand(-0.08, 0.08), rand(-0.08, 0.08), rand(-0.08, 0.08))).normalize());
  s.list.push({ pos: at.clone().addScaledVector(dir, 0.14), q, t: 0 });
}
function updateStuck(g: Game, dt: number) {
  const s = stuckSets.get(g.scene);
  if (!s || s.time === g.time) return;
  s.time = g.time;
  let n = 0;
  for (const a of s.list) {
    a.t += dt;
    // the last half second: shrink away
    const k = clamp((6 - a.t) / 0.5, 0, 1);
    if (k <= 0) continue;
    s.mesh.setMatrixAt(n++, _m1.compose(a.pos, a.q, _v1.setScalar(k)));
  }
  s.list = s.list.filter((a) => a.t < 6);
  s.mesh.count = n;
  s.mesh.instanceMatrix.needsUpdate = true;
}

function arrowPool() {
  return new InstancedPool(arrowGeometry(), itemMaterial(), 96);
}

// ───────────────────────── kit ─────────────────────────

class SteveKit implements HeroKit {
  primary(h: Hero, g: Game) {
    const st = h.kitState;
    if (weapon(h) === 'bow') {
      // the draw starts now; the arrow leaves when the button comes up (update)
      st.draw = 0;
      h.primaryCd = 99;
      h.anim.bow = 1;
      g.play('bowDraw', h.muzzle('L'), 0.7);
      return;
    }
    swing(h, g);
  }

  secondary(h: Hero, g: Game) {
    // no room for a hill (aiming off the edge of the arena): keep the cooldown
    if (!buildUp(h, g)) return false;
    if (h.kitState.draw != null) loose(h, g, true);
    return true;
  }

  ult(h: Hero, g: Game) {
    if (h.kitState.draw != null) loose(h, g, true);
    summonDragon(h, g);
    return true;
  }

  swap(h: Hero, g: Game, dir: number, slot?: number) {
    const cur = LOADOUT.indexOf(weapon(h));
    const next = slot !== undefined ? clamp(slot, 0, LOADOUT.length - 1) : (cur + dir + LOADOUT.length) % LOADOUT.length;
    if (next === cur) return;
    equip(h, g, LOADOUT[next]);
    g.net?.kitEvent(h, `w:${LOADOUT[next]}`);
  }

  update(h: Hero, g: Game, dt: number) {
    const st = h.kitState;
    updateStuck(g, dt);
    st.weapon ??= 'sword';
    // the item comes back out a beat after a swap
    if (st.swapT > 0) { st.swapT -= dt; h.anim.item = st.swapT > 0.12 ? undefined : st.weapon; }
    else h.anim.item = st.weapon;
    if (st.pending) {
      st.pending.t -= dt;
      if (st.pending.t <= 0) { const p = st.pending; st.pending = null; if (h.alive) strike(h, g, p.crit, p.side); }
    }
    if (st.draw != null) {
      st.draw += dt;
      const k = Math.min(1, st.draw / BOW.full);
      h.speedMult *= 0.62;
      h.anim.bow = 1;
      h.anim.bowDraw = k;
      setBowStage(h, k, true);
      if (h.isLocal) g.camRig.zoom(9 * k);
      if (k >= 1 && !st.fullCue) { st.fullCue = true; g.play('bowFull', h.muzzle('L'), 0.5); }
      // the owner decides when the string is let go (online, the others hear it through onNet)
      const release = h.ctrl === 'bot' ? st.draw >= (st.botDraw ??= rand(0.65, 1)) : !h.input.primary;
      if (g.owns(h) && release && h.channel <= 0) loose(h, g, false);
    } else {
      h.anim.bow = Math.max(0, (h.anim.bow ?? 0) - dt * 5);
      h.anim.bowDraw = 0;
    }
    if (st.wall) updateWall(h, g, dt, st.wall);
    if (st.dragon) updateDragon(h, g, dt, st.dragon);
  }

  onNet(h: Hero, g: Game, ev: string) {
    if (ev.startsWith('w:')) { const w = ev.slice(2) as Weapon; if (LOADOUT.includes(w) && w !== weapon(h)) equip(h, g, w); return; }
    if (ev.startsWith('loose:')) {
      // loose:<draw>:<dx>,<dy>,<dz>
      const [, k, d] = ev.split(':');
      const v = d.split(',').map(Number);
      if (v.length === 3 && v.every(Number.isFinite)) fireArrow(h, g, clamp(+k || 0, 0, 1), new THREE.Vector3(v[0], v[1], v[2]).normalize());
      h.kitState.draw = null; h.kitState.fullCue = false;
      setBowStage(h, 0, false);
    }
  }

  onDeath(h: Hero, g: Game) {
    const st = h.kitState;
    st.draw = null; st.pending = null; st.fullCue = false;
    h.anim.bow = 0; h.anim.bowDraw = 0;
    setBowStage(h, 0, false);
    if (st.dragon) dragonLeave(st.dragon);
    void g;
  }
}

function weapon(h: Hero): Weapon { return h.kitState.weapon ?? 'sword'; }

function equip(h: Hero, g: Game, w: Weapon) {
  const st = h.kitState;
  if (st.draw != null) { st.draw = null; st.fullCue = false; setBowStage(h, 0, false); }
  st.weapon = w;
  st.swapT = 0.24;
  h.primaryCd = Math.max(h.primaryCd > 50 ? 0 : h.primaryCd, 0.24);
  g.play('itemSwap', h.muzzle('R'), 0.55);
  // a little flourish: the new item flips up out of the hotbar
  const at = h.muzzle(w === 'bow' ? 'L' : 'R');
  for (let i = 0; i < 5; i++) g.vfx.p({ x: at.x, y: at.y, z: at.z, vx: rand(-1, 1), vy: rand(0.5, 2), vz: rand(-1, 1), r: w === 'bow' ? 1.6 : DIAMOND.r, g: w === 'bow' ? 1.1 : DIAMOND.g, b: w === 'bow' ? 0.5 : DIAMOND.b, size: 0.05, life: 0.3, shape: Shape.Pixel, aux: rand(0, 9), gravity: 6 });
}

/** Bow string pulled back in three stages (Minecraft-style), and the nocked arrow shown while drawing. */
function setBowStage(h: Hero, k: number, drawing: boolean) {
  const o = h.model.itemObject?.('bow');
  if (!o) return;
  const stage = drawing ? (k < 0.34 ? 1 : k < 0.99 ? 2 : 3) : 0;
  const bow = o.getObjectByName('bow') as THREE.Mesh | undefined;
  if (bow && bow.userData.stage !== stage) { bow.geometry = bowGeometry(stage); bow.userData.stage = stage; }
  const nock = o.getObjectByName('nock');
  if (nock) { nock.visible = drawing; nock.position.x = 0.04; nock.position.y = -0.2 + stage * 0.035; }
}

// ───────────────────────── Diamond Sword ─────────────────────────

function swing(h: Hero, g: Game) {
  const st = h.kitState;
  st.combo = g.time - (st.comboT ?? -9) > 1 ? 0 : (st.combo ?? 0) + 1;
  st.comboT = g.time;
  // a crit is a strike on the way down from a jump
  const crit = !h.grounded && h.vel.y < -0.5;
  const side: 1 | -1 = crit ? 1 : st.combo % 2 ? -1 : 1;
  h.primaryCd = SWORD.cd;
  h.anim.attack = 1; h.anim.attackSide = 1; h.anim.attackBoth = false;
  h.anim.attackKind = crit ? 'chop' : side > 0 ? 'slash' : 'backslash';
  g.play('swordSwing', h.muzzle('R'), 0.75);
  st.pending = { t: SWORD.hitAt, crit, side };
  if (h.isLocal) { g.camRig.kick(crit ? 2 : 1); }
}

function strike(h: Hero, g: Game, crit: boolean, side: 1 | -1) {
  const f = h.forward, r = h.right;
  const cy = h.pos.y + (crit ? 1.15 : 1.25);
  // the sweep: an arc of diamond light across the front, right to left (or back)
  const arc = g.vfx.trail({ color: DIAMOND, endColor: new THREE.Color(0.6, 1.4, 1.3), width: crit ? 0.3 : 0.22, life: 0.16, style: TrailStyle.Smooth, minDist: 0.05, taper: 0.4 });
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = crit ? lerp(1.2, -0.6, u) : side * lerp(1.15, -1.15, u);
    const rad = SWORD.reach * 0.62;
    if (crit) arc?.push(_a.copy(h.pos).addScaledVector(f, Math.cos(a * 0.6) * rad).setY(h.pos.y + 1.1 + Math.sin(a) * 1.0));
    else arc?.push(_a.copy(h.pos).addScaledVector(f, Math.cos(a) * rad).addScaledVector(r, Math.sin(a) * rad).setY(cy + u * 0.2 * side));
  }
  arc?.stop();
  // the classic sweep puff in front
  const front = _b.copy(h.pos).addScaledVector(f, 1.6).setY(cy);
  g.vfx.p({ x: front.x, y: front.y, z: front.z, r: 1.4, g: 1.6, b: 1.6, a: 0.55, size: 0.9, grow: 2.2, life: 0.18, shape: Shape.Ring, aux: 0.08, flat: false });
  let hits = 0;
  for (const e of g.heroes) {
    if (!e.alive || e.team === h.team) continue;
    const dx = e.pos.x - h.pos.x, dz = e.pos.z - h.pos.z, d = Math.hypot(dx, dz);
    if (d > SWORD.reach + HERO_RADIUS || Math.abs(e.pos.y - h.pos.y) > 2.2) continue;
    const ang = Math.acos(clamp((dx * f.x + dz * f.z) / Math.max(1e-3, d), -1, 1));
    if (d > 1.2 && ang > SWORD.cone) continue;
    if (!g.los(h.chest, e.chest)) continue;
    const at = e.chest;
    const dmg = SWORD.dmg * (hits ? SWORD.sweep : 1);
    hits++;
    g.damage(e, dmg, h, { at, crit, knock: new THREE.Vector3(f.x * (crit ? 4 : 3.2), crit ? 2.5 : 1.6, f.z * (crit ? 4 : 3.2)) });
    g.play(crit ? 'swordCrit' : 'swordHit', at, 0.9);
    g.vfx.sparks(at, DIAMOND, crit ? 16 : 9, 9, f);
    g.vfx.flare(at, DIAMOND_HOT, crit ? 2 : 1.2, 0.1, rand(-0.3, 0.3));
    if (crit) critBurst(g, at, 18);
    // the target flashes red and a few chips fly, the way mobs take a hit
    for (let i = 0; i < 6; i++) g.vfx.p({ x: at.x, y: at.y, z: at.z, vx: rand(-3, 3), vy: rand(1, 4), vz: rand(-3, 3), r: 2.4, g: 0.25, b: 0.2, size: 0.07, life: 0.4, shape: Shape.Pixel, aux: rand(0, 9), gravity: 14 });
  }
  if (hits && h.isLocal) { g.camRig.shake(crit ? 0.14 : 0.06); if (crit) { screenFx.punch(0.2); g.hitStop(0.04); } }
}

/** Minecraft's crit sparkle: little grey-white stars scattering out of the hit. */
function critBurst(g: Game, at: THREE.Vector3, n: number) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), up = rand(-0.3, 1);
    g.vfx.p({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * rand(2, 5), vy: up * 4, vz: Math.sin(a) * rand(2, 5), r: CRIT.r, g: CRIT.g, b: CRIT.b, r2: 0.6, g2: 0.6, b2: 0.7, size: rand(0.09, 0.16), life: rand(0.35, 0.6), shape: Shape.Star, drag: 3, spin: rand(-4, 4) });
  }
}

// ───────────────────────── Bow ─────────────────────────

function loose(h: Hero, g: Game, cancel: boolean) {
  const st = h.kitState;
  const k = Math.min(1, (st.draw ?? 0) / BOW.full);
  st.draw = null; st.fullCue = false; st.botDraw = undefined;
  h.primaryCd = BOW.cd;
  h.anim.bowDraw = 0;
  setBowStage(h, 0, false);
  if (cancel || k * BOW.full < BOW.min) { h.primaryCd = 0.1; return; }
  const from = arrowMuzzle(h, _c);
  const dir = h.aimDir(from, new THREE.Vector3());
  fireArrow(h, g, k, dir);
  g.net?.kitEvent(h, `loose:${k.toFixed(2)}:${dir.x.toFixed(3)},${dir.y.toFixed(3)},${dir.z.toFixed(3)}`);
  if (h.isLocal) { g.camRig.recoil(0.006 + 0.01 * k, rand(-1, 1) * 0.002); g.camRig.kick(1.5 * k); }
}

function arrowMuzzle(h: Hero, out: THREE.Vector3) {
  return out.copy(h.pos).addScaledVector(h.forward, 0.6).addScaledVector(h.right, -0.12).setY(h.pos.y + 1.42);
}

function fireArrow(h: Hero, g: Game, k: number, dir: THREE.Vector3) {
  const from = arrowMuzzle(h, new THREE.Vector3());
  const full = k >= 0.99;
  const speed = lerp(BOW.speed0, BOW.speed1, k);
  const dmg = lerp(BOW.dmg0, BOW.dmg1, k * k) + (full ? 6 : 0);
  g.play(full ? 'bowShootFull' : 'bowShoot', from, 0.6 + 0.4 * k);
  h.anim.attack = 1; h.anim.attackSide = 1; h.anim.attackKind = 'loose'; h.anim.attackBoth = false;
  const trail = g.vfx.trail({ color: full ? CRIT : new THREE.Color(0.9, 0.9, 0.9), endColor: new THREE.Color(0.2, 0.2, 0.25), width: full ? 0.05 : 0.025, life: full ? 0.3 : 0.14, style: TrailStyle.Smooth, minDist: 0.25 });
  g.spawnProjectile({
    owner: h, kind: 'steveArrow', pos: from, vel: dir.clone().multiplyScalar(speed), gravity: lerp(BOW.grav0, BOW.grav1, k), radius: 0.07, life: 2.6, damage: dmg, color: CRIT,
    render(p, g) {
      const pool = g.pool('steveArrow', arrowPool);
      _q1.setFromUnitVectors(_z, _v1.copy(p.vel).normalize());
      pool.add(_m1.compose(p.pos, _q1, _s1));
      trail?.push(p.pos);
      if (full && Math.random() < 0.7) g.vfx.p({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: rand(-0.6, 0.6), vy: rand(-0.6, 0.6), vz: rand(-0.6, 0.6), r: CRIT.r, g: CRIT.g, b: CRIT.b, size: rand(0.07, 0.12), life: 0.35, shape: Shape.Star, spin: rand(-3, 3) });
    },
    onExpire() { trail?.stop(); },
    onHit(p, g, hit, point) {
      trail?.push(point); trail?.stop();
      const dir = _v1.copy(p.vel).normalize();
      if (hit) {
        const head = point.y > hit.pos.y + 1.42;
        g.damage(hit, p.damage, p.owner, { crit: head, at: point, knock: dir.clone().multiplyScalar(full ? 3 : 1.5).setY(0.6), fx: false });
        g.play('arrowHit', point, 0.8);
        if (full || head) critBurst(g, point, full ? 12 : 8);
        for (let i = 0; i < 5; i++) g.vfx.p({ x: point.x, y: point.y, z: point.z, vx: rand(-2.5, 2.5), vy: rand(0.5, 3), vz: rand(-2.5, 2.5), r: 2.4, g: 0.25, b: 0.2, size: 0.06, life: 0.35, shape: Shape.Pixel, aux: rand(0, 9), gravity: 12 });
      } else {
        g.play('arrowStick', point, 0.6);
        stickArrow(g, point, dir);
        g.vfx.dust(point, 2, 0.25, 0.25, 0.4);
        for (let i = 0; i < 4; i++) g.vfx.p({ x: point.x, y: point.y, z: point.z, vx: -dir.x * rand(1, 3) + rand(-1, 1), vy: rand(0.5, 2.5), vz: -dir.z * rand(1, 3) + rand(-1, 1), r: 0.5, g: 0.4, b: 0.3, size: 0.05, life: 0.35, shape: Shape.Pixel, aux: rand(0, 9), gravity: 12 });
      }
    },
  } as Omit<Projectile, 'prev' | 'age' | 'dead' | 'seed'>);
}

// ───────────────────────── Build Up ─────────────────────────

interface Column { b: DynBlock; x: number; z: number; base: number; n: number; delay: number; kinds: number[] }
interface Wall {
  t: number; cols: Column[]; yaw: number;
  meshes: { grass: THREE.InstancedMesh; dirt: THREE.InstancedMesh; stone: THREE.InstancedMesh };
  broke: boolean; zone: Zone | null;
}

/** Heights of the hill, row by row from Steve's side (a staircase) to the enemy's (a cliff), across 7 columns. */
const PROFILE = [
  [0, 1, 1, 1, 1, 1, 0],
  [1, 1, 2, 2, 2, 1, 1],
  [1, 2, 3, 3, 3, 2, 1],
];

function buildUp(h: Hero, g: Game): boolean {
  const st = h.kitState;
  // where: on the floor at the crosshair, kept between near and far, facing Steve
  const aim = _a.copy(h.input.aim);
  const d = _b.subVectors(aim, h.pos).setY(0);
  let dist = d.length();
  if (dist < 1e-3) { d.copy(h.forward); dist = 1; }
  d.divideScalar(dist);
  dist = clamp(dist, WALL.near, WALL.far);
  // pull the hill back toward Steve until it fits inside the arena
  while (dist > WALL.near && !g.world.inBounds(h.pos.x + d.x * (dist + 1), h.pos.z + d.z * (dist + 1), 2)) dist = Math.max(WALL.near, dist - 1);
  const cx = h.pos.x + d.x * (dist + 1), cz = h.pos.z + d.z * (dist + 1);
  const yaw = Math.atan2(d.x, d.z);
  const fx = d.x, fz = d.z, rx = d.z, rz = -d.x; // forward (away from Steve) and across
  const rnd = mulberry32(Math.floor(cx * 7.3 + cz * 13.1 + 999) >>> 0);
  const cols: Column[] = [];
  let count = 0;
  for (let row = 0; row < 3; row++) for (let i = 0; i < 7; i++) {
    let n = PROFILE[row][i];
    // a lumpy hill, not a perfect stair: some columns a block taller (never the cliff face's middle)
    if (n > 0 && rnd() < 0.18 && !(row === 2 && i > 1 && i < 5)) n = Math.min(3, n + 1);
    if (n <= 0) continue;
    const x = cx + fx * (row - 1) + rx * (i - 3), z = cz + fz * (row - 1) + rz * (i - 3);
    if (!g.world.inBounds(x, z, 0.6)) continue;
    const base = g.world.heightAt(x, z, h.pos.y + 0.5);
    const b = g.world.addBlock(x, z, 0.5, 0.5, -yaw, base, base);
    const kinds: number[] = [];
    for (let k = 0; k < n; k++) kinds.push(k === n - 1 ? 0 : k === 0 && rnd() < 0.6 ? 2 : rnd() < 0.15 ? 2 : 1);
    cols.push({ b, x, z, base, n, delay: (Math.abs(i - 3) + row * 0.6) * WALL.stagger, kinds });
    count += n;
  }
  if (!cols.length) return false;
  if (st.wall) breakWall(h, g, st.wall);
  const M = blockMaterials();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const mk = (mat: THREE.Material | THREE.Material[]) => {
    const m = new THREE.InstancedMesh(box, mat, Math.max(1, count));
    m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    g.scene.add(m);
    return m;
  };
  const wall: Wall = { t: 0, cols, yaw, meshes: { grass: mk(M.grass), dirt: mk(M.dirt), stone: mk(M.stone) }, broke: false, zone: null };
  st.wall = wall;
  // the meshes go away with the match even if Steve never comes back for them
  wall.zone = g.addZone({ owner: h, team: h.team, pos: new THREE.Vector3(cx, 0, cz), radius: 0, t: 0, dur: WALL.life + 1, dead: false, kind: 'steveWall', update() {}, dispose: () => disposeWall(g, wall) });
  h.anim.attack = 1; h.anim.attackSide = 1; h.anim.attackKind = 'place'; h.anim.attackBoth = false;
  g.play('wallRise', _c.set(cx, h.pos.y, cz), 1);
  g.shake(_c, 0.25, 14);
  if (h.isLocal) g.camRig.shake(0.08);
  return true;
}

const _bq = new THREE.Quaternion(), _bp = new THREE.Vector3(), _bs = new THREE.Vector3();
function updateWall(h: Hero, g: Game, dt: number, w: Wall) {
  w.t += dt;
  if (w.t > WALL.life) { breakWall(h, g, w); return; }
  _bq.setFromAxisAngle(_up, w.yaw);
  const cnt = [0, 0, 0];
  const list = [w.meshes.grass, w.meshes.dirt, w.meshes.stone];
  for (const c of w.cols) {
    const u = clamp((w.t - c.delay) / WALL.rise, 0, 1);
    // ease out with a little overshoot as the column bursts up
    const e = u >= 1 ? 1 : 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2);
    const top = c.base + c.n * Math.min(1.04, e);
    if (u > 0 && c.b.top < c.base + 0.01) risePuff(g, c);
    c.b.top = Math.min(c.base + c.n, top);
    if (u <= 0) continue;
    for (let k = 0; k < c.n; k++) {
      const y = top - c.n + k + 0.5;
      if (y < c.base - 0.5) continue;
      const kind = c.kinds[k];
      _bp.set(c.x, y, c.z);
      list[kind].setMatrixAt(cnt[kind]++, _m1.compose(_bp, _bq, _bs.setScalar(1)));
    }
  }
  list.forEach((m, i) => { m.count = cnt[i]; m.instanceMatrix.needsUpdate = true; });
  // a last warning: the blocks crack a second before they go
  if (w.t > WALL.life - 1 && w.cols.length && Math.random() < dt * 12) {
    const c = w.cols[Math.floor(Math.random() * w.cols.length)];
    g.vfx.p({ x: c.x + rand(-0.5, 0.5), y: c.base + rand(0, c.n), z: c.z + rand(-0.5, 0.5), vy: rand(-1, 0.5), r: 0.4, g: 0.3, b: 0.2, size: 0.06, life: 0.5, shape: Shape.Pixel, aux: rand(0, 9), gravity: 10 });
  }
}

function risePuff(g: Game, c: Column) {
  const at = _v2.set(c.x, c.base + 0.05, c.z);
  g.vfx.dust(at, 3, 0.55, 0.35, 0.9);
  for (let i = 0; i < 6; i++) {
    const col = Math.random() < 0.5 ? DIRT_C : GRASS_C;
    g.vfx.p({ x: c.x + rand(-0.5, 0.5), y: c.base + 0.1, z: c.z + rand(-0.5, 0.5), vx: rand(-2, 2), vy: rand(2, 5), vz: rand(-2, 2), r: col.r, g: col.g, b: col.b, size: rand(0.08, 0.13), life: rand(0.5, 0.8), shape: Shape.Pixel, aux: rand(0, 9), gravity: 18 });
  }
}

/** Every block pops with a burst of its own chips, the way blocks break. */
function breakWall(h: Hero, g: Game, w: Wall) {
  if (w.broke) return;
  w.broke = true;
  for (const c of w.cols) {
    for (let k = 0; k < c.n; k++) {
      const col = [GRASS_C, DIRT_C, STONE_C][c.kinds[k]];
      const y = c.base + k + 0.5;
      for (let i = 0; i < 5; i++) g.vfx.p({ x: c.x + rand(-0.45, 0.45), y: y + rand(-0.45, 0.45), z: c.z + rand(-0.45, 0.45), vx: rand(-2.5, 2.5), vy: rand(1, 4), vz: rand(-2.5, 2.5), r: col.r * 1.4, g: col.g * 1.4, b: col.b * 1.4, size: rand(0.08, 0.14), life: rand(0.5, 0.9), shape: Shape.Pixel, aux: rand(0, 9), gravity: 18 });
    }
    g.vfx.dust(_v2.set(c.x, c.base, c.z), 1, 0.6, 0.3, 0.6);
  }
  const mid = w.cols[Math.floor(w.cols.length / 2)];
  if (mid) g.play('blockBreak', _v2.set(mid.x, mid.base + 1, mid.z), 0.9);
  if (w.zone) w.zone.dead = true;
  disposeWall(g, w);
  if (h.kitState.wall === w) h.kitState.wall = null;
}

function disposeWall(g: Game, w: Wall) {
  for (const c of w.cols) g.world.removeBlock(c.b);
  w.cols.length = 0;
  for (const m of Object.values(w.meshes)) { m.removeFromParent(); m.dispose(); }
}

// ───────────────────────── The Ender Dragon ─────────────────────────

interface Dragon {
  rig: DragonRig; t: number; pos: THREE.Vector3; vel: THREE.Vector3; yaw: number; pitch: number; bank: number;
  center: THREE.Vector3; ground: number; theta: number; flap: number;
  run: { target: Hero | null; at: THREE.Vector3; t: number } | null; runCd: number;
  breath: number; tickT: number; cloudT: number; leaving: boolean; roar: boolean;
  flame: LoopHandle | null; gone: boolean;
}

function summonDragon(h: Hero, g: Game) {
  const st = h.kitState;
  if (st.dragon) removeDragon(g, st.dragon);
  // the fight it circles: in front of Steve, where he aims, within reach
  const d = _a.subVectors(h.input.aim, h.pos).setY(0);
  const l = clamp(d.length(), 0, 16);
  d.normalize().multiplyScalar(l || 0);
  if (!(l > 0)) d.copy(h.forward).multiplyScalar(8);
  const center = h.pos.clone().add(d);
  if (!g.world.inBounds(center.x, center.z, 4)) center.lerp(h.pos, 0.5);
  const ground = g.world.heightAt(center.x, center.z, h.pos.y + 1);
  const rig = buildDragon();
  rig.root.scale.setScalar(0.01);
  g.scene.add(rig.root);
  // it bursts out of an End portal above and behind Steve
  const pos = h.pos.clone().addScaledVector(h.forward, -4).setY(h.pos.y + 15);
  const vel = h.forward.clone().multiplyScalar(14).setY(-2);
  const dr: Dragon = {
    rig, t: 0, pos, vel, yaw: h.yaw + Math.PI, pitch: 0, bank: 0, center, ground,
    theta: Math.atan2(pos.z - center.z, pos.x - center.x), flap: 0, run: null, runCd: 2.2,
    breath: 0, tickT: 0, cloudT: 0, leaving: false, roar: false, flame: null, gone: false,
  };
  st.dragon = dr;
  h.anim.cast = 1;
  h.channel = Math.max(h.channel, 0.55);
  // the portal: a ring of void and starry ender particles opening in the sky
  g.vfx.rune(_v1.copy(pos).setY(h.pos.y + 0.05), ENDER, 4, 1.4, 2.5, 1, 1.2);
  g.vfx.flare(pos, ENDER_HOT, 9, 0.45);
  g.vfx.flash(pos, new THREE.Color(1.4, 0.4, 2.2), 70, 0.8, 40);
  for (let i = 0; i < 60; i++) {
    const a = rand(0, TAU), r = rand(2, 6);
    g.vfx.p({ x: pos.x + Math.cos(a) * r, y: pos.y + rand(-1, 1), z: pos.z + Math.sin(a) * r, vx: -Math.cos(a) * r * 1.5, vy: rand(-1, 1), vz: -Math.sin(a) * r * 1.5, r: ENDER.r, g: ENDER.g, b: ENDER.b, r2: 0.4, g2: 0.1, b2: 0.6, size: rand(0.1, 0.22), life: rand(0.5, 0.9), shape: Shape.Pixel, aux: rand(0, 9), drag: 1.5 });
  }
  g.vfx.smoke(pos, VOID, 10, 3, 1.6, 0.7);
  g.play('dragonSummon', h.pos, 1);
  screenFx.ripple(pos, 14, 0.8, 0.8);
  if (h.isLocal) { g.events.onAnnounce('THE ENDER DRAGON', 'The End has come', 'gold'); screenFx.flashScreen(new THREE.Color(0.9, 0.3, 1.4), 0.14); }
  else if (g.local && g.local.team !== h.team) g.events.onAnnounce('ENDER DRAGON', 'Take cover from its breath!', 'red');
}

function dragonLeave(dr: Dragon) { if (!dr.leaving) { dr.leaving = true; dr.t = Math.max(dr.t, DRAGON.dur - DRAGON.leave); } }

function updateDragon(h: Hero, g: Game, dt: number, dr: Dragon) {
  dr.t += dt;
  if (dr.t >= DRAGON.dur) { removeDragon(g, dr); h.kitState.dragon = null; return; }
  const R = dr.rig;
  if (dr.t > 0.6) h.anim.cast = 0;
  // grow out of the portal, shrink back into the sky at the end
  const grow = clamp(dr.t / 0.7, 0, 1), fade = clamp((DRAGON.dur - dr.t) / 0.6, 0, 1);
  R.root.scale.setScalar(Math.max(0.01, (1 - Math.pow(1 - grow, 3)) * fade * 0.85));
  if (dr.t > 0.5 && !dr.roar) { dr.roar = true; g.play('dragonRoar', dr.pos, 1); g.shake(dr.pos, 0.35, 60); }

  const leaving = dr.t > DRAGON.dur - DRAGON.leave;
  // ── pick a dive: the enemy nearest the fight it was summoned over
  dr.runCd -= dt;
  if (!dr.run && !leaving && dr.runCd <= 0 && dr.t > DRAGON.arrive) {
    let best: Hero | null = null, bd = DRAGON.reach;
    for (const e of g.heroes) {
      if (!e.alive || e.team === h.team) continue;
      const dd = Math.hypot(e.pos.x - dr.center.x, e.pos.z - dr.center.z);
      if (dd < bd) { bd = dd; best = e; }
    }
    if (best) { dr.run = { target: best, at: best.pos.clone(), t: 0 }; g.play('dragonDive', dr.pos, 0.9); }
    else dr.runCd = 0.4;
  }

  // ── steering
  const want = _a;
  let speed = DRAGON.speed;
  if (leaving) {
    want.copy(dr.vel).setY(0).normalize().setY(0.9).normalize();
    speed = 26;
  } else if (dr.run) {
    const run = dr.run;
    run.t += dt;
    if (run.target?.alive) run.at.lerp(run.target.pos, Math.min(1, dt * 3));
    const over = _b.copy(run.at).setY(dr.ground + DRAGON.runAlt);
    const toT = _c.subVectors(over, dr.pos);
    const flat = Math.hypot(toT.x, toT.z);
    const ahead = (toT.x * dr.vel.x + toT.z * dr.vel.z) / Math.max(1e-3, flat * Math.hypot(dr.vel.x, dr.vel.z));
    want.copy(toT).normalize();
    speed = DRAGON.runSpeed;
    // breathe while it bears down on the target
    dr.breath = flat < 16 && ahead > 0.2 ? Math.min(1, dr.breath + dt * 5) : Math.max(0, dr.breath - dt * 3);
    if ((flat < 3.5 && run.t > 0.5) || run.t > 2.6) {
      dr.run = null; dr.runCd = 1.3;
      dr.theta = Math.atan2(dr.pos.z - dr.center.z, dr.pos.x - dr.center.x);
    }
  } else {
    // circle the fight, looking ahead along the orbit
    dr.breath = Math.max(0, dr.breath - dt * 3);
    dr.theta += (DRAGON.speed / DRAGON.radius) * dt;
    const ax = dr.center.x + Math.cos(dr.theta + 0.5) * DRAGON.radius, az = dr.center.z + Math.sin(dr.theta + 0.5) * DRAGON.radius;
    want.set(ax - dr.pos.x, dr.ground + DRAGON.alt - dr.pos.y, az - dr.pos.z).normalize();
  }
  const turn = dr.run ? 2.6 : 1.8;
  dr.vel.lerp(want.multiplyScalar(speed), 1 - Math.exp(-turn * dt));
  dr.pos.addScaledVector(dr.vel, dt);
  // never into the floor or the scenery's top
  const floor = g.world.heightAt(dr.pos.x, dr.pos.z, dr.pos.y) + 3.5;
  if (dr.pos.y < floor) { dr.pos.y = floor; dr.vel.y = Math.max(dr.vel.y, 0); }

  // ── pose: heading, pitch, banking into turns
  const yaw = Math.atan2(dr.vel.x, dr.vel.z);
  const dyaw = Math.atan2(Math.sin(yaw - dr.yaw), Math.cos(yaw - dr.yaw));
  dr.yaw += dyaw * Math.min(1, dt * 6);
  dr.bank = damp(dr.bank, clamp(-dyaw * 6, -0.7, 0.7), 4, dt);
  dr.pitch = damp(dr.pitch, -Math.atan2(dr.vel.y, Math.hypot(dr.vel.x, dr.vel.z)) * 0.8, 5, dt);
  R.root.position.copy(dr.pos);
  R.root.rotation.set(dr.pitch, dr.yaw, dr.bank, 'YXZ');
  // wings: big slow beats, folding into a glide during a dive
  const glide = dr.run ? 0.55 : 0;
  dr.flap += dt * (leaving ? 7 : lerp(4.6, 2.4, glide));
  const beat = Math.sin(dr.flap);
  if (Math.sin(dr.flap - dt * 4.6) < 0.9 && beat >= 0.9 && R.root.scale.x > 0.3) g.play('dragonFlap', dr.pos, 0.7);
  for (const w of R.wings) {
    w.inner.rotation.z = w.side * (beat * lerp(0.62, 0.2, glide) + 0.08);
    w.outer.rotation.z = w.side * (Math.sin(dr.flap - 0.8) * lerp(0.55, 0.15, glide) - 0.05);
    w.inner.rotation.y = w.side * -0.12 * glide;
  }
  // neck dips toward the target while breathing, the tail streams and sways
  const tgtDip = dr.breath * 0.17;
  R.neck.forEach((s, i) => { s.rotation.x = lerp(s.rotation.x, tgtDip + Math.sin(dr.flap * 0.5 + i * 0.6) * 0.04, Math.min(1, dt * 6)); s.rotation.y = Math.sin(dr.t * 1.3 + i * 0.5) * 0.05; });
  R.head.rotation.x = lerp(R.head.rotation.x, dr.breath * 0.35, Math.min(1, dt * 6));
  R.jaw.rotation.x = lerp(R.jaw.rotation.x, dr.breath * 0.55 + (dr.t < 1.4 ? 0.4 * Math.sin(Math.min(1, dr.t / 1.4) * Math.PI) : 0), Math.min(1, dt * 10));
  R.tail.forEach((s, i) => { s.rotation.y = Math.sin(dr.t * 2.2 - i * 0.55) * 0.09; s.rotation.x = Math.sin(dr.flap - i * 0.4) * 0.03 - 0.01; });
  // the eyes glow through the smoke
  if (Math.random() < dt * 20) {
    R.root.updateMatrixWorld(true);
    for (const e of R.eyes) { const p = e.getWorldPosition(_v1); g.vfx.p({ x: p.x, y: p.y, z: p.z, r: ENDER.r, g: ENDER.g, b: ENDER.b, size: 0.6 * R.root.scale.x, life: 0.08, shape: Shape.Flare }); }
  }
  // ender particles shed from the body
  if (Math.random() < dt * 30) {
    const p = _v1.copy(dr.pos).add(_v2.set(rand(-1.5, 1.5), rand(-1, 1), rand(-3, 3)));
    g.vfx.p({ x: p.x, y: p.y, z: p.z, vx: rand(-0.5, 0.5), vy: rand(-0.8, 0.2), vz: rand(-0.5, 0.5), r: ENDER.r * 0.6, g: ENDER.g * 0.6, b: ENDER.b * 0.6, size: rand(0.08, 0.14), life: rand(0.6, 1), shape: Shape.Pixel, aux: rand(0, 9) });
  }
  breathe(h, g, dt, dr);
}

/** Dragon fire: a stream of purple flame, black smoke and white embers from the jaws to the ground ahead of it. */
function breathe(h: Hero, g: Game, dt: number, dr: Dragon) {
  if (dr.breath < 0.05) { if (dr.flame) { dr.flame.stop(0.3); dr.flame = null; } return; }
  dr.rig.root.updateMatrixWorld(true);
  const mouth = dr.rig.mouth.getWorldPosition(_a);
  // where the fire lands: the target (led a little), or straight ahead and down
  const tgt = dr.run?.at ?? _b.copy(dr.pos).addScaledVector(dr.vel, 0.5).setY(dr.ground);
  const land = _b.copy(tgt);
  land.y = g.world.heightAt(land.x, land.z, mouth.y) + 0.1;
  const dir = _c.subVectors(land, mouth);
  const len = dir.length();
  dir.divideScalar(len || 1);
  if (!dr.flame) { dr.flame = g.loop('dragonBreath', mouth, 0.85); g.play('dragonBreathStart', mouth, 0.9); }
  dr.flame?.set(mouth, 1, 0.85 * dr.breath);
  const k = dr.breath;
  const n = Math.ceil(dt * 160 * k);
  for (let i = 0; i < n; i++) {
    const u = Math.random();
    const sp = rand(14, 22);
    const spread = 0.6 + u * 2.2;
    const vx = dir.x * sp + rand(-1, 1) * spread, vy = dir.y * sp + rand(-1, 1) * spread, vz = dir.z * sp + rand(-1, 1) * spread;
    const r = Math.random();
    if (r < 0.55) g.vfx.p({ x: mouth.x, y: mouth.y, z: mouth.z, vx, vy, vz, r: ENDER.r, g: ENDER.g, b: ENDER.b, r2: 0.5, g2: 0.05, b2: 1.1, size: rand(0.3, 0.6), grow: 3.5, life: len / sp * rand(0.8, 1.1), shape: Shape.Flare, drag: 0.4, rot: rand(0, TAU) });
    else if (r < 0.85) g.vfx.pa({ x: mouth.x, y: mouth.y, z: mouth.z, vx: vx * 0.8, vy: vy * 0.8, vz: vz * 0.8, r: VOID.r, g: VOID.g, b: VOID.b, a: 0.55, size: rand(0.4, 0.7), grow: 4, life: len / sp * rand(1, 1.4), shape: Shape.Smoke, drag: 0.6, rot: rand(0, TAU), spin: rand(-2, 2) });
    else g.vfx.p({ x: mouth.x, y: mouth.y, z: mouth.z, vx: vx * 1.1, vy: vy * 1.1, vz: vz * 1.1, r: 4, g: 3.6, b: 4.4, size: rand(0.06, 0.1), life: len / sp * rand(0.7, 1), shape: Shape.Spark, stretch: 0.03 });
  }
  // the fire splashes where it lands
  if (Math.random() < dt * 30 * k) {
    g.vfx.p({ x: land.x + rand(-1, 1), y: land.y + 0.2, z: land.z + rand(-1, 1), vx: rand(-3, 3), vy: rand(1, 3), vz: rand(-3, 3), r: ENDER.r, g: ENDER.g, b: ENDER.b, r2: 0.3, g2: 0.05, b2: 0.6, size: rand(0.4, 0.8), grow: 2.5, life: 0.4, shape: Shape.Flare });
    g.vfx.groundGlow(land, ENDER, 3, 0.4, 0.1);
  }
  // damage along the stream and in a splash where it lands
  dr.tickT -= dt;
  if (dr.tickT <= 0 && k > 0.5) {
    dr.tickT = DRAGON.tick;
    for (const e of g.heroes) {
      if (!e.alive || e.team === h.team) continue;
      const c = e.center;
      const inStream = distSqPointSegment(c, mouth, land) < 1.5 * 1.5;
      const inSplash = Math.hypot(c.x - land.x, c.z - land.z) < 2.6 && Math.abs(e.pos.y - land.y) < 2.5;
      if (!inStream && !inSplash) continue;
      g.damage(e, DRAGON.flameDmg, h, { at: c, fx: false });
      if (Math.random() < 0.4) g.vfx.p({ x: c.x, y: c.y, z: c.z, vy: 2, r: ENDER.r, g: ENDER.g, b: ENDER.b, size: 0.5, grow: 2, life: 0.3, shape: Shape.Flare });
    }
  }
  // lingering clouds of dragon's breath
  dr.cloudT -= dt;
  if (dr.cloudT <= 0 && k > 0.6) { dr.cloudT = 0.45; breathCloud(h, g, land.clone()); }
}

function breathCloud(h: Hero, g: Game, at: THREE.Vector3) {
  // merge into a cloud already here instead of stacking damage
  for (const z of g.zones) if (z.kind === 'dragonBreath' && z.owner === h && z.pos.distanceTo(at) < DRAGON.cloudR * 0.9) { z.t = Math.min(z.t, 0.4); return; }
  let tick = 0;
  g.addZone({
    owner: h, team: h.team, pos: at, radius: DRAGON.cloudR, t: 0, dur: DRAGON.cloudDur, dead: false, kind: 'dragonBreath',
    update(z, g, dt) {
      const fade = Math.min(1, (z.dur - z.t) / 0.8);
      // a low swirl of purple motes that drift up and pop
      const n = Math.ceil(dt * 50 * fade);
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), r = Math.sqrt(Math.random()) * z.radius;
        g.vfx.p({ x: z.pos.x + Math.cos(a) * r, y: z.pos.y + rand(0, 0.4), z: z.pos.z + Math.sin(a) * r, vx: -Math.sin(a) * 0.8, vy: rand(0.4, 1.4), vz: Math.cos(a) * 0.8, r: ENDER.r * 0.8, g: ENDER.g * 0.8, b: ENDER.b * 0.8, r2: 0.3, g2: 0.05, b2: 0.5, size: rand(0.08, 0.16), life: rand(0.6, 1.1), shape: Shape.Pixel, aux: rand(0, 9) });
      }
      if (Math.random() < dt * 5 * fade) g.vfx.pa({ x: z.pos.x + rand(-1.5, 1.5), y: z.pos.y + 0.3, z: z.pos.z + rand(-1.5, 1.5), vy: 0.3, r: 0.25, g: 0.05, b: 0.35, a: 0.35 * fade, size: rand(1.2, 1.8), grow: 1.6, life: 1.2, shape: Shape.Smoke, rot: rand(0, TAU), spin: rand(-0.5, 0.5) });
      if (Math.random() < dt * 2) g.vfx.groundGlow(z.pos, ENDER, z.radius * 2.2, 0.8, 0.3);
      tick -= dt;
      if (tick > 0) return;
      tick = 0.25;
      for (const e of g.enemiesNear(z.team, z.pos, z.radius)) {
        if (Math.abs(e.pos.y - z.pos.y) > 2.2) continue;
        g.damage(e, DRAGON.cloudDmg, z.owner, { at: e.center, fx: false, silent: true });
        e.applySlow(0.25, 0.4);
      }
    },
    dispose() {},
  });
}

function removeDragon(g: Game, dr: Dragon) {
  if (dr.gone) return;
  dr.gone = true;
  dr.flame?.stop(0.2); dr.flame = null;
  // it bursts into a puff of ender particles as it leaves
  g.vfx.smoke(dr.pos, VOID, 8, 3, 1.4, 0.5);
  g.vfx.burst(dr.pos, ENDER, 40, 8, 0.2, 0.9, { shape: Shape.Pixel });
  dr.rig.root.removeFromParent();
  dr.rig.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
}

// ───────────────────────── procedural stand-in ─────────────────────────

/** Blocky body for the instant before the model loads (the real one is scripts/build-steve.mjs). */
function buildSteve(r: RigBuilder) {
  const skin = r.mat('#c49272', 0.85), shirt = r.mat('#18a8a8', 0.85), jeans = r.mat('#3a3f9e', 0.85), hair = r.mat('#3b2715', 0.9), shoe = r.mat('#707070', 0.85);
  r.hips.position.y = 0.7; r.spine.position.y = 0.04; r.chest.position.y = 0.4; r.neck.position.y = 0.2; r.head.position.y = 0.03;
  r.add(r.chest, new THREE.BoxGeometry(0.45, 0.68, 0.225), shirt, [0, -0.15, 0]);
  r.add(r.head, new THREE.BoxGeometry(0.45, 0.45, 0.45), skin, [0, 0.22, 0]);
  r.add(r.head, new THREE.BoxGeometry(0.46, 0.12, 0.46), hair, [0, 0.4, 0]);
  for (const [sh, el] of [[r.shoulderL, r.elbowL], [r.shoulderR, r.elbowR]] as const) {
    sh.position.x = Math.sign(sh.position.x) * 0.34;
    r.add(sh, new THREE.BoxGeometry(0.225, 0.3, 0.225), shirt, [0, -0.08, 0]);
    r.add(el, new THREE.BoxGeometry(0.225, 0.34, 0.225), skin, [0, -0.1, 0]);
  }
  for (const [hp, kn, ft] of [[r.hipL, r.kneeL, r.footL], [r.hipR, r.kneeR, r.footR]] as const) {
    r.add(hp, new THREE.BoxGeometry(0.225, 0.35, 0.225), jeans, [0, -0.17, 0]);
    r.add(kn, new THREE.BoxGeometry(0.225, 0.3, 0.225), jeans, [0, -0.15, 0]);
    r.add(ft, new THREE.BoxGeometry(0.225, 0.06, 0.225), shoe, [0, 0.02, 0]);
  }
}

const STEVE_ICONS = {
  swordBow: '<path d="M4 20l2-2M6 18l-1.5-1.5M6 18l1.5 1.5M7 17L17.5 6.5 19 3l-3.5 1.5L5 15" fill="currentColor" fill-opacity=".25"/><path d="M7 17L17.5 6.5 19 3l-3.5 1.5L5 15M4.5 15.5l4 4M3.5 20.5l2-2"/><path d="M13 20c4-1 6.5-3.5 7.5-7.5" stroke-dasharray="1.6 1.4" opacity=".7"/>',
  blocks: '<path d="M3 13h6v7H3zM9 9h6v11H9zM15 5h6v15h-6z" fill="currentColor" fill-opacity=".25"/><path d="M3 13h6v7H3zM9 9h6v11H9zM15 5h6v15h-6zM3 15h6M9 11h6M15 7h6" />',
  dragon: '<path d="M2 10l6 1 4-4 4 4 6-1-4 4-6 1-6-1z" fill="currentColor" fill-opacity=".3"/><path d="M2 10l6 1 4-4 4 4 6-1-4 4-6 1-6-1zM12 15v5M10.5 7.5l1.5 1 1.5-1"/><circle cx="10.8" cy="9.6" r=".7" fill="currentColor"/><circle cx="13.2" cy="9.6" r=".7" fill="currentColor"/>',
};

export const STEVE: HeroDef = {
  id: 'steve',
  name: 'Steve',
  title: 'The Blocky Miner',
  role: 'Duelist',
  tagline: 'Punch trees. Build walls. Summon dragons.',
  color: '#2fc9c0',
  accent: '#b05cff',
  maxHp: 275,
  modelUrl: '/models/heroes/steve.glb?v=1',
  speed: 6.2,
  secondaryCd: 11,
  ultCost: 1600,
  botRange: 10,
  ratings: { damage: 0.75, mobility: 0.5, support: 0.4, difficulty: 0.55 },
  abilities: {
    primary: { key: 'LMB', name: 'Diamond Sword / Bow', desc: 'Scroll the mouse wheel (or press 1 / 2) to swap. The sword sweeps everyone in front of you and crits when you strike while falling from a jump. Hold with the bow to draw and release to shoot: a full draw flies flat and fast with a crit trail.', stat: '40 sweep · arrows 16-60', icon: STEVE_ICONS.swordBow },
    secondary: { key: 'RMB', name: 'Build Up', desc: 'A hill of grass, dirt and stone bursts out of the ground where you aim: a sheer wall toward the enemy and steps on your side to jump up for the high ground. It stands for 8 s.', stat: '7-wide wall · 8 s · 11 s cd', icon: STEVE_ICONS.blocks },
    ult: { key: 'SHIFT', name: 'Ender Dragon', desc: 'The Ender Dragon bursts from an End portal above you, circles the fight and dives on enemies breathing purple dragon fire, leaving clouds of burning breath on the ground.', stat: '70 dps fire · breath clouds · 10 s', icon: STEVE_ICONS.dragon },
  },
  items: [
    { id: 'sword', hand: 'R', build: buildSword },
    { id: 'bow', hand: 'L', build: buildBow },
  ],
  look: { build: buildSteve, style: 'default' },
  createKit: () => new SteveKit(),
};

/** Pre-compiles the block, item and dragon materials so the first wall or dragon doesn't hitch. */
export function warmupSteve(g: Game): THREE.Object3D[] {
  g.pool('steveArrow', arrowPool);
  const M = blockMaterials();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const out: THREE.Object3D[] = [new THREE.Mesh(box, M.grass), new THREE.Mesh(box, M.dirt), new THREE.Mesh(box, M.stone), buildSword(), buildBow()];
  out.push(buildDragon().root);
  return out;
}
