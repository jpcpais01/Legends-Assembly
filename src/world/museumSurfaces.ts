import * as THREE from 'three';
import { bake, NOISE_GLSL } from './studyDesk';

/**
 * The Grand Museum's code-built surfaces: the inlaid marble floor, the coffered ceiling and the marble of the cornices
 * and piers that tie the Meshy wall pieces together.
 *
 * One 1024² marble tile is baked on the GPU at load (vein strength, cloudiness, grain and fine veins in RGBA, periodic so
 * it tiles). Every marble here (white Carrara, verde antico, rosso porphyry, giallo, nero) is that tile tinted per
 * stone, sampled in world space with a per-slab offset, so nothing is ever stretched and no two slabs match. The floor
 * pattern (compass rose, brass inlay, nave runner, cabochon tiles) is analytic, antialiased with fwidth, and its
 * reflections are box-projected onto the hall, so the columns and the light pools sit in the polish where they should.
 */

const MARBLE_BAKE = /* glsl */ `
precision highp float;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 uv = vUv;
  float m1 = fbm(uv, vec2(3.0)), m2 = fbm(uv + 0.5, vec2(5.0)), m3 = fbm(uv + 0.21, vec2(4.0));
  float warp = m1 * 2.4 + m2 * 0.9;
  // main veins: a periodic wave pushed around by noise, kept only at its crest (thin, branching where the warp folds)
  float ph = (uv.x * 2.0 + uv.y * 1.0) * 6.2831853 + warp * 5.2;
  float v1 = pow(1.0 - abs(sin(ph)), 16.0) * (0.35 + 0.8 * m3);
  float ph2 = (-uv.x * 1.0 + uv.y * 3.0) * 6.2831853 + (fbm(uv + 0.7, vec2(4.0)) * 2.0 + m1) * 4.0;
  float v2 = pow(1.0 - abs(sin(ph2)), 34.0) * 0.8;
  float cloud = fbm(uv + 0.33, vec2(2.0)) * 0.7 + m2 * 0.3;
  float grain = vnoise(uv * 256.0, vec2(256.0)) * 0.6 + vnoise(uv * 97.0, vec2(97.0)) * 0.4;
  gl_FragColor = vec4(clamp(v1 + v2 * 0.45, 0.0, 1.0), cloud, grain, v2);
}`;

let marbleTex: THREE.Texture | null = null;
/** The shared marble tile (linear data, tiling, mipmapped). Baked once. */
export function bakeMarble(renderer: THREE.WebGLRenderer) {
  return (marbleTex ??= bake(renderer, 1024, 1024, MARBLE_BAKE, {}, false));
}

/** Stone palette: each takes a marble sample (r vein, g cloud, b grain, a fine vein) and returns linear albedo. */
const STONES_GLSL = /* glsl */ `
vec3 carrara(vec4 m) { vec3 b = mix(vec3(0.74, 0.72, 0.68), vec3(0.86, 0.85, 0.82), m.g); return b * (1.0 - 0.42 * m.r) - vec3(0.025, 0.024, 0.02) * m.b; }
vec3 verde(vec4 m) { vec3 b = mix(vec3(0.018, 0.075, 0.05), vec3(0.05, 0.15, 0.1), m.g); return b + vec3(0.3, 0.4, 0.34) * m.r * 0.7 + vec3(0.015) * m.b; }
vec3 rosso(vec4 m) { vec3 b = mix(vec3(0.22, 0.035, 0.03), vec3(0.36, 0.07, 0.05), m.g); return b * (0.8 + 0.35 * m.b) + vec3(0.32, 0.24, 0.2) * smoothstep(0.86, 0.95, m.b); }
vec3 giallo(vec4 m) { vec3 b = mix(vec3(0.56, 0.38, 0.16), vec3(0.72, 0.53, 0.26), m.g); return b * (1.0 - 0.32 * m.r); }
vec3 nero(vec4 m) { return vec3(0.018, 0.018, 0.022) + vec3(0.012) * m.g + vec3(0.5, 0.5, 0.48) * m.r * 0.55; }
const vec3 BRASS = vec3(0.98, 0.74, 0.4);
float mh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// 1 inside a band of half-width w around d = 0, antialiased
float band(float d, float w) { float f = fwidth(d) * 0.75 + 1e-4; return 1.0 - smoothstep(w - f, w + f, abs(d)); }
float inside(float d) { float f = fwidth(d) * 0.75 + 1e-4; return 1.0 - smoothstep(-f, f, d); }
`;

