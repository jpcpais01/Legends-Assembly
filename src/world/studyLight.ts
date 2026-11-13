import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

/**
 * Sunlight for the Giant's Study: the sun only reaches the room through its two arched windows.
 *
 * One analytic test, `studySun(worldPos)`, says how much of the sun a point sees: it follows the ray towards the sun to
 * the first wall it would cross and checks it against that window's arch, its recess and its mullions, with a
 * penumbra that widens with distance. The same function shades every lit material (patched into three's light loop),
 * drives the volumetric god rays (a depth-aware ray march) and lights the dust motes, so beams, floor patches and
 * motes always agree. The desk's own shadow map still handles heroes and props.
 *
 * Room numbers are João's Cartographer's study model (scripts/build-study-room.mjs), in model units, mapped into the
 * world by ROOM_K around the desk.
 */

// ── the room model in the world: world = (model - center) * K, the model floor lands on the arena floor
export const ROOM_K = 170;
export const ROOM_CX = -0.005, ROOM_CZ = 0.005, ROOM_FLOOR_M = -0.436;
export const FLOOR_Y = -38;
const wx = (x: number) => (x - ROOM_CX) * ROOM_K;
const wy = (y: number) => FLOOR_Y + (y - ROOM_FLOOR_M) * ROOM_K;
const wz = (z: number) => (z - ROOM_CZ) * ROOM_K;

/** The world transform of the room model. */
export function roomMatrix() {
  return new THREE.Matrix4().makeTranslation(-ROOM_CX * ROOM_K, FLOOR_Y - ROOM_FLOOR_M * ROOM_K, -ROOM_CZ * ROOM_K)
    .multiply(new THREE.Matrix4().makeScale(ROOM_K, ROOM_K, ROOM_K));
}

/** Towards the sun: low through the back window so its patch of light, mullions and all, falls across the desk. */
export const SUN_DIR = new THREE.Vector3(0.13, 0.47, -0.8).normalize();

// window aperture (measured from the model) and its mullions, in the back window's frame (world x, world y)
const AP = { x0: wx(-0.18), x1: wx(0.2775), y0: wy(-0.157), ys: wy(0.294), top: wy(0.513) };
const ACX = (AP.x0 + AP.x1) / 2, ARX = (AP.x1 - AP.x0) / 2, ARY = AP.top - AP.ys;
const VBARS = [-0.1325, -0.035, 0.08, 0.1975].map(wx);
const HBARS = [-0.015, 0.133].map(wy);
const f = (v: number) => v.toFixed(3);

/** Window planes: the back window (z), the side window copy (x, its frame shifted along z by BOFF). */
export const WIN = {
  zA: wz(-0.835), zAi: wz(-0.695),          // mullion plane, inner wall face
  xB: wx(0.835), xBi: wx(0.705),
  bOff: (0.1 - ROOM_CZ + ROOM_CX) * ROOM_K, // side window frame: z - bOff = back window x
  ceil: wy(0.705), floor: FLOOR_Y,
  ap: AP,
};
export const ROOM_BOX = { x0: wx(-0.715), x1: WIN.xBi, z0: WIN.zAi, z1: wz(0.705), y0: FLOOR_Y, y1: WIN.ceil };

/** GLSL: `float studySun(vec3 p)` (0 = in the walls' shadow, 1 = sunlit), self-contained. */
export const STUDY_SUN_GLSL = /* glsl */ `
#ifndef STUDY_SUN
#define STUDY_SUN
const vec3 ST_SUN = vec3(${f(SUN_DIR.x)}, ${f(SUN_DIR.y)}, ${f(SUN_DIR.z)});
float stApSD(vec2 q, float m) {
  if (q.y < ${f(AP.ys)}) return min(min(q.x - ${f(AP.x0)} + m, ${f(AP.x1)} + m - q.x), q.y - ${f(AP.y0)} + m);
  vec2 e = (q - vec2(${f(ACX)}, ${f(AP.ys)})) / vec2(${f(ARX)} + m, ${f(ARY)} + m);
  return (1.0 - length(e)) * min(${f(ARX)} + m, ${f(ARY)} + m);
}
float stBarSD(vec2 q) {
  float d = abs(q.y - ${f(AP.ys)}) - 2.9;
  if (q.y < ${f(AP.ys)}) {
    ${VBARS.map((b) => `d = min(d, abs(q.x - ${f(b)}) - 1.9);`).join(' ')}
    ${HBARS.map((h) => `d = min(d, abs(q.y - ${f(h)}) - 1.4);`).join(' ')}
  } else {
    vec2 r = q - vec2(${f(ACX)}, ${f(AP.ys)});
    float l = length(r);
    d = min(d, abs(r.x) - 1.7);
    d = min(d, abs(l - 20.4) - 1.1);
    if (l > 20.4) { d = min(d, abs(dot(r, vec2(0.7071, -0.7071))) - 1.1); d = min(d, abs(dot(r, vec2(0.7071, 0.7071))) - 1.1); }
  }
  return d;
}
float stWin(vec2 q, vec2 qi, float t) {
  float w = 0.35 + t * 0.011;
  return smoothstep(-w, w, stApSD(q, 0.0)) * smoothstep(-w, w, stBarSD(q)) * smoothstep(-w, w, stApSD(qi, 9.0));
}
float studySun(vec3 p) {
  if (p.z < ${f(WIN.zA)} + 0.5 || p.x > ${f(WIN.xB)} - 0.5) return 1.0;
  float tA = (${f(WIN.zA)} - p.z) / ST_SUN.z;
  float tB = (${f(WIN.xB)} - p.x) / ST_SUN.x;
  float tC = (${f(WIN.ceil)} - p.y) / ST_SUN.y;
  if (tC < min(tA, tB)) return 0.0;
  if (tA < tB) {
    vec3 h = p + ST_SUN * tA, hi = p + ST_SUN * ((${f(WIN.zAi)} - p.z) / ST_SUN.z);
    return stWin(h.xy, hi.xy, tA);
  }
  vec3 h = p + ST_SUN * tB, hi = p + ST_SUN * ((${f(WIN.xBi)} - p.x) / ST_SUN.x);
  return stWin(vec2(h.z - ${f(WIN.bOff)}, h.y), vec2(hi.z - ${f(WIN.bOff)}, hi.y), tB);
}
#endif
`;

