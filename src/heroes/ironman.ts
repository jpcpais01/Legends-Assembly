import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HeroDef, HeroKit, Projectile } from '../game/types';
import type { Hero } from '../game/Hero';
import { HERO_RADIUS } from '../game/Hero';
import type { Game } from '../game/Game';
import { InstancedPool } from '../vfx/Vfx';
import { Shape } from '../vfx/Particles';
import { globalUniforms } from '../render/materials';
import { rand, segmentVsCapsule, TAU, _m1, _q1, _v1 } from '../core/math';
import type { RigBuilder } from '../render/HeroRig';
import { screenFx, type Lens } from '../vfx/ScreenFx';
import { TrailStyle } from '../vfx/Trails';
import type { LoopHandle } from '../core/Audio';
import { PROPS } from '../render/props';

/**
 * Iron Man: a flying duelist in powered armour.
 *  LMB  Repulsor Blast: alternating palm blasts, fast and straight, headshots crit.
 *  RMB  Missile Swarm: the shoulder pods fire six homing missiles at the legend nearest your crosshair.
 *  SHIFT Unibeam: he lifts off and pours the arc reactor out of his chest as a huge beam that pierces everyone in its path.
 *  Passive Jet Boots: hold jump in the air to hover on the boot thrusters.
 */

const REPULSOR = new THREE.Color(2.2, 3.6, 4.4);
const REPULSOR_SOFT = new THREE.Color(0.7, 1.6, 2.8);
const REPULSOR_TAIL = new THREE.Color(0.25, 0.7, 2.2);
const WHITE_HOT = new THREE.Color(4.2, 4.2, 4.4);
const FLAME = new THREE.Color(4, 2.2, 0.7);
const FLAME_END = new THREE.Color(0.9, 0.12, 0.02);
const JET = new THREE.Color(2.4, 3.2, 4.2);
const SMOKE = new THREE.Color(0.42, 0.4, 0.4);
const BLAST = new THREE.Color(4, 2.4, 0.9);
const Z = new THREE.Vector3(0, 0, 1);
const GRAVITY = 22; // Hero.ts
const HOVER_FUEL = 1.6; // seconds of hover
const BEAM_CHARGE = 0.6, BEAM_TIME = 3.0, BEAM_LEN = 48, BEAM_R = 0.55;

const ICONS = {
  repulsor: '<circle cx="12" cy="12" r="3.2" fill="currentColor"/><circle cx="12" cy="12" r="6.2" opacity=".75"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" opacity=".6"/><path d="M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" opacity=".45"/>',
  missiles: '<path d="M4 17l9-9 2.5 0.5L16 11l-9 9z" fill="currentColor" fill-opacity=".3"/><path d="M4 17l9-9 2.5.5.5 2.5-9 9zM13 8l3-3 3 .1.1 3-3 3"/><path d="M3 21l2.5-1M8 4.5l1 2.5M18.5 13.5l2.5 1" opacity=".7"/>',
  unibeam: '<path d="M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z" fill="currentColor"/><path d="M5 12a7 7 0 0 1 2-4.9M5 12a7 7 0 0 0 2 4.9" opacity=".75"/><path d="M14.5 10.4L22 8.5v7l-7.5-1.9" fill="currentColor" fill-opacity=".35"/><path d="M14.5 10.4L22 8.5M14.5 13.6L22 15.5"/>',
};

// ───────────────── shared meshes ─────────────────

function boltPool() {
  return new InstancedPool(
    new THREE.SphereGeometry(1, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 4.2, 5.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    192,
  );
}

let missileGeo: THREE.BufferGeometry | null = null;
function missilePool() {
  const t = PROPS.micro_missile;
  if (t) {
    // the Meshy missile lies along x with its nose at -x: turn the nose to +z, centre it and make it 0.5 m long
    const g = t.geometry.clone();
    g.computeBoundingBox();
    const bb = g.boundingBox!, c = bb.getCenter(new THREE.Vector3()), len = bb.max.x - bb.min.x;
    g.translate(-c.x, -c.y, -c.z).rotateY(Math.PI / 2).scale(0.5 / len, 0.5 / len, 0.5 / len);
    return new InstancedPool(g, t.material, 64);
  }
  if (!missileGeo) {
    // a sleek micro-missile along +z: body, gold nose cone, four swept fins, a glowing nozzle ring (vertex colours)
    const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
      const n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      g.deleteAttribute('uv');
      return g;
    };
    const red = new THREE.Color(0.6, 0.05, 0.04), gold = new THREE.Color(0.95, 0.68, 0.3), steel = new THREE.Color(0.35, 0.36, 0.4);
    const body = paint(new THREE.CylinderGeometry(0.05, 0.055, 0.42, 10).rotateX(Math.PI / 2), red);
    const nose = paint(new THREE.ConeGeometry(0.05, 0.14, 10).rotateX(Math.PI / 2).translate(0, 0, 0.28), gold);
    const ring = paint(new THREE.CylinderGeometry(0.058, 0.058, 0.04, 10).rotateX(Math.PI / 2).translate(0, 0, 0.08), gold);
    const parts = [body, nose, ring];
    for (let i = 0; i < 4; i++) {
      const f = paint(new THREE.BoxGeometry(0.008, 0.075, 0.1), steel);
      f.translate(0, 0.075, -0.17).rotateZ((i / 4) * TAU + Math.PI / 4);
      parts.push(f);
    }
    missileGeo = mergeGeometries(parts)!;
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.75, roughness: 0.3, emissive: new THREE.Color(0.08, 0.02, 0.01) });
  return new InstancedPool(missileGeo, mat, 64);
}

