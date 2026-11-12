import * as THREE from 'three';
import type { HeroDef, HeroKit, Projectile, Zone } from '../game/types';
import type { Hero } from '../game/Hero';
import type { Game } from '../game/Game';
import { InstancedPool } from '../vfx/Vfx';
import { Shape } from '../vfx/Particles';
import { rand, TAU, _m1, _q1, _v1 } from '../core/math';
import type { RigBuilder } from '../render/HeroRig';
import { ICONS } from './icons';
import { propMesh, PROPS } from '../render/props';

const GOLD = new THREE.Color(3.2, 2.2, 0.7);
const Z = new THREE.Vector3(0, 0, 1);

function ringPool() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  return new InstancedPool(new THREE.TorusGeometry(1, 0.09, 6, 28), mat, 192, true);
}

class YeatKit implements HeroKit {
  primary(h: Hero, g: Game) {
    if (h.kitState.truck) return;
    h.primaryCd = 0.62;
    const m = h.muzzle('R');
    m.addScaledVector(h.right, -0.3); // both hands, center-ish
    const base = h.aimDir(m);
    h.anim.attack = 1;
    h.anim.attackSide = (h.anim.attackSide * -1) || 1;
    const col = GOLD;
    g.play('bell', m, 0.8);
    g.vfx.p({ x: m.x, y: m.y, z: m.z, r: col.r, g: col.g, b: col.b, size: 0.3, grow: 4, life: 0.2, shape: Shape.Ring, aux: 0.15 });
    g.vfx.burst(m, col, 8, 5, 0.1, 0.25);
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(base, up).normalize();
    const vup = new THREE.Vector3().crossVectors(side, base).normalize();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + rand(-0.3, 0.3);
      const s = i === 0 ? 0 : rand(0.03, 0.075);
      const dir = base.clone().addScaledVector(side, Math.cos(a) * s).addScaledVector(vup, Math.sin(a) * s).normalize();
      g.spawnProjectile({
        owner: h, kind: 'bell', pos: m.clone(), vel: dir.multiplyScalar(62), gravity: 0, radius: 0.16, life: 0.36, damage: 10, color: col,
        render(p, g) {
          const pool = g.pool('bellRing', ringPool);
          _q1.setFromUnitVectors(Z, _v1.copy(p.vel).normalize());
          const sc = 0.12 + p.age * 1.1;
          _m1.compose(p.pos, _q1, new THREE.Vector3(sc, sc, sc));
          const fade = 1 - (p.age / p.life) * 0.6;
          pool.add(_m1, new THREE.Color(p.color.r * fade, p.color.g * fade, p.color.b * fade));
        },
        onHit(p, g, hit, point) {
          if (hit) {
            const crit = point.y > hit.pos.y + 1.42;
            const falloff = p.age > 0.2 ? 0.6 : 1;
            g.damage(hit, p.damage * falloff, p.owner, { crit, at: point, knock: _v1.copy(p.vel).setY(0).normalize().multiplyScalar(0.6) });
          }
          g.vfx.sparks(point, p.color, 4, 6);
          g.vfx.p({ x: point.x, y: point.y, z: point.z, r: p.color.r, g: p.color.g, b: p.color.b, size: 0.2, grow: 3, life: 0.15, shape: Shape.Ring, aux: 0.25 });
        },
      } as Omit<Projectile, 'prev' | 'age' | 'dead' | 'seed'>);
    }
  }

  secondary(h: Hero, g: Game) {
    if (h.kitState.truck) return false;
    startTonka(h, g);
    return true;
  }

  ult(h: Hero, g: Game) {
    dropTheBell(h, g);
    return true;
  }

  update(h: Hero, g: Game, dt: number) {
    if (h.kitState.truck) updateTonka(h, g, dt);
  }

  onDeath(h: Hero, g: Game) {
    if (h.kitState.truck) endTonka(h, g, false);
  }
}

// ───────────────────────── Tonka ─────────────────────────
const TONKA_DUR = 4.5;
const TONKA_MAX = 25;
const YELLOW = new THREE.Color(3.2, 2.2, 0.25);

