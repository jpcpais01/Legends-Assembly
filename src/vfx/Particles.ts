import * as THREE from 'three';
import { globalUniforms } from '../render/materials';

export const enum Shape { Dot = 0, Spark = 1, Smoke = 2, Star = 3, Petal = 4, Ring = 5, Splat = 6, Glyph = 7 }

export interface ParticleOpts {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  r: number; g: number; b: number; a?: number;
  size: number;
  life: number;
  shape?: Shape;
  gravity?: number;
  drag?: number;
  grow?: number; // size multiplier reached at end of life
  stretch?: number; // velocity stretch factor (sparks)
  flat?: boolean; // lies on the ground plane instead of facing camera
  rot?: number;
  spin?: number;
  aux?: number; // ring thickness / splat seed
  fadeIn?: number;
  hold?: number; // fraction of life at full opacity before fading
}

/**
 * Instanced billboard particle system with CPU simulation and a single draw call.
 * One system per blend mode. All hero VFX are built from this + a few bespoke meshes.
 */
export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  private cap: number;
  private n = 0;
  // simulation state (SoA)
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private life: Float32Array; private maxLife: Float32Array;
  private size0: Float32Array; private grow: Float32Array;
  private grav: Float32Array; private drag: Float32Array;
  private rot: Float32Array; private spin: Float32Array;
  private a0: Float32Array; private fadeIn: Float32Array; private hold: Float32Array;
  // GPU attributes
  private aPos: THREE.InstancedBufferAttribute;
  private aVel: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private aData: THREE.InstancedBufferAttribute;

  constructor(capacity: number, additive: boolean) {
    this.cap = capacity;
    const F = (k = 1) => new Float32Array(capacity * k);
    this.px = F(); this.py = F(); this.pz = F();
    this.vx = F(); this.vy = F(); this.vz = F();
    this.life = F(); this.maxLife = F(); this.size0 = F(); this.grow = F();
    this.grav = F(); this.drag = F(); this.rot = F(); this.spin = F(); this.a0 = F(); this.fadeIn = F(); this.hold = F();

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = () => { const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.aPos = mk(); this.aVel = mk(); this.aCol = mk(); this.aData = mk();
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iVel', this.aVel);
    geo.setAttribute('iCol', this.aCol);
    geo.setAttribute('iData', this.aData);
    geo.instanceCount = 0;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uNoise: globalUniforms.uNoise },
      vertexShader: /* glsl */ `
        attribute vec4 iPos; attribute vec4 iVel; attribute vec4 iCol; attribute vec4 iData;
        varying vec2 vUv; varying vec4 vCol; varying float vShape; varying float vAux;
        void main() {
          vUv = uv; vCol = iCol; vShape = iData.y; vAux = iData.w;
          float size = iData.x;
          float c = cos(iPos.w), s = sin(iPos.w);
          vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * size;
          vec4 mv;
          if (iData.z > 0.5) {
            // flat on ground
            vec3 wp = iPos.xyz + vec3(q.x, 0.0, q.y);
            mv = modelViewMatrix * vec4(wp, 1.0);
          } else if (iVel.w > 0.0) {
            // velocity-stretched streak in view space
            vec4 c0 = modelViewMatrix * vec4(iPos.xyz, 1.0);
            vec3 vdir = (modelViewMatrix * vec4(iVel.xyz, 0.0)).xyz;
            vec2 d2 = vdir.xy;
            float len = length(d2);
            vec2 dir = len > 1e-4 ? d2 / len : vec2(1.0, 0.0);
            vec2 nrm = vec2(-dir.y, dir.x);
            float stretch = 1.0 + len * iVel.w;
            mv = c0 + vec4(dir * position.x * size * stretch + nrm * position.y * size, 0.0, 0.0);
          } else {
            mv = modelViewMatrix * vec4(iPos.xyz, 1.0);
            mv.xy += q;
          }
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uNoise;
        varying vec2 vUv; varying vec4 vCol; varying float vShape; varying float vAux;
        void main() {
          vec2 d = vUv - 0.5;
          float r = length(d) * 2.0;
          float a = 0.0;
          int sh = int(vShape + 0.5);
          if (sh == 0 || sh == 1) {
            a = pow(max(0.0, 1.0 - r), 1.8);
          } else if (sh == 2) {
            float n = texture2D(uNoise, vUv * 0.5 + vAux).g;
            a = smoothstep(1.0, 0.3, r + (n - 0.5) * 0.6);
          } else if (sh == 3) {
            vec2 ad = abs(d) * 2.0;
            float st = max(0.0, 1.0 - ad.x * ad.y * 28.0 - r * 0.6);
            a = pow(st, 2.0) + pow(max(0.0, 1.0 - r), 6.0) * 1.5;
          } else if (sh == 4) {
            vec2 e = d * vec2(2.6, 1.2);
            a = smoothstep(0.5, 0.3, length(e));
          } else if (sh == 5) {
            float th = max(vAux, 0.02);
            a = smoothstep(th, 0.0, abs(r - (1.0 - th))) ;
          } else if (sh == 6) {
            float n = texture2D(uNoise, vUv * 0.7 + vAux).r;
            float n2 = texture2D(uNoise, vUv * 2.0 - vAux).g;
            float ang = atan(d.y, d.x);
            float edge = 0.62 + (n - 0.5) * 0.7 + sin(ang * 7.0 + vAux * 40.0) * 0.08;
            a = smoothstep(edge, edge - 0.08, r);
            // droplets around the splat
            a = max(a, smoothstep(0.08, 0.0, length(d - vec2(cos(vAux * 30.0), sin(vAux * 30.0)) * 0.42)) );
            a *= 0.85 + n2 * 0.3;
          } else {
            a = 1.0 - r;
          }
          if (a <= 0.003) discard;
          gl_FragColor = vec4(vCol.rgb, vCol.a * a);
          #ifdef PREMUL
          gl_FragColor.rgb *= gl_FragColor.a;
          #endif
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
  }

  spawn(o: ParticleOpts) {
    let i: number;
    if (this.n < this.cap) i = this.n++;
    else i = Math.floor(Math.random() * this.cap); // overwrite a random slot when saturated
    this.px[i] = o.x; this.py[i] = o.y; this.pz[i] = o.z;
    this.vx[i] = o.vx ?? 0; this.vy[i] = o.vy ?? 0; this.vz[i] = o.vz ?? 0;
    this.life[i] = 0; this.maxLife[i] = o.life;
    this.size0[i] = o.size; this.grow[i] = o.grow ?? 1;
    this.grav[i] = o.gravity ?? 0; this.drag[i] = o.drag ?? 0;
    this.rot[i] = o.rot ?? Math.random() * 6.283; this.spin[i] = o.spin ?? 0;
    this.a0[i] = o.a ?? 1; this.fadeIn[i] = o.fadeIn ?? 0.05; this.hold[i] = o.hold ?? 0;
    const c = this.aCol.array as Float32Array;
    c[i * 4] = o.r; c[i * 4 + 1] = o.g; c[i * 4 + 2] = o.b; c[i * 4 + 3] = o.a ?? 1;
    const d = this.aData.array as Float32Array;
    d[i * 4] = o.size; d[i * 4 + 1] = o.shape ?? 0; d[i * 4 + 2] = o.flat ? 1 : 0; d[i * 4 + 3] = o.aux ?? Math.random();
    const v = this.aVel.array as Float32Array;
    v[i * 4 + 3] = o.stretch ?? 0;
  }

  private kill(i: number) {
    const last = --this.n;
    if (i === last) return;
    const S = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.life, this.maxLife, this.size0, this.grow, this.grav, this.drag, this.rot, this.spin, this.a0, this.fadeIn, this.hold];
    for (const arr of S) arr[i] = arr[last];
    for (const at of [this.aCol, this.aData, this.aVel]) {
      const a = at.array as Float32Array;
      a[i * 4] = a[last * 4]; a[i * 4 + 1] = a[last * 4 + 1]; a[i * 4 + 2] = a[last * 4 + 2]; a[i * 4 + 3] = a[last * 4 + 3];
    }
  }

  update(dt: number) {
    const P = this.aPos.array as Float32Array;
    const V = this.aVel.array as Float32Array;
    const C = this.aCol.array as Float32Array;
    const D = this.aData.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const l = (this.life[i] += dt);
      if (l >= this.maxLife[i]) { this.kill(i); i--; continue; }
      const t = l / this.maxLife[i];
      this.vy[i] -= this.grav[i] * dt;
      const dr = this.drag[i];
      if (dr > 0) { const k = Math.max(0, 1 - dr * dt); this.vx[i] *= k; this.vy[i] *= k; this.vz[i] *= k; }
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      P[i * 4] = this.px[i]; P[i * 4 + 1] = this.py[i]; P[i * 4 + 2] = this.pz[i]; P[i * 4 + 3] = this.rot[i];
      V[i * 4] = this.vx[i]; V[i * 4 + 1] = this.vy[i]; V[i * 4 + 2] = this.vz[i];
      D[i * 4] = this.size0[i] * (1 + (this.grow[i] - 1) * t);
      const fi = this.fadeIn[i] > 0 ? Math.min(1, t / this.fadeIn[i]) : 1;
      const h = this.hold[i];
      C[i * 4 + 3] = this.a0[i] * fi * (t < h ? 1 : 1 - (t - h) / (1 - h));
    }
    const geo = this.mesh.geometry as THREE.InstancedBufferGeometry;
    geo.instanceCount = this.n;
    for (const at of [this.aPos, this.aVel, this.aCol, this.aData]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, Math.max(4, this.n * 4));
      at.needsUpdate = true;
    }
  }

  get count() { return this.n; }
  clear() { this.n = 0; }
}
