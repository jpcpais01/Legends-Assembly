import * as THREE from 'three';
import { propMesh } from '../render/props';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HeroDef, HeroKit, Projectile, Zone } from '../game/types';
import type { Hero } from '../game/Hero';
import type { Game } from '../game/Game';
import { InstancedPool } from '../vfx/Vfx';
import { Shape } from '../vfx/Particles';
import { globalUniforms } from '../render/materials';
import { pick, rand, TAU, _m1, _q1, _v1 } from '../core/math';
import type { RigBuilder } from '../render/HeroRig';
import { ICONS } from './icons';
import { screenFx } from '../vfx/ScreenFx';
import { TrailStyle, type Trail } from '../vfx/Trails';

const PAINTS = [
  new THREE.Color(0.08, 0.22, 0.95), // cobalt
  new THREE.Color(1.0, 0.76, 0.08), // chrome yellow
  new THREE.Color(0.05, 0.55, 0.42), // viridian
  new THREE.Color(0.95, 0.32, 0.08), // vermilion
  new THREE.Color(0.35, 0.6, 1.0), // cerulean
];
const SUN = new THREE.Color(3.2, 2.4, 0.6);
const HEAL = new THREE.Color(1.6, 2.8, 0.8);
const STAR = new THREE.Color(3.4, 2.8, 1.1);
const NIGHT = new THREE.Color(0.35, 0.6, 2.6);
const FIELD = [new THREE.Color(0.95, 0.72, 0.08), new THREE.Color(0.85, 0.5, 0.05), new THREE.Color(0.35, 0.6, 0.12), new THREE.Color(0.98, 0.85, 0.3)];

function globPool() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.18, metalness: 0.0, emissive: 0x111111 });
  return new InstancedPool(new THREE.IcosahedronGeometry(1, 2), m, 64, true);
}
function seedPool() {
  return new InstancedPool(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 0.6) }), 8);
}

// ───────────── Sunflower ─────────────
let flowerGeos: { petals: THREE.BufferGeometry; head: THREE.BufferGeometry; stem: THREE.BufferGeometry } | null = null;
function sunflowerGeos() {
  if (flowerGeos) return flowerGeos;
  const petals: THREE.BufferGeometry[] = [];
  for (let layer = 0; layer < 2; layer++) {
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + layer * (TAU / n / 2);
      const p = new THREE.SphereGeometry(1, 8, 6);
      p.scale(0.11, 0.025, 0.36 - layer * 0.05);
      p.translate(0, 0, 0.5 - layer * 0.04);
      p.rotateX(-0.25 - layer * 0.15);
      p.rotateY(a);
      const col: number[] = [];
      const c = layer === 0 ? new THREE.Color(1.0, 0.72, 0.06) : new THREE.Color(1.0, 0.58, 0.04);
      for (let k = 0; k < p.attributes.position.count; k++) col.push(c.r, c.g, c.b);
      p.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      petals.push(p.toNonIndexed());
    }
  }
  const pg = mergeGeometries(petals)!;
  pg.rotateX(Math.PI / 2);
  const head = new THREE.SphereGeometry(0.3, 24, 12);
  head.scale(1, 1, 0.35);
  const hp = head.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
    const bump = Math.sin(x * 60) * Math.sin(y * 60) * 0.006;
    hp.setZ(i, z + (z > 0 ? bump : 0));
  }
  head.computeVertexNormals();
  const stemPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) stemPts.push(new THREE.Vector3(Math.sin(i * 0.4) * 0.08, i * 0.28, Math.cos(i * 0.3) * 0.05));
  const stem = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(stemPts), 16, 0.05, 6);
  const leaf = new THREE.SphereGeometry(1, 10, 6); leaf.scale(0.28, 0.02, 0.12);
  const l1 = leaf.clone().rotateZ(0.5).translate(0.25, 0.9, 0);
  const l2 = leaf.clone().rotateZ(-0.6).rotateY(2.5).translate(-0.22, 1.4, 0.1);
  flowerGeos = { petals: pg, head, stem: mergeGeometries([stem.toNonIndexed(), l1.toNonIndexed(), l2.toNonIndexed()])! };
  return flowerGeos;
}
let flowerMats: { petals: THREE.Material; head: THREE.Material; stem: THREE.Material } | null = null;
function sunflowerMats() {
  if (flowerMats) return flowerMats;
  flowerMats = {
    petals: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: new THREE.Color(0.35, 0.22, 0.0), side: THREE.DoubleSide }),
    head: new THREE.MeshStandardMaterial({ color: 0x3b2410, roughness: 0.9 }),
    stem: new THREE.MeshStandardMaterial({ color: 0x3f7a22, roughness: 0.7 }),
  };
  return flowerMats;
}