interface TruckState {
  t: number;
  speed: number;
  heading: number;
  group: THREE.Group;
  wheels: THREE.Object3D[];
  hidden: { o: THREE.Object3D; v: boolean }[];
  last: THREE.Vector3;
  /** Distance we asked physics to move last frame (frame times vary, so compare against this). */
  expect: number;
  roll: number;
}

const _yAxis = new THREE.Vector3(0, 1, 0);
let truckTemplate: { group: THREE.Group; wheelNames: string[] } | null = null;
/** Chunky toy dump truck (faces +z). Replaced by the Meshy `tonka_truck` prop when it's delivered. */
const TRUCK_H = 2.0;
/** The Meshy truck faces -x with axles along z: turn it to face +z. */
const TRUCK_YAW = Math.PI / 2;
let meshyTruck: { body: THREE.BufferGeometry; wheels: { geo: THREE.BufferGeometry; c: THREE.Vector3; r: number }[]; mat: THREE.Material } | null = null;

/**
 * Splits the single-mesh Meshy truck into body + 4 wheels from its geometry: the tyres are the
 * triangles in the outer z slabs that fall inside a disc around each wheel hub.
 */
function splitMeshyTruck() {
  const t = PROPS.tonka_truck;
  if (!t) return null;
  if (meshyTruck) return meshyTruck;
  const g = t.geometry;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const idx = g.index ? (g.index.array as ArrayLike<number>) : Array.from({ length: n }, (_, i) => i);
  let maxZ = 0;
  for (let i = 0; i < n; i++) maxZ = Math.max(maxZ, Math.abs(pos.getZ(i)));
  const zIn = maxZ * 0.49;
  // hub centers: the bounding box of low, outer vertices in each quadrant
  const wheels: { c: THREE.Vector3; r: number; tris: number[] }[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const bb = new THREE.Box3();
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (Math.sign(x) === sx && Math.sign(z) === sz && Math.abs(z) > zIn && y < 0.47 && Math.abs(x) > 0.08) bb.expandByPoint(new THREE.Vector3(x, y, z));
    }
    if (bb.isEmpty()) return null;
    const r = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y) / 2;
    wheels.push({ c: new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.min.y + r, sz * maxZ * 0.5), r, tris: [] });
  }
  const body: number[] = [];
  const inWheel = (i: number, w: (typeof wheels)[number]) => {
    const z = pos.getZ(i);
    return Math.sign(z) === Math.sign(w.c.z) && Math.abs(z) > zIn * 0.96 && Math.hypot(pos.getX(i) - w.c.x, pos.getY(i) - w.c.y) < w.r * 1.04;
  };
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k], b = idx[k + 1], c = idx[k + 2];
    const w = wheels.find((w) => inWheel(a, w) && inWheel(b, w) && inWheel(c, w));
    (w ? w.tris : body).push(a, b, c);
  }
  const sub = (tris: number[], off?: THREE.Vector3) => {
    const geo = g.clone();
    geo.setIndex(tris);
    if (off) geo.translate(-off.x, -off.y, -off.z);
    geo.computeBoundingSphere();
    return geo;
  };
  meshyTruck = { body: sub(body), wheels: wheels.map((w) => ({ geo: sub(w.tris, w.c), c: w.c, r: w.r })), mat: t.material };
  return meshyTruck;
}

