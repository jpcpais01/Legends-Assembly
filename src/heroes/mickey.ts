import * as THREE from 'three';
import type { HeroDef, HeroKit, Projectile, Zone } from '../game/types';
import type { Hero } from '../game/Hero';
import type { Game } from '../game/Game';
import { InstancedPool } from '../vfx/Vfx';
import { Shape } from '../vfx/Particles';
import { rand, TAU, _m1, _q1, _v1 } from '../core/math';
import type { RigBuilder } from '../render/HeroRig';
import { ICONS } from './icons';
import { PROPS, propMesh } from '../render/props';
import { audio, type LoopHandle } from '../core/Audio';
import { screenFx } from '../vfx/ScreenFx';
import { TrailStyle, type Trail } from '../vfx/Trails';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Mickey Mouse, as he first appeared in 1928 (the public-domain Steamboat Willie design).
 *
 *  LMB  Spud Shot        lobbed potatoes that land on the crosshair, bonk heads and bounce once
 *  RMB  Portable Hole    slap an ink hole on the floor, dive in, burrow to the aim point and pop out with a stomp
 *  SHIFT Steamboat Willie the world turns into a 1928 black-and-white cartoon and a giant steamboat ploughs
 *                        through everyone in front of him
 */

const CREAM = new THREE.Color(3, 2.8, 2.4);
const INK = new THREE.Color(0.012, 0.012, 0.014);
const SPUD_C = new THREE.Color(0.55, 0.37, 0.18);
const SPUD_IN = new THREE.Color(0.95, 0.85, 0.55);
const STAR = new THREE.Color(3.4, 3.1, 1.6);
const STEAM = new THREE.Color(0.92, 0.92, 0.9);
const _up = new THREE.Vector3(0, 1, 0);
const _ax = new THREE.Vector3();
const _sc = new THREE.Vector3();

// ───────────────────────── Spud Shot ─────────────────────────
const SPUD_SPEED = 48;
const SPUD_G = 11;
const SPUD_DMG = 38;
const SPUD_SIZE = 0.15;

let spudGeo: THREE.BufferGeometry | null = null;
/** Lumpy cartoon potato with a few dark eyes (vertex colors). Swapped for the Meshy `potato` when it lands. */
function potatoGeometry() {
  if (spudGeo) return spudGeo;
  const g = new THREE.IcosahedronGeometry(1, 3);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const eyes = [new THREE.Vector3(0.7, 0.5, 0.5), new THREE.Vector3(-0.5, 0.2, 0.84), new THREE.Vector3(0.1, -0.8, 0.6), new THREE.Vector3(-0.6, 0.6, -0.5)].map((e) => e.normalize());
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const lump = 1 + Math.sin(v.x * 4.1 + v.y * 2.3) * 0.06 + Math.sin(v.z * 5.2 - v.x * 1.7) * 0.05 + Math.sin(v.y * 7.3) * 0.025;
    let eye = 0;
    for (const e of eyes) eye = Math.max(eye, Math.max(0, v.dot(e) - 0.95) * 20);
    const r = lump * (1 - eye * 0.07);
    pos.setXYZ(i, v.x * r * 1.32, v.y * r * 0.92, v.z * r);
    const speck = 0.92 + Math.sin(v.x * 31 + v.y * 17) * Math.sin(v.z * 23) * 0.08;
    const dark = 1 - eye * 0.55;
    col[i * 3] = 0.62 * speck * dark; col[i * 3 + 1] = 0.42 * speck * dark; col[i * 3 + 2] = 0.21 * speck * dark;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  spudGeo = g;
  return g;
}
function spudPool() {
  const t = PROPS.potato;
  if (t) {
    // the Meshy potato: centered, longest side 2 so it matches the procedural one's radius-1 scale
    const geo = t.geometry.clone().translate(0, -t.size.y / 2, 0);
    geo.scale(2 / Math.max(t.size.x, t.size.y, t.size.z), 2 / Math.max(t.size.x, t.size.y, t.size.z), 2 / Math.max(t.size.x, t.size.y, t.size.z));
    return new InstancedPool(geo, t.material, 64);
  }
  return new InstancedPool(potatoGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 }), 64);
}

/** A cartoon impact: white star flash, dizzy stars circling up from the head, potato chunks. */
function bonkFx(g: Game, at: THREE.Vector3, big: boolean) {
  g.vfx.p({ x: at.x, y: at.y, z: at.z, r: STAR.r, g: STAR.g, b: STAR.b, size: big ? 0.75 : 0.5, grow: 1.7, life: 0.13, shape: Shape.Star, rot: rand(0, TAU) });
  g.vfx.flare(at, CREAM, big ? 1.3 : 0.8, 0.07, rand(-0.3, 0.3));
  g.vfx.debris(at, SPUD_C, big ? 7 : 4, 5, 0.06, 4);
  g.vfx.debris(at, SPUD_IN, 3, 4, 0.05, 3);
  const n = big ? 5 : 3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    g.vfx.p({ x: at.x + Math.cos(a) * 0.3, y: at.y + 0.15, z: at.z + Math.sin(a) * 0.3, vx: -Math.sin(a) * 2.2, vy: rand(0.6, 1.2), vz: Math.cos(a) * 2.2, r: STAR.r, g: STAR.g, b: STAR.b, size: rand(0.12, 0.18), life: rand(0.55, 0.8), drag: 2, shape: Shape.Star, spin: rand(4, 8), fadeIn: 0.05 });
  }
}