function bloomSunflower(g: Game, owner: Hero, at: THREE.Vector3) {
  const prev: Zone | undefined = owner.kitState.flower;
  if (prev && !prev.dead) prev.t = Math.max(prev.t, prev.dur - 0.01);
  const pos = at.clone();
  pos.y = g.world.heightAt(pos.x, pos.z);
  const group = new THREE.Group();
  group.position.copy(pos);
  // sway pivot at the base; the head faces the enemy side
  const sway = new THREE.Group();
  sway.rotation.y = Math.atan2(owner.forward.x, owner.forward.z);
  group.add(sway);
  let petals: THREE.Object3D | null = null;
  const model = propMesh('sunflower', 3.1);
  if (model) sway.add(model);
  else {
    const geos = sunflowerGeos();
    const mats = sunflowerMats();
    const stem = new THREE.Mesh(geos.stem, mats.stem);
    const headPivot = new THREE.Group();
    headPivot.position.set(0.1, 2.3, 0.05);
    const head = new THREE.Mesh(geos.head, mats.head);
    const pm = new THREE.Mesh(geos.petals, mats.petals);
    pm.scale.setScalar(1.25);
    headPivot.add(head, pm);
    headPivot.rotation.x = -0.25;
    sway.add(stem, headPivot);
    for (const m of [stem, head, pm]) m.castShadow = true;
    petals = pm;
  }
  group.scale.setScalar(0.01);
  g.scene.add(group);
  g.play('bloom', pos, 1);
  g.vfx.shockwave(pos, new THREE.Color(2.2, 2.4, 0.5), 7, 0.6, 0.06);
  g.vfx.add.spawn({ x: pos.x, y: pos.y + 0.06, z: pos.z, r: 0.9, g: 1.1, b: 0.25, a: 0.8, size: 13, life: 6, shape: Shape.Ring, flat: true, aux: 0.03, hold: 0.85, fadeIn: 0.05, rot: 0 });
  // the healing field is painted onto the ground: a ring of thick brush strokes and a few dabs inside
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * TAU + rand(-0.06, 0.06), r = 6.3 + rand(-0.25, 0.25);
    const c = FIELD[i % FIELD.length];
    g.vfx.pa({ x: pos.x + Math.cos(a) * r, y: pos.y + 0.04, z: pos.z + Math.sin(a) * r, r: c.r, g: c.g, b: c.b, a: 0.85, size: rand(2, 2.6), life: 6, hold: 0.88, fadeIn: 0.05 + i * 0.006, shape: Shape.Stroke, flat: true, rot: -(a + Math.PI / 2), aux: Math.random() });
  }
  for (let i = 0; i < 10; i++) {
    const a = rand(0, TAU), r = Math.sqrt(Math.random()) * 5;
    const c = FIELD[i % FIELD.length];
    g.vfx.pa({ x: pos.x + Math.cos(a) * r, y: pos.y + 0.035, z: pos.z + Math.sin(a) * r, r: c.r * 0.8, g: c.g * 0.8, b: c.b * 0.8, a: 0.45, size: rand(1, 1.6), life: 6, hold: 0.88, fadeIn: 0.1, shape: Shape.Stroke, flat: true, rot: rand(0, TAU), aux: Math.random() });
  }
  g.vfx.flare(pos.clone().setY(pos.y + 0.6), SUN, 4, 0.3);
  for (let i = 0; i < 30; i++) g.vfx.pa({ x: pos.x, y: pos.y + 0.3, z: pos.z, vx: rand(-4, 4), vy: rand(3, 7), vz: rand(-4, 4), r: 1, g: rand(0.55, 0.78), b: 0.05, a: 1, size: rand(0.12, 0.2), life: rand(1, 1.6), gravity: 5, drag: 1.4, shape: Shape.Petal, spin: rand(-6, 6) });
  g.vfx.dust(pos, 8, 0.6, 0.3, 2.4, new THREE.Color(0.45, 0.36, 0.2));
  let tick = 0;
  let sunT = 0;
  const zone: Zone = {
    owner, team: owner.team, pos, radius: 6.5, t: 0, dur: 6, dead: false, kind: 'sunflower',
    update(z, g, dt) {
      const k = Math.min(1, z.t / 0.7);
      const elastic = k >= 1 ? 1 : 1 - Math.pow(2, -10 * k) * Math.cos(k * 10);
      const out = z.t > z.dur - 0.4 ? Math.max(0.01, (z.dur - z.t) / 0.4) : 1;
      group.scale.setScalar(Math.max(0.01, elastic * out));
      sway.rotation.z = Math.sin(z.t * 1.7) * 0.05;
      sway.rotation.x = Math.sin(z.t * 1.1 + 1) * 0.03;
      if (petals) petals.rotation.z += dt * 0.4;
      // a soft little sun glows around the flower head
      sunT -= dt;
      if (sunT <= 0 && z.t > 0.4 && z.t < z.dur - 0.3) {
        sunT = 0.12;
        const hp = _v1.copy(pos).setY(pos.y + 2.7);
        g.vfx.p({ x: hp.x, y: hp.y, z: hp.z, r: 1.4, g: 1.0, b: 0.2, size: rand(3, 3.6), life: 0.45, shape: Shape.Dot, fadeIn: 0.3 });
        if (Math.random() < 0.4) g.vfx.p({ x: hp.x + rand(-0.6, 0.6), y: hp.y + rand(-0.4, 0.4), z: hp.z + rand(-0.6, 0.6), vy: rand(-0.4, 0.2), r: 2.4, g: 1.8, b: 0.4, size: rand(0.08, 0.14), life: 1.2, shape: Shape.Star, spin: 2 });
      }
      if (Math.random() < dt * 14) {
        const a = rand(0, TAU), r = rand(0, z.radius);
        g.vfx.p({ x: pos.x + Math.cos(a) * r, y: pos.y + 0.1, z: pos.z + Math.sin(a) * r, vy: rand(0.8, 2), r: HEAL.r, g: HEAL.g, b: HEAL.b, size: rand(0.06, 0.12), life: rand(0.8, 1.4), shape: Shape.Star, spin: 2 });
      }
      tick += dt;
      if (tick >= 0.25) {
        tick = 0;
        for (const a of g.alliesNear(z.team, pos, z.radius)) {
          const healed = g.heal(a, 8, owner);
          if (healed > 0 && Math.random() < 0.5) {
            const c = a.center;
            g.vfx.p({ x: c.x + rand(-0.3, 0.3), y: c.y + rand(-0.5, 0.6), z: c.z + rand(-0.3, 0.3), vy: 1.5, r: 1.8, g: 3, b: 0.8, size: 0.12, life: 0.7, shape: Shape.Star });
          }
          // golden motes drift from the flower to whoever it is healing
          if (healed > 0) {
            const c = a.center, hp = _v1.copy(pos).setY(pos.y + 2.5);
            for (let i = 0; i < 2; i++) {
              const life = rand(0.45, 0.65);
              g.vfx.p({ x: hp.x + rand(-0.3, 0.3), y: hp.y + rand(-0.3, 0.3), z: hp.z + rand(-0.3, 0.3), vx: (c.x - hp.x) / life, vy: (c.y - hp.y) / life + 1, vz: (c.z - hp.z) / life, r: 2.6, g: 2.2, b: 0.6, r2: 0.8, g2: 2.6, b2: 0.6, size: rand(0.07, 0.12), life, shape: Shape.Spark, stretch: 0.025 });
            }
          }
        }
      }
    },
    dispose(z, g) {
      const hp = _v1.copy(pos).setY(pos.y + 2.6);
      for (let i = 0; i < 24; i++) g.vfx.pa({ x: hp.x, y: hp.y, z: hp.z, vx: rand(-3, 3), vy: rand(0, 4), vz: rand(-3, 3), r: 1, g: rand(0.55, 0.75), b: 0.05, a: 1, size: rand(0.12, 0.2), life: rand(1, 1.8), gravity: 4, drag: 1.5, shape: Shape.Petal, spin: rand(-6, 6) });
      g.scene.remove(group);
      if (owner.kitState.flower === z) owner.kitState.flower = null;
    },
  };
  owner.kitState.flower = zone;
  g.addZone(zone);
}

