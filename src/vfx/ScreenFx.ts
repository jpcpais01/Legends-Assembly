import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { settings } from '../core/settings';

/**
 * Screen-space impact layer: shockwave ripples, gravitational lensing, chromatic punches,
 * radial zoom blur and full-screen flashes. Gameplay code writes into `screenFx`; the renderer
 * projects the world-space sources once per frame and only enables the pass while something
 * is active, so it costs nothing the rest of the time.
 */
const MAX_SRC = 4;

interface Ripple { pos: THREE.Vector3; radius: number; strength: number; t: number; dur: number }
export interface Lens { pos: THREE.Vector3; radius: number; strength: number; alive: boolean }

class ScreenFxState {
  ripples: Ripple[] = [];
  lenses: Lens[] = [];
  aberration = 0;
  zoom = 0;
  /** Sustained zoom blur (vehicles), re-applied every frame by its owner. */
  zoomHold = 0;
  flash = new THREE.Color(0, 0, 0);

  /** Expanding shockwave ring through the world (radius in meters). */
  ripple(pos: THREE.Vector3, radius: number, strength = 1, dur = 0.7) {
    if (!settings.screenFx) return;
    if (this.ripples.length >= MAX_SRC) this.ripples.shift();
    this.ripples.push({ pos: pos.clone(), radius, strength, t: 0, dur });
  }

  /** A persistent lensing source the owner moves and kills. */
  lens(pos: THREE.Vector3, radius: number, strength: number): Lens {
    const l = { pos: pos.clone(), radius, strength, alive: true };
    this.lenses.push(l);
    return l;
  }

  /** Chromatic aberration kick (0..1-ish). */
  punch(amount: number) { if (settings.screenFx) this.aberration = Math.min(1.2, Math.max(this.aberration, amount)); }

  /** Radial zoom blur kick. */
  zoomPunch(amount: number) { if (settings.screenFx) this.zoom = Math.min(1, Math.max(this.zoom, amount)); }

  /** Additive HDR flash over the whole frame. */
  flashScreen(color: THREE.Color, amount: number) {
    this.flash.r = Math.max(this.flash.r, color.r * amount);
    this.flash.g = Math.max(this.flash.g, color.g * amount);
    this.flash.b = Math.max(this.flash.b, color.b * amount);
  }

  update(dt: number) {
    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => r.t < r.dur);
    this.lenses = this.lenses.filter((l) => l.alive);
    this.aberration = Math.max(0, this.aberration - dt * 2.6);
    this.zoom = Math.max(0, this.zoom - dt * 3.2);
    const k = Math.exp(-dt * 7);
    this.flash.multiplyScalar(k);
    if (this.flash.r + this.flash.g + this.flash.b < 0.002) this.flash.setRGB(0, 0, 0);
  }

  get active() {
    return this.ripples.length > 0 || this.lenses.length > 0 || this.aberration > 0.002 || this.zoom > 0.002 || this.zoomHold > 0.002
      || this.flash.r + this.flash.g + this.flash.b > 0.002;
  }

  clear() {
    this.ripples.length = 0;
    for (const l of this.lenses) l.alive = false;
    this.lenses.length = 0;
    this.aberration = 0; this.zoom = 0; this.zoomHold = 0;
    this.flash.setRGB(0, 0, 0);
  }
}

export const screenFx = new ScreenFxState();

