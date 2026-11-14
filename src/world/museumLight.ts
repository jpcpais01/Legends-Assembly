import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

/**
 * Sunlight for the Grand Museum: the hall is roofed, and the sun only gets in through the broken dome over the crossing.
 *
 * The sun is a narrow, far-away spot light (rays are parallel for all practical purposes) aimed down through the dome. Its
 * cone only covers the dome's opening, so nothing outside it is ever sunlit, and its shadow map, focused on that small
 * area, is sharp enough to carve the drum's arched windows, its broken shell and the T-rex's ribs into the light pools on
 * the floor. The same shadow map drives the volumetric shafts (a depth-aware ray march, like the study's) and the dust
 * motes, so beams, floor pools and motes always agree. Everything else is lit by the soft sky light from above, the
 * marble's own bounce (a cube capture of the finished hall) and gilded lamps.
 */

/** The hall: floor at y = 0, interior walls at |x| = HX and |z| = HZ, flat coffered ceiling at CEIL. */
export const HALL = { HX: 52, HZ: 37, CEIL: 30 };
/** The broken dome ring: scale, the ceiling hole it stands on and its yaw (turns its breach towards the sun). */
export const DOME = { K: 56, HOLE_R: 21.4, YAW: 1.6 };

/** Towards the sun: high noon-ish, so shafts from the sun-side drum windows land across the crossing. */
export const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 63), THREE.MathUtils.degToRad(90 + 20));

/** The spot that plays the sun: far up the sun direction, aimed at the dome, cone just wider than the opening. */
export function makeSunbeam() {
  const aim = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize().multiplyScalar(7).setY(HALL.CEIL + 8);
  const D = 240;
  const spot = new THREE.SpotLight(new THREE.Color(1.0, 0.9, 0.74), 11, 0, Math.atan(31 / D), 0.12, 0);
  spot.position.copy(aim).addScaledVector(SUN_DIR, D);
  spot.target.position.copy(aim);
  spot.castShadow = true;
  spot.shadow.camera.near = D - 60;
  spot.shadow.camera.far = D + 70;
  spot.shadow.bias = -0.00012;
  spot.shadow.normalBias = 0.04;
  spot.shadow.radius = 2;
  return spot;
}

/**
 * Volumetric shafts under the dome. The march runs at half resolution on the stretch of the view ray inside the hall,
 * tests the sun's shadow map at each step (so the drum windows, the dome's breach and the T-rex all cut the shafts) and
 * a depth-aware upsample puts it back without halos around heroes.
 */