// ───────────── The Starry Night ─────────────
let skyMat: THREE.ShaderMaterial | null = null;
let floorMat: THREE.ShaderMaterial | null = null;
const STARRY_GLSL = /* glsl */ `
  uniform float uTime; uniform sampler2D uNoise; uniform float uFade;
  vec2 swirl(vec2 p, vec2 c, float strength, float radius) {
    vec2 d = p - c; float r = length(d);
    float a = strength * exp(-r * r / (radius * radius));
    float s = sin(a), co = cos(a);
    return c + vec2(d.x * co - d.y * s, d.x * s + d.y * co);
  }
  vec3 starry(vec2 p) {
    float t = uTime * 0.25;
    vec2 q = p;
    q = swirl(q, vec2(0.15, 0.1), 3.2 + sin(t) * 0.4 + t * 2.0, 0.35);
    q = swirl(q, vec2(-0.35, -0.15), -2.4 - t * 1.6, 0.28);
    q = swirl(q, vec2(0.4, -0.35), 2.0 + t * 1.2, 0.22);
    // brush strokes: noise stretched along the flow
    float n1 = texture2D(uNoise, q * vec2(1.4, 5.0) + vec2(t * 0.2, 0.0)).g;
    float n2 = texture2D(uNoise, q * vec2(3.0, 9.0) - vec2(0.0, t * 0.3)).r;
    float strokes = smoothstep(0.35, 0.75, n1) * 0.7 + smoothstep(0.5, 0.8, n2) * 0.5;
    vec3 deep = vec3(0.02, 0.06, 0.28);
    vec3 cobalt = vec3(0.1, 0.28, 0.85);
    vec3 pale = vec3(0.65, 0.85, 1.2);
    vec3 col = mix(deep, cobalt, smoothstep(0.2, 0.7, n1));
    col = mix(col, pale, smoothstep(0.62, 0.9, n2) * 0.7);
    // swirl band highlights in yellow-white
    float band = smoothstep(0.7, 0.95, texture2D(uNoise, q * vec2(2.0, 12.0)).g);
    col += vec3(1.4, 1.2, 0.5) * band * 0.6;
    // stars with halos
    vec2 cell = floor(p * 7.0);
    vec2 f = fract(p * 7.0) - 0.5;
    float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    if (h > 0.72) {
      vec2 o = vec2(fract(h * 13.1), fract(h * 7.7)) - 0.5;
      float d = length(f - o * 0.5);
      float tw = 0.7 + 0.3 * sin(uTime * 3.0 + h * 40.0);
      col += vec3(2.6, 2.2, 0.9) * smoothstep(0.08, 0.0, d) * 3.0 * tw;
      col += vec3(1.4, 1.2, 0.4) * smoothstep(0.32, 0.12, d) * smoothstep(0.2, 0.28, d) * 1.2 * tw;
      col += vec3(1.0, 0.85, 0.3) * smoothstep(0.35, 0.0, d) * 0.4 * tw;
    }
    return col * (0.75 + strokes * 0.6);
  }
`;
function starryMats() {
  if (skyMat && floorMat) return { skyMat, floorMat };
  skyMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: globalUniforms.uTime, uNoise: globalUniforms.uNoise, uFade: { value: 0 } },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vW; void main(){ vP = position; vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      ${STARRY_GLSL}
      varying vec3 vP; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 d = normalize(vP);
        vec2 p = d.xz / (1.0 + d.y) ; // stereographic projection of the dome
        vec3 col = starry(p * 0.9);
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vW))), 2.0);
        float base = smoothstep(0.0, 0.15, d.y);
        float a = (0.38 + fres * 0.35) * uFade * (0.6 + 0.4 * base);
        col += vec3(0.4, 0.6, 1.4) * fres * 0.8;
        gl_FragColor = vec4(col, a);
      }`,
  });
  floorMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: globalUniforms.uTime, uNoise: globalUniforms.uNoise, uFade: { value: 0 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      ${STARRY_GLSL}
      varying vec2 vP;
      void main(){
        vec2 p = vP / 12.0;
        float r = length(p);
        vec3 col = starry(p * 1.2) * 0.55;
        float edge = smoothstep(1.0, 0.94, r) * (0.55 + 0.45 * smoothstep(0.8, 1.0, r));
        col += vec3(1.6, 1.3, 0.4) * smoothstep(0.02, 0.0, abs(r - 0.985)) * 2.0;
        gl_FragColor = vec4(col * edge * uFade, 1.0);
      }`,
  });
  return { skyMat, floorMat };
}