const frag = /* glsl */ `
  uniform vec4 uSrc[${MAX_SRC}];   // xy = screen uv, z = radius (uv, y units), w = strength
  uniform vec4 uKind[${MAX_SRC}];  // x = 0 ripple / 1 lens, y = ring width, z = swirl
  uniform float uAspect;
  uniform float uCA;
  uniform float uZoom;
  uniform vec3 uFlash;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 off = vec2(0.0);
    float bend = 0.0;
    for (int i = 0; i < ${MAX_SRC}; i++) {
      vec4 s = uSrc[i];
      if (s.w == 0.0) continue;
      vec4 k = uKind[i];
      vec2 dv = (uv - s.xy) * vec2(uAspect, 1.0);
      float r = length(dv);
      vec2 dir = r > 1e-5 ? dv / r : vec2(0.0);
      if (k.x < 0.5) {
        // ripple: push pixels out ahead of the ring and pull them in behind it
        float x = (r - s.z) / max(k.y, 1e-4);
        float w = x * exp(-x * x * 1.6);
        off -= dir * w * s.w * k.y;
        bend += abs(w) * s.w;
      } else {
        // lens: compress what's behind the singularity into a bright Einstein ring, and twist it
        float f = smoothstep(s.z, 0.0, r);
        float f2 = f * f * smoothstep(0.0, s.z * 0.4, r); // leave the core itself undistorted
        off += dir * f2 * s.w * s.z;
        off += vec2(-dir.y, dir.x) * f2 * f * s.w * s.z * k.z;
        bend += f2 * s.w * 0.5;
      }
    }
    off.x /= uAspect;
    vec2 cuv = clamp(uv + off, vec2(0.001), vec2(0.999));
    vec2 fromC = cuv - 0.5;
    float ca = uCA * 0.012 + bend * 0.02;
    vec3 col;
    if (ca > 0.00005) {
      vec2 o = fromC * ca;
      col = vec3(texture2D(inputBuffer, cuv + o).r, texture2D(inputBuffer, cuv).g, texture2D(inputBuffer, cuv - o).b);
    } else {
      col = texture2D(inputBuffer, cuv).rgb;
    }
    if (uZoom > 0.001) {
      vec3 acc = col;
      for (int j = 1; j <= 5; j++) acc += texture2D(inputBuffer, cuv - fromC * uZoom * 0.03 * float(j)).rgb;
      float edgeK = smoothstep(0.05, 0.45, length(fromC));
      col = mix(col, acc / 6.0, edgeK);
    }
    outputColor = vec4(col + uFlash, inputColor.a);
  }
`;

export class ImpactEffect extends Effect {
  private src: THREE.Vector4[];
  private kind: THREE.Vector4[];
  private _p = new THREE.Vector3();
  private _q = new THREE.Vector3();
  private _r = new THREE.Vector3();

  constructor() {
    const src = Array.from({ length: MAX_SRC }, () => new THREE.Vector4());
    const kind = Array.from({ length: MAX_SRC }, () => new THREE.Vector4());
    super('ImpactEffect', frag, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['uSrc', new THREE.Uniform(src)],
        ['uKind', new THREE.Uniform(kind)],
        ['uAspect', new THREE.Uniform(1)],
        ['uCA', new THREE.Uniform(0)],
        ['uZoom', new THREE.Uniform(0)],
        ['uFlash', new THREE.Uniform(new THREE.Color())],
      ]),
    });
    this.src = src;
    this.kind = kind;
  }

  /** Projects the world-space sources for this frame. Returns false when there is nothing to draw. */
  sync(camera: THREE.PerspectiveCamera) {
    const u = this.uniforms;
    u.get('uAspect')!.value = camera.aspect;
    u.get('uCA')!.value = screenFx.aberration;
    u.get('uZoom')!.value = Math.max(screenFx.zoom, screenFx.zoomHold);
    (u.get('uFlash')!.value as THREE.Color).copy(screenFx.flash);
    for (const s of this.src) s.w = 0;
    let n = 0;
    const right = this._r.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const put = (pos: THREE.Vector3, radius: number, strength: number, kind: number, swirl: number) => {
      if (n >= MAX_SRC) return;
      const p = this._p.copy(pos).project(camera);
      if (p.z > 1 || p.z < -1) return; // behind the camera
      const q = this._q.copy(pos).addScaledVector(right, radius).project(camera);
      const ru = Math.abs(q.x - p.x) * 0.5 * camera.aspect;
      if (ru < 0.004) return;
      const sx = p.x * 0.5 + 0.5, sy = p.y * 0.5 + 0.5;
      if (sx < -ru || sx > 1 + ru || sy < -ru || sy > 1 + ru) return;
      this.src[n].set(sx, sy, ru, strength);
      this.kind[n].set(kind, kind === 0 ? Math.max(0.01, ru * 0.22) : 0, swirl, 0);
      n++;
    };
    for (const l of screenFx.lenses) put(l.pos, l.radius, l.strength, 1, 0.8);
    for (const r of screenFx.ripples) {
      const k = r.t / r.dur;
      const e = 1 - Math.pow(1 - k, 2.2);
      put(r.pos, r.radius * (0.08 + e * 0.92), r.strength * (1 - k) * (1 - k), 0, 0);
    }
    return n > 0 || screenFx.aberration > 0.002 || screenFx.zoom > 0.002 || screenFx.zoomHold > 0.002 || screenFx.flash.r + screenFx.flash.g + screenFx.flash.b > 0.002;
  }
}