/** Chunky toy dump truck (faces +z). Uses the Meshy `tonka_truck` with its wheels split off so they spin. */
export function buildTruck(): THREE.Group {
  const g = new THREE.Group();
  const mt = splitMeshyTruck();
  if (mt) {
    const body = new THREE.Mesh(mt.body, mt.mat);
    body.scale.setScalar(TRUCK_H); body.rotation.y = TRUCK_YAW; body.castShadow = true;
    g.add(body);
    mt.wheels.forEach((w, i) => {
      // pivot axes: after the yaw the axle (local z) lies along x, so rotation.x rolls the wheel
      const pivot = new THREE.Group();
      pivot.position.copy(w.c).applyAxisAngle(_yAxis, TRUCK_YAW).multiplyScalar(TRUCK_H);
      pivot.name = `wheel${i}`;
      pivot.userData.radius = w.r * TRUCK_H;
      const m = new THREE.Mesh(w.geo, mt.mat);
      m.scale.setScalar(TRUCK_H); m.rotation.y = TRUCK_YAW; m.castShadow = true;
      pivot.add(m);
      g.add(pivot);
    });
    return g;
  }
  const meshy = propMesh('tonka_truck', 1.9);
  if (meshy) { g.add(meshy); return g; }
  if (!truckTemplate) {
    const t = new THREE.Group();
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.35, metalness: 0.25 });
    const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.15, metalness: 1 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.05, metalness: 0.6 });
    const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(3, 2.6, 1.6) });
    const box = (w: number, hh: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m); mesh.position.set(x, y, z); mesh.rotation.x = rx; mesh.castShadow = true; t.add(mesh); return mesh;
    };
    box(1.7, 0.35, 3.1, black, 0, 0.55, 0); // chassis
    box(1.75, 0.95, 1.05, yellow, 0, 1.15, 0.95); // cab
    box(1.5, 0.5, 0.06, glass, 0, 1.35, 1.48); // windshield
    box(1.8, 0.45, 0.7, yellow, 0, 0.9, 1.6); // hood
    box(1.9, 0.18, 0.16, chrome, 0, 0.62, 2.0); // bumper
    for (const x of [-0.6, 0.6]) box(0.28, 0.2, 0.06, lamp, x, 0.95, 1.96);
    // dump bed, tilted a touch
    const bed = new THREE.Group(); bed.position.set(0, 0.85, -0.65); bed.rotation.x = -0.12; t.add(bed);
    const bedPart = (w: number, hh: number, d: number, x: number, y: number, z: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), yellow); m.position.set(x, y, z); m.castShadow = true; bed.add(m); };
    bedPart(1.85, 0.1, 1.8, 0, 0.05, 0); bedPart(0.1, 0.75, 1.8, -0.88, 0.42, 0); bedPart(0.1, 0.75, 1.8, 0.88, 0.42, 0); bedPart(1.85, 0.85, 0.1, 0, 0.47, 0.9); bedPart(1.85, 0.6, 0.1, 0, 0.35, -0.9);
    // hazard stripes on the bumper
    for (let i = 0; i < 5; i++) box(0.12, 0.19, 0.02, black, -0.7 + i * 0.35, 0.62, 2.085).rotation.z = 0.6;
    // wheels
    const wg = new THREE.CylinderGeometry(0.48, 0.48, 0.42, 20).rotateZ(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.44, 10).rotateZ(Math.PI / 2);
    const names: string[] = [];
    for (const [x, z] of [[-0.95, 1.2], [0.95, 1.2], [-0.95, -1.05], [0.95, -1.05]]) {
      const w = new THREE.Group(); w.position.set(x, 0.48, z); w.name = `wheel${names.length}`; names.push(w.name);
      const tire = new THREE.Mesh(wg, black); tire.castShadow = true;
      const h2 = new THREE.Mesh(hub, chrome);
      w.add(tire, h2);
      // tread blocks so the spin reads
      for (let i = 0; i < 8; i++) { const tb = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, 0.14), black); const a = (i / 8) * TAU; tb.position.set(0, Math.cos(a) * 0.48, Math.sin(a) * 0.48); tb.rotation.x = -a; w.add(tb); }
      t.add(w);
    }
    truckTemplate = { group: t, wheelNames: names };
  }
  g.add(truckTemplate.group.clone());
  return g;
}

