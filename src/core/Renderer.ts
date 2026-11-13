import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, SMAAEffect, SMAAPreset, FXAAEffect, HueSaturationEffect, BrightnessContrastEffect,
} from 'postprocessing';
import { QUALITY, settings, type QualityPreset } from './settings';
import { ImpactEffect, screenFx } from '../vfx/ScreenFx';

/**
 * Renderer + post stack.
 * Single HDR (half-float) scene pass -> one merged effect pass (bloom, grade, tonemap, vignette)
 * -> AA pass on LDR. Dynamic resolution keeps frame time locked to the display refresh.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  private renderPass: RenderPass;
  /** Screen-space impact layer (ripples, lensing, aberration). Enabled only while something is active. */
  private impact = new ImpactEffect();
  private impactPass: EffectPass;
  private warm = true;
  private gradePass!: EffectPass;
  private aaPass: EffectPass | null = null;
  private vignette: VignetteEffect;
  private tone: ToneMappingEffect;
  private hue: HueSaturationEffect;
  private bc: BrightnessContrastEffect;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  preset: QualityPreset;

  renderScale = 1;
  private frameTimes: number[] = [];
  private evalTimer = 0;
  private goodTime = 0;
  private refreshMs = 1000 / 60;
  private fastest: number[] = [];
  fps = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;

  constructor(container: HTMLElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    this.preset = QUALITY[settings.quality];
    const gl = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.NoToneMapping;
    gl.shadowMap.enabled = this.preset.shadows;
    gl.shadowMap.type = THREE.PCFShadowMap;
    gl.info.autoReset = false;
    container.appendChild(gl.domElement);
    this.gl = gl;

    this.composer = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.impactPass = new EffectPass(camera, this.impact);
    this.impactPass.enabled = false;
    this.composer.addPass(this.impactPass);

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 0.82,
      luminanceSmoothing: 0.25,
      intensity: 0.95,
      radius: 0.72,
      levels: 7,
    });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.55 });
    this.hue = new HueSaturationEffect({ saturation: 0.12 });
    this.bc = new BrightnessContrastEffect({ contrast: 0.06 });
    this.rebuildPasses();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Re-create effect passes for the current quality preset. */
  rebuildPasses() {
    if (this.gradePass) { this.composer.removePass(this.gradePass); }
    if (this.aaPass) { this.composer.removePass(this.aaPass); this.aaPass.dispose(); this.aaPass = null; }
    const effects = [] as any[];
    if (this.preset.bloom) effects.push(this.bloom);
    effects.push(this.hue, this.bc, this.tone, this.vignette);
    this.gradePass = new EffectPass(this.camera, ...effects);
    this.composer.addPass(this.gradePass);
    if (this.preset.aa === 'smaa') {
      this.aaPass = new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM }));
    } else if (this.preset.aa === 'fxaa') {
      this.aaPass = new EffectPass(this.camera, new FXAAEffect());
    }
    if (this.aaPass) this.composer.addPass(this.aaPass);
  }

  private volumetric: { pass: EffectPass; effect: { setSteps(n: number): void } } | null = null;
  /** An arena's volumetric light (the study's god rays): runs on the HDR scene, before bloom and grading. */
  setVolumetric(effect: ConstructorParameters<typeof EffectPass>[1] & { setSteps(n: number): void }) {
    const pass = new EffectPass(this.camera, effect);
    this.composer.addPass(pass, 1);
    this.volumetric = { pass, effect };
    effect.setSteps(this.godRaySteps());
  }
  private godRaySteps() { return ({ low: 8, medium: 14, high: 20 } as Record<string, number>)[settings.quality] ?? 24; }

  applyQuality() {
    if (this.volumetric) this.volumetric.effect.setSteps(this.godRaySteps());
    this.preset = QUALITY[settings.quality];
    this.gl.shadowMap.enabled = this.preset.shadows;
    this.rebuildPasses();
    this.renderScale = 1;
    this.resize();
  }

  setCamera(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.renderPass.mainCamera = camera;
    this.impactPass.mainCamera = camera;
    this.gradePass.mainCamera = camera;
    if (this.aaPass) this.aaPass.mainCamera = camera;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio) * this.renderScale;
    this.gl.setPixelRatio(pr);
    this.gl.setSize(w, h, false);
    this.gl.domElement.style.width = w + 'px';
    this.gl.domElement.style.height = h + 'px';
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Feed frame delta (ms). Adjusts internal render scale with hysteresis. */
  private updateDynamicRes(ms: number, dt: number) {
    this.fpsAccum += dt; this.fpsFrames++;
    if (this.fpsAccum >= 0.5) { this.fps = this.fpsFrames / this.fpsAccum; this.fpsAccum = 0; this.fpsFrames = 0; }
    if (ms <= 0 || ms > 250) return;
    this.frameTimes.push(ms);
    this.fastest.push(ms);
    if (this.fastest.length > 240) this.fastest.shift();
    this.evalTimer += dt;
    if (this.evalTimer < 1.0) return;
    this.evalTimer = 0;
    // estimate the display refresh from the fastest frames we observe
    const sorted = [...this.fastest].sort((a, b) => a - b);
    const est = sorted[Math.floor(sorted.length * 0.1)] || 16.7;
    const rates = [30, 60, 75, 90, 100, 120, 144, 165, 180, 240, 360];
    let best = 60;
    for (const r of rates) if (Math.abs(1000 / r - est) < Math.abs(1000 / best - est)) best = r;
    this.refreshMs = 1000 / best;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (!settings.dynamicResolution) {
      if (this.renderScale !== 1) { this.renderScale = 1; this.resize(); }
      return;
    }
    if (avg > this.refreshMs * 1.18 && this.renderScale > 0.55) {
      this.renderScale = Math.max(0.55, this.renderScale - 0.1);
      this.goodTime = 0;
      this.resize();
    } else if (avg < this.refreshMs * 1.04) {
      this.goodTime += 1;
      if (this.goodTime >= 4 && this.renderScale < 1) {
        this.renderScale = Math.min(1, this.renderScale + 0.05);
        this.goodTime = 0;
        this.resize();
      }
    } else {
      this.goodTime = 0;
    }
  }

  setVignette(darkness: number) { this.vignette.darkness = darkness; }
  setSaturation(s: number) { this.hue.saturation = s; }

  render(dt: number, frameMs: number) {
    this.updateDynamicRes(frameMs, dt);
    this.gl.info.reset();
    screenFx.update(dt);
    // the first frame (boot warmup) runs the impact pass once so its shader compiles during loading
    this.impactPass.enabled = this.warm || (settings.screenFx && screenFx.active && this.impact.sync(this.camera));
    this.warm = false;
    this.composer.render(dt);
  }
}
