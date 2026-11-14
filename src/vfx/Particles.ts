import * as THREE from 'three';
import { globalUniforms } from '../render/materials';

export const enum Shape {
  Dot = 0, Spark = 1, Smoke = 2, Star = 3, Petal = 4, Ring = 5, Splat = 6, Glyph = 7,
  /** Hot core with an anamorphic streak and cross rays (muzzle flashes, impacts). */
  Flare = 8,
  /** Eighth note (Yeat). */
  Note = 9,
  /** Curved bristly brush stroke along the quad's x axis (Van Gogh). Pair with stretch or rot. */
  Stroke = 10,
  /** Dark burnt ground mark with a noisy edge (use the alpha system, flat). */
  Scorch = 11,
  /** Radial ground cracks around a dark crater (alpha system, flat). */
  Crack = 12,
  /** Faceted diamond chunk (debris, crystal shards). */
  Shard = 13,
  /** Healing cross. */
  Plus = 14,
  /** Rotating rune circle: rim, tick marks and an inner ring (target markers, cast circles). */
  Rune = 15,
  /** Crisp square block-break chip with a 2x2 shaded face (Steve). Use aux for its shading seed. */
  Pixel = 16,
}

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
  /** Optional end-of-life color (HDR); the color lerps toward it over the particle's life. */
  r2?: number; g2?: number; b2?: number;
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
  /** start rgb, end rgb (or -1 in [3] when the color is constant) */
  private cols: Float32Array;
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
    this.cols = F(6);

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
            // z is flipped so the quad winds counter-clockwise seen from above (front face up)
            vec3 wp = iPos.xyz + vec3(q.x, 0.0, -q.y);
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
          float shade = 1.0;
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
          } else if (sh == 8) {
            // flare: hot core + anamorphic streak + a softer cross
            float core = pow(max(0.0, 1.0 - r), 3.0);
            float sx = exp(-abs(d.y) * 46.0) * max(0.0, 1.0 - abs(d.x) * 2.0);
            float sy = exp(-abs(d.x) * 46.0) * max(0.0, 1.0 - abs(d.y) * 2.0);
            a = core * 1.5 + sx * 1.1 + sy * 0.55;
          } else if (sh == 9) {
            // eighth note: tilted oval head, stem and a flag
            vec2 p = d * 2.2;
            vec2 hp = p - vec2(-0.28, -0.5);
            hp = mat2(0.86, 0.5, -0.5, 0.86) * hp;
            float head = length(hp * vec2(1.0, 1.55)) - 0.3;
            float stem = max(abs(p.x - 0.0) - 0.055, abs(p.y - 0.2) - 0.7);
            float fy = p.y - (0.85 - (p.x) * 0.9);
            float flag = max(abs(fy) - 0.12, max(-p.x, p.x - 0.42));
            float sd = min(head, min(stem, flag));
            a = smoothstep(0.05, -0.02, sd) + smoothstep(0.45, 0.0, sd) * 0.35;
          } else if (sh == 10) {
            // brush stroke: curved band with bristle streaks and dry ends
            float bend = sin(d.x * 5.0 + vAux * 20.0) * 0.06;
            float n = texture2D(uNoise, vec2(vUv.x * 0.3 + vAux, vUv.y * 2.2 + vAux * 3.0)).r;
            float band = smoothstep(0.24, 0.1, abs(d.y + bend));
            float ends = smoothstep(0.5, 0.28, abs(d.x)) ;
            float bristle = smoothstep(0.28, 0.62, n);
            a = band * ends * (0.4 + bristle * 0.8);
          } else if (sh == 11) {
            // scorch mark
            float n = texture2D(uNoise, vUv * 0.8 + vAux).r;
            float n2 = texture2D(uNoise, vUv * 2.4 - vAux).g;
            float edge = 0.78 + (n - 0.5) * 0.5;
            a = smoothstep(edge, edge * 0.25, r) * (0.7 + n2 * 0.3);
          } else if (sh == 12) {
            // radial cracks around a crater
            float ang = atan(d.y, d.x);
            float wob = (texture2D(uNoise, vec2(r * 1.3 + vAux, vAux * 2.0 + ang * 0.15)).r - 0.5) * 0.9;
            float f = fract((ang + wob) * (11.0 / 6.2831) + vAux * 7.0);
            float dist = abs(f - 0.5) * (6.2831 / 11.0) * r;
            float line = smoothstep(0.022, 0.004, dist) * smoothstep(1.0, 0.35, r) * smoothstep(0.1, 0.2, r);
            float crater = smoothstep(0.32, 0.05, r) * 0.85;
            a = max(line, crater);
          } else if (sh == 13) {
            // faceted shard with a lit edge
            float dd = abs(d.x) * 1.7 + abs(d.y);
            a = smoothstep(0.5, 0.44, dd) * (0.75 + 0.5 * step(0.0, d.x * d.y));
          } else if (sh == 14) {
            float c = min(max(abs(d.x) - 0.11, abs(d.y) - 0.36), max(abs(d.y) - 0.11, abs(d.x) - 0.36));
            a = smoothstep(0.03, -0.02, c) + smoothstep(0.22, 0.0, c) * 0.4;
          } else if (sh == 15) {
            // rune circle
            float th = max(vAux, 0.02);
            float rim = smoothstep(th, 0.0, abs(r - (1.0 - th)));
            float ang = atan(d.y, d.x);
            float tk = step(0.55, fract(ang * (36.0 / 6.2831))) * smoothstep(0.035, 0.0, abs(r - 0.86) - 0.035);
            float seg = step(0.3, fract(ang * (5.0 / 6.2831))) * smoothstep(th * 0.8, 0.0, abs(r - 0.72));
            float inner = smoothstep(th * 0.7, 0.0, abs(r - 0.6)) * 0.8;
            a = max(rim, max(tk * 0.9, max(seg, inner)));
          } else if (sh == 16) {
            // pixel chip: a hard square split into 2x2 shaded texels
            a = step(max(abs(d.x), abs(d.y)), 0.42);
            vec2 cell = floor(vUv * 2.0);
            shade = 0.72 + 0.42 * fract(sin(dot(cell + vAux * 13.0, vec2(12.9898, 78.233))) * 43758.5453);
          } else {
            a = 1.0 - r;
          }
          if (a <= 0.003) discard;
          gl_FragColor = vec4(vCol.rgb * shade, vCol.a * a);
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
    const k = i * 6, cs = this.cols;
    cs[k] = o.r; cs[k + 1] = o.g; cs[k + 2] = o.b;
    if (o.r2 !== undefined) { cs[k + 3] = o.r2; cs[k + 4] = o.g2 ?? o.g; cs[k + 5] = o.b2 ?? o.b; }
    else cs[k + 3] = -1;
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
    const cs = this.cols;
    for (let j = 0; j < 6; j++) cs[i * 6 + j] = cs[last * 6 + j];
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
      const k = i * 6, cs = this.cols;
      if (cs[k + 3] >= 0) {
        C[i * 4] = cs[k] + (cs[k + 3] - cs[k]) * t;
        C[i * 4 + 1] = cs[k + 1] + (cs[k + 4] - cs[k + 1]) * t;
        C[i * 4 + 2] = cs[k + 2] + (cs[k + 5] - cs[k + 2]) * t;
      }
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