function throwSpud(g: Game, h: Hero, pos: THREE.Vector3, vel: THREE.Vector3, bounces: number, damage: number, trail: Trail | null) {
  const spin = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
  const spinRate = rand(14, 20);
  const tilt = rand(0, TAU);
  trail?.push(pos);
  g.spawnProjectile({
    owner: h, kind: 'spud', pos: pos.clone(), vel, gravity: SPUD_G, radius: 0.2, life: 2.4, damage, color: SPUD_C,
    render(p, g) {
      _q1.setFromAxisAngle(spin, tilt + p.age * spinRate);
      g.pool('spud', spudPool).add(_m1.compose(p.pos, _q1, _sc.setScalar(SPUD_SIZE)));
      trail?.push(p.pos);
    },
    onExpire() { trail?.stop(); },
    onHit(p, g, hit, point) {
      trail?.push(point);
      if (hit) {
        trail?.stop();
        const crit = point.y > hit.pos.y + 1.42;
        g.damage(hit, p.damage, p.owner, { crit, at: point, fx: false, knock: _v1.copy(p.vel).setY(0).normalize().multiplyScalar(1.6) });
        g.play('spudBonk', point, crit ? 0.95 : 0.75, { variant: crit ? 3 : Math.floor(Math.random() * 3) });
        bonkFx(g, point, crit);
        // the odd lettered BONK! (always on a headshot): rare enough to stay a treat
        if (p.owner.isLocal && (crit || Math.random() < 0.22)) g.vfx.glyph('BONK!', point.clone().setY(point.y + 0.6), { color: '#fff6dc', glow: '#ff5a4e', scale: crit ? 1.15 : 0.85, dur: 0.6, vy: 1.4 });
        return;
      }
      const speed = p.vel.length();
      if (bounces > 0 && speed > 7) {
        // floor or wall: the floor sits right under the hit point
        const floorY = g.world.heightAt(point.x, point.z, point.y + 0.4);
        const n = Math.abs(point.y - floorY) < 0.35 ? _up : _ax.copy(p.vel).setY(0).normalize().negate();
        const v = p.vel.clone();
        v.addScaledVector(n, -2 * v.dot(n)).multiplyScalar(0.62);
        if (n === _up) v.y = Math.max(v.y, 4.5);
        g.play('spudBounce', point, 0.6);
        g.vfx.dust(point, 2, 0.35, 0.28, 1);
        g.vfx.p({ x: point.x, y: point.y + 0.04, z: point.z, r: 1.6, g: 1.5, b: 1.3, size: 0.3, grow: 3, life: 0.2, shape: Shape.Ring, flat: n === _up, aux: 0.18 });
        throwSpud(g, p.owner, point.clone().addScaledVector(n, 0.2), v, bounces - 1, Math.round(p.damage * 0.75), trail);
        return;
      }
      trail?.stop();
      // a dud: it splits on the floor
      g.play('spudBonk', point, 0.35, { variant: 1 });
      g.vfx.debris(point, SPUD_C, 6, 4, 0.07, 3);
      g.vfx.debris(point, SPUD_IN, 4, 3, 0.05, 3);
      g.vfx.dust(point, 2, 0.4, 0.3, 1.2);
    },
  } as Omit<Projectile, 'prev' | 'age' | 'dead' | 'seed'>);
}

// ───────────────────────── Portable Hole ─────────────────────────
const HOLE_MAX = 16;
const HOLE_MIN = 3;
const DIVE = 0.3;
const POP_R = 3.2;

interface HoleState {
  phase: 'dive' | 'tunnel' | 'pop';
  t: number;
  to: THREE.Vector3;
  dir: THREE.Vector3;
  tunnelT: number;
  speed: number;
  exitOpen: boolean;
  dustT: number;
  rumble: LoopHandle | null;
}