function startTonka(h: Hero, g: Game) {
  const group = buildTruck();
  const wheels: THREE.Object3D[] = [];
  group.traverse((o) => { if (o.name.startsWith('wheel')) wheels.push(o); });
  const hidden = h.model.root.children.map((o) => ({ o, v: o.visible }));
  hidden.forEach(({ o }) => { o.visible = false; });
  h.model.root.add(group);
  const f = h.forward;
  const st: TruckState = { t: 0, speed: Math.max(7, Math.hypot(h.vel.x, h.vel.z)), heading: Math.atan2(-f.x, -f.z), group, wheels, hidden, last: h.pos.clone(), expect: 0, roll: 0 };
  h.kitState.truck = st;
  if (h.isLocal) g.camRig.vehicle = 1;
  g.play('tonka', h.pos, 1.1);
  const c = h.center;
  g.vfx.smoke(c, new THREE.Color(0.75, 0.7, 0.6), 14, 1.1, 0.9, 0.6);
  g.vfx.burst(c, YELLOW, 40, 9, 0.12, 0.5);
  g.vfx.shockwave(h.pos, YELLOW, 3.5, 0.35, 0.14);
  if (h.isLocal) { g.camRig.kick(10); g.camRig.shake(0.25); g.events.onAnnounce('TONKA', 'Ram them', 'gold'); }
}

function updateTonka(h: Hero, g: Game, dt: number) {
  const st = h.kitState.truck as TruckState;
  st.t += dt;
  h.dmgTakenMult *= 0.6;
  // steer toward where the player looks, slowly: heavy truck, wide turns (worse at speed)
  const target = h.yaw;
  let diff = target - st.heading;
  while (diff > Math.PI) diff -= TAU;
  while (diff < -Math.PI) diff += TAU;
  const turnRate = 2.1 - (st.speed / TONKA_MAX) * 1.2;
  const turn = Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
  st.heading += turn;
  st.roll += ((-turn / Math.max(dt, 1e-4)) * 0.06 - st.roll) * Math.min(1, dt * 8);
  // always accelerating; W floors it
  const accel = h.input.forward > 0.1 ? 15 : 9;
  st.speed = Math.min(TONKA_MAX, st.speed + accel * dt);
  const dir = new THREE.Vector3(-Math.sin(st.heading), 0, -Math.cos(st.heading));
  // walls: if we barely moved compared to what we asked for last frame, we hit something solid
  const moved = Math.hypot(h.pos.x - st.last.x, h.pos.z - st.last.z);
  if (st.t > 0.15 && st.expect > 0.02 && moved < st.expect * 0.35) {
    if (st.speed > 12) {
      g.play('crash', h.pos, 0.8);
      g.vfx.sparks(_v1.copy(h.pos).addScaledVector(dir, 1.6).setY(h.pos.y + 0.8), new THREE.Color(3, 2.4, 1), 26, 10);
      g.shake(h.pos, 0.4);
    }
    st.speed *= 0.2;
  }
  st.last.copy(h.pos);
  st.expect = st.speed * dt;
  h.overrideVel = (h.overrideVel ?? new THREE.Vector3()).copy(dir).multiplyScalar(st.speed).setY(-3);

  // ram: everyone in front of the bumper takes damage scaled by speed
  if (st.speed > 6) {
    const nose = _v1.copy(h.pos).addScaledVector(dir, 1.3);
    const victims = g.enemiesNear(h.team, nose, 1.9);
    if (victims.length) {
      const dmg = Math.round(30 + st.speed * 4.4);
      for (const e of victims) {
        g.damage(e, dmg, h, { knock: dir.clone().multiplyScalar(st.speed * 0.75).setY(8) });
        g.vfx.sparks(e.chest, YELLOW, 30, 14, dir);
        g.vfx.burst(e.chest, new THREE.Color(3, 1.2, 0.3), 30, 10, 0.12, 0.5);
      }
      g.play('crash', h.pos, 1.2);
      g.play('bass808', h.pos, 1);
      g.vfx.shockwave(nose, YELLOW, 6, 0.4, 0.12);
      g.vfx.flash(nose.clone().setY(h.pos.y + 1), new THREE.Color(1, 0.7, 0.2), 60, 0.4, 14);
      g.shake(h.pos, 0.8);
      endTonka(h, g, true);
      return;
    }
  }

  // visuals: the model root follows the hero's body yaw, so counter-rotate to the truck heading
  st.group.rotation.set(0, st.heading - h.bodyYaw, st.roll);
  st.group.position.y = Math.sin(st.t * 30) * 0.015 * (st.speed / TONKA_MAX);
  for (const w of st.wheels) w.rotation.x += (st.speed / (w.userData.radius ?? 0.48)) * dt;
  // dust from the rear wheels + exhaust
  if (Math.random() < dt * 30) {
    const back = _v1.copy(h.pos).addScaledVector(dir, -1.1);
    g.vfx.pa({ x: back.x + rand(-0.8, 0.8), y: h.pos.y + 0.2, z: back.z + rand(-0.8, 0.8), vx: -dir.x * 2 + rand(-1, 1), vy: rand(0.4, 1.4), vz: -dir.z * 2 + rand(-1, 1), r: 0.62, g: 0.55, b: 0.45, a: 0.45, size: rand(0.6, 1.1), grow: 2.2, life: rand(0.6, 1.1), drag: 1.5, shape: Shape.Smoke, spin: rand(-1, 1), fadeIn: 0.1 });
  }
  if (st.t >= TONKA_DUR) endTonka(h, g, false);
}

