import * as THREE from 'three';
import { globalUniforms } from '../render/materials';

/** How a ribbon is shaded. */
export const enum TrailStyle {
  /** Soft glowing ribbon with a hot core. */
  Smooth = 0,
  /** Flickering energy: scrolling noise along the length. */
  Energy = 1,
  /** Bristly paint stroke with dry, broken edges (alpha system). */
  Brush = 2,
}

export interface TrailOpts {
  color: THREE.Color;
  /** Tail color; defaults to the head color. */
  endColor?: THREE.Color;
  /** Half-width at the head, in meters. */
  width: number;
  /** Seconds a point lives before fading out of the tail. */
  life: number;
  style?: TrailStyle;
  /** Min distance between stored points (smaller = smoother curves, more vertices). */
  minDist?: number;
  /** Peak opacity. */
  alpha?: number;
  /** 0 = constant width, 1 = tapers to a point at the tail. */
  taper?: number;
}

const MAX_PTS = 24;

/**
 * One ribbon: a short history of positions. Push the head every frame; call stop() when the
 * emitter dies and the tail fades out on its own before the slot is recycled.
 */
export class Trail {
  pts = new Float32Array(MAX_PTS * 4); // x y z age
  n = 0;
  head = 0; // index of the newest point in the ring buffer
  stopped = false;
  free = true;
  o!: Required<Omit<TrailOpts, 'endColor'>> & { endColor: THREE.Color };
  seed = 0;

  push(p: THREE.Vector3) {
    if (this.stopped) return;
    const P = this.pts;
    if (this.n > 1) {
      // keep the head glued to the emitter; only commit a new point once we moved far enough
      const prev = ((this.head - 1 + MAX_PTS) % MAX_PTS) * 4;
      const dx = p.x - P[prev], dy = p.y - P[prev + 1], dz = p.z - P[prev + 2];
      if (dx * dx + dy * dy + dz * dz < this.o.minDist * this.o.minDist) {
        const h = this.head * 4;
        P[h] = p.x; P[h + 1] = p.y; P[h + 2] = p.z; P[h + 3] = 0;
        return;
      }
    }
    this.head = (this.head + 1) % MAX_PTS;
    const h = this.head * 4;
    P[h] = p.x; P[h + 1] = p.y; P[h + 2] = p.z; P[h + 3] = 0;
    if (this.n < MAX_PTS) this.n++;
  }

  stop() { this.stopped = true; }
}

/**
 * Camera-facing ribbon trails, one draw call per blend mode. The CPU only writes positions and
 * a few scalars; the vertex shader extrudes each point sideways toward the camera.
 */
export class TrailSystem {
  readonly mesh: THREE.Mesh;
  private trails: Trail[] = [];
  private geo: THREE.BufferGeometry;
  private aPos: THREE.BufferAttribute;
  private aTan: THREE.BufferAttribute;
  private aData: THREE.BufferAttribute;
  private aCol: THREE.BufferAttribute;
  private index: THREE.BufferAttribute;