let holeMat: THREE.MeshBasicMaterial | null = null;
let rimMat: THREE.MeshBasicMaterial | null = null;
const holeGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
const rimGeo = new THREE.RingGeometry(0.93, 1.08, 40).rotateX(-Math.PI / 2);
/** A flat black cartoon hole that springs open, sits, and snaps shut. */
function openHole(g: Game, h: Hero, at: THREE.Vector3, life: number, radius = 0.95) {
  holeMat ??= new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  rimMat ??= new THREE.MeshBasicMaterial({ color: 0x23211f, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const grp = new THREE.Group();
  const disc = new THREE.Mesh(holeGeo, holeMat), rim = new THREE.Mesh(rimGeo, rimMat);
  disc.renderOrder = 3; rim.renderOrder = 2;
  grp.add(rim, disc);
  grp.position.set(at.x, at.y + 0.025, at.z);
  grp.scale.setScalar(0.001);
  g.scene.add(grp);
  const zone: Zone = {
    owner: h, team: h.team, pos: at.clone(), radius, t: 0, dur: life, dead: false, kind: 'portableHole',
    update(z) {
      // springy open (overshoot), then a snap shut over the last 0.18 s
      const o = Math.min(1, z.t / 0.16);
      const open = 1 + Math.sin(o * Math.PI) * 0.25 * (1 - o) - (1 - o) * (1 - o);
      const close = Math.min(1, Math.max(0, (z.dur - z.t) / 0.18));
      const s = Math.max(0.001, radius * Math.max(0, open) * close);
      grp.scale.set(s, 1, s * 0.82);
      grp.rotation.y = h.bodyYaw;
    },
    dispose(_z, g) { g.scene.remove(grp); },
  };
  g.addZone(zone);
  g.vfx.dustRing(at, radius * 0.9, 12, 0.4, 0.3);
  return zone;
}

function holeTarget(h: Hero, g: Game) {
  const from = h.pos;
  const d = new THREE.Vector3(h.input.aim.x - from.x, 0, h.input.aim.z - from.z);
  let len = d.length();
  if (len < 0.5 || h.input.aim.y > from.y + 6) { d.copy(h.forward); len = HOLE_MAX; } else d.multiplyScalar(1 / len);
  len = THREE.MathUtils.clamp(len, HOLE_MIN, HOLE_MAX);
  // stop short of walls (the burrow can't go through them)
  const a = _v1.copy(from).setY(from.y + 0.6);
  const b = from.clone().addScaledVector(d, len).setY(from.y + 0.6);
  const t = g.world.raycast(a, b, 0.3);
  if (t >= 0) len = Math.max(HOLE_MIN * 0.5, len * t - 0.7);
  const to = from.clone().addScaledVector(d, len);
  to.y = g.world.heightAt(to.x, to.z, from.y + 1.2);
  return { to, dir: d, len };
}

function startHole(h: Hero, g: Game) {
  const { to, dir, len } = holeTarget(h, g);
  const tunnelT = THREE.MathUtils.clamp(len / 40, 0.16, 0.4);
  const st: HoleState = { phase: 'dive', t: 0, to, dir, tunnelT, speed: len / tunnelT, exitOpen: false, dustT: 0, rumble: null };
  h.kitState.hole = st;
  h.channel = DIVE + tunnelT + 0.05;
  h.moveLock = h.channel;
  h.overrideVel = (h.overrideVel ?? new THREE.Vector3()).set(0, -3, 0);
  openHole(g, h, h.pos.clone(), DIVE + tunnelT + 0.5);
  g.play('holeDive', h.pos, 0.9);
  // he whips the hole out of his pocket and slaps it down: a puff of ink
  for (let i = 0; i < 10; i++) {
    const a = rand(0, TAU);
    g.vfx.pa({ x: h.pos.x + Math.cos(a) * 0.5, y: h.pos.y + 0.1, z: h.pos.z + Math.sin(a) * 0.5, vx: Math.cos(a) * 3, vy: rand(1.5, 3.5), vz: Math.sin(a) * 3, r: INK.r, g: INK.g, b: INK.b, a: 0.9, size: rand(0.07, 0.13), life: rand(0.35, 0.55), gravity: 12, shape: Shape.Dot });
  }
  if (h.isLocal) { g.camRig.shake(0.08); screenFx.zoomPunch(0.2); }
}

function updateHole(h: Hero, g: Game, dt: number) {
  const st = h.kitState.hole as HoleState;
  st.t += dt;
  const root = h.model.root;
  if (st.phase === 'dive') {
    // squash in anticipation, then stretch and get sucked down through the hole
    h.dmgTakenMult = st.t > DIVE * 0.5 ? 0 : 1;
    const k = st.t / DIVE;
    let sy = 1, sxz = 1;
    if (k < 0.3) { const a = k / 0.3; sy = 1 - 0.22 * Math.sin(a * Math.PI * 0.5); sxz = 1 + 0.16 * Math.sin(a * Math.PI * 0.5); }
    else { const a = (k - 0.3) / 0.7; sy = (1.25 - a * 0.3) * (1 - a * a); sxz = 0.85 - a * 0.35; }
    root.scale.set(sxz, Math.max(0.001, sy), sxz);
    if (st.t >= DIVE) {
      st.phase = 'tunnel'; st.t = 0;
      root.visible = false;
      h.overrideVel!.set(st.dir.x * st.speed, -3, st.dir.z * st.speed);
      g.play('holeTravel', h.pos, 0.7);
    }
    return;
  }
  if (st.phase === 'tunnel') {
    h.dmgTakenMult = 0;
    // the burrow races under the floor: a mound of dust and ink speckles on the way
    st.dustT -= dt;
    if (st.dustT <= 0) {
      st.dustT = 0.03;
      g.vfx.dust(h.pos, 1, 0.45, 0.3, 0.6);
      g.vfx.pa({ x: h.pos.x + rand(-0.25, 0.25), y: h.pos.y + 0.03, z: h.pos.z + rand(-0.25, 0.25), r: INK.r, g: INK.g, b: INK.b, a: 0.55, size: rand(0.25, 0.4), life: 1.6, hold: 0.4, shape: Shape.Splat, flat: true, rot: rand(0, TAU), aux: Math.random() });
    }
    if (!st.exitOpen && st.t > st.tunnelT - 0.12) { st.exitOpen = true; openHole(g, h, st.to, 0.8, 1.05); }
    if (st.t >= st.tunnelT) popOut(h, g, st);
    return;
  }
  // pop: a damped spring from squashed to stretched and back to normal
  const k = st.t;
  const sy = 1 + Math.sin(k * 15) * Math.exp(-k * 5.5) * 0.45 + (k < 0.06 ? -0.5 * (1 - k / 0.06) : 0);
  const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
  root.scale.set(sxz, Math.max(0.2, sy), sxz);
  if (k > 0.8) { root.scale.set(1, 1, 1); h.kitState.hole = null; }
}

function popOut(h: Hero, g: Game, st: HoleState) {
  st.phase = 'pop'; st.t = 0;
  h.overrideVel = null;
  h.channel = 0; h.moveLock = 0;
  h.model.root.visible = true;
  h.pos.x = st.to.x; h.pos.z = st.to.z;
  h.vel.set(st.dir.x * 2, 11, st.dir.z * 2);
  h.grounded = false;
  const at = st.to;
  g.play('holePop', at, 1);
  // the stomp: everyone near the exit gets bonked into the air
  for (const e of g.enemiesNear(h.team, at, POP_R)) {
    const out = _v1.copy(e.pos).sub(at).setY(0);
    if (out.lengthSq() < 0.01) out.copy(st.dir);
    g.damage(e, 45, h, { knock: out.normalize().multiplyScalar(6).setY(8), at: e.chest });
    bonkFx(g, e.chest.setY(e.pos.y + 1.6), true);
    g.voice.say(h, 'secondaryHit');
  }
  g.vfx.shockwave(at, CREAM, POP_R + 0.5, 0.35, 0.12);
  g.vfx.dustRing(at, 1.2, 18, 0.7, 0.4);
  g.vfx.flare(_v1.copy(at).setY(at.y + 0.8), CREAM, 2.4, 0.12);
  for (let i = 0; i < 16; i++) {
    const a = rand(0, TAU), sp = rand(2, 5);
    g.vfx.pa({ x: at.x, y: at.y + 0.2, z: at.z, vx: Math.cos(a) * sp, vy: rand(3, 7), vz: Math.sin(a) * sp, r: INK.r, g: INK.g, b: INK.b, a: 0.95, size: rand(0.07, 0.15), life: rand(0.5, 0.8), gravity: 16, shape: Shape.Dot });
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    g.vfx.p({ x: at.x, y: at.y + 0.6, z: at.z, vx: Math.cos(a) * 3.5, vy: rand(2, 4), vz: Math.sin(a) * 3.5, r: STAR.r, g: STAR.g, b: STAR.b, size: rand(0.18, 0.26), life: 0.55, drag: 2.2, shape: Shape.Star, spin: rand(-8, 8) });
  }
  if (h.isLocal) { g.camRig.shake(0.18); g.camRig.kick(4); screenFx.ripple(_v1.copy(at).setY(at.y + 0.5), 3.5, 0.6, 0.35); }
  g.vfx.glyph('POP!', _v1.copy(at).setY(at.y + 2.4), { color: '#fff6dc', glow: '#ff5a4e', scale: 1.1, dur: 0.6, vy: 1.6 });
}

function endHole(h: Hero) {
  const st = h.kitState.hole as HoleState | null;
  if (!st) return;
  st.rumble?.stop(0.1);
  h.kitState.hole = null;
  h.overrideVel = null;
  h.model.root.scale.set(1, 1, 1);
  h.model.root.visible = true;
}

// ───────────────────────── Steamboat Willie ─────────────────────────
const BOAT_SPEED = 26;
const BOAT_BEHIND = 26;
const BOAT_AHEAD = 58;
const BOAT_W = 7.2;
const BOAT_L = 15;
const BOAT_H = 11;
/** Turn the delivered Meshy boat to face +z (set once the model's orientation is known). */
const STEAMBOAT_YAW = 0;
const BOAT_DMG = 180;

interface Boat { group: THREE.Group; wheels: THREE.Object3D[]; stacks: THREE.Object3D[]; stackTops: THREE.Object3D[]; whistle: THREE.Object3D | null }

let boatTemplate: THREE.Group | null = null;
/** Bakes a group's direct mesh children into one mesh per material (the boat is ~80 parts: this keeps it to a handful of draws). */
function mergeByMaterial(parent: THREE.Object3D) {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const o of [...parent.children]) {
    const m = o as THREE.Mesh;
    if (!m.isMesh) continue;
    m.updateMatrix();
    const g = m.geometry.clone().applyMatrix4(m.matrix);
    const mat = m.material as THREE.Material;
    byMat.set(mat, [...(byMat.get(mat) ?? []), g]);
    parent.remove(m);
  }
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    parent.add(mesh);
  }
}
/** Chubby 1920s river steamboat, faces +z. Stand-in until the Meshy `steamboat` is delivered. */
function buildBoat(): Boat {
  const meshy = propMesh('steamboat', BOAT_H);
  if (meshy) {
    meshy.rotation.y = STEAMBOAT_YAW;
    const group = new THREE.Group();
    group.add(meshy);
    const top = new THREE.Object3D(); top.position.set(0, BOAT_H * 0.95, -BOAT_L * 0.1); group.add(top);
    return { group, wheels: [], stacks: [], stackTops: [top], whistle: top };
  }
  if (!boatTemplate) {
    const t = new THREE.Group();
    const M = (c: number, rough = 0.55, metal = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
    const hullM = M(0x141416, 0.4), creamM = M(0xe9dfc8, 0.6), darkM = M(0x2a2826, 0.6), blackM = M(0x070708, 0.35), brass = M(0xb08a3c, 0.3, 1), redM = M(0x9a2a22, 0.5);
    const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, p: [number, number, number], r: [number, number, number] = [0, 0, 0], s: [number, number, number] = [1, 1, 1], parent: THREE.Object3D = t) => {
      const o = new THREE.Mesh(geo, m); o.position.set(...p); o.rotation.set(...r); o.scale.set(...s); o.castShadow = true; parent.add(o); return o;
    };
    // hull: a fat rounded tub, a cream stripe at the waterline, a white deck with a rail
    mesh(new THREE.SphereGeometry(1, 40, 24), hullM, [0, 1.0, 0], [0, 0, 0], [3.3, 2.1, 7.5]);
    mesh(new THREE.TorusGeometry(1, 0.05, 8, 64), creamM, [0, 1.55, 0], [Math.PI / 2, 0, 0], [3.25, 7.4, 1]);
    mesh(new THREE.CylinderGeometry(1, 1, 0.3, 48), creamM, [0, 2.95, 0], [0, 0, 0], [2.95, 1, 6.7]);
    mesh(new THREE.TorusGeometry(1, 0.07, 6, 64), creamM, [0, 3.55, 0], [Math.PI / 2, 0, 0], [2.95, 6.7, 1]);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 5), creamM, [Math.cos(a) * 2.95, 3.25, Math.sin(a) * 6.7]);
    }
    // main cabin with round portholes
    mesh(new THREE.BoxGeometry(4.4, 2.1, 7.2), creamM, [0, 4.15, -0.6]);
    mesh(new THREE.BoxGeometry(4.9, 0.25, 7.9), darkM, [0, 5.3, -0.6]);
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
      mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 20), blackM, [sx * 2.22, 4.25, -3 + i * 1.6], [0, 0, Math.PI / 2]);
      mesh(new THREE.TorusGeometry(0.34, 0.07, 6, 20), brass, [sx * 2.24, 4.25, -3 + i * 1.6], [0, Math.PI / 2, 0]);
    }
    // life rings on the cabin
    for (const sx of [-1, 1]) {
      mesh(new THREE.TorusGeometry(0.42, 0.13, 8, 20), creamM, [sx * 2.28, 4.0, 2.4], [0, Math.PI / 2, 0]);
      for (let k = 0; k < 4; k++) mesh(new THREE.TorusGeometry(0.42, 0.14, 8, 4, 0.35), redM, [sx * 2.29, 4.0, 2.4], [k * Math.PI / 2, Math.PI / 2, 0]);
    }
    // pilot house up front, a brass steam whistle on its roof
    mesh(new THREE.BoxGeometry(2.6, 1.9, 2.4), creamM, [0, 6.4, 1.6]);
    mesh(new THREE.BoxGeometry(3.0, 0.22, 2.9), darkM, [0, 7.45, 1.6]);
    for (const sx of [-1, 0, 1]) mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 18), blackM, [sx * 0.8, 6.55, 2.82], [Math.PI / 2, 0, 0]);
    const whistle = new THREE.Group(); whistle.position.set(0, 7.55, 1.6); t.add(whistle); whistle.name = 'whistle';
    mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 12), brass, [0, 0.45, 0], [0, 0, 0], [1, 1, 1], whistle);
    mesh(new THREE.SphereGeometry(0.2, 12, 8), brass, [0, 0.95, 0], [0, 0, 0], [1, 1, 1], whistle);
    // two tall smokestacks leaning back, each its own pivot so it can squash and stretch on the chug
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(sx * 0.95, 5.4, -1.6); pivot.rotation.x = -0.2; pivot.name = 'stack';
      t.add(pivot);
      mesh(new THREE.CylinderGeometry(0.5, 0.66, 4.6, 24), blackM, [0, 2.3, 0], [0, 0, 0], [1, 1, 1], pivot);
      mesh(new THREE.CylinderGeometry(0.74, 0.52, 0.55, 24), blackM, [0, 4.75, 0], [0, 0, 0], [1, 1, 1], pivot);
      mesh(new THREE.TorusGeometry(0.72, 0.08, 6, 24), creamM, [0, 5.02, 0], [Math.PI / 2, 0, 0], [1, 1, 1], pivot);
      mesh(new THREE.TorusGeometry(0.58, 0.07, 6, 24), creamM, [0, 3.6, 0], [Math.PI / 2, 0, 0], [1, 1, 1], pivot);
      const top = new THREE.Object3D(); top.position.set(0, 5.1, 0); top.name = 'stackTop'; pivot.add(top);
    }
    // side paddle wheels in arched housings
    for (const sx of [-1, 1]) {
      mesh(new THREE.CylinderGeometry(2.45, 2.45, 1.05, 32, 1, false, 0, Math.PI), creamM, [sx * 3.25, 2.3, -2.6], [Math.PI / 2, 0, Math.PI / 2 * sx], [1, 1, 1]);
      const w = new THREE.Group(); w.position.set(sx * 3.35, 2.1, -2.6); w.name = 'wheel'; t.add(w);
      mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.12, 28), darkM, [0, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1], w);
      mesh(new THREE.TorusGeometry(2.15, 0.1, 6, 32), redM, [0, 0, 0], [0, Math.PI / 2, 0], [1, 1, 1], w);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        mesh(new THREE.BoxGeometry(0.85, 0.12, 1.1), creamM, [0, Math.cos(a) * 1.75, Math.sin(a) * 1.75], [-a, 0, 0], [1, 1, 1], w);
      }
      mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 14), brass, [0, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1], w);
    }
    // bow: a little flag pole and a rope coil
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6), darkM, [0, 4.1, 6.4]);
    mesh(new THREE.BoxGeometry(0.04, 0.6, 0.9), creamM, [0, 4.85, 6.85]);
    mergeByMaterial(t);
    t.traverse((o) => { if (o !== t && (o.name === 'wheel' || o.name === 'stack' || o.name === 'whistle')) mergeByMaterial(o); });
    boatTemplate = t;
  }
  const group = new THREE.Group();
  const inst = boatTemplate.clone();
  group.add(inst);
  const wheels: THREE.Object3D[] = [], stacks: THREE.Object3D[] = [], stackTops: THREE.Object3D[] = [];
  let whistle: THREE.Object3D | null = null;
  inst.traverse((o) => {
    if (o.name === 'wheel') wheels.push(o);
    else if (o.name === 'stack') stacks.push(o);
    else if (o.name === 'stackTop') stackTops.push(o);
    else if (o.name === 'whistle') whistle = o;
  });
  return { group, wheels, stacks, stackTops, whistle };
}