function endTonka(h: Hero, g: Game, crashed: boolean) {
  const st = h.kitState.truck as TruckState | null;
  if (!st) return;
  h.kitState.truck = null;
  if (h.isLocal) g.camRig.vehicle = 0;
  h.model.root.remove(st.group);
  st.hidden.forEach(({ o, v }) => { o.visible = v; });
  const dir = new THREE.Vector3(-Math.sin(st.heading), 0, -Math.cos(st.heading));
  h.overrideVel = null;
  h.vel.set(dir.x * st.speed * 0.25, crashed ? 6 : 0, dir.z * st.speed * 0.25);
  if (crashed) h.grounded = false;
  const c = h.center;
  g.vfx.smoke(c, new THREE.Color(0.75, 0.7, 0.6), 16, 1.2, 1, 0.6);
  g.vfx.burst(c, YELLOW, 30, 8, 0.1, 0.45);
}

// ───────────────────────── The Bell ─────────────────────────
const DOOM = new THREE.Color(0.6, 3.2, 0.9);
let bellTemplate: THREE.Object3D | null = null;
/** Colossal bronze bell hanging from its yoke; origin at the hanging point, bell below (−y). */
function buildBell(): THREE.Object3D {
  const H = 5.4;
  const meshy = propMesh('giant_bell', H);
  if (meshy) { meshy.position.y = -H; const g = new THREE.Group(); g.add(meshy); return g; }
  if (!bellTemplate) {
    const t = new THREE.Group();
    const bronze = new THREE.MeshStandardMaterial({ color: 0xb07a2a, metalness: 1, roughness: 0.3, emissive: new THREE.Color(0.12, 0.07, 0.0) });
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.8 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.8, roughness: 0.5 });
    // classic bell profile (radius, height), lathed
    const prof: [number, number][] = [[0.0, 0], [2.75, 0], [2.85, 0.12], [2.7, 0.3], [2.35, 0.75], [1.95, 1.6], [1.8, 2.6], [1.78, 3.4], [1.6, 4.0], [1.1, 4.35], [0.0, 4.45]];
    const outer = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 48);
    const inner = new THREE.LatheGeometry(prof.slice(1, -1).map(([r, y]) => new THREE.Vector2(Math.max(0.01, r - 0.22), y + 0.02)).reverse(), 48);
    const shell = new THREE.Mesh(outer, bronze); shell.castShadow = true;
    const inside = new THREE.Mesh(inner, new THREE.MeshStandardMaterial({ color: 0x2b1a08, metalness: 0.9, roughness: 0.6, side: THREE.BackSide }));
    // decorative rings
    for (const [y, r] of [[0.55, 2.42], [2.2, 1.86], [3.65, 1.72]]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 6, 48), bronze); ring.rotation.x = Math.PI / 2; ring.position.y = y; t.add(ring); }
    const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), iron); clapper.position.y = 0.6;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.6), iron); rod.position.y = 2.4;
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.6, 0.8), wood); yoke.position.y = 4.75; yoke.castShadow = true;
    for (const x of [-1.2, 1.2]) { const strap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.86), iron); strap.position.set(x, 4.55, 0); t.add(strap); }
    t.add(shell, inside, clapper, rod, yoke);
    t.scale.setScalar(H / 5.05); // profile is 5.05 m tall incl. yoke
    t.position.y = -H;
    bellTemplate = t;
  }
  const g = new THREE.Group();
  g.add(bellTemplate.clone());
  return g;
}