// ───────────────── Unibeam visuals ─────────────────
// Four nested tubes (white-hot filament, plasma core, soft halo, twin helix sheath) sharing one vertex
// shader that flares the beam where it leaves the chest and ripples it along its length, plus camera-
// facing flares for the reactor and the impact, and spinning emitter rings. All additive, no lights.
const TUBE_VERT = /* glsl */ `
  uniform float uTime; uniform float uFlare; uniform float uWob;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vD; varying float vLen;
  void main(){
    vUv = uv;
    vLen = length(modelMatrix[1].xyz);
    float d = position.y * vLen;
    vD = d;
    float r = 1.0 + uFlare * exp(-d * 1.4) + uWob * sin(d * 0.9 - uTime * 34.0) * smoothstep(0.0, 2.0, d);
    vec4 wp = modelMatrix * vec4(position.x * r, position.y, position.z * r, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const TUBE_HEAD = /* glsl */ `
  uniform float uTime; uniform sampler2D uNoise; uniform float uK;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vD; varying float vLen;
  float facing(){ return abs(dot(normalize(vN), normalize(vV))); }
  // soft start at the chest, frayed far end
  float ends(){ return smoothstep(0.0, 0.35, vD) * (smoothstep(1.0, 0.86, vUv.y) * 0.85 + 0.15); }