/** Big dark cartoon smoke puff (alpha). */
function smokePuff(g: Game, p: THREE.Vector3, vx: number, vy: number, vz: number, size: number) {
  const c = Math.random() < 0.5 ? 0.04 : 0.09;
  g.vfx.pa({ x: p.x, y: p.y, z: p.z, vx, vy, vz, r: c, g: c, b: c * 1.05, a: 0.85, size, grow: 2.6, life: rand(1.3, 1.8), drag: 1.4, shape: Shape.Smoke, spin: rand(-0.8, 0.8), rot: rand(0, TAU), fadeIn: 0.05 });
}

function steamJet(g: Game, p: THREE.Vector3, k = 1) {
  for (let i = 0; i < 6 * k; i++) {
    g.vfx.pa({ x: p.x + rand(-0.1, 0.1), y: p.y, z: p.z + rand(-0.1, 0.1), vx: rand(-0.8, 0.8), vy: rand(6, 10), vz: rand(-0.8, 0.8), r: STEAM.r, g: STEAM.g, b: STEAM.b, a: 0.6, size: rand(0.4, 0.7), grow: 3, life: rand(0.6, 0.9), drag: 2.4, shape: Shape.Smoke, spin: rand(-1, 1), rot: rand(0, TAU), fadeIn: 0.03 });
  }
}