/** Pick the enemy nearest the crosshair's aim point (within 9 m); otherwise drop on the aim point itself. */
function bellTarget(h: Hero, g: Game) {
  const aim = h.input.aim;
  let best: Hero | null = null, bd = 9;
  for (const e of g.heroes) {
    if (e.team === h.team || !e.alive) continue;
    const d = Math.hypot(e.pos.x - aim.x, e.pos.z - aim.z);
    if (d < bd) { bd = d; best = e; }
  }
  const p = best ? best.pos.clone() : aim.clone();
  const off = p.clone().sub(h.pos).setY(0);
  if (off.length() > 45) p.copy(h.pos).addScaledVector(off.normalize(), 45);
  p.y = g.world.heightAt(p.x, p.z);
  return { pos: p, follow: best };
}

function dropTheBell(h: Hero, g: Game) {
  const { pos, follow } = bellTarget(h, g);
  const bell = buildBell();
  const pivot = new THREE.Group();
  pivot.add(bell);
  const HANG = 15; // hanging point height above the ground while it swings
  pivot.position.set(pos.x, pos.y + HANG + 22, pos.z);
  g.scene.add(pivot);
  g.play('emcCharge', pos, 0.5);
  if (h.isLocal) g.events.onAnnounce('THE BELL', 'It tolls for them', 'red');
  else if (g.local && g.local.team !== h.team && follow === g.local) g.events.onAnnounce('THE BELL TOLLS', 'Move!', 'red');
  let phase: 'descend' | 'swing' | 'fall' | 'landed' = 'descend';
  let vy = 0, rang = false, landT = 0;
  const groundAt = pos.clone();
  const zone: Zone = {
    owner: h, team: h.team, pos: groundAt, radius: 6, t: 0, dur: 6.5, dead: false, kind: 'theBell',
    update(z, g, dt) {
      // doom sky: dark & sickly green while the bell is up, fading after it lands
      const doom = phase === 'landed' ? Math.max(0, 1 - (landT - 0.6) / 1.6) : Math.min(1, z.t / 0.6);
      g.doom = Math.max(g.doom, doom);
      // track the victim until it starts to swing down
      if (follow && follow.alive && z.t < 1.45) {
        groundAt.x += (follow.pos.x - groundAt.x) * Math.min(1, dt * 3.5);
        groundAt.z += (follow.pos.z - groundAt.z) * Math.min(1, dt * 3.5);
        groundAt.y = g.world.heightAt(groundAt.x, groundAt.z);
      }
      // warning circle
      if (phase !== 'landed' && Math.random() < dt * 10) {
        g.vfx.add.spawn({ x: groundAt.x, y: groundAt.y + 0.06, z: groundAt.z, r: DOOM.r, g: DOOM.g, b: DOOM.b, size: 6.2 * 0.2, grow: 10, life: 0.5, shape: Shape.Ring, flat: true, aux: 0.05, fadeIn: 0.05, rot: 0 });
      }
      if (phase === 'descend') {
        const k = Math.min(1, z.t / 0.75);
        const e = 1 - Math.pow(1 - k, 3);
        pivot.position.set(groundAt.x, groundAt.y + HANG + 22 * (1 - e), groundAt.z);
        if (k >= 1) phase = 'swing';
      } else if (phase === 'swing') {
        const s = Math.min(1, (z.t - 0.75) / 1.0);
        pivot.position.set(groundAt.x, groundAt.y + HANG, groundAt.z);
        pivot.rotation.z = Math.sin(s * TAU) * 0.5 * (1 - s * 0.3);
        if (!rang && s > 0.27) {
          rang = true;
          const mouth = _v1.copy(pivot.position).setY(pivot.position.y - 4.5);
          g.play('bigBell', mouth, 1.6);
          g.vfx.flash(mouth, new THREE.Color(0.5, 1.6, 0.6), 120, 1.2, 40);
          for (let i = 0; i < 3; i++) g.vfx.add.spawn({ x: mouth.x, y: mouth.y, z: mouth.z, r: DOOM.r, g: DOOM.g, b: DOOM.b, size: 1.2 + i, grow: 12, life: 0.9 + i * 0.25, shape: Shape.Ring, aux: 0.04, fadeIn: 0.01, rot: 0 });
          g.shake(groundAt, 0.5, 60);
        }
        if (s >= 1) { phase = 'fall'; pivot.rotation.z = 0; }
      } else if (phase === 'fall') {
        vy += 70 * dt;
        pivot.position.y -= vy * dt;
        if (pivot.position.y - 5.4 <= groundAt.y) {
          pivot.position.y = groundAt.y + 5.4 - 0.25;
          phase = 'landed';
          landT = 0;
          impact(h, g, groundAt);
        }
      } else {
        landT += dt;
        if (landT > 2.2) pivot.position.y -= dt * 2.5; // sink into the earth
        if (landT > 3.2) z.t = z.dur;
      }
    },
    dispose(_z, g) { g.scene.remove(pivot); },
  };
  g.addZone(zone);
}

