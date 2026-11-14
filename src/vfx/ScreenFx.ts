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
  /**
   * 0..1 "1928 film": black and white print stock, grain, flicker, scratches, dust and gate weave
   * (Mickey's Steamboat Willie). Re-applied every frame by its owner and always shown, because it is
   * the special itself, not a camera effect.
   */
  film = 0;
  /**
   * 0..1 "drowsy" (Bob Marley's Kaya Cloud and One Love): the view sways and swims, a ghost image drifts beside
   * it and a warm haze closes in at the edges. Re-applied every frame from the local legend's status and always
   * shown, because it is a gameplay status, not a camera effect.
   */
  drowsy = 0;

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
    this.film = Math.max(0, this.film - dt * 2.5);
    this.drowsy = Math.max(0, this.drowsy - dt * 2.5);
    if (this.flash.r + this.flash.g + this.flash.b < 0.002) this.flash.setRGB(0, 0, 0);
  }

  get active() {
    return this.ripples.length > 0 || this.lenses.length > 0 || this.aberration > 0.002 || this.zoom > 0.002 || this.zoomHold > 0.002
      || this.flash.r + this.flash.g + this.flash.b > 0.002 || this.film > 0.002 || this.drowsy > 0.002;
  }

  clear() {
    this.ripples.length = 0;
    for (const l of this.lenses) l.alive = false;
    this.lenses.length = 0;
    this.aberration = 0; this.zoom = 0; this.zoomHold = 0; this.film = 0; this.drowsy = 0;
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
  uniform float uFilm;
  uniform float uFilmT;
  uniform float uDrowsy;

  float fh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

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
    // film gate weave: the frame jitters a hair, once per projected frame (24 fps)
    float fr = floor(uFilmT * 24.0);
    if (uFilm > 0.001) off += (vec2(fh(vec2(fr, 1.3)), fh(vec2(fr, 7.1))) - 0.5) * vec2(0.0012, 0.0024) * uFilm;
    // drowsy: the whole view sways like a slow boat and swims in long, lazy waves (zoomed in a touch so the
    // edges never pull in from outside the frame)
    vec2 ghost = vec2(0.0);
    if (uDrowsy > 0.001) {
      float t = uFilmT;
      vec2 c = uv - 0.5;
      float zoomIn = 1.0 - 0.035 * uDrowsy;
      off += c * (zoomIn - 1.0);
      off += vec2(sin(t * 0.83) * 0.011, sin(t * 0.61 + 1.3) * 0.008) * uDrowsy;
      off += vec2(sin(uv.y * 7.0 + t * 1.9), cos(uv.x * 5.0 + t * 1.45)) * 0.0045 * uDrowsy;
      ghost = vec2(sin(t * 1.13 + 0.5), cos(t * 0.77)) * vec2(0.016, 0.01) * uDrowsy;
    }
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
    if (uDrowsy > 0.001) {
      // double vision, a warm smoky haze and heavy eyelids closing in from the edges
      vec3 g1 = texture2D(inputBuffer, clamp(cuv + ghost, vec2(0.001), vec2(0.999))).rgb;
      vec3 g2 = texture2D(inputBuffer, clamp(cuv - ghost * 0.6, vec2(0.001), vec2(0.999))).rgb;
      col = mix(col, (g1 + g2) * 0.5, 0.42 * uDrowsy);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l) * vec3(1.05, 1.0, 0.82), 0.3 * uDrowsy);
      col = mix(col, vec3(0.62, 0.66, 0.5) * (0.35 + l * 0.5), 0.12 * uDrowsy);
      vec2 vc = (uv - 0.5) * vec2(1.0, 1.25);
      float lid = 0.5 + 0.5 * sin(uFilmT * 0.9);
      float vig = smoothstep(0.75 - 0.2 * uDrowsy - 0.06 * lid * uDrowsy, 0.3, length(vc));
      col *= mix(1.0, vig, 0.75 * uDrowsy);
    }
    col += uFlash;
    if (uFilm > 0.001) {
      // print stock: luminance with a warm silver tone and a steeper toe, so blacks go inky like a 1928 cartoon
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      float lt = l / (1.0 + l);
      lt = smoothstep(0.03, 0.82, lt);
      float flick = 1.0 + (fh(vec2(fr, 3.7)) - 0.5) * 0.14;
      vec2 px = uv * vec2(uAspect, 1.0) * 420.0;
      float grain = fh(floor(px) + fr * 13.1) - 0.5;
      lt += grain * 0.09 * (0.35 + lt);
      // two or three scratches running down the frame, and dust specks that live for a single frame
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float sx = fh(vec2(floor(uFilmT * 6.0 + fi * 0.37), fi * 9.1));
        float on = step(0.45, fh(vec2(fr, fi * 5.3)));
        float w = 0.0008 + 0.0012 * fh(vec2(fi, 2.0));
        lt += on * (1.0 - smoothstep(0.0, w, abs(uv.x - sx))) * (fi == 1.0 ? -0.35 : 0.45) * (0.6 + 0.4 * sin(uv.y * 40.0 + fi * 7.0));
      }
      vec2 cell = floor(uv * vec2(uAspect, 1.0) * 26.0);
      float dh = fh(cell + fr * 1.7);
      if (dh > 0.992) {
        vec2 cp = (fract(uv * vec2(uAspect, 1.0) * 26.0) - 0.5);
        float spec = 1.0 - smoothstep(0.08, 0.2, length(cp * vec2(1.0, 1.0 + fh(cell) * 2.0)));
        lt = mix(lt, dh > 0.996 ? 0.95 : 0.02, spec * 0.85);
      }
      // the projector's hot spot and a heavy oval vignette
      vec2 vc = (uv - 0.5) * vec2(1.0, 1.15);
      float vig = 1.0 - smoothstep(0.32, 0.78, length(vc));
      lt *= flick * mix(0.32, 1.06, vig);
      vec3 silver = vec3(lt) * vec3(1.04, 1.0, 0.9);
      // back to the HDR range the tone mapper expects
      vec3 fcol = silver / max(vec3(1e-3), vec3(1.0) - min(silver, vec3(0.97)));
      col = mix(col, fcol, uFilm);
    }
    outputColor = vec4(col, inputColor.a);
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
        ['uFilm', new THREE.Uniform(0)],
        ['uFilmT', new THREE.Uniform(0)],
        ['uDrowsy', new THREE.Uniform(0)],
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
    u.get('uFilm')!.value = screenFx.film;
    u.get('uFilmT')!.value = performance.now() / 1000;
    u.get('uDrowsy')!.value = screenFx.drowsy;
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
    return n > 0 || screenFx.aberration > 0.002 || screenFx.zoom > 0.002 || screenFx.zoomHold > 0.002 || screenFx.flash.r + screenFx.flash.g + screenFx.flash.b > 0.002 || screenFx.film > 0.002 || screenFx.drowsy > 0.002;
  }
}