function createStarryNight(g: Game, owner: Hero) {
  const pos = owner.pos.clone();
  pos.y = g.world.heightAt(pos.x, pos.z);
  const { skyMat, floorMat } = starryMats();
  const sm = skyMat.clone(); const fm = floorMat.clone();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(12, 64, 24, 0, TAU, 0, Math.PI / 2), sm);
  dome.renderOrder = 15;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 96).rotateX(-Math.PI / 2), fm);
  floor.position.y = 0.08;
  floor.renderOrder = 3;
  const group = new THREE.Group();
  group.position.copy(pos);
  group.add(dome, floor);
  g.scene.add(group);
  g.play('starry', pos, 1.2);
  g.vfx.flash(pos.clone().setY(pos.y + 6), new THREE.Color(0.4, 0.55, 1.4), 70, 2.0, 30);
  g.vfx.shockwave(pos, new THREE.Color(1.2, 1.6, 3.2), 14, 0.8, 0.05);
  g.vfx.shockwave(pos, new THREE.Color(3, 2.4, 0.8), 10, 0.6, 0.08);
  g.vfx.glyph('The Starry Night', pos.clone().setY(pos.y + 7), { color: '#ffe9a6', glow: '#4f7bff', scale: 2.4, dur: 2.4, vy: 0.3 });
  g.shake(pos, 0.4, 30);
  // the canvas opens: rune of the brush, a painted ripple and a swirl of strokes on the floor
  g.vfx.rune(pos, new THREE.Color(1.6, 1.4, 0.5), 24, 1.6, 0.6, 0.9, 1.05);
  screenFx.ripple(pos.clone().setY(pos.y + 2), 12, 0.9, 0.8);
  if (owner.isLocal) screenFx.zoomPunch(0.5);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU * 2, r = 1.5 + (i / 28) * 9.5;
    const c = i % 3 === 0 ? new THREE.Color(0.95, 0.8, 0.2) : i % 3 === 1 ? new THREE.Color(0.12, 0.28, 0.85) : new THREE.Color(0.35, 0.6, 1);
    g.vfx.pa({ x: pos.x + Math.cos(a) * r, y: pos.y + 0.05, z: pos.z + Math.sin(a) * r, r: c.r, g: c.g, b: c.b, a: 0.55, size: rand(2.4, 3.2), life: 7, hold: 0.85, fadeIn: 0.03 + i * 0.008, shape: Shape.Stroke, flat: true, rot: -(a + Math.PI / 2 + 0.35), aux: Math.random() });
  }
  interface Shooter { from: THREE.Vector3; to: THREE.Vector3; t: number; trail: Trail | null }
  const shooters: Shooter[] = [];
  let swirlT = 0;
  let tick = 0;
  let starT = 0;
  g.addZone({
    owner, team: owner.team, pos, radius: 12, t: 0, dur: 7, dead: false, kind: 'starry',
    update(z, g, dt) {
      const fadeIn = Math.min(1, z.t / 0.6), fadeOut = Math.min(1, (z.dur - z.t) / 0.6);
      const f = Math.min(fadeIn, fadeOut);
      sm.uniforms.uFade.value = f;
      fm.uniforms.uFade.value = f;
      dome.scale.set(1, 0.2 + 0.8 * (1 - Math.pow(1 - fadeIn, 3)), 1);
      // drifting stars inside
      if (Math.random() < dt * 25) {
        const a = rand(0, TAU), r = Math.sqrt(Math.random()) * 11;
        g.vfx.p({ x: pos.x + Math.cos(a) * r, y: pos.y + rand(1, 8), z: pos.z + Math.sin(a) * r, vx: -Math.sin(a) * 1.5, vz: Math.cos(a) * 1.5, r: 3, g: 2.6, b: 1.1, size: rand(0.12, 0.3), life: rand(1, 2), shape: Shape.Star, spin: 1, fadeIn: 0.3 });
      }
      // swirling brush strokes ride the wind of the painting
      swirlT -= dt;
      if (swirlT <= 0 && f > 0.3) {
        swirlT = 0.05;
        const a = rand(0, TAU), r = rand(3, 10.5), y = rand(2, 7);
        const sp = rand(3, 5);
        const c = Math.random() < 0.35 ? new THREE.Color(2.4, 2.0, 0.7) : new THREE.Color(0.5, 0.9, 2.6);
        g.vfx.p({ x: pos.x + Math.cos(a) * r, y: pos.y + y, z: pos.z + Math.sin(a) * r, vx: -Math.sin(a) * sp, vy: rand(-0.3, 0.3), vz: Math.cos(a) * sp, r: c.r * 0.6, g: c.g * 0.6, b: c.b * 0.6, size: rand(0.9, 1.5), life: rand(0.9, 1.4), shape: Shape.Stroke, stretch: 0.12, fadeIn: 0.25, drag: 0.2 });
      }
      // shooting stars streak down with real trails
      for (let i = shooters.length - 1; i >= 0; i--) {
        const sh = shooters[i];
        sh.t += dt / 0.24;
        const k = Math.min(1, sh.t);
        const head = _v1.lerpVectors(sh.from, sh.to, k * k);
        sh.trail?.push(head);
        g.vfx.p({ x: head.x, y: head.y, z: head.z, r: STAR.r, g: STAR.g, b: STAR.b, size: 0.35, life: 0.06, shape: Shape.Star });
        if (k >= 1) {
          sh.trail?.stop();
          g.vfx.burst(sh.to, new THREE.Color(3, 2.5, 0.9), 14, 5, 0.1, 0.4);
          g.vfx.flare(sh.to, STAR, 2.2, 0.16, rand(-0.4, 0.4));
          g.vfx.p({ x: sh.to.x, y: sh.to.y, z: sh.to.z, r: STAR.r, g: STAR.g, b: STAR.b, size: 0.3, grow: 4, life: 0.25, shape: Shape.Ring, aux: 0.15 });
          for (let j = 0; j < 4; j++) g.vfx.p({ x: sh.to.x, y: sh.to.y, z: sh.to.z, vx: rand(-3, 3), vy: rand(1, 4), vz: rand(-3, 3), r: STAR.r, g: STAR.g, b: STAR.b, size: rand(0.15, 0.25), life: 0.6, gravity: 6, shape: Shape.Star, spin: rand(-5, 5) });
          shooters.splice(i, 1);
        }
      }
      tick += dt; starT += dt;
      const doTick = tick >= 0.5;
      if (doTick) tick = 0;
      const enemies = g.enemiesNear(z.team, pos, z.radius);
      for (const e of enemies) {
        e.applySlow(0.4, 0.3);
        if (doTick) g.damage(e, 15, owner, { at: e.chest });
      }
      if (doTick) for (const a of g.alliesNear(z.team, pos, z.radius)) g.heal(a, 12.5, owner);
      // shooting stars striking enemies
      if (starT > 0.35 && enemies.length) {
        starT = 0;
        const e = pick(enemies);
        const from = new THREE.Vector3(pos.x + rand(-6, 6), pos.y + 10, pos.z + rand(-6, 6));
        const to = e.chest;
        const trail = g.vfx.trail({ color: STAR, endColor: NIGHT, width: 0.16, life: 0.35, style: TrailStyle.Energy, minDist: 0.4 });
        trail?.push(from);
        shooters.push({ from, to, t: 0, trail });
        g.play('starFall', to, 0.75);
      }
    },
    dispose() {
      for (const sh of shooters) sh.trail?.stop();
      // the painting dissolves into stars
      for (let i = 0; i < 40; i++) {
        const a = rand(0, TAU), r = Math.sqrt(Math.random()) * 11;
        g.vfx.p({ x: pos.x + Math.cos(a) * r, y: pos.y + rand(1, 9), z: pos.z + Math.sin(a) * r, vx: rand(-0.5, 0.5), vy: rand(0.5, 2), vz: rand(-0.5, 0.5), r: STAR.r, g: STAR.g, b: STAR.b, r2: NIGHT.r, g2: NIGHT.g, b2: NIGHT.b, size: rand(0.1, 0.25), life: rand(0.8, 1.5), shape: Shape.Star, spin: rand(-2, 2) });
      }
      g.scene.remove(group); dome.geometry.dispose(); floor.geometry.dispose(); sm.dispose(); fm.dispose();
    },
  });
}