export class MuseumRaysEffect extends Effect {
  private cam: THREE.Camera;
  private sun: THREE.SpotLight;
  private rt: THREE.WebGLRenderTarget;
  private march: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.Camera();
  constructor(camera: THREE.Camera, sun: THREE.SpotLight, steps: number) {
    super('MuseumRaysEffect', /* glsl */ `
      uniform sampler2D uRays;
      uniform vec2 uRaysSize;
      uniform mat4 uProjInvC;
      uniform vec3 uColor;
      uniform float uDensity;
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        vec4 v = uProjInvC * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        float d = length(v.xyz / v.w);
        vec2 st = uv * uRaysSize - 0.5;
        vec2 i = floor(st), f = st - i, t = 1.0 / uRaysSize, b = (i + 0.5) * t;
        vec2 s0 = texture2D(uRays, b).rg, s1 = texture2D(uRays, b + vec2(t.x, 0.0)).rg;
        vec2 s2 = texture2D(uRays, b + vec2(0.0, t.y)).rg, s3 = texture2D(uRays, b + t).rg;
        vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
        w *= 1.0 / (0.02 + abs(vec4(s0.y, s1.y, s2.y, s3.y) - d) / max(d, 0.01));
        float r = dot(w, vec4(s0.x, s1.x, s2.x, s3.x)) / max(dot(w, vec4(1.0)), 1e-6);
        outputColor = vec4(inputColor.rgb + uColor * (r * uDensity), inputColor.a);
      }`, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uRays', new THREE.Uniform(null)],
        ['uRaysSize', new THREE.Uniform(new THREE.Vector2(1, 1))],
        ['uProjInvC', new THREE.Uniform(new THREE.Matrix4())],
        ['uColor', new THREE.Uniform(new THREE.Color(1.0, 0.86, 0.66))],
        ['uDensity', new THREE.Uniform(0.0105)],
      ]),
    });
    this.cam = camera;
    this.sun = sun;
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.uniforms.get('uRays')!.value = this.rt.texture;
    const f = (v: number) => v.toFixed(3);
    this.march = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      defines: { STEPS: String(steps) },
      uniforms: {
        tDepth: { value: null },
        uShadow: { value: null },
        uShadowMat: { value: new THREE.Matrix4() },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uFrame: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        precision highp sampler2DShadow;
        uniform highp sampler2D tDepth;
        uniform sampler2DShadow uShadow;
        uniform mat4 uShadowMat;
        uniform mat4 uProjInv;
        uniform mat4 uCamWorld;
        uniform vec3 uCamPos;
        uniform float uFrame;
        varying vec2 vUv;
        const vec3 SUN = vec3(${f(SUN_DIR.x)}, ${f(SUN_DIR.y)}, ${f(SUN_DIR.z)});
        float stIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        float sunAt(vec3 p) {
          vec4 sc = uShadowMat * vec4(p, 1.0);
          vec3 c = sc.xyz / sc.w;
          float cone = smoothstep(0.5, 0.42, length(c.xy - 0.5));
          if (cone <= 0.0) return 0.0;
          return cone * texture(uShadow, vec3(c.xy, c.z - 0.0004));
        }
        void main() {
          float depth = texture2D(tDepth, vUv).r;
          vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          vec3 vp = v.xyz / v.w;
          float dist = length(vp);
          vec3 rd = normalize((uCamWorld * vec4(vp, 1.0)).xyz - uCamPos);
          // only the hall under the dome can hold a shaft: spend every step there
          vec3 inv = 1.0 / (rd + vec3(equal(rd, vec3(0.0))) * 1e-6);
          vec3 ta = (vec3(-34.0, 0.0, -32.0) - uCamPos) * inv;
          vec3 tb = (vec3(34.0, ${f(HALL.CEIL + 30)}, 32.0) - uCamPos) * inv;
          vec3 tn = min(ta, tb), tx = max(ta, tb);
          float t0 = max(max(tn.x, tn.y), max(tn.z, 0.0));
          float t1 = min(min(tx.x, tx.y), min(tx.z, min(dist, 300.0)));
          float acc = 0.0;
          if (t1 > t0) {
            float dt = (t1 - t0) / float(STEPS);
            float off = stIgn(gl_FragCoord.xy + uFrame * 5.588238);
            for (int i = 0; i < STEPS; i++) acc += sunAt(uCamPos + rd * (t0 + dt * (float(i) + off)));
            acc *= dt;
          }
          float mu = dot(rd, SUN);
          float g = 0.6;
          float phase = 0.25 + (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.06;
          gl_FragColor = vec4(acc * phase, dist, 0.0, 1.0);
        }`,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(tri, this.march);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }
  /** Shaft strength (scaled down during Yeat's doom). */
  baseDensity = 0.0105;
  setSteps(steps: number) { this.march.defines.STEPS = String(steps); this.march.needsUpdate = true; }
  setDepthTexture(depthTexture: THREE.Texture) { this.march.uniforms.tDepth.value = depthTexture; }
  setSize(width: number, height: number) {
    const w = Math.max(1, Math.ceil(width / 2)), h = Math.max(1, Math.ceil(height / 2));
    this.rt.setSize(w, h);
    this.uniforms.get('uRaysSize')!.value.set(w, h);
  }
  update(renderer: THREE.WebGLRenderer) {
    const map = this.sun.shadow.map;
    const on = !!map?.depthTexture && renderer.shadowMap.enabled;
    this.uniforms.get('uDensity')!.value = on ? this.baseDensity : 0;
    if (!on) return;
    const c = this.cam as THREE.PerspectiveCamera;
    const u = this.march.uniforms;
    u.uShadow.value = map!.depthTexture;
    u.uShadowMat.value.copy(this.sun.shadow.matrix);
    u.uProjInv.value.copy(c.projectionMatrixInverse);
    this.uniforms.get('uProjInvC')!.value.copy(c.projectionMatrixInverse);
    u.uCamWorld.value.copy(c.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(c.matrixWorld);
    u.uFrame.value = (u.uFrame.value + 1) % 64;
    renderer.setRenderTarget(this.rt);
    renderer.render(this.quadScene, this.quadCam);
  }
  dispose() { this.rt.dispose(); this.march.dispose(); this.quad.geometry.dispose(); super.dispose(); }
}

/** Dust drifting under the dome, glowing only where a shaft catches it (same shadow map as the shafts). */
export function makeMuseumDust(count: number, sun: THREE.SpotLight) {
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 30;
    pos[i * 3] = Math.cos(a) * r - SUN_DIR.x * 8;
    pos[i * 3 + 1] = rnd(0.5, HALL.CEIL - 2);
    pos[i * 3 + 2] = Math.sin(a) * r - SUN_DIR.z * 8;
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 }, uShadow: { value: null }, uShadowMat: { value: new THREE.Matrix4() } },
    vertexShader: /* glsl */ `
      precision highp sampler2DShadow;
      attribute float aSeed;
      uniform float uTime;
      uniform sampler2DShadow uShadow;
      uniform mat4 uShadowMat;
      varying float vA;
      void main() {
        float t = uTime * (0.05 + aSeed * 0.07) + aSeed * 40.0;
        vec3 p = position + vec3(sin(t * 1.3) * 3.0, sin(t * 0.7 + aSeed * 6.0) * 2.5, cos(t * 1.1) * 3.0);
        vec4 sc = uShadowMat * vec4(p, 1.0);
        vec3 c = sc.xyz / sc.w;
        float lit = smoothstep(0.5, 0.42, length(c.xy - 0.5)) * texture(uShadow, vec3(c.xy, c.z - 0.0004));
        vA = lit * (0.35 + 0.65 * fract(aSeed * 13.7));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = vA > 0.01 ? (0.6 + aSeed) * 26.0 / -mv.z : 0.0;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, r) * vA;
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * a * 1.4, 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  /** Call every frame: the sun's shadow map only exists after its first shadow pass. */
  const sync = () => {
    const map = sun.shadow.map;
    if (!map?.depthTexture) return false;
    mat.uniforms.uShadow.value = map.depthTexture;
    mat.uniforms.uShadowMat.value.copy(sun.shadow.matrix);
    return true;
  };
  return { points: pts, sync };
}