function launchSteamboat(h: Hero, g: Game) {
  const dir = h.forward;
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const origin = h.pos.clone();
  const boat = buildBoat();
  const heading = Math.atan2(dir.x, dir.z);
  const start = origin.clone().addScaledVector(dir, -BOAT_BEHIND);
  boat.group.position.copy(start).setY(g.world.heightAt(start.x, start.z, origin.y + 2));
  boat.group.rotation.y = heading;
  g.scene.add(boat.group);
  const hit = new Set<number>();
  let y = boat.group.position.y, chugT = 0, whistles = 0, sinkT = -1, foamT = 0;
  const chug = g.loop('paddleChug', start, 0);
  g.play('calliope', null, 0.85);
  const total = (BOAT_BEHIND + BOAT_AHEAD) / BOAT_SPEED;
  if (h.isLocal) g.events.onAnnounce('STEAMBOAT WILLIE', 'Full steam ahead!', 'gold');
  else if (g.local && g.local.team !== h.team) g.events.onAnnounce('STEAMBOAT INCOMING', 'Get off the river!', 'red');
  const zone: Zone = {
    owner: h, team: h.team, pos: origin, radius: BOAT_W, t: 0, dur: total + 1.1, dead: false, kind: 'steamboat',
    update(z, g, dt) {
      // the whole world plays as a 1928 print while the boat is out
      const fadeIn = Math.min(1, z.t / 0.35), fadeOut = Math.min(1, Math.max(0, (z.dur - z.t) / 0.45));
      screenFx.film = Math.max(screenFx.film, fadeIn * fadeOut);
      const s = -BOAT_BEHIND + Math.min(z.t, total) * BOAT_SPEED;
      const p = boat.group.position;
      p.x = origin.x + dir.x * s; p.z = origin.z + dir.z * s;
      // ride the "waves": follow the floor (books, rulers...) with a lazy spring, and bob like a cork
      const floor = g.world.heightAt(p.x, p.z, y + 3);
      y += (floor - y) * Math.min(1, dt * 4);
      const bob = Math.sin(z.t * 5.2) * 0.18;
      if (z.t > total && sinkT < 0) {
        sinkT = 0;
        g.play('bigSplash', p, 1.2);
        g.vfx.dustRing(_v1.copy(p).setY(y), 5, 28, 2, 0.4, new THREE.Color(0.85, 0.85, 0.85));
        for (let i = 0; i < 40; i++) {
          const a = rand(0, TAU), r = rand(1, 4);
          g.vfx.pa({ x: p.x + Math.cos(a) * r, y: y + 0.5, z: p.z + Math.sin(a) * r, vx: Math.cos(a) * rand(2, 6), vy: rand(6, 14), vz: Math.sin(a) * rand(2, 6), r: 0.9, g: 0.92, b: 0.95, a: 0.85, size: rand(0.12, 0.3), life: rand(0.8, 1.3), gravity: 18, shape: Shape.Dot });
        }
      }
      if (sinkT >= 0) {
        // nose-dives under the floor like a cartoon submarine
        sinkT += dt;
        p.y = y + bob - sinkT * sinkT * 14;
        boat.group.rotation.set(0.35 * Math.min(1, sinkT * 2), heading, 0, 'YXZ');
      } else {
        p.y = y + bob;
        boat.group.rotation.set(Math.sin(z.t * 4.1) * 0.05, heading, Math.sin(z.t * 2.7) * 0.05, 'YXZ');
      }
      boat.group.updateMatrixWorld();
      // chug-a chug: stacks squash and stretch on the beat, each beat coughs out a smoke puff
      chugT += dt;
      const beat = chugT * 5;
      boat.stacks.forEach((st, i) => {
        const ph = beat * Math.PI * 2 + i * Math.PI;
        const k = Math.sin(ph);
        st.scale.set(1 - k * 0.12, 1 + k * 0.16, 1 - k * 0.12);
      });
      for (const w of boat.wheels) w.rotation.x += dt * 9;
      if (Math.floor(beat) !== Math.floor(beat - dt * 5) && sinkT < 0) {
        for (const top of boat.stackTops) {
          top.getWorldPosition(_v1);
          smokePuff(g, _v1, -dir.x * 3 + rand(-0.5, 0.5), rand(3, 5), -dir.z * 3 + rand(-0.5, 0.5), rand(1.1, 1.6));
        }
      }
      // two blasts of the whistle on the way
      if ((whistles === 0 && z.t > 1.25) || (whistles === 1 && z.t > 2.55)) {
        whistles++;
        g.play('steamWhistle', p, 1.1, { variant: 1 });
        audio.duck(0.6, 0.85, 0.3);
      }
      if (boat.whistle && ((z.t > 1.25 && z.t < 1.9) || (z.t > 2.55 && z.t < 3.2))) { boat.whistle.getWorldPosition(_v1); steamJet(g, _v1.setY(_v1.y + 1), 0.4); }
      // bow wave: spray off both sides of the bow and a foamy wake behind
      foamT -= dt;
      if (foamT <= 0 && sinkT < 0) {
        foamT = 0.03;
        for (const sx of [-1, 1]) {
          const bx = p.x + dir.x * BOAT_L * 0.42 + side.x * sx * 2.2, bz = p.z + dir.z * BOAT_L * 0.42 + side.z * sx * 2.2;
          g.vfx.pa({ x: bx, y: y + 0.3, z: bz, vx: side.x * sx * rand(4, 8) + dir.x * 6, vy: rand(3, 6), vz: side.z * sx * rand(4, 8) + dir.z * 6, r: 0.9, g: 0.91, b: 0.93, a: 0.8, size: rand(0.15, 0.32), life: rand(0.5, 0.8), gravity: 16, shape: Shape.Dot });
          g.vfx.pa({ x: bx, y: y + 0.2, z: bz, vx: side.x * sx * 3, vy: 1, vz: side.z * sx * 3, r: 0.85, g: 0.86, b: 0.88, a: 0.45, size: rand(0.8, 1.2), grow: 2, life: 0.7, drag: 2, shape: Shape.Smoke, rot: rand(0, TAU) });
        }
        const wx = p.x - dir.x * BOAT_L * 0.45, wz = p.z - dir.z * BOAT_L * 0.45;
        g.vfx.pa({ x: wx + rand(-1.5, 1.5), y: y + 0.05, z: wz + rand(-1.5, 1.5), r: 0.82, g: 0.83, b: 0.85, a: 0.5, size: rand(1.2, 2), grow: 2.2, life: 1.4, shape: Shape.Ring, flat: true, aux: 0.12, rot: 0 });
      }
      chug?.set(p, 1, Math.min(1, z.t * 3) * (sinkT >= 0 ? Math.max(0, 1 - sinkT * 2) : 1) * 1.1);
      if (sinkT < 0) g.shake(p, dt * 0.45, 22);
      // everyone in front of the bow gets flattened and launched (once each)
      if (sinkT < 0) for (const e of g.heroes) {
        if (!e.alive || e.team === h.team || hit.has(e.id)) continue;
        const rx = e.pos.x - p.x, rz = e.pos.z - p.z;
        const along = rx * dir.x + rz * dir.z, lat = rx * side.x + rz * side.z;
        if (along < -BOAT_L * 0.5 || along > BOAT_L * 0.5 + 0.8 || Math.abs(lat) > BOAT_W * 0.5 + 0.6 || e.pos.y > p.y + 7) continue;
        hit.add(e.id);
        const out = Math.sign(lat) || (Math.random() < 0.5 ? -1 : 1);
        g.damage(e, BOAT_DMG, h, { knock: new THREE.Vector3(dir.x * 14 + side.x * out * 9, 13, dir.z * 14 + side.z * out * 9), at: e.chest });
        const c = e.chest;
        g.play('ram', c, 1.1);
        g.play('spudBonk', c, 1, { variant: 3 });
        bonkFx(g, c, true);
        g.vfx.flare(c, CREAM, 5, 0.2);
        g.vfx.shockwave(e.pos, CREAM, 5, 0.4, 0.12);
        for (let i = 0; i < 10; i++) g.vfx.p({ x: c.x, y: c.y, z: c.z, vx: dir.x * 5 + rand(-6, 6), vy: rand(2, 8), vz: dir.z * 5 + rand(-6, 6), r: STAR.r, g: STAR.g, b: STAR.b, size: rand(0.25, 0.4), life: rand(0.5, 0.8), drag: 2.2, gravity: 5, shape: Shape.Star, spin: rand(-8, 8) });
        g.vfx.glyph(Math.random() < 0.5 ? 'WHAM!' : 'KER-SPLASH!', c.clone().setY(c.y + 1.6), { color: '#fff6dc', glow: '#ff5a4e', scale: 2, dur: 1, vy: 1.4 });
        screenFx.ripple(c, 6, 1, 0.45);
        if (h.isLocal || e.isLocal) { g.hitStop(0.08); screenFx.punch(0.6); }
        if (e.isLocal) screenFx.zoomPunch(0.5);
        g.voice.say(h, 'secondaryHit');
      }
    },
    dispose(_z, g) { g.scene.remove(boat.group); chug?.stop(0.2); },
  };
  g.addZone(zone);
}