// ───────────── Kit ─────────────
class VanGoghKit implements HeroKit {
  private ci = 0;
  primary(h: Hero, g: Game) {
    h.primaryCd = 0.42;
    const m = h.muzzle('R');
    const dir = h.aimDir(m);
    h.anim.attack = 1; h.anim.attackSide = 1; h.anim.attackKind = 'stroke';
    const col = PAINTS[this.ci++ % PAINTS.length];
    g.play('paint', m, 0.7);
    for (let i = 0; i < 5; i++) g.vfx.pa({ x: m.x, y: m.y, z: m.z, vx: dir.x * 4 + rand(-1, 1), vy: dir.y * 4 + rand(0, 1.5), vz: dir.z * 4 + rand(-1, 1), r: col.r, g: col.g, b: col.b, size: rand(0.04, 0.08), life: 0.5, gravity: 9 });
    // the flick of the brush: a quick stroke in the air and a glint of wet paint
    g.vfx.pa({ x: m.x, y: m.y, z: m.z, vx: dir.x * 6, vy: dir.y * 6 + 1, vz: dir.z * 6, r: col.r, g: col.g, b: col.b, a: 0.9, size: 0.5, life: 0.18, shape: Shape.Stroke, stretch: 0.08, drag: 4 });
    g.vfx.flare(m, new THREE.Color(col.r * 2 + 0.4, col.g * 2 + 0.4, col.b * 2 + 0.4), 0.7, 0.07);
    const trail = g.vfx.trail({ color: col, endColor: col, width: 0.11, life: 0.2, style: TrailStyle.Brush, minDist: 0.3, alpha: 0.95 });
    trail?.push(m);
    g.spawnProjectile({
      owner: h, kind: 'paint', pos: m.clone(), vel: dir.multiplyScalar(50).add(new THREE.Vector3(0, 1.0, 0)), gravity: 8, radius: 0.2, life: 1.6, damage: 30, color: col,
      render(p, g) {
        const pool = g.pool('paintGlob', globPool);
        const w = Math.sin(p.age * 30 + p.seed * 10) * 0.25;
        _q1.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _v1.copy(p.vel).normalize());
        _m1.compose(p.pos, _q1, new THREE.Vector3(0.17 * (1 + w), 0.17 * (1 - w), 0.24));
        pool.add(_m1, p.color);
        trail?.push(p.pos);
        if (Math.random() < 0.7) g.vfx.pa({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: p.vel.x * 0.1 + rand(-0.4, 0.4), vy: rand(-0.5, 0.5), vz: p.vel.z * 0.1 + rand(-0.4, 0.4), r: p.color.r, g: p.color.g, b: p.color.b, size: rand(0.04, 0.08), life: 0.6, gravity: 12 });
      },
      onExpire() { trail?.stop(); },
      onHit(p, g, hit, point) {
        trail?.push(point); trail?.stop();
        if (hit) {
          const crit = point.y > hit.pos.y + 1.42;
          g.damage(hit, p.damage, p.owner, { crit, at: point, fx: false });
        }
        for (const e of g.enemiesNear(p.owner.team, point, 2.2)) if (e !== hit) g.damage(e, 12, p.owner, { at: e.chest, fx: false });
        g.play('splat', point, 0.9);
        // strokes of paint fly out of the splash, plus a bright wet flash
        for (let i = 0; i < 6; i++) {
          const a = rand(0, TAU);
          g.vfx.pa({ x: point.x, y: point.y, z: point.z, vx: Math.cos(a) * rand(3, 6), vy: rand(1, 4), vz: Math.sin(a) * rand(3, 6), r: p.color.r, g: p.color.g, b: p.color.b, a: 0.95, size: rand(0.35, 0.55), life: rand(0.25, 0.4), shape: Shape.Stroke, stretch: 0.1, drag: 3, gravity: 6 });
        }
        g.vfx.flare(point, new THREE.Color(p.color.r * 2.5 + 0.5, p.color.g * 2.5 + 0.5, p.color.b * 2.5 + 0.5), hit ? 1.4 : 1, 0.1);
        if (hit) for (let i = 0; i < 6; i++) g.vfx.pa({ x: hit.pos.x + rand(-0.3, 0.3), y: point.y + rand(-0.3, 0.2), z: hit.pos.z + rand(-0.3, 0.3), vy: rand(-0.5, 0), r: p.color.r * 0.8, g: p.color.g * 0.8, b: p.color.b * 0.8, size: rand(0.05, 0.08), life: rand(0.6, 1), gravity: 5, hold: 0.5 });
        for (let i = 0; i < 16; i++) g.vfx.pa({ x: point.x, y: point.y, z: point.z, vx: rand(-4, 4), vy: rand(1, 5), vz: rand(-4, 4), r: p.color.r, g: p.color.g, b: p.color.b, size: rand(0.05, 0.12), life: rand(0.4, 0.8), gravity: 16, drag: 0.5 });
        g.vfx.p({ x: point.x, y: point.y, z: point.z, r: p.color.r * 2, g: p.color.g * 2, b: p.color.b * 2, size: 0.4, grow: 4, life: 0.2, shape: Shape.Ring, aux: 0.2 });
        const gy = g.world.heightAt(point.x, point.z);
        const ground = hit ? hit.pos.clone() : point.clone();
        if (point.y - gy < 1.2 || hit) { ground.y = g.world.heightAt(ground.x, ground.z); g.vfx.splat(ground, p.color, rand(1.3, 2.0)); }
      },
    } as Omit<Projectile, 'prev' | 'age' | 'dead' | 'seed'>);
  }

  secondary(h: Hero, g: Game) {
    const m = h.muzzle('R'); // the palette is in his left hand
    const dir = h.aimDir(m);
    h.anim.attack = 1; h.anim.attackSide = 1; h.anim.attackKind = 'toss';
    g.play('seedToss', m, 0.7);
    g.vfx.flare(m, SUN, 0.9, 0.1);
    const trail = g.vfx.trail({ color: new THREE.Color(2.6, 1.9, 0.4), endColor: new THREE.Color(0.5, 1.4, 0.3), width: 0.06, life: 0.4, style: TrailStyle.Smooth, minDist: 0.25 });
    g.spawnProjectile({
      owner: h, kind: 'seed', pos: m.clone(), vel: dir.multiplyScalar(20).add(new THREE.Vector3(0, 4, 0)), gravity: 16, radius: 0.15, life: 2.5, damage: 0, color: SUN,
      render(p, g) {
        g.pool('seed', seedPool).add(_m1.compose(p.pos, _q1.identity(), new THREE.Vector3(0.1, 0.1, 0.1)));
        g.vfx.p({ x: p.pos.x, y: p.pos.y, z: p.pos.z, r: SUN.r, g: SUN.g, b: SUN.b, size: 0.12, life: 0.3, shape: Shape.Star });
        trail?.push(p.pos);
        if (Math.random() < 0.3) g.vfx.pa({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: rand(-1, 1), vy: rand(-0.5, 0.5), vz: rand(-1, 1), r: 1, g: 0.7, b: 0.06, a: 1, size: 0.09, life: 0.8, gravity: 3, drag: 2, shape: Shape.Petal, spin: rand(-6, 6) });
      },
      onHit(p, g, _hit, point) { trail?.stop(); bloomSunflower(g, p.owner, point); },
      onExpire(p, g) { trail?.stop(); bloomSunflower(g, p.owner, p.pos); },
    } as Omit<Projectile, 'prev' | 'age' | 'dead' | 'seed'>);
    return true;
  }

  ult(h: Hero, g: Game) {
    h.anim.cast = 1;
    h.kitState.castT = 0.8;
    createStarryNight(g, h);
    if (h.isLocal) g.events.onAnnounce('THE STARRY NIGHT', 'Paint the sky', 'blue');
    return true;
  }

  update(h: Hero, _g: Game, dt: number) {
    if (h.kitState.castT > 0) {
      h.kitState.castT -= dt;
      h.anim.cast = Math.max(0, Math.min(1, h.kitState.castT * 2));
    }
  }
}