let patched = false;
/**
 * Make every lit material's directional light respect the windows. Done once, before anything compiles; only the study
 * arena calls it (one arena per page load), so other arenas never carry the test.
 */
export function patchSunThroughWindows() {
  if (patched) return;
  patched = true;
  THREE.ShaderChunk.lights_pars_begin += STUDY_SUN_GLSL;
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= studySun( transpose( mat3( viewMatrix ) ) * geometryPosition + cameraPosition );',
  );
}

/**
 * Volumetric god rays: march the view ray through the room up to the depth buffer and gather sunlight wherever the
 * window test passes. Dithered, so a handful of steps reads as a smooth beam; the desk shades the air under it.
 */
export class GodRaysEffect extends Effect {
  private cam: THREE.Camera;
  constructor(camera: THREE.Camera, steps: number) {
    super('GodRaysEffect', /* glsl */ `
      uniform mat4 uProjInv;
      uniform mat4 uCamWorld;
      uniform vec3 uCamPos;
      uniform vec3 uColor;
      uniform float uDensity;
      uniform float uFrame;
      ${STUDY_SUN_GLSL}
      float stIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        vec3 wp = (uCamWorld * vec4(v.xyz / v.w, 1.0)).xyz;
        vec3 rd = wp - uCamPos;
        float len = min(length(rd), 520.0);
        rd = normalize(rd);
        float dt = len / float(STEPS);
        float off = stIgn(gl_FragCoord.xy + uFrame * 5.588238);
        float acc = 0.0;
        for (int i = 0; i < STEPS; i++) {
          vec3 p = uCamPos + rd * (dt * (float(i) + off));
          if (p.z < ${f(ROOM_BOX.z0)} || p.x > ${f(ROOM_BOX.x1)} || p.x < ${f(ROOM_BOX.x0)} || p.z > ${f(ROOM_BOX.z1)} || p.y < ${f(ROOM_BOX.y0)} || p.y > ${f(ROOM_BOX.y1)}) continue;
          float s = studySun(p);
          // under the desk top: the desk is in the way
          if (p.y < 0.0) { vec2 q = p.xz - ST_SUN.xz * (p.y / ST_SUN.y); if (abs(q.x) < 43.0 && abs(q.y) < 30.0) s = 0.0; }
          acc += s;
        }
        float mu = dot(rd, ST_SUN);
        float g = 0.55;
        float phase = 0.3 + (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.08;
        outputColor = vec4(inputColor.rgb + uColor * (acc * dt * uDensity * phase), inputColor.a);
      }`, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      defines: new Map([['STEPS', String(steps)]]),
      uniforms: new Map<string, THREE.Uniform>([
        ['uProjInv', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
        ['uColor', new THREE.Uniform(new THREE.Color(1.0, 0.72, 0.42))],
        ['uDensity', new THREE.Uniform(0.0022)],
        ['uFrame', new THREE.Uniform(0)],
      ]),
    });
    this.cam = camera;
  }
  get color() { return this.uniforms.get('uColor')!.value as THREE.Color; }
  setSteps(steps: number) { this.defines.set('STEPS', String(steps)); this.setChanged(); }
  update() {
    const c = this.cam as THREE.PerspectiveCamera;
    this.uniforms.get('uProjInv')!.value.copy(c.projectionMatrixInverse);
    this.uniforms.get('uCamWorld')!.value.copy(c.matrixWorld);
    this.uniforms.get('uCamPos')!.value.setFromMatrixPosition(c.matrixWorld);
    this.uniforms.get('uFrame')!.value = (this.uniforms.get('uFrame')!.value + 1) % 64;
  }
}

/** Dust drifting through the room, glowing only where a sunbeam catches it. */
export function makeDust(count: number) {
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rnd(ROOM_BOX.x0 + 10, ROOM_BOX.x1 - 5);
    pos[i * 3 + 1] = rnd(-30, WIN.ceil - 20);
    pos[i * 3 + 2] = rnd(ROOM_BOX.z0 + 5, 70);
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      ${STUDY_SUN_GLSL}
      attribute float aSeed;
      uniform float uTime; uniform float uScale;
      varying float vA;
      void main() {
        float t = uTime * (0.05 + aSeed * 0.07) + aSeed * 40.0;
        vec3 p = position + vec3(sin(t * 1.3) * 4.0, sin(t * 0.7 + aSeed * 6.0) * 6.0 - mod(uTime * (0.4 + aSeed), 30.0) * 0.0, cos(t * 1.1) * 4.0);
        vA = studySun(p) * (0.35 + 0.65 * fract(aSeed * 13.7));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = vA > 0.01 ? uScale * (0.6 + aSeed) * 90.0 / -mv.z : 0.0;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, r) * vA;
        gl_FragColor = vec4(vec3(1.0, 0.8, 0.55) * a * 0.9, 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}