class MickeyKit implements HeroKit {
  primary(h: Hero, g: Game) {
    if (h.kitState.hole) return;
    h.primaryCd = 0.4;
    const st = h.kitState;
    st.hand = st.hand === 1 ? -1 : 1;
    const m = h.muzzle(st.hand === 1 ? 'R' : 'L');
    const dir = h.aimDir(m);
    // lob it so it comes down right on the crosshair (out to ~30 m; further out it flies flatter)
    const dist = Math.min(30, h.input.aim.distanceTo(m));
    const vel = dir.multiplyScalar(SPUD_SPEED);
    vel.y += 0.5 * SPUD_G * (dist / SPUD_SPEED);
    h.anim.attack = 1;
    h.anim.attackSide = st.hand;
    h.anim.attackKind = 'throw';
    g.play('spudThrow', m, 0.7);
    g.vfx.p({ x: m.x, y: m.y, z: m.z, r: CREAM.r * 0.5, g: CREAM.g * 0.5, b: CREAM.b * 0.5, size: 0.25, grow: 2.5, life: 0.12, shape: Shape.Ring, aux: 0.15 });
    // cartoon speed lines behind every spud
    const trail = g.vfx.trail({ color: new THREE.Color(1.5, 1.45, 1.35), endColor: new THREE.Color(0.2, 0.2, 0.2), width: 0.05, life: 0.14, style: TrailStyle.Smooth, minDist: 0.3 });
    throwSpud(g, h, m, vel, 1, SPUD_DMG, trail);
    if (h.isLocal) { g.camRig.shake(0.03); g.camRig.kick(1); }
  }

