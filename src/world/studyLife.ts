import * as THREE from 'three';
import { STUDY_SUN_GLSL } from './studyLight';

/**
 * The study breathing: dust hanging in the sunbeams right where the legends fight, embers
 * drifting up the chimney, and the desk clutter jolting when something big lands.
 *
 * Shockwaves are a tiny ring buffer of uniforms (center, start time, strength) that the prop
 * materials, the dust and the room all read. Everything is vertex-shader work on geometry
 * that already exists, so a blast costs no extra draw calls and nothing on the CPU.
 */
const MAX_SHOCKS = 4;
export const SHOCK = {
  uShock: { value: Array.from({ length: MAX_SHOCKS }, () => new THREE.Vector4(0, 0, -99, 0)) },
  uShockTime: { value: 0 },
};
let shockIdx = 0;

/** Register a blast at `pos` (strength ~0.3 small hit … 1.5 a special landing). */
export function addShock(x: number, z: number, strength: number) {
  const s = SHOCK.uShock.value[shockIdx];
  s.set(x, z, SHOCK.uShockTime.value, strength);
  shockIdx = (shockIdx + 1) % MAX_SHOCKS;
}

export function tickShocks(time: number) { SHOCK.uShockTime.value = time; }

/** GLSL: `vec3 shockOffset(vec3 worldPos, float flex)` — how far a point is thrown right now. */
const SHOCK_GLSL = /* glsl */ `
uniform vec4 uShock[${MAX_SHOCKS}];
uniform float uShockTime;
vec3 shockOffset(vec3 p, float flex) {
  vec3 o = vec3(0.0);
  for (int i = 0; i < ${MAX_SHOCKS}; i++) {
    vec4 s = uShock[i];
    float age = uShockTime - s.z;
    if (age < 0.0 || age > 1.4) continue;
    vec2 d2 = p.xz - s.xy;
    float d = length(d2);
    // the jolt travels through the desk (fast) and dies off with distance and time
    float arrive = d / 70.0;
    float t = age - arrive;
    if (t < 0.0) continue;
    float amp = s.w * exp(-t * 5.0) / (1.0 + d * 0.09) * flex;
    float w = sin(t * 46.0 + d * 0.7);
    o.y += max(w, -0.25) * amp * 0.16;
    o.xz += (d2 / max(d, 0.001)) * w * amp * 0.06;
  }
  return o;
}`;

/**
 * Make a desk material jolt with the shockwaves. Geometry is baked in world space (mesh at
 * the origin), so `position` is the world position; things rock more the taller they stand
 * above the desk top and their feet stay planted.
 */
export function patchShock(mat: THREE.Material) {
  const m = mat as THREE.MeshStandardMaterial;
  if (m.userData.shock) return;
  m.userData.shock = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uShock = SHOCK.uShock;
    sh.uniforms.uShockTime = SHOCK.uShockTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${SHOCK_GLSL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += shockOffset(transformed, clamp(transformed.y / 2.5, 0.0, 1.0));');
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => (key ? key() : '') + '|shock';
}

/**
 * Dust motes at the legends' scale, over the desk: invisible in the shade, glittering where
 * a sunbeam crosses them, and blown outward by every blast.
 */
export function makeDeskDust(count: number, hx: number, hz: number) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * (hx + 6);
    pos[i * 3 + 1] = 0.3 + Math.pow(Math.random(), 1.6) * 16;
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * (hz + 6);
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uShock: SHOCK.uShock, uShockTime: SHOCK.uShockTime },
    vertexShader: /* glsl */ `
      ${STUDY_SUN_GLSL}
      attribute float aSeed;
      uniform float uTime; uniform float uScale;
      uniform vec4 uShock[${MAX_SHOCKS}];
      uniform float uShockTime;
      varying float vA;
      void main() {
        float t = uTime * (0.04 + aSeed * 0.05) + aSeed * 60.0;
        vec3 p = position + vec3(sin(t * 1.7) * 1.6, sin(t * 0.9 + aSeed * 7.0) * 1.1 + sin(uTime * 0.11 + aSeed * 30.0) * 0.6, cos(t * 1.3) * 1.6);
        // blasts push the air outward and up
        for (int i = 0; i < ${MAX_SHOCKS}; i++) {
          vec4 s = uShock[i];
          float age = uShockTime - s.z;
          if (age < 0.0 || age > 3.0) continue;
          vec3 d = p - vec3(s.x, 0.0, s.y);
          float l = length(d);
          float push = s.w * 7.0 * (1.0 - exp(-age * 3.0)) / (1.0 + l * l * 0.02) * exp(-age * 0.6);
          p += normalize(d + vec3(0.0, 2.0, 0.0)) * push;
        }
        float lit = studySun(p);
        float tw = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 40.0);
        vA = (lit * 0.85 + 0.03) * tw * (0.4 + 0.6 * fract(aSeed * 17.3));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = vA > 0.01 ? clamp(uScale * (0.5 + aSeed * 0.9) * 22.0 / -mv.z, 0.0, 7.0) : 0.0;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, r) * vA;
        gl_FragColor = vec4(vec3(1.0, 0.84, 0.6) * a, 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  return pts;
}

/** Embers riding the fireplace's heat up the chimney: a looping GPU particle column. */
export function makeEmbers(count: number, at: THREE.Vector3, width: number) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = at.x + (Math.random() * 2 - 1) * width * 0.25;
    pos[i * 3 + 1] = at.y;
    pos[i * 3 + 2] = at.z + (Math.random() * 2 - 1) * width * 0.5;
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uBoost: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime; uniform float uScale; uniform float uBoost;
      varying float vA; varying float vHot;
      void main() {
        float life = 2.2 + aSeed * 2.6;
        float t = mod(uTime + aSeed * 37.0, life) / life;
        float rise = t * (16.0 + aSeed * 18.0) * (1.0 + uBoost);
        vec3 p = position + vec3(sin(uTime * (1.2 + aSeed) + aSeed * 20.0) * (0.6 + t * 2.4), rise, cos(uTime * (0.9 + aSeed) + aSeed * 11.0) * (0.6 + t * 2.4));
        vHot = 1.0 - t;
        vA = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.55, 1.0, t)) * (0.6 + 0.4 * sin(uTime * 13.0 + aSeed * 90.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uScale * (0.5 + aSeed) * 70.0 / -mv.z, 0.0, 6.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA; varying float vHot;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, r) * vA;
        vec3 c = mix(vec3(1.6, 0.35, 0.05), vec3(3.0, 1.6, 0.5), vHot);
        gl_FragColor = vec4(c * a, 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}