function impact(h: Hero, g: Game, at: THREE.Vector3) {
  const R = 6;
  for (const e of g.enemiesNear(h.team, at, R)) {
    const d = Math.hypot(e.pos.x - at.x, e.pos.z - at.z);
    const dmg = Math.round(230 - 110 * Math.min(1, d / R));
    const out = _v1.copy(e.pos).sub(at).setY(0);
    if (out.lengthSq() < 0.01) out.set(1, 0, 0);
    g.damage(e, dmg, h, { knock: out.normalize().multiplyScalar(9).setY(9) });
  }
  g.play('bellDrop', at, 1.5);
  g.play('bigBell', at, 0.9);
  g.vfx.shockwave(at, DOOM, 14, 0.8, 0.1);
  g.vfx.shockwave(at, new THREE.Color(3, 2.4, 1.2), 9, 0.5, 0.18);
  g.vfx.smoke(at, new THREE.Color(0.5, 0.45, 0.38), 40, 2.2, 1.8, 0.65);
  g.vfx.burst(at.clone().setY(at.y + 0.5), new THREE.Color(1.5, 1.2, 0.6), 80, 16, 0.14, 0.8, { gravity: 18 });
  g.vfx.sparks(at.clone().setY(at.y + 0.3), new THREE.Color(3, 2.5, 1), 50, 16);
  g.vfx.flash(at.clone().setY(at.y + 2), new THREE.Color(1, 1.3, 0.6), 140, 0.8, 30);
  g.shake(at, 1, 45);
}