  secondary(h: Hero, g: Game) {
    if (h.kitState.hole) return false;
    startHole(h, g);
    return true;
  }

  ult(h: Hero, g: Game) {
    if (h.kitState.hole) return false;
    // he yanks the whistle cord: a long toot, a plume of steam from his raised fist, and the boat is on its way
    h.channel = 0.9;
    h.kitState.castT = 0;
    g.play('steamWhistle', h.pos, 1.2, { variant: 0 });
    audio.duck(1.2, 0.8, 0.3);
    launchSteamboat(h, g);
    if (h.isLocal) { g.camRig.shake(0.2); screenFx.zoomPunch(0.35); }
    return true;
  }

  update(h: Hero, g: Game, dt: number) {
    if (h.kitState.hole) updateHole(h, g, dt);
    const st = h.kitState;
    if (st.castT !== undefined && st.castT !== null) {
      st.castT += dt;
      h.anim.cast = st.castT < 0.75 ? Math.min(1, st.castT * 6) : Math.max(0, 1 - (st.castT - 0.75) * 6);
      if (st.castT < 1.1 && Math.random() < dt * 30) {
        h.model.handWorld('R', _v1);
        steamJet(g, _v1.setY(_v1.y + 0.3), 0.25);
      }
      if (st.castT > 1) { st.castT = null; h.anim.cast = 0; }
    }
  }