  constructor(capacity: number, additive: boolean) {
    for (let i = 0; i < capacity; i++) this.trails.push(new Trail());
    const verts = capacity * MAX_PTS * 2;
    const geo = new THREE.BufferGeometry();
    const mk = (k: number) => { const a = new THREE.BufferAttribute(new Float32Array(verts * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.aPos = mk(3); this.aTan = mk(3); this.aData = mk(4); this.aCol = mk(4);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aTan', this.aTan);
    geo.setAttribute('aData', this.aData);
    geo.setAttribute('aCol', this.aCol);
    this.index = new THREE.BufferAttribute(new Uint16Array(capacity * (MAX_PTS - 1) * 6), 1);
    this.index.setUsage(THREE.DynamicDrawUsage);
    geo.setIndex(this.index);
    geo.setDrawRange(0, 0);
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uNoise: globalUniforms.uNoise, uTime: globalUniforms.uTime },
      vertexShader: /* glsl */ `
        attribute vec3 aTan; attribute vec4 aData; attribute vec4 aCol;
        varying vec2 vUv; varying vec4 vCol; varying float vA;
        void main() {
          vec3 wp = position;
          vec3 view = normalize(cameraPosition - wp);
          vec3 side = cross(aTan, view);
          float l = length(side);
          side = l > 1e-5 ? side / l : vec3(0.0, 1.0, 0.0);
          wp += side * aData.x * aData.y;
          vUv = vec2(aData.w, aData.x * 0.5 + 0.5);
          vCol = aCol; vA = aData.z;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uNoise; uniform float uTime;
        varying vec2 vUv; varying vec4 vCol; varying float vA;
        void main() {
          float v = abs(vUv.y - 0.5) * 2.0;
          int st = int(vCol.a);
          float seed = fract(vCol.a);
          vec3 col = vCol.rgb;
          float a;
          if (st == 1) {
            float n = texture2D(uNoise, vec2(vUv.x * 0.35 - uTime * 2.2 + seed, vUv.y * 0.4 + seed)).g;
            a = (1.0 - v * v) * (0.45 + n * 1.0);
            col *= 1.0 + smoothstep(0.45, 0.0, v) * 1.2;
          } else if (st == 2) {
            float n = texture2D(uNoise, vec2(vUv.x * 0.25 + seed * 7.0, vUv.y * 1.6 + seed)).r;
            float edge = smoothstep(1.0, 0.55, v + (n - 0.5) * 0.7);
            a = edge * (0.55 + smoothstep(0.3, 0.7, n) * 0.6);
            col *= 0.8 + n * 0.45;
          } else {
            a = 1.0 - v * v;
            col *= 1.0 + smoothstep(0.35, 0.0, v) * 0.8;
          }
          a *= vA;
          if (a <= 0.003) discard;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 19 : 9;
  }

  create(o: TrailOpts): Trail | null {
    const t = this.trails.find((x) => x.free);
    if (!t) return null;
    t.free = false; t.stopped = false; t.n = 0; t.head = 0;
    t.seed = Math.random() * 0.9;
    t.o = {
      color: o.color, endColor: o.endColor ?? o.color, width: o.width, life: o.life,
      style: o.style ?? TrailStyle.Smooth, minDist: o.minDist ?? 0.25, alpha: o.alpha ?? 1, taper: o.taper ?? 1,
    };
    return t;
  }

  update(dt: number) {
    const P = this.aPos.array as Float32Array, T = this.aTan.array as Float32Array;
    const D = this.aData.array as Float32Array, C = this.aCol.array as Float32Array;
    const I = this.index.array as Uint16Array;
    let v = 0, ii = 0;
    for (const t of this.trails) {
      if (t.free) continue;
      const o = t.o, life = o.life;
      // age points (the head ages only once the emitter stopped)
      let alive = 0;
      for (let k = 0; k < t.n; k++) {
        const idx = ((t.head - k + MAX_PTS) % MAX_PTS) * 4;
        if (k > 0 || t.stopped) t.pts[idx + 3] += dt;
        if (t.pts[idx + 3] < life) alive = k + 1;
      }
      t.n = alive;
      if (t.n === 0) { if (t.stopped) t.free = true; continue; }
      if (t.n < 2) continue;
      const v0 = v;
      let dist = 0;
      let px = 0, py = 0, pz = 0;
      for (let k = 0; k < t.n; k++) {
        const idx = ((t.head - k + MAX_PTS) % MAX_PTS) * 4;
        const x = t.pts[idx], y = t.pts[idx + 1], z = t.pts[idx + 2], age = t.pts[idx + 3];
        // tangent from neighbours
        const ia = ((t.head - Math.max(0, k - 1) + MAX_PTS) % MAX_PTS) * 4;
        const ib = ((t.head - Math.min(t.n - 1, k + 1) + MAX_PTS) % MAX_PTS) * 4;
        let tx = t.pts[ia] - t.pts[ib], ty = t.pts[ia + 1] - t.pts[ib + 1], tz = t.pts[ia + 2] - t.pts[ib + 2];
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        if (k > 0) dist += Math.hypot(x - px, y - py, z - pz);
        px = x; py = y; pz = z;
        const u = Math.min(1, age / life);
        const along = k / (t.n - 1);
        const fade = (1 - u) * (1 - u);
        const w = o.width * (1 - o.taper * along * 0.92) * (0.6 + 0.4 * (1 - u));
        const a = fade * o.alpha * (k === 0 ? 0.6 : 1);
        const cr = o.color.r + (o.endColor.r - o.color.r) * along;
        const cg = o.color.g + (o.endColor.g - o.color.g) * along;
        const cb = o.color.b + (o.endColor.b - o.color.b) * along;
        for (let s = -1; s <= 1; s += 2) {
          P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
          T[v * 3] = tx; T[v * 3 + 1] = ty; T[v * 3 + 2] = tz;
          D[v * 4] = s; D[v * 4 + 1] = w; D[v * 4 + 2] = a; D[v * 4 + 3] = dist;
          C[v * 4] = cr; C[v * 4 + 1] = cg; C[v * 4 + 2] = cb; C[v * 4 + 3] = o.style + t.seed;
          v++;
        }
      }
      for (let k = 0; k < t.n - 1; k++) {
        const a = v0 + k * 2;
        I[ii++] = a; I[ii++] = a + 1; I[ii++] = a + 2;
        I[ii++] = a + 1; I[ii++] = a + 3; I[ii++] = a + 2;
      }
    }
    for (const at of [this.aPos, this.aTan, this.aData, this.aCol]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, Math.max(at.itemSize, v * at.itemSize));
      at.needsUpdate = true;
    }
    this.index.clearUpdateRanges();
    this.index.addUpdateRange(0, Math.max(6, ii));
    this.index.needsUpdate = true;
    this.geo.setDrawRange(0, ii);
  }

  clear() { for (const t of this.trails) { t.free = true; t.n = 0; } }
}