function buildVanGogh(r: RigBuilder) {
  r.base({ skin: '#eecaa7', shirt: '#2b4f94', pants: '#4a4630', shoes: '#4a2e1b', sleeves: '#2b4f94', torsoScale: [1, 1.02, 1] });
  const coat = r.mat('#2b4f94', 0.85);
  const ginger = r.mat('#c9622a', 0.9);
  const straw = r.mat('#e7c25c', 0.85);
  const band = r.mat('#1f3566', 0.7);
  const bandage = r.mat('#f2efe8', 0.95);
  const wood = r.mat('#c99a62', 0.6);
  // coat tails
  r.add(r.hips, new THREE.CylinderGeometry(0.2, 0.26, 0.42, 16, 1, true), coat, [0, -0.17, -0.01]);
  r.add(r.spine, new THREE.TorusGeometry(0.09, 0.03, 6, 16), coat, [0, 0.38, 0.0], [Math.PI / 2, 0, 0], [1.2, 1.2, 1]);
  const btn = r.mat('#d9b36a', 0.3, 0.8);
  for (let i = 0; i < 3; i++) r.add(r.spine, r.sphere(0.012, 6, 4), btn, [0.04, 0.08 + i * 0.08, 0.14]);
  // ginger beard + hair
  for (let i = 0; i < 11; i++) {
    const a = -Math.PI * 0.85 + (i / 10) * Math.PI * 0.7 + Math.PI / 2;
    r.add(r.head, r.sphere(0.035, 8, 6), ginger, [Math.cos(a) * 0.095, -0.015 + Math.sin(i * 1.9) * 0.008, Math.sin(a) * 0.085 + 0.01]);
  }
  r.add(r.head, r.sphere(0.05, 10, 8), ginger, [0, -0.04, 0.085], [0, 0, 0], [1.2, 0.9, 0.8]);
  for (const x of [-0.03, 0.03]) r.add(r.head, r.sphere(0.024, 8, 6), ginger, [x, 0.018, 0.105], [0, 0, 0], [1.3, 0.6, 0.7]);
  r.add(r.head, r.sphere(0.118, 14, 10), ginger, [0, 0.08, -0.025], [0, 0, 0], [1.02, 0.7, 1.02]);
  // bandaged ear wrap
  r.add(r.head, new THREE.TorusGeometry(0.122, 0.018, 6, 24), bandage, [0, 0.03, 0], [0.35, 0, 0.5]);
  r.add(r.head, r.sphere(0.05, 10, 8), bandage, [-0.115, 0.05, 0], [0, 0, 0], [0.6, 1, 1]);
  // straw hat
  r.add(r.head, new THREE.CylinderGeometry(0.25, 0.26, 0.015, 32), straw, [0, 0.15, 0], [0.08, 0, 0]);
  r.add(r.head, new THREE.CylinderGeometry(0.11, 0.125, 0.11, 24), straw, [0, 0.2, -0.005], [0.08, 0, 0]);
  r.add(r.head, new THREE.CylinderGeometry(0.127, 0.127, 0.03, 24), band, [0, 0.165, -0.002], [0.08, 0, 0]);
  // palette (left) + brush (right)
  const pal = r.add(r.handL, new THREE.CylinderGeometry(0.17, 0.17, 0.015, 24), wood, [0.05, -0.06, 0.12], [Math.PI / 2 - 0.3, 0, 0.2]);
  const dab = [0x1f4fe0, 0xffc21a, 0x0e8c66, 0xf04a14, 0xffffff, 0x8a3fd1];
  dab.forEach((c, i) => {
    const a = (i / dab.length) * TAU;
    r.add(pal, new THREE.SphereGeometry(0.025, 8, 6), r.mat(c, 0.25), [Math.cos(a) * 0.1, 0.012, Math.sin(a) * 0.1], [0, 0, 0], [1, 0.4, 1]);
  });
  r.add(r.handR, new THREE.CylinderGeometry(0.008, 0.012, 0.32, 6), wood, [0, -0.05, 0.12], [Math.PI / 2 + 0.3, 0, 0]);
  r.add(r.handR, new THREE.ConeGeometry(0.016, 0.06, 6), r.mat('#1f4fe0', 0.3, 0, { emissive: new THREE.Color(0.05, 0.15, 0.6) }), [0, -0.1, 0.27], [Math.PI / 2 + 0.3, 0, 0]);
}