  onDeath(h: Hero) {
    endHole(h);
    h.kitState.castT = null;
    h.anim.cast = 0;
  }
}

function buildMickey(r: RigBuilder) {
  r.base({ skin: '#f1e7d2', shirt: '#0b0b0d', pants: '#2c2b30', shoes: '#cfc6b4', sleeves: '#0b0b0d', torsoScale: [1.05, 0.95, 1.05], legR: 0.045, armR: 0.042, shoeScale: 1.7, eyes: false });
  const ink = r.mat('#0b0b0d', 0.4);
  const cream = r.mat('#f1e7d2', 0.6);
  const btn = r.mat('#f6f1e6', 0.4);
  // black dome over the cream face, long snout, button nose, pie eyes, big round ears
  r.add(r.head, r.sphere(0.135, 20, 14), ink, [0, 0.085, -0.025], [0, 0, 0], [1.05, 1, 1.02]);
  r.add(r.head, r.sphere(0.06, 12, 10), cream, [0, 0.03, 0.12], [0.2, 0, 0], [0.95, 0.8, 1.3]);
  r.add(r.head, r.sphere(0.028, 10, 8), ink, [0, 0.045, 0.2]);
  for (const x of [-0.035, 0.035]) r.add(r.head, r.sphere(0.018, 8, 6), ink, [x, 0.1, 0.1], [0, 0, 0], [0.8, 1.7, 0.6]);
  for (const x of [-0.13, 0.13]) r.add(r.head, new THREE.CylinderGeometry(0.085, 0.085, 0.02, 24), ink, [x, 0.21, -0.03], [Math.PI / 2, 0, x > 0 ? -0.35 : 0.35]);
  for (const x of [-0.045, 0.045]) r.add(r.hips, r.sphere(0.022, 8, 6), btn, [x, 0.06, 0.12], [0, 0, 0], [1, 1.3, 0.5]);
  r.add(r.hips, new THREE.TorusGeometry(0.1, 0.008, 4, 16, Math.PI), ink, [0, 0, -0.14], [0, 0, Math.PI]);
}

export const MICKEY: HeroDef = {
  id: 'mickey',
  name: 'Mickey Mouse',
  title: 'The Original Toon',
  role: 'Duelist',
  tagline: 'Toot toot! Full steam ahead, pals!',
  color: '#ff5a4e',
  accent: '#fff1d6',
  maxHp: 275,
  // stand-in built by scripts/build-mickey-standin.mjs until the Meshy model lands; bump ?v= whenever the file changes
  modelUrl: '/models/heroes/mickey.glb?v=1',
  motion: 'cartoon',
  speed: 6.7,
  secondaryCd: 8,
  ultCost: 1400,
  botRange: 15,
  ratings: { damage: 0.7, mobility: 0.9, support: 0.1, difficulty: 0.5 },
  abilities: {
    primary: { key: 'LMB', name: 'Spud Shot', desc: 'Lob potatoes that drop right on the crosshair. Headshots bonk for 50% more, and a miss bounces once to try again.', stat: `${SPUD_DMG} dmg · bounces once`, icon: ICONS.spud },
    secondary: { key: 'RMB', name: 'Portable Hole', desc: 'Slap a hole on the floor, dive in and burrow to where you aim. Pop out with a stomp that bonks everyone around you into the air.', stat: `up to ${HOLE_MAX} m · 45 dmg pop · 8 s cd`, icon: ICONS.hole },
    ult: { key: 'SHIFT', name: 'Steamboat Willie', desc: 'Pull the whistle cord: the whole world turns into a 1928 cartoon while a giant steamboat ploughs through everyone in front of you and launches them.', stat: `${BOAT_DMG} dmg · ${BOAT_W.toFixed(0)} m wide`, icon: ICONS.steamboat },
  },
  look: { build: buildMickey },
  createKit: () => new MickeyKit(),
};

export function warmupMickey(g: Game): THREE.Object3D[] {
  g.pool('spud', spudPool);
  const b = buildBoat();
  holeMat ??= new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return [b.group, new THREE.Mesh(holeGeo, holeMat)];
}
