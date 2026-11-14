import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The Giant's Study desk, built in code: a varnished walnut top made of glued boards, a moulded lip,
 * a drawer apron and turned legs.
 *
 * The wood is baked once on the GPU at load into a 4096x1024 grain tile (albedo + gloss, and a normal map)
 * plus a small tiling pore/scratch detail map. At runtime the desk shader picks a board per fragment,
 * offsets into the tile per board (so it never visibly repeats), and layers the detail map at
 * world scale, so the surface stays crisp right under the heroes' feet. Three texture reads, no noise.
 */

/** Grain tile size in meters (along the grain, across it). */
const TILE = new THREE.Vector2(64, 16);
/** Board width in meters. */
const BOARD = 10;

export const NOISE_GLSL = /* glsl */ `
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p, vec2 per) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = h21(mod(i, per)), b = h21(mod(i + vec2(1.0, 0.0), per));
  float c = h21(mod(i + vec2(0.0, 1.0), per)), d = h21(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 uv, vec2 per) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(uv * per, per); per *= 2.0; a *= 0.5; }
  return s;
}
`;

/** Wood grain: flat-sawn walnut with cathedral arches, a couple of small knots, pores and ray flecks. All periodic in uv. */
const WOOD_BAKE = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform int uMode;
uniform vec2 uTexel;
${NOISE_GLSL}
// knot influence (periodic distance)
float knot(vec2 uv, vec2 c, vec2 s) {
  vec2 d = uv - c; d -= floor(d + 0.5);
  d *= vec2(64.0, 16.0) / s;
  return exp(-dot(d, d));
}
// returns ring phase, band (latewood) mask, pore mask, knot core
vec4 grain(vec2 uv) {
  float k = knot(uv, vec2(0.23, 0.31), vec2(2.2, 0.9)) + knot(uv, vec2(0.71, 0.74), vec2(1.6, 0.7)) * 0.8;
  float warp = fbm(uv, vec2(2.0, 1.0)) * 26.0 + fbm(uv + 0.37, vec2(6.0, 4.0)) * 4.0 + fbm(uv + 0.71, vec2(24.0, 16.0)) * 0.6;
  float f = uv.y * 80.0 + warp + k * 7.0;
  float r = fract(f);
  float band = smoothstep(0.45, 0.9, r) * (1.0 - smoothstep(0.94, 1.0, r));
  band *= 0.75 + 0.25 * vnoise(uv * vec2(64.0, 256.0), vec2(64.0, 256.0));
  float streak = vnoise(uv * vec2(96.0, 640.0), vec2(96.0, 640.0));
  streak = smoothstep(0.55, 0.95, streak);
  float flecks = smoothstep(0.82, 0.97, vnoise(uv * vec2(512.0, 96.0), vec2(512.0, 96.0))) * 0.5;
  return vec4(f, band, streak + flecks * 0.5, k);
}
float heightAt(vec2 uv) { vec4 g = grain(uv); return -g.y * 0.6 - g.z * 0.35 - g.w * 0.3; }
void main() {
  vec2 uv = vUv;
  if (uMode == 0) {
    vec4 g = grain(uv);
    float macro = fbm(uv + 0.11, vec2(2.0, 1.0));
    vec3 light = vec3(0.2, 0.085, 0.036);
    vec3 dark = vec3(0.05, 0.018, 0.008);
    vec3 col = mix(light, dark, g.y * 0.78 + g.z * 0.18);
    col *= 0.82 + 0.36 * macro;
    col = mix(col, vec3(0.06, 0.025, 0.012), smoothstep(0.35, 0.9, g.w) * 0.8); // knot cores
    col = mix(col, col * vec3(1.12, 0.96, 0.85), smoothstep(0.4, 0.7, fbm(uv + 0.5, vec2(4.0, 2.0)))); // warm/cool streaks
    float rough = clamp(g.y * 0.6 + g.z * 0.5 + g.w * 0.4, 0.0, 1.0);
    gl_FragColor = vec4(col, rough);
  } else {
    float h0 = heightAt(uv);
    float hx = heightAt(uv + vec2(uTexel.x, 0.0));
    float hy = heightAt(uv + vec2(0.0, uTexel.y));
    // derivatives per meter
    float dx = (hx - h0) / (uTexel.x * 64.0), dy = (hy - h0) / (uTexel.y * 16.0);
    vec3 n = normalize(vec3(-dx * 0.012, -dy * 0.012, 1.0));
    gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
  }
}
`;

/** Tiling detail: r = pore darkening, g = scratch / wear (roughness), ba = normal xy. 1 tile = 3.2 m along grain x 0.8 m across. */
const DETAIL_BAKE = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uTexel;
${NOISE_GLSL}
float pores(vec2 uv) {
  float p = vnoise(uv * vec2(24.0, 160.0), vec2(24.0, 160.0));
  float q = vnoise(uv * vec2(64.0, 320.0) + 3.1, vec2(64.0, 320.0));
  return smoothstep(0.62, 0.95, p) * 0.7 + smoothstep(0.7, 1.0, q) * 0.5;
}
float scratches(vec2 uv) {
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float a = 0.35 + fi * 1.7;
    vec2 d = vec2(cos(a), sin(a) * 4.0);
    float line = fract(dot(uv, d) * (5.0 + fi * 3.0) + vnoise(uv * vec2(8.0, 8.0), vec2(8.0)) * 0.3);
    float seg = smoothstep(0.55, 0.8, vnoise(uv * vec2(6.0, 6.0) + fi * 7.0, vec2(6.0)));
    s += smoothstep(0.012, 0.0, abs(line - 0.5)) * seg;
  }
  return clamp(s, 0.0, 1.0);
}
void main() {
  vec2 uv = vUv;
  float p0 = pores(uv);
  float px = pores(uv + vec2(uTexel.x, 0.0)), py = pores(uv + vec2(0.0, uTexel.y));
  vec2 n = vec2(-(px - p0), -(py - p0)) * 1.4;
  float wear = fbm(uv, vec2(4.0, 4.0));
  gl_FragColor = vec4(p0, clamp(scratches(uv) * 0.8 + smoothstep(0.55, 0.8, wear) * 0.25, 0.0, 1.0), n * 0.5 + 0.5);
}
`;