`;
function tubeMat(frag: string, flare: number, wob: number) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: globalUniforms.uTime, uNoise: globalUniforms.uNoise, uK: { value: 1 }, uFlare: { value: flare }, uWob: { value: wob } },
    vertexShader: TUBE_VERT,
    fragmentShader: TUBE_HEAD + frag,
  });
}
const FLARE_FRAG = /* glsl */ `
  uniform vec3 uCol; uniform float uK; uniform float uTime; uniform float uRays;
  varying vec2 vUv;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p), a = atan(p.y, p.x);
    float core = exp(-r * r * 22.0);
    float halo = exp(-r * 4.2) * 0.55;
    float rays = (pow(max(0.0, cos(a * 3.0 + uTime * 2.5)), 24.0) + 0.7 * pow(max(0.0, cos(a * 5.0 - uTime * 1.7)), 30.0)) * exp(-r * 2.6) * uRays;
    vec3 c = uCol * (halo + rays) + vec3(3.0, 3.3, 3.6) * core;
    gl_FragColor = vec4(c * smoothstep(1.0, 0.6, r) * uK, 1.0);
  }`;
const RING_FRAG = /* glsl */ `
  uniform vec3 uCol; uniform float uK; uniform float uTime; uniform float uSpin; uniform float uSeg;
  varying vec2 vUv;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p), a = atan(p.y, p.x) / 6.2831853 + 0.5;
    float band = smoothstep(0.66, 0.72, r) * smoothstep(0.98, 0.9, r);
    float dash = smoothstep(0.35, 0.45, fract(a * uSeg + uTime * uSpin)) * smoothstep(0.95, 0.85, fract(a * uSeg + uTime * uSpin));
    float thin = exp(-pow((r - 0.6) * 40.0, 2.0)) + exp(-pow((r - 1.0) * 60.0, 2.0)) * 0.5;
    float glow = exp(-pow((r - 0.8) * 7.0, 2.0)) * 0.25;
    gl_FragColor = vec4(uCol * (band * dash * 0.9 + thin * 1.3 + glow) * uK, 1.0);
  }`;
const BB_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

let beamMats: { hot: THREE.ShaderMaterial; core: THREE.ShaderMaterial; glow: THREE.ShaderMaterial; helix: THREE.ShaderMaterial; flare: THREE.ShaderMaterial; ring: THREE.ShaderMaterial } | null = null;
function beamMaterials() {
  if (beamMats) return beamMats;
  const hot = tubeMat(/* glsl */ `
    void main(){
      float f = pow(facing(), 3.0);
      float flick = 0.85 + 0.15 * sin(uTime * 90.0 + vD * 0.7);
      gl_FragColor = vec4(vec3(2.4, 2.8, 3.2) * f * flick * ends() * uK, 1.0);
    }`, 0.9, 0.05);
  const core = tubeMat(/* glsl */ `
    void main(){
      float f = facing();
      float n = texture2D(uNoise, vec2(vUv.x * 2.0 + vD * 0.02, vD * 0.045 - uTime * 2.6)).g;
      float surge = 0.7 + 0.55 * n + 0.3 * sin(vD * 1.3 - uTime * 48.0);
      float c0 = pow(f, 1.8);
      vec3 c = mix(vec3(0.12, 0.6, 2.4), vec3(0.9, 2.2, 3.6), c0) * (0.2 + c0 * 0.9) * surge;
      gl_FragColor = vec4(c * ends() * uK, 1.0);
    }`, 1.2, 0.08);
  const glow = tubeMat(/* glsl */ `
    void main(){
      float f = facing();
      float n = texture2D(uNoise, vec2(vUv.x * 3.0 - uTime * 0.7, vD * 0.03 - uTime * 1.4)).r;
      float halo = pow(f, 2.2) * (0.5 + 0.7 * n);
      vec3 c = vec3(0.08, 0.32, 1.1) * halo;
      gl_FragColor = vec4(c * ends() * uK, 1.0);
    }`, 1.6, 0.12);
  const helix = tubeMat(/* glsl */ `
    void main(){
      float f = facing();
      float s1 = fract(vUv.x * 2.0 + vD * 0.2 - uTime * 3.4);
      float s2 = fract(-vUv.x * 3.0 + vD * 0.13 - uTime * 2.2);
      float b = smoothstep(0.0, 0.06, s1) * smoothstep(0.2, 0.06, s1) + 0.6 * smoothstep(0.0, 0.05, s2) * smoothstep(0.14, 0.05, s2);
      float reach = smoothstep(26.0, 6.0, vD) * 0.8 + 0.2;
      vec3 c = vec3(0.9, 2.2, 4.4) * b * pow(f, 0.7) * reach;
      gl_FragColor = vec4(c * ends() * uK, 1.0);
    }`, 1.0, 0.0);
  const bb = (frag: string, extra: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: globalUniforms.uTime, uK: { value: 1 }, uCol: { value: new THREE.Color(0.5, 1.4, 3.2) }, ...extra },
    vertexShader: BB_VERT, fragmentShader: frag,
  });
  const flare = bb(FLARE_FRAG, { uRays: { value: 1 } });
  const ring = bb(RING_FRAG, { uSpin: { value: 1 }, uSeg: { value: 6 } });
  return (beamMats = { hot, core, glow, helix, flare, ring });
}
/** unit-length open tube along +y from 0 to 1, with length segments for the flare and ripple */
let beamGeo: THREE.CylinderGeometry | null = null;
const tubeGeo = () => (beamGeo ??= (new THREE.CylinderGeometry(1, 1, 1, 18, 40, true).translate(0, 0.5, 0) as THREE.CylinderGeometry));
let quadGeo: THREE.PlaneGeometry | null = null;
const quad = () => (quadGeo ??= new THREE.PlaneGeometry(2, 2));

/** The beam's meshes, cloned per cast so several Iron Men can fire at once. */
function buildBeamParts(g: Game) {
  const m = beamMaterials();
  const mk = (geo: THREE.BufferGeometry, mat: THREE.ShaderMaterial, order: number) => {
    const o = new THREE.Mesh(geo, mat.clone());
    o.frustumCulled = false; o.renderOrder = order; o.visible = false;
    g.scene.add(o);
    return o;
  };
  const parts = {
    glow: mk(tubeGeo(), m.glow, 5), helix: mk(tubeGeo(), m.helix, 6), core: mk(tubeGeo(), m.core, 7), hot: mk(tubeGeo(), m.hot, 8),
    muzzle: mk(quad(), m.flare, 9), impact: mk(quad(), m.flare, 9),
    ringA: mk(quad(), m.ring, 9), ringB: mk(quad(), m.ring, 9), wave1: mk(quad(), m.ring, 9), wave2: mk(quad(), m.ring, 9), splash: mk(quad(), m.ring, 9),
  };
  const u = (o: THREE.Mesh) => (o.material as THREE.ShaderMaterial).uniforms;
  u(parts.impact).uCol.value.setRGB(1.2, 1.6, 3.0);
  u(parts.ringB).uSpin.value = -1.4; u(parts.ringB).uSeg.value = 9;
  u(parts.wave1).uSeg.value = 3; u(parts.wave2).uSeg.value = 3;
  u(parts.splash).uSpin.value = 2; u(parts.splash).uSeg.value = 5; u(parts.splash).uCol.value.setRGB(1.6, 1.4, 2.6);
  return parts;
}
type BeamParts = ReturnType<typeof buildBeamParts>;
const uni = (o: THREE.Mesh) => (o.material as THREE.ShaderMaterial).uniforms;

// ───────────────── helpers ─────────────────

const _v2 = new THREE.Vector3();
function billboard(g: Game, m: THREE.Mesh, pos: THREE.Vector3, size: number) {
  m.position.copy(pos); m.quaternion.copy(g.camRig.camera.quaternion); m.scale.setScalar(Math.max(0.001, size));
}
/** a flat ring centred on pos, facing along dir */
function ringAt(m: THREE.Mesh, pos: THREE.Vector3, dir: THREE.Vector3, size: number) {
  m.position.copy(pos); m.quaternion.setFromUnitVectors(Z, dir); m.scale.setScalar(Math.max(0.001, size));
}

/** world positions of the two boot thrusters and the two shoulder missile pods */
function boot(h: Hero, s: 1 | -1, out: THREE.Vector3) {
  const r = h.right;
  return out.copy(h.pos).addScaledVector(r, 0.115 * s).setY(h.pos.y + 0.04 + (h.anim.levitate ?? 0) * 0.1);
}
function pod(h: Hero, s: 1 | -1, out = new THREE.Vector3()) {
  const r = h.right, f = h.forward;
  return out.copy(h.pos).addScaledVector(r, 0.2 * s).addScaledVector(f, -0.08).setY(h.pos.y + 1.56);
}
function reactor(h: Hero, out = new THREE.Vector3()) {
  return out.copy(h.pos).addScaledVector(h.forward, 0.22).setY(h.pos.y + 1.3);
}

/** A boot-thruster puff: a hot blue-white core, orange flame licking down, and a little smoke. */
function jetPuff(g: Game, at: THREE.Vector3, k: number, down = 1) {
  g.vfx.p({ x: at.x, y: at.y, z: at.z, vx: rand(-0.3, 0.3), vy: -rand(6, 10) * down * k, vz: rand(-0.3, 0.3), r: JET.r, g: JET.g, b: JET.b, r2: FLAME.r, g2: FLAME.g, b2: FLAME.b, size: rand(0.07, 0.11) * (0.6 + k * 0.5), life: rand(0.06, 0.1), shape: Shape.Spark, stretch: 0.03 });
  g.vfx.p({ x: at.x + rand(-0.02, 0.02), y: at.y - 0.05, z: at.z + rand(-0.02, 0.02), vx: rand(-0.6, 0.6), vy: -rand(3, 6) * down * k, vz: rand(-0.6, 0.6), r: FLAME.r, g: FLAME.g, b: FLAME.b, r2: FLAME_END.r, g2: FLAME_END.g, b2: FLAME_END.b, size: rand(0.1, 0.18) * (0.6 + k * 0.5), grow: 0.3, life: rand(0.1, 0.18), shape: Shape.Dot });
  if (Math.random() < 0.25 * k) g.vfx.pa({ x: at.x, y: at.y - 0.2, z: at.z, vx: rand(-0.5, 0.5), vy: -rand(0.5, 1.5), vz: rand(-0.5, 0.5), r: SMOKE.r, g: SMOKE.g, b: SMOKE.b, a: 0.22, size: rand(0.25, 0.4), grow: 2.4, life: rand(0.6, 1), drag: 2, shape: Shape.Smoke, spin: rand(-1, 1), fadeIn: 0.15 });
}

// ───────────────── Micro-missiles ─────────────────

/** The enemy legend closest to the crosshair (within a cone, in sight), or null. */
function lockOn(h: Hero, g: Game): Hero | null {
  const from = h.chest, look = h.aimDir(from);
  let best: Hero | null = null, bestA = 0.5; // ~29 degrees
  for (const e of g.heroes) {
    if (!e.alive || e.team === h.team) continue;
    const d = _v1.copy(e.chest).sub(from);
    const dist = d.length();
    if (dist > 48 || dist < 0.5) continue;
    const a = Math.acos(Math.min(1, d.dot(look) / dist)) + dist * 0.002;
    if (a < bestA && g.los(from, e.chest)) { bestA = a; best = e; }
  }
  return best;
}

function fireMissile(g: Game, h: Hero, side: 1 | -1, target: Hero | null, aim: THREE.Vector3, n: number) {
  const m = pod(h, side);
  const f = h.forward, r = h.right;
  // kick up and out of the pod, then the guidance takes over
  const vel = new THREE.Vector3().addScaledVector(f, 13).addScaledVector(r, side * rand(3, 6)).add(new THREE.Vector3(0, rand(5, 8), 0));
  g.play('missileLaunch', m, 0.5);
  g.vfx.flare(m, FLAME, 0.9, 0.08, rand(-0.4, 0.4));
  for (let i = 0; i < 3; i++) g.vfx.pa({ x: m.x, y: m.y, z: m.z, vx: rand(-1, 1) - f.x * 2, vy: rand(0, 1.5), vz: rand(-1, 1) - f.z * 2, r: SMOKE.r, g: SMOKE.g, b: SMOKE.b, a: 0.35, size: rand(0.2, 0.35), grow: 2.5, life: rand(0.5, 0.9), drag: 3, shape: Shape.Smoke, spin: rand(-1, 1), fadeIn: 0.05 });
  const trail = g.vfx.trail({ color: new THREE.Color(3.5, 2.2, 1.0), endColor: new THREE.Color(0.5, 0.18, 0.05), width: 0.05, life: 0.18, style: TrailStyle.Smooth, minDist: 0.3 });
  trail?.push(m);
  const goal = aim.clone().add(new THREE.Vector3(rand(-1.2, 1.2), rand(-0.6, 0.6), rand(-1.2, 1.2)));
  const wob = rand(0, TAU);
  g.spawnProjectile({
    owner: h, kind: 'ironMissile', pos: m.clone(), vel, gravity: 0, radius: 0.14, life: 2.4, damage: 16, color: FLAME, seed: n,
    render(p, g, dt) {
      // guidance: homes harder the longer it flies, with a little corkscrew so the swarm weaves
      const tgt = target && target.alive ? _v1.copy(target.chest) : _v1.copy(goal);
      const want = tgt.sub(p.pos);
      const dist = want.length();
      want.normalize();
      const speed = Math.min(46, 18 + p.age * 70);
      const gain = p.age < 0.12 ? 2 : 7 + p.age * 10;
      const sp = p.vel.length();
      p.vel.lerp(want.multiplyScalar(speed), Math.min(1, gain * dt));
      if (dist > 3) { const w = p.age * 14 + wob; p.vel.x += Math.cos(w) * 9 * dt; p.vel.y += Math.sin(w) * 9 * dt; }
      void sp;
      const pool = g.pool('ironMissile', missilePool);
      _q1.setFromUnitVectors(Z, _v1.copy(p.vel).normalize());
      _m1.compose(p.pos, _q1, new THREE.Vector3(1, 1, 1));
      pool.add(_m1);
      // exhaust: hot flare, flame and a smoke trail that hangs in the air
      const back = _v1.copy(p.vel).normalize().multiplyScalar(-0.26).add(p.pos);
      trail?.push(back);
      g.vfx.p({ x: back.x, y: back.y, z: back.z, r: 4, g: 3, b: 1.6, r2: FLAME_END.r, g2: FLAME_END.g, b2: FLAME_END.b, size: rand(0.12, 0.18), life: 0.06, shape: Shape.Dot });
      if (Math.random() < 0.7) g.vfx.pa({ x: back.x, y: back.y, z: back.z, vx: rand(-0.4, 0.4), vy: rand(0, 0.5), vz: rand(-0.4, 0.4), r: SMOKE.r, g: SMOKE.g, b: SMOKE.b, a: 0.28, size: rand(0.1, 0.16), grow: 4, life: rand(0.5, 0.8), drag: 2.5, shape: Shape.Smoke, spin: rand(-1, 1), fadeIn: 0.04 });
    },
    onExpire(p, g) { trail?.stop(); missileBoom(g, p.owner, p.pos, null, p.damage * 0.5); },
    onHit(p, g, hit, point) { trail?.push(point); trail?.stop(); missileBoom(g, p.owner, point, hit, p.damage); },
  } as Omit<Projectile, 'prev' | 'age' | 'dead' | 'seed'> & { seed: number });
}

function missileBoom(g: Game, owner: Hero, at: THREE.Vector3, hit: Hero | null, dmg: number) {
  if (hit) g.damage(hit, dmg, owner, { at, fx: false });
  for (const e of g.enemiesNear(owner.team, at, 2.6)) if (e !== hit) g.damage(e, 6, owner, { at: e.chest, fx: false, silent: !!hit });
  g.play('missileBoom', at, 0.65);
  g.vfx.flare(at, BLAST, 2.2, 0.12, rand(-0.3, 0.3));
  g.vfx.burst(at, BLAST, 14, 7, 0.12, 0.3, { r2: 1.2, g2: 0.2, b2: 0.05, drag: 3 });
  g.vfx.sparks(at, new THREE.Color(4, 2.6, 1.2), 10, 12);
  g.vfx.p({ x: at.x, y: at.y, z: at.z, r: 3, g: 2, b: 1, size: 0.3, grow: 5, life: 0.16, shape: Shape.Ring, aux: 0.15 });
  g.vfx.smoke(at, new THREE.Color(0.3, 0.28, 0.27), 3, 0.7, 1.2, 0.4);
  g.vfx.flash(at, new THREE.Color(1, 0.6, 0.3), 14, 0.18, 9);
  const ground = g.world.heightAt(at.x, at.z);
  if (at.y - ground < 0.6) g.vfx.scorch(_v1.set(at.x, ground, at.z), 1.4, 6, 0.6);
  g.shake(at, 0.08, 10);
}

// ───────────────── Kit ─────────────────

interface BeamState {
  t: number;
  dir: THREE.Vector3;
  parts: BeamParts;
  heatMuzzle: Lens; heatEnd: Lens;
  tickT: number; fxT: number; scorchT: number;
  hum: LoopHandle | null;
}

class IronManKit implements HeroKit {
  primary(h: Hero, g: Game) {
    h.primaryCd = 0.19;
    h.hand = (h.hand * -1) as 1 | -1;
    const side = h.hand > 0 ? 'R' : 'L';
    const m = h.muzzle(side);
    const dir = h.aimDir(m);
    h.anim.attack = 1; h.anim.attackSide = h.hand; h.anim.attackKind = 'blast';
    // palm discharge: a white-hot core, a shock ring and a puff of ionised air
    g.vfx.flare(m, REPULSOR, 1.3, 0.07, rand(-0.3, 0.3));
    g.vfx.p({ x: m.x, y: m.y, z: m.z, r: REPULSOR.r, g: REPULSOR.g, b: REPULSOR.b, size: 0.14, grow: 3.6, life: 0.1, shape: Shape.Ring, aux: 0.22, fadeIn: 0.01 });
    g.vfx.burst(m, REPULSOR_SOFT, 4, 2.5, 0.08, 0.14);
    g.play('repulsor', m, 0.55);
    const trail = g.vfx.trail({ color: REPULSOR, endColor: REPULSOR_TAIL, width: 0.06, life: 0.07, style: TrailStyle.Energy, minDist: 0.4 });
    trail?.push(m);
    g.spawnProjectile({
      owner: h, kind: 'repulsor', pos: m.clone(), vel: dir.multiplyScalar(120), gravity: 0, radius: 0.13, life: 0.6, damage: 17, color: REPULSOR,
      render(p, g) {
        const pool = g.pool('repulsorBolt', boltPool);
        _q1.setFromUnitVectors(Z, _v1.copy(p.vel).normalize());
        _m1.compose(p.pos, _q1, new THREE.Vector3(0.1, 0.1, 0.75));
        pool.add(_m1);
        trail?.push(p.pos);
        if (Math.random() < 0.4) g.vfx.p({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: rand(-0.5, 0.5), vy: rand(-0.5, 0.5), vz: rand(-0.5, 0.5), r: REPULSOR_SOFT.r, g: REPULSOR_SOFT.g, b: REPULSOR_SOFT.b, r2: 0.2, g2: 0.4, b2: 1.4, size: 0.07, life: 0.18, shape: Shape.Dot });
      },
      onExpire() { trail?.stop(); },
      onHit(p, g, hit, point) {
        trail?.push(point); trail?.stop();
        if (hit) g.damage(hit, p.damage, p.owner, { crit: point.y > hit.pos.y + 1.42, at: point, fx: false });
        g.play('repulsorHit', point, hit ? 0.7 : 0.45);
        const back = _v1.copy(p.vel).normalize().multiplyScalar(-1);
        g.vfx.sparks(point, REPULSOR, 10, 10, back);
        g.vfx.flare(point, REPULSOR, hit ? 1.7 : 1.2, 0.09, rand(-0.3, 0.3));
        g.vfx.p({ x: point.x, y: point.y, z: point.z, r: 2.2, g: 3.4, b: 4.4, size: 0.22, grow: 4, life: 0.16, shape: Shape.Ring, aux: 0.2 });
        if (!hit) g.vfx.p({ x: point.x, y: point.y, z: point.z, r: 0.9, g: 1.6, b: 2.6, size: 0.3, life: 0.6, hold: 0.2, shape: Shape.Dot, fadeIn: 0.01 });
      },
    } as Omit<Projectile, 'prev' | 'age' | 'dead' | 'seed'>);
  }

  secondary(h: Hero, g: Game) {
    const target = lockOn(h, g);
    h.kitState.salvo = { n: 6, t: 0, target, aim: h.input.aim.clone() };
    h.anim.attack = 1; h.anim.attackSide = -h.hand; h.anim.attackKind = 'blast';
    // the pods flip open with a hiss
    for (const s of [1, -1] as const) {
      const p = pod(h, s);
      g.vfx.flare(p, new THREE.Color(3, 1.6, 0.6), 0.8, 0.1);
      g.vfx.burst(p, new THREE.Color(2, 2.4, 3), 5, 2, 0.06, 0.2);
    }
    g.play('missilePods', h.chest, 0.7);
    if (target) {
      // a lock-on reticle on the target, visible to everyone (it is a warning too)
      g.vfx.glyph('◎', target.chest, { color: '#ffd7a8', glow: '#ff5a2a', scale: 1.3, dur: 0.7, follow: () => (target.alive ? _v1.copy(target.pos).setY(target.pos.y + 1.3) : null) });
      if (h.isLocal) g.events.onAnnounce('Target locked', target.name, 'gold');
    }
    return true;
  }

  ult(h: Hero, g: Game) {
    const st = h.kitState;
    if (st.beam) return false;
    const o = reactor(h);
    st.beam = {
      t: 0, dir: h.aimDir(o), parts: buildBeamParts(g),
      heatMuzzle: screenFx.heat(o, 1.1, 0), heatEnd: screenFx.heat(o, 2.6, 0),
      tickT: 0, fxT: 0, scorchT: 0, hum: null,
    } satisfies BeamState;
    h.channel = BEAM_CHARGE + BEAM_TIME;
    g.play('unibeamCharge', h.chest, 1);
    const feet = h.pos.clone(); feet.y = g.world.heightAt(feet.x, feet.z);
    g.vfx.rune(feet, new THREE.Color(1.4, 2.8, 4), 4.2, 1, 2.6, 0.9, 0.8);
    g.vfx.shockwave(feet, JET, 4, 0.4, 0.1);
    g.vfx.dustRing(feet, 1.2, 22, 0.8, 0.45);
    if (h.isLocal) g.events.onAnnounce('Unibeam', 'Arc reactor at full power', 'blue');
    return true;
  }

  update(h: Hero, g: Game, dt: number) {
    const st = h.kitState;
    st.fuel ??= HOVER_FUEL;

    // ── micro-missile salvo: one every 55 ms, alternating pods
    const sv = st.salvo;
    if (sv) {
      sv.t -= dt;
      while (sv.n > 0 && sv.t <= 0 && h.alive) {
        sv.t += 0.055;
        sv.n--;
        fireMissile(g, h, (sv.n % 2 ? 1 : -1), sv.target, sv.aim, sv.n);
      }
      if (sv.n <= 0 || !h.alive) st.salvo = null;
    }

    // ── jet boots: hold jump in the air to hover
    const beam: BeamState | null = st.beam ?? null;
    const hovering = !beam && h.alive && !h.grounded && h.input.jump && st.fuel > 0 && h.vel.y < 3.5 && h.channel <= 0;
    if (hovering) {
      st.fuel = Math.max(0, st.fuel - dt);
      // cancel gravity, ease toward a gentle rise, and steer better than a normal jump
      h.vel.y += GRAVITY * dt;
      h.vel.y += (1.1 - h.vel.y) * Math.min(1, dt * 5);
      h.speedMult *= 1.12;
      st.hoverT = (st.hoverT ?? 0) + dt;
      if (!st.hoverOn) { st.hoverOn = true; g.play('jetIgnite', h.pos, 0.6); st.jetLoop = g.loop('jetLoop', h.pos, 0.5); }
    } else {
      if (st.hoverOn) { st.hoverOn = false; st.jetLoop?.stop(); st.jetLoop = null; }
      st.hoverT = 0;
      if (h.grounded) st.fuel = Math.min(HOVER_FUEL, st.fuel + dt * 0.8);
    }
    (st.jetLoop as LoopHandle | null)?.set(h.pos, 0.9 + Math.min(0.25, (st.hoverT ?? 0) * 0.2), 0.5);
    const jetK = beam ? 1 : hovering ? 0.9 : 0;
    h.anim.levitate = beam ? Math.min(1, (h.anim.levitate ?? 0) + dt * 4) : Math.max(hovering ? 0.65 : 0, (h.anim.levitate ?? 0) - dt * 3) * (h.alive ? 1 : 0);
    if (jetK > 0) for (const s of [1, -1] as const) jetPuff(g, boot(h, s, _v1), jetK);

    if (beam) this.updateBeam(h, g, dt, beam);
  }

  private updateBeam(h: Hero, g: Game, dt: number, b: BeamState) {
    b.t += dt;
    h.dmgTakenMult = 0.7;
    h.anim.cast = Math.min(1, b.t * 3);
    // lift off and hold a hover while the beam runs
    h.overrideVel = (h.overrideVel ?? new THREE.Vector3()).set(0, b.t < 0.5 ? 3 : 0, 0);
    const o = reactor(h);
    const charging = b.t < BEAM_CHARGE;
    if (charging) {
      const k = b.t / BEAM_CHARGE;
      // energy converges into the arc reactor
      for (let i = 0; i < 3; i++) {
        const a = rand(0, TAU), r = rand(1.5, 3.5), yy = rand(-1, 1.5), life = 0.28;
        g.vfx.p({ x: o.x + Math.cos(a) * r, y: o.y + yy, z: o.z + Math.sin(a) * r, vx: -Math.cos(a) * r / life, vy: -yy / life, vz: -Math.sin(a) * r / life, r: 1.2, g: 2.6, b: 4, r2: 4, g2: 4, b2: 4.4, size: 0.06, life, shape: Shape.Spark, stretch: 0.04 });
      }
      if (Math.random() < dt * 25) g.vfx.flare(o, WHITE_HOT, 0.4 + k * 1.4, 0.06, rand(-0.5, 0.5));
      if (h.isLocal) screenFx.zoomHold = k * 0.08;
      b.dir.copy(h.aimDir(o));
      // the reactor swells into a star while two emitter rings spin up and close in on it
      const P = b.parts, e = k * k;
      P.muzzle.visible = P.ringA.visible = P.ringB.visible = true;
      billboard(g, P.muzzle, o, 0.12 + e * 0.6 * (1 + Math.sin(g.time * 60) * 0.08));
      uni(P.muzzle).uRays.value = e; uni(P.muzzle).uK.value = 0.5 + e * 0.8;
      ringAt(P.ringA, _v1.copy(o).addScaledVector(b.dir, 0.3), b.dir, 1.5 - e * 1.0);
      ringAt(P.ringB, _v1.copy(o).addScaledVector(b.dir, 0.45), b.dir, 1.1 - e * 0.75);
      uni(P.ringA).uK.value = uni(P.ringB).uK.value = Math.min(1, k * 2);
      uni(P.ringA).uSpin.value = 0.8 + e * 5; uni(P.ringB).uSpin.value = -(1 + e * 6);
      b.heatMuzzle.pos.copy(o); b.heatMuzzle.strength = e * 0.6;
      return;
    }
    const P = b.parts;
    if (!P.core.visible) {
      // ignition
      P.core.visible = P.glow.visible = P.hot.visible = P.helix.visible = P.impact.visible = P.splash.visible = P.wave1.visible = P.wave2.visible = true;
      g.play('unibeamFire', o, 1);
      b.hum = g.loop('unibeamLoop', o, 0.9);
      g.vfx.flare(o, WHITE_HOT, 3.5, 0.25);
      g.vfx.shockwave(o, REPULSOR, 4, 0.35, 0.12, false);
      g.vfx.flash(o, new THREE.Color(0.6, 0.9, 1.4), 30, 0.35, 16);
      g.shake(o, 0.12, 20);
      screenFx.ripple(_v1.copy(o).addScaledVector(b.dir, 1), 3, 0.5, 0.4);
      if (h.isLocal) { screenFx.punch(0.15); screenFx.flashScreen(new THREE.Color(0.8, 1.1, 1.6), 0.12); g.camRig.kick(3); }
    }
    const k = b.t - BEAM_CHARGE;
    const fade = Math.min(1, k / 0.12) * Math.min(1, (BEAM_TIME - k) / 0.25);
    // the beam is heavy: it sweeps toward the crosshair at a limited rate
    const want = h.aimDir(o);
    const ang = b.dir.angleTo(want);
    if (ang > 1e-4) b.dir.lerp(want, Math.min(1, (2.6 * dt) / ang)).normalize();
    const far = _v1.copy(o).addScaledVector(b.dir, BEAM_LEN);
    const wt = g.world.raycast(o, far, 0.2);
    const len = wt >= 0 ? Math.max(0.5, wt * BEAM_LEN) : BEAM_LEN;
    const end = o.clone().addScaledVector(b.dir, len);
    // orient the tubes
    _q1.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.dir);
    const pulse = 1 + Math.sin(g.time * 40) * 0.06;
    for (const [m, r] of [[P.hot, 0.16 * pulse], [P.core, 0.42 * pulse], [P.helix, 0.85], [P.glow, 1.6]] as const) {
      m.position.copy(o); m.quaternion.copy(_q1);
      const w = BEAM_R * r * (0.3 + 0.7 * fade);
      m.scale.set(w, len, w);
      uni(m).uK.value = fade;
    }
    // reactor star, emitter rings, pressure waves racing out along the beam
    billboard(g, P.muzzle, o, (0.6 + Math.sin(g.time * 47) * 0.05) * (0.5 + 0.5 * fade));
    uni(P.muzzle).uRays.value = 0.8; uni(P.muzzle).uK.value = 0.3 + 0.55 * fade;
    ringAt(P.ringA, _v1.copy(o).addScaledVector(b.dir, 0.45), b.dir, 0.7);
    ringAt(P.ringB, _v1.copy(o).addScaledVector(b.dir, 1.0), b.dir, 0.5 + Math.sin(g.time * 30) * 0.04);
    uni(P.ringA).uK.value = uni(P.ringB).uK.value = fade;
    const reach = Math.min(len - 0.5, 14);
    for (const [w, ph] of [[P.wave1, 0], [P.wave2, 0.5]] as const) {
      const f = (k * 1.7 + ph) % 1;
      ringAt(w, _v1.copy(o).addScaledVector(b.dir, 0.8 + f * reach), b.dir, 0.45 + f * 0.7);
      uni(w).uK.value = fade * (1 - f) * Math.min(1, f * 8) * 0.9;
    }
    // the impact: a white-hot star where it hits and a splash ring spreading over the surface
    billboard(g, P.impact, _v2.copy(end).addScaledVector(b.dir, -0.15), (1.2 + Math.random() * 0.3) * fade);
    uni(P.impact).uRays.value = 0.7;
    ringAt(P.splash, _v2.copy(end).addScaledVector(b.dir, -0.05), b.dir, (1.3 + Math.sin(g.time * 22) * 0.15) * fade);
    uni(P.splash).uK.value = wt >= 0 ? fade : 0;
    P.impact.visible = true;
    b.heatMuzzle.pos.copy(o); b.heatMuzzle.strength = 0.7 * fade;
    b.heatEnd.pos.copy(end); b.heatEnd.strength = (wt >= 0 ? 1 : 0.4) * fade;
    b.hum?.set(o, 1, 0.9 * fade);
    if (h.isLocal) screenFx.zoomHold = 0.05 * fade;

    // damage: everyone in the beam's path, through each other
    b.tickT += dt;
    if (b.tickT >= 0.1) {
      b.tickT -= 0.1;
      for (const e of g.heroes) {
        if (!e.alive || e.team === h.team) continue;
        const t = segmentVsCapsule(o, end, e.pos.x, e.pos.z, e.pos.y + 0.1, e.pos.y + 1.7, HERO_RADIUS + BEAM_R);
        if (t < 0) continue;
        const at = _v1.lerpVectors(o, end, t).clone();
        g.damage(e, 10, h, { at, fx: false, knock: b.dir.clone().setY(0).multiplyScalar(1.4) });
        g.vfx.sparks(at, REPULSOR, 6, 9);
        g.vfx.flare(at, WHITE_HOT, 1.4, 0.08, rand(-0.5, 0.5));
        e.applySlow(0.25, 0.2);
      }
    }
    // the muzzle at his chest and the molten end of the beam
    if (Math.random() < dt * 30) g.vfx.flare(o, WHITE_HOT, 2.2 * fade, 0.06, rand(-0.5, 0.5));
    b.fxT += dt;
    if (b.fxT > 1 / 45) {
      b.fxT = 0;
      g.vfx.p({ x: end.x, y: end.y, z: end.z, r: 3, g: 3.8, b: 4.4, size: 0.9 * fade, grow: 0.4, life: 0.08, shape: Shape.Dot });
      g.vfx.sparks(end, new THREE.Color(3.5, 3, 2), 3, 12, b.dir.clone().negate());
      if (Math.random() < 0.4) g.vfx.pa({ x: end.x, y: end.y, z: end.z, vx: rand(-1, 1), vy: rand(1, 2.5), vz: rand(-1, 1), r: 0.3, g: 0.3, b: 0.32, a: 0.3, size: rand(0.4, 0.7), grow: 2.5, life: rand(0.8, 1.2), drag: 1.5, shape: Shape.Smoke, spin: rand(-1, 1), fadeIn: 0.1 });
      // stray filaments crackling around the beam
      const u = Math.random() * Math.min(1, len / BEAM_LEN);
      const p = _v1.copy(o).addScaledVector(b.dir, u * len);
      g.vfx.p({ x: p.x + rand(-0.3, 0.3), y: p.y + rand(-0.3, 0.3), z: p.z + rand(-0.3, 0.3), vx: rand(-3, 3), vy: rand(-3, 3), vz: rand(-3, 3), r: 1.8, g: 3, b: 4.2, size: 0.05, life: 0.12, shape: Shape.Spark, stretch: 0.03 });
    }
    b.scorchT += dt;
    if (b.scorchT > 0.09) {
      b.scorchT = 0;
      g.vfx.flash(end, new THREE.Color(0.6, 0.9, 1.4), 20 * fade, 0.12, 9);
      const ground = g.world.heightAt(end.x, end.z);
      if (end.y - ground < 0.8) {
        const gp = _v1.set(end.x, ground, end.z);
        g.vfx.scorch(gp, 1.6, 8, 0.65);
        g.vfx.groundGlow(gp, new THREE.Color(2.4, 1.2, 0.4), 1.4, 1.2, 0.1);
        g.vfx.embers(gp, new THREE.Color(4, 2.4, 0.8), new THREE.Color(0.6, 0.1, 0.02), 4, 0.6, 2);
      }
    }
    if (k >= BEAM_TIME || !h.alive) this.endBeam(h, g, end);
  }

  private endBeam(h: Hero, g: Game, end?: THREE.Vector3) {
    const b: BeamState | null = h.kitState.beam;
    if (!b) return;
    h.kitState.beam = null;
    b.hum?.stop();
    const fired = b.parts.core.visible;
    for (const m of Object.values(b.parts)) { g.scene.remove(m); (m.material as THREE.Material).dispose(); }
    b.heatMuzzle.alive = b.heatEnd.alive = false;
    if (h.isLocal) screenFx.zoomHold = 0;
    h.overrideVel = null;
    h.anim.cast = 0;
    if (end && fired) {
      g.vfx.flare(end, WHITE_HOT, 3, 0.25);
      g.vfx.shockwave(end, REPULSOR, 3, 0.4, 0.1, false);
      g.play('repulsorHit', end, 1);
    }
  }

  onDeath(h: Hero, g: Game) {
    this.endBeam(h, g);
    h.kitState.salvo = null;
    if (h.kitState.hoverOn) { h.kitState.hoverOn = false; h.kitState.jetLoop?.stop(); h.kitState.jetLoop = null; }
    h.anim.levitate = 0; h.anim.cast = 0;
  }
}

// ───────────────── Look (shown only until the GLB loads) ─────────────────
function buildIronMan(r: RigBuilder) {
  r.base({ skin: '#8e1410', shirt: '#9a1712', pants: '#8e1410', shoes: '#c89a4a', sleeves: '#c89a4a', torsoScale: [1.08, 1, 1.02] });
  const gold = r.mat('#d8a24a', 0.28, 1);
  const red = r.mat('#9a1712', 0.3, 0.85);
  const glow = r.mat('#cff4ff', 0.4, 0, { emissive: new THREE.Color(2.4, 3.6, 4) });
  r.add(r.head, r.sphere(0.115, 16, 12), red, [0, 0.06, -0.01], [0, 0, 0], [1, 1.12, 1.08]);
  r.add(r.head, r.capsule(0.07, 0.06, 8), gold, [0, 0.05, 0.07], [Math.PI / 2, 0, 0], [1.05, 1, 0.7]);
  for (const x of [0.035, -0.035]) r.add(r.head, r.capsule(0.008, 0.035, 4), glow, [x, 0.07, 0.112], [0, 0, Math.PI / 2 + (x > 0 ? 0.15 : -0.15)]);
  r.add(r.chest, new THREE.CylinderGeometry(0.04, 0.04, 0.02, 16), glow, [0, 0.02, 0.15], [Math.PI / 2, 0, 0]);
  for (const s of [r.shoulderL, r.shoulderR]) r.add(s, r.sphere(0.085, 12, 8), red, [0, -0.02, 0], [0, 0, 0], [1.1, 0.9, 1.1]);
  for (const hb of [r.handL, r.handR]) r.add(hb, new THREE.CylinderGeometry(0.02, 0.02, 0.01, 12), glow, [0, -0.05, 0]);
  r.add(r.chest, r.capsule(0.08, 0.1, 6), gold, [0, 0.12, 0.08], [0, 0, Math.PI / 2], [1, 1, 0.5]);
}

export const IRONMAN: HeroDef = {
  id: 'ironman',
  name: 'Iron Man',
  title: 'The Armored Avenger',
  role: 'Duelist',
  tagline: 'Genius in a flying suit of armor.',
  color: '#ff4a3d',
  accent: '#ffc857',
  maxHp: 250,
  // Meshy model (the code-built stand-in from scripts/build-ironman-placeholder.mjs is retired); bump ?v= when the file changes
  modelUrl: '/models/heroes/ironman.glb?v=2',
  speed: 6.1,
  secondaryCd: 9,
  ultCost: 1500,
  botRange: 17,
  ratings: { damage: 0.85, mobility: 0.8, support: 0.1, difficulty: 0.6 },
  abilities: {
    primary: { key: 'LMB', name: 'Repulsor Blast', desc: 'Fire alternating palm repulsors. Fast, straight and precise: headshots deal 50% bonus damage. Hold jump in the air to hover on your jet boots.', stat: '17 dmg · 5 shots/s', icon: ICONS.repulsor },
    secondary: { key: 'RMB', name: 'Missile Swarm', desc: 'Your shoulder pods launch six homing missiles at the enemy closest to your crosshair. Each one splashes on impact.', stat: '6 × 16 dmg · 9 s cd', icon: ICONS.missiles },
    ult: { key: 'SHIFT', name: 'Unibeam', desc: 'Lift off and pour the arc reactor out of your chest: a huge beam you sweep across the arena that burns through every enemy in its path.', stat: '100 dps · 3 s · pierces', icon: ICONS.unibeam },
  },
  look: { build: buildIronMan },
  createKit: () => new IronManKit(),
};

/** Pre-create pools/materials so shaders compile during loading, not mid-fight. */
export function warmupIronMan(g: Game): THREE.Object3D[] {
  g.pool('repulsorBolt', boltPool);
  g.pool('ironMissile', missilePool);
  const m = beamMaterials();
  return [m.hot, m.core, m.glow, m.helix].map((mat): THREE.Object3D => new THREE.Mesh(tubeGeo(), mat)).concat([m.flare, m.ring].map((mat) => new THREE.Mesh(quad(), mat)));
}