export interface FloorOpts {
  hx: number; hz: number;
  /** Where the reflection cube was captured, and the box it is projected onto. */
  probe: THREE.Vector3; boxMin: THREE.Vector3; boxMax: THREE.Vector3;
  /** Baked top-down occlusion and its world rectangle (x0, z0, x1, z1). */
  ao: THREE.Texture | null; aoRect: THREE.Vector4;
}

/** The inlaid floor. Geometry is a flat plane in world space (y = 0). */
export function makeFloorMaterial(renderer: THREE.WebGLRenderer, o: FloorOpts) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0, envMapIntensity: 1 });
  const uniforms = {
    tMarble: { value: bakeMarble(renderer) },
    tAO: { value: o.ao },
    uAORect: { value: o.aoRect },
    uUseAO: { value: o.ao ? 1 : 0 },
    uProbe: { value: o.probe }, uBoxMin: { value: o.boxMin }, uBoxMax: { value: o.boxMax },
  };
  mat.userData.uniforms = uniforms;
  const f = (v: number) => v.toFixed(2);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const ibl = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
      'vec4 envMapColor = textureLod( envMap, envMapRotation * reflectVec, roughnessToMip( roughness ) );',
      'reflectVec = boxProject( reflectVec );\n\t\t\tvec4 envMapColor = textureLod( envMap, envMapRotation * reflectVec, roughnessToMip( roughness ) );',
    );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vWP;
        uniform sampler2D tMarble, tAO;
        uniform vec4 uAORect;
        uniform float uUseAO;
        uniform vec3 uProbe, uBoxMin, uBoxMax;
        ${STONES_GLSL}
        vec3 fCol; float fRough, fMetal;
        vec3 boxProject(vec3 v) {
          vec3 a = (uBoxMax - vWP) / v, b = (uBoxMin - vWP) / v;
          vec3 e = max(a, b);
          float t = min(min(e.x, e.y), e.z);
          return normalize(vWP + v * t - uProbe);
        }
        vec4 slab(vec2 p, vec2 id, float s) { return texture2D(tMarble, p / s + vec2(mh(id), mh(id + 7.13))); }
        // paint one layer: c over the current color where k is 1
        void lay(float k, vec3 c, float r, float mtl) { fCol = mix(fCol, c, k); fRough = mix(fRough, r, k); fMetal = mix(fMetal, mtl, k); }
        void floorPattern(vec2 p) {
          vec4 m = slab(p, floor(p / 3.0), 6.0);
          float r = length(p);
          // field: 3 m Carrara slabs, fine grout, nero cabochons on the corners
          vec2 t = p / 3.0, ft = fract(t) - 0.5;
          fCol = carrara(m) * (0.94 + 0.12 * mh(floor(t) + 3.1)); fRough = 0.07 + 0.09 * m.g; fMetal = 0.0;
          vec2 cc = (0.5 - abs(ft)) * 3.0; // distance to the slab edges (m)
          float cab = cc.x + cc.y;          // diamond around each corner
          lay(inside(cab - 0.62), nero(m), 0.08, 0.0);
          lay(band(cab - 0.62, 0.035), BRASS, 0.3, 1.0);
          lay(band(min(cc.x, cc.y), 0.012) * (1.0 - inside(cab - 0.62)), carrara(m) * 0.55, 0.45, 0.0);
          // perimeter: a verde band with a brass line just inside it
          float edge = min(${f(o.hx)} - abs(p.x), ${f(o.hz)} - abs(p.y));
          lay(inside(edge - 2.4), verde(m), 0.09, 0.0);
          lay(band(edge - 2.65, 0.05), BRASS, 0.3, 1.0);
          // nave runner along x: rosso frame, giallo panels with verde roundels, brass edges
          float ny = abs(p.y), nx = abs(p.x);
          if (ny < 6.0 && nx < ${f(o.hx - 3.2)}) {
            float k = inside(ny - 5.2) * (1.0 - inside(r - 15.6));
            lay(k, rosso(m), 0.1, 0.0);
            float px = mod(p.x + 4.5, 9.0) - 4.5; // 9 m panels
            vec2 q = vec2(px, p.y);
            float panel = max(abs(q.x) - 3.7, abs(q.y) - 3.9);
            lay(k * inside(panel), giallo(m), 0.1, 0.0);
            float rd = length(q);
            lay(k * inside(rd - 2.6), verde(m), 0.08, 0.0);
            lay(k * inside(rd - 1.0), nero(m), 0.08, 0.0);
            lay(k * (band(rd - 2.6, 0.06) + band(panel, 0.05) + band(rd - 1.0, 0.04)), BRASS, 0.3, 1.0);
            lay(band(ny - 5.2, 0.07) * (1.0 - inside(r - 15.6)), BRASS, 0.3, 1.0);
          }
          // the crossing: an eight-point compass rose in verde, giallo, Carrara, rosso and nero, ringed in brass and rosso
          if (r < 15.6) {
            float a = atan(p.y, p.x) / 6.2831853;
            float u = fract(a * 8.0 + 0.5) - 0.5;   // long points on the axes and diagonals
            float u2 = fract(a * 8.0) - 0.5;        // short points between them
            float wL = 0.5 * (1.0 - r / 12.0), wS = 0.5 * (1.0 - r / 8.2);
            float dL = (abs(u) - wL) * r * 0.785, dS = (abs(u2) - wS) * r * 0.785; // to meters along the arc
            vec4 mc = slab(p, vec2(floor(a * 16.0), 1.0), 7.0);
            lay(inside(r - 12.3), verde(mc), 0.08, 0.0);
            float sS = inside(dS) * inside(r - 8.2);
            lay(sS, u2 > 0.0 ? rosso(mc) : nero(mc), 0.08, 0.0);
            float sL = inside(dL) * inside(r - 12.0);
            lay(sL, u > 0.0 ? giallo(mc) : carrara(mc) * 0.92, 0.07, 0.0);
            lay(band(dL, 0.03) * inside(r - 12.0) + band(dS, 0.025) * inside(r - 8.2) * (1.0 - sL), BRASS, 0.3, 1.0);
            lay(band(r - 12.55, 0.16), BRASS, 0.28, 1.0);
            lay(inside(r - 15.2) * (1.0 - inside(r - 12.75)), rosso(m), 0.09, 0.0);
            lay(band(r - 13.95, 0.09) , carrara(m), 0.09, 0.0);
            lay(band(r - 15.35, 0.12), BRASS, 0.28, 1.0);
            lay(inside(r - 1.4), nero(mc), 0.07, 0.0);
            lay(band(r - 1.4, 0.07) + band(r - 0.5, 0.06), BRASS, 0.28, 1.0);
          }
          // polish wears where feet go: a touch rougher and warmer in the middle lanes
          fRough += 0.05 * smoothstep(30.0, 0.0, abs(p.y) * 1.6 + abs(p.x) * 0.35) * (1.0 - fMetal);
        }
      `)
      .replace('#include <envmap_physical_pars_fragment>', ibl)
      .replace('#include <map_fragment>', 'floorPattern(vWP.xz);\ndiffuseColor.rgb = fCol;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = fMetal;')
      .replace('#include <aomap_fragment>', /* glsl */ `#include <aomap_fragment>
        if (uUseAO > 0.5) {
          // the occlusion was rendered looking down with -z up the image
          float fao = texture2D(tAO, vec2((vWP.x - uAORect.x) / (uAORect.z - uAORect.x), (uAORect.w - vWP.z) / (uAORect.w - uAORect.y))).r;
          reflectedLight.indirectDiffuse *= fao;
          reflectedLight.indirectSpecular *= mix(1.0, fao, 0.75);
          reflectedLight.directDiffuse *= mix(1.0, fao, 0.35);
        }`);
  };
  return mat;
}

/** Marble for the code-built architecture: Carrara picked by the dominant world axis (cheap triplanar). */
export function makeMarbleMaterial(renderer: THREE.WebGLRenderer, stone: 'carrara' | 'verde' | 'rosso' | 'nero' = 'carrara', roughness = 0.2) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness: 0 });
  const tMarble = { value: bakeMarble(renderer) };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tMarble = tMarble;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = mat3(modelMatrix) * objectNormal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP; varying vec3 vWN;\nuniform sampler2D tMarble;\n${STONES_GLSL}`)
      .replace('#include <map_fragment>', /* glsl */ `
        vec3 an = abs(vWN);
        vec2 tp = an.y > max(an.x, an.z) ? vWP.xz : (an.x > an.z ? vWP.zy : vWP.xy);
        vec4 mm = texture2D(tMarble, tp / 6.0);
        diffuseColor.rgb *= ${stone}(mm);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness + 0.08 * mm.g;');
  };
  return mat;
}

/**
 * The coffered ceiling: a flat slab seen from below, the coffers painted in (bevels lit from the side the light comes
 * from, deep recesses, gilded rosettes), so it's one plane and one draw.
 */
export function makeCeilingMaterial(renderer: THREE.WebGLRenderer, cell: number) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
  const tMarble = { value: bakeMarble(renderer) };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tMarble = tMarble;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP;\nuniform sampler2D tMarble;\n${STONES_GLSL}\nfloat cRough, cMetal;`)
      .replace('#include <map_fragment>', /* glsl */ `
        vec2 q = vWP.xz / ${cell.toFixed(2)};
        vec2 c = fract(q) - 0.5;
        float d = max(abs(c.x), abs(c.y));
        vec4 mm = texture2D(tMarble, vWP.xz / 9.0);
        vec3 col = carrara(mm) * 0.95;
        cRough = 0.35; cMetal = 0.0;
        // bevel steps: two rings, each face shaded by which way it tilts
        float side = abs(c.x) > abs(c.y) ? sign(c.x) * 0.5 + 0.5 : sign(c.y) * 0.25 + 0.5;
        float shade = mix(0.62, 1.05, side);
        float s1 = inside(d - 0.43) * (1.0 - inside(d - 0.37));
        float s2 = inside(d - 0.33) * (1.0 - inside(d - 0.28));
        col *= mix(1.0, shade, s1) * mix(1.0, shade * 0.85, s2);
        // the recess: deeper, warm, shadowed toward its walls
        float rec = inside(d - 0.28);
        col = mix(col, carrara(mm) * vec3(0.62, 0.56, 0.48) * (0.55 + 0.45 * smoothstep(0.28, 0.12, d)), rec);
        // gilding: a fillet around each coffer and an eight-petal rosette
        float a = atan(c.y, c.x);
        float ro = 0.075 + 0.028 * cos(a * 8.0);
        float gold = band(d - 0.43, 0.007) + band(d - 0.33, 0.006) + inside(length(c) - ro);
        gold = clamp(gold, 0.0, 1.0);
        col = mix(col, BRASS * 0.9, gold);
        cRough = mix(cRough, 0.3, gold); cMetal = gold;
        diffuseColor.rgb *= col;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = cRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = cMetal;');
  };
  return mat;
}

/** Polished gilding for cornice fillets, the dome's ring and lamp fittings. */
export function makeGoldMaterial() {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(1.0, 0.74, 0.38), metalness: 1, roughness: 0.26 });
}