export function bake(renderer: THREE.WebGLRenderer, w: number, h: number, frag: string, uniforms: Record<string, THREE.IUniform>, srgb: boolean) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType,
    colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: false,
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uTexel: { value: new THREE.Vector2(1 / w, 1 / h) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: frag,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.Camera();
  const prev = renderer.getRenderTarget();
  const prevAuto = renderer.autoClear;
  renderer.autoClear = true;
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  renderer.autoClear = prevAuto;
  mat.dispose(); quad.geometry.dispose();
  return rt.texture;
}

export interface WoodMaps { albedo: THREE.Texture; normal: THREE.Texture; detail: THREE.Texture }

let cached: WoodMaps | null = null;
export function bakeWoodMaps(renderer: THREE.WebGLRenderer): WoodMaps {
  if (cached) return cached;
  cached = {
    albedo: bake(renderer, 4096, 1024, WOOD_BAKE, { uMode: { value: 0 } }, true),
    normal: bake(renderer, 4096, 1024, WOOD_BAKE, { uMode: { value: 1 } }, false),
    detail: bake(renderer, 512, 512, DETAIL_BAKE, {}, false),
  };
  return cached;
}

/**
 * Varnished walnut on world-space coordinates (geometry must be baked into world space). Top faces run the
 * grain along x in boards across z; side faces follow x or z with height. Per-board tint and tile offset.
 */