function buildYeat(r: RigBuilder) {
  r.base({ skin: '#d9a886', shirt: '#121216', pants: '#1d1d24', shoes: '#f1f1f1', sleeves: '#121216', torsoScale: [1.15, 1.05, 1.2], legR: 0.09, armR: 0.072, shoeScale: 1.3, eyes: false });
  const puffer = r.mat('#0e0e12', 0.32, 0.1);
  const gold = r.mat('#ffcf5a', 0.22, 1);
  const red = r.mat('#c0122c', 0.7);
  const shades = r.mat('#050507', 0.08, 0.9);
  const sole = r.mat('#d4142e', 0.5);
  // puffer jacket: stacked quilted rings
  for (let i = 0; i < 5; i++) {
    const y = 0.02 + i * 0.075;
    const rad = 0.2 - Math.abs(i - 2) * 0.012;
    r.add(r.spine, new THREE.TorusGeometry(rad, 0.045, 8, 24), puffer, [0, y, 0], [Math.PI / 2, 0, 0], [1.08, 0.82, 1]);
  }
  r.add(r.chest, new THREE.TorusGeometry(0.11, 0.05, 8, 20), puffer, [0, 0.1, 0], [Math.PI / 2, 0, 0]); // high collar
  for (const sh of [r.shoulderL, r.shoulderR]) {
    for (let i = 0; i < 3; i++) r.add(sh, new THREE.TorusGeometry(0.075, 0.035, 6, 16), puffer, [0, -0.05 - i * 0.085, 0], [Math.PI / 2, 0, 0]);
  }
  for (const el of [r.elbowL, r.elbowR]) for (let i = 0; i < 2; i++) r.add(el, new THREE.TorusGeometry(0.068, 0.032, 6, 16), puffer, [0, -0.04 - i * 0.09, 0], [Math.PI / 2, 0, 0]);
  // chains + bell pendant
  r.add(r.chest, new THREE.TorusGeometry(0.13, 0.012, 6, 32), gold, [0, 0.06, 0.04], [Math.PI / 2 - 0.5, 0, 0], [1, 1.25, 1]);
  r.add(r.chest, new THREE.TorusGeometry(0.15, 0.016, 6, 32), gold, [0, 0.02, 0.05], [Math.PI / 2 - 0.65, 0, 0], [1, 1.35, 1]);
  r.add(r.chest, new THREE.ConeGeometry(0.04, 0.06, 12, 1, true), gold, [0, -0.11, 0.19], [0.3, 0, 0]);
  r.add(r.chest, r.sphere(0.012, 6, 4), gold, [0, -0.145, 0.2]);
  // beanie
  r.add(r.head, r.sphere(0.128, 18, 12, ), red, [0, 0.11, -0.005], [0, 0, 0], [1.02, 0.85, 1.05]);
  r.add(r.head, new THREE.TorusGeometry(0.118, 0.025, 6, 24), red, [0, 0.075, 0], [Math.PI / 2, 0, 0], [1, 1.02, 1]);
  r.add(r.head, r.sphere(0.03, 8, 6), red, [0, 0.215, -0.01]);
  // wrap shades
  r.add(r.head, new THREE.TorusGeometry(0.11, 0.022, 6, 20, Math.PI * 0.9), shades, [0, 0.08, 0.005], [Math.PI / 2, 0, Math.PI * 0.05], [1, 1.05, 0.9]);
  // rings on fingers + chunky sole accents
  r.add(r.handR, r.sphere(0.02, 6, 4), gold, [0.02, -0.05, 0.02]);
  r.add(r.handL, r.sphere(0.02, 6, 4), gold, [-0.02, -0.05, 0.02]);
  for (const ft of [r.footL, r.footR]) r.add(ft, new THREE.BoxGeometry(0.13, 0.04, 0.3), sole, [0, -0.065, 0.06]);
}

export const YEAT: HeroDef = {
  id: 'yeat',
  name: 'Yeat',
  title: 'The Rage Icon',
  role: 'Vanguard',
  tagline: 'Twizzy rich. Bells ringing. Rage on.',
  color: '#ff3d7f',
  accent: '#ffcf5a',
  maxHp: 350,
  modelUrl: '/models/heroes/yeat.glb',
  held: { prop: 'golden_bell', hand: 'R', size: 0.15, pos: [0, -0.1, 0.03], rot: [0, 0, 0], ring: true },
  speed: 6.3,
  secondaryCd: 9,
  ultCost: 1350,
  botRange: 6,
  ratings: { damage: 0.75, mobility: 0.8, support: 0.1, difficulty: 0.35 },
  abilities: {
    primary: { key: 'LMB', name: 'Bell Ring', desc: 'Blast a spread of golden sound rings. Brutal up close, falls off at range.', stat: '7 × 10 dmg · close range', icon: ICONS.bell },
    secondary: { key: 'RMB', name: 'Tonka', desc: 'Turn into a speeding toy truck that keeps accelerating but turns wide. Ram an enemy for massive damage.', stat: 'up to 140 dmg · 4.5 s · 9 s cd', icon: ICONS.tonka },
    ult: { key: 'SHIFT', name: 'The Bell', desc: 'The sky turns dark and green as a colossal bell appears above your target, tolls once, then crashes down.', stat: '230 dmg center · 6 m', icon: ICONS.theBell },
  },
  look: { build: buildYeat },
  createKit: () => new YeatKit(),
};

export function warmupYeat(g: Game): THREE.Object3D[] {
  g.pool('bellRing', ringPool);
  return [buildTruck(), buildBell()];
}