export const VANGOGH: HeroDef = {
  id: 'vangogh',
  name: 'Vincent van Gogh',
  title: 'The Dreamer',
  role: 'Strategist',
  tagline: 'I dream my painting, and then I paint my dream.',
  color: '#ffc21a',
  accent: '#2b6bff',
  maxHp: 275,
  modelUrl: '/models/heroes/vangogh.glb',
  motion: 'artist',
  held: { prop: 'palette', hand: 'L', size: 0.46, pos: [0.02, -0.09, 0.1], rot: [0, 0, 0] },
  speed: 6.0,
  secondaryCd: 12,
  ultCost: 1500,
  botRange: 13,
  ratings: { damage: 0.6, mobility: 0.4, support: 0.95, difficulty: 0.6 },
  abilities: {
    primary: { key: 'LMB', name: 'Impasto Shot', desc: 'Fling thick globs of oil paint that splash nearby enemies and stain the ground.', stat: '30 dmg + 12 splash', icon: ICONS.paint },
    secondary: { key: 'RMB', name: 'Sunflower Field', desc: 'Toss a seed that blooms into a giant sunflower, healing all allies around it.', stat: '32 hp/s for 6 s · 12 s cd', icon: ICONS.sunflower },
    ult: { key: 'SHIFT', name: 'The Starry Night', desc: 'Paint a swirling night sky over the battlefield: enemies inside are slowed and burned by falling stars, allies are healed.', stat: '7 s · 12 m dome', icon: ICONS.starry },
  },
  look: { build: buildVanGogh },
  createKit: () => new VanGoghKit(),
};

export function warmupVanGogh(g: Game): THREE.Object3D[] {
  g.pool('paintGlob', globPool);
  g.pool('seed', seedPool);
  const geos = sunflowerGeos();
  const mats = sunflowerMats();
  const { skyMat, floorMat } = starryMats();
  const geo = new THREE.PlaneGeometry(1, 1);
  return [new THREE.Mesh(geos.petals, mats.petals), new THREE.Mesh(geos.head, mats.head), new THREE.Mesh(geos.stem, mats.stem), new THREE.Mesh(geo, skyMat), new THREE.Mesh(geo, floorMat)];
}