export function makeDeskWoodMaterial(maps: WoodMaps, tint = new THREE.Color(1, 1, 1)) {
  const mat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.4, metalness: 0, envMapIntensity: 1.1 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tGrain = { value: maps.albedo };
    sh.uniforms.tGrainN = { value: maps.normal };
    sh.uniforms.tDetail = { value: maps.detail };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vWP; varying vec3 vWN;
        uniform sampler2D tGrain, tGrainN, tDetail;
        float wh(float n) { return fract(sin(n * 91.345 + 7.13) * 43758.5453); }
        struct WoodS { vec2 p; vec3 T; vec3 B; vec3 N; float board; float seam; vec2 guv; vec2 gx; vec2 gy; };
        WoodS woodSetup() {
          WoodS w;
          w.N = normalize(vWN);
          if (abs(w.N.y) > 0.6) { w.p = vec2(vWP.x, vWP.z + 30.0); w.T = vec3(1.0, 0.0, 0.0); w.B = vec3(0.0, 0.0, 1.0); }
          else if (abs(w.N.z) >= abs(w.N.x)) { w.p = vec2(vWP.x, vWP.y * 1.3 + 3.7); w.T = vec3(1.0, 0.0, 0.0); w.B = vec3(0.0, 1.0, 0.0); }
          else { w.p = vec2(vWP.z, vWP.y * 1.3 + 3.7); w.T = vec3(0.0, 0.0, 1.0); w.B = vec3(0.0, 1.0, 0.0); }
          float fb = w.p.y / ${BOARD.toFixed(1)};
          w.board = floor(fb);
          float fr = fract(fb);
          w.seam = min(fr, 1.0 - fr) * ${BOARD.toFixed(1)};
          float r = wh(w.board), r2 = wh(w.board + 17.0);
          vec2 tile = vec2(${TILE.x.toFixed(1)}, ${TILE.y.toFixed(1)});
          // flip every other board so the grain direction alternates like a real glue-up
          float flip = r2 > 0.5 ? 1.0 : -1.0;
          w.guv = vec2(w.p.x * flip / tile.x + r * 13.7, (fr * ${BOARD.toFixed(1)}) / tile.y + r2 * 0.61);
          w.gx = dFdx(w.p) / tile * vec2(flip, 1.0);
          w.gy = dFdy(w.p) / tile * vec2(flip, 1.0);
          return w;
        }`)
      .replace('#include <map_fragment>', /* glsl */ `
        WoodS ws = woodSetup();
        vec4 wg = textureGrad(tGrain, ws.guv, ws.gx, ws.gy);
        vec2 duv = ws.p / vec2(3.2, 0.8);
        vec4 wd = texture2D(tDetail, duv);
        float bt = wh(ws.board + 5.0);
        vec3 boardTint = mix(vec3(0.86, 0.9, 0.97), vec3(1.12, 1.02, 0.92), bt);
        float seamDark = 1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.09, ws.seam));
        diffuseColor.rgb *= wg.rgb * boardTint * seamDark * (1.0 - wd.r * 0.28);`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
        float roughnessFactor = clamp(mix(0.26, 0.5, wg.a) + wd.g * 0.3 + wd.r * 0.12 + (1.0 - smoothstep(0.0, 0.12, ws.seam)) * 0.35, 0.12, 1.0);`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `
        {
          vec3 gn = textureGrad(tGrainN, ws.guv, ws.gx, ws.gy).xyz * 2.0 - 1.0;
          vec2 dn = wd.ba * 2.0 - 1.0;
          vec2 pert = gn.xy * 0.9 + dn * 0.55;
          // rounded-over board edges: a soft V groove at each glue line
          float fr = fract(ws.p.y / ${BOARD.toFixed(1)});
          pert.y += (smoothstep(0.0, 0.1, ws.seam) - 1.0) * (fr < 0.5 ? -0.45 : 0.45);
          vec3 wN = normalize(ws.N + ws.T * pert.x + ws.B * pert.y);
          normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
        }`);
  };
  mat.customProgramCacheKey = () => 'deskwood';
  return mat;
}

/** Indexed geometry with only position/normal/uv, so everything for one material can be merged. */
export function clean(g: THREE.BufferGeometry) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  if (!g.index) {
    const n = g.getAttribute('position').count;
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.morphAttributes = {};
  return g;
}

/**
 * The desk itself, in world space with the top surface at y = 0 and the floor at `floorY`.
 * Returns geometry for the wood material, brass hardware, and the solid top (for collision).
 */
export function buildDeskGeometry(hx: number, hz: number, floorY: number) {
  const wood: THREE.BufferGeometry[] = [];
  const brass: THREE.BufferGeometry[] = [];
  const T = 2.6; // top thickness
  // the top: a thick slab with a generous round-over, then a cove-moulded step below it
  const top = new RoundedBoxGeometry(hx * 2, T, hz * 2, 5, 0.9).translate(0, -T / 2, 0);
  wood.push(top);
  const lip = new RoundedBoxGeometry(hx * 2 - 1.2, 1.4, hz * 2 - 1.2, 3, 0.5).translate(0, -T - 0.55, 0);
  wood.push(lip);
  // apron (frieze) with drawers on the long sides
  const AY = -T - 1.2, AH = 7.5, inset = 3.2;
  const ax = hx - inset, az = hz - inset;
  wood.push(new THREE.BoxGeometry(ax * 2, AH, az * 2).translate(0, AY - AH / 2, 0));
  // drawer fronts + knobs, three per long side
  const knob = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.35, 0), new THREE.Vector2(0.3, 0.35), new THREE.Vector2(0.75, 0.75), new THREE.Vector2(0.8, 1.0), new THREE.Vector2(0.55, 1.3), new THREE.Vector2(0, 1.35)], 16);
  for (const side of [-1, 1]) {
    for (let i = -1; i <= 1; i++) {
      const dw = (ax * 2 - 6) / 3 - 1.2;
      const cx = i * (dw + 1.2);
      const front = new RoundedBoxGeometry(dw, AH - 1.6, 1.0, 2, 0.3).translate(cx, AY - AH / 2, side * (az + 0.4));
      wood.push(front);
      // raised panel
      wood.push(new RoundedBoxGeometry(dw - 3, AH - 4, 0.5, 2, 0.2).translate(cx, AY - AH / 2, side * (az + 1.0)));
      const k = knob.clone().rotateX(side * Math.PI / 2).translate(cx, AY - AH / 2, side * (az + 1.1));
      brass.push(k);
    }
  }
  // turned legs at the corners
  const legH = AY - AH - floorY + 0.01;
  const prof: THREE.Vector2[] = [];
  const P = (r: number, y: number) => prof.push(new THREE.Vector2(r, y));
  P(0, 0); P(2.0, 0); P(2.2, 0.6); P(1.6, 1.4); P(1.4, 3); P(1.9, legH * 0.18); P(2.4, legH * 0.24); P(2.0, legH * 0.3); P(1.5, legH * 0.34);
  P(1.7, legH * 0.55); P(2.6, legH * 0.66); P(2.9, legH * 0.72); P(2.4, legH * 0.78); P(2.0, legH * 0.82); P(2.6, legH * 0.86);
  P(2.6, legH * 0.9); P(3.0, legH * 0.93); P(3.0, legH); P(0, legH);
  const leg = new THREE.LatheGeometry(prof, 20);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    wood.push(leg.clone().translate(sx * (ax - 2.6), floorY, sz * (az - 2.6)));
    // brass castor cup
    brass.push(new THREE.CylinderGeometry(2.3, 2.5, 1.0, 20).translate(sx * (ax - 2.6), floorY + 0.5, sz * (az - 2.6)));
  }
  // stretchers between the legs
  const sy = floorY + legH * 0.3;
  for (const sz of [-1, 1]) wood.push(new THREE.CylinderGeometry(0.9, 0.9, (ax - 2.6) * 2, 12).rotateZ(Math.PI / 2).translate(0, sy, sz * (az - 2.6)));
  wood.push(new THREE.CylinderGeometry(0.9, 0.9, (az - 2.6) * 2, 12).rotateX(Math.PI / 2).translate(0, sy, 0));

  const woodGeo = mergeGeometries(wood.map(clean), false)!;
  const brassGeo = mergeGeometries(brass.map(clean), false)!;
  return { woodGeo, brassGeo };
}
