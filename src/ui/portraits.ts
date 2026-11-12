import * as THREE from 'three';
import { HERO_LIST } from '../heroes';
import { ProceduralHeroModel } from '../render/HeroRig';
import type { HeroId } from '../game/types';

/** Studio-lit 3D portraits of every hero, rendered once at boot into data URLs for the UI. */
export const portraits: Partial<Record<HeroId, string>> = {};

export function renderPortraits(gl: THREE.WebGLRenderer, env: THREE.Texture | null) {
  const W = 384, H = 480;
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.7;
  const key = new THREE.DirectionalLight(0xfff0dd, 3.2); key.position.set(1.5, 2.5, 3);
  const rim = new THREE.DirectionalLight(0x88aaff, 4); rim.position.set(-2, 2, -2.5);
  const fill = new THREE.DirectionalLight(0xffc89a, 0.8); fill.position.set(-2, 0.5, 2);
  scene.add(key, rim, fill);
  const cam = new THREE.PerspectiveCamera(26, W / H, 0.1, 50);
  const prevTarget = gl.getRenderTarget();
  const prevTone = gl.toneMapping;
  const prevExp = gl.toneMappingExposure;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.05;
  const pixels = new Uint8Array(W * H * 4);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  for (const def of HERO_LIST) {
    const model = new ProceduralHeroModel(def.look, new THREE.Color(def.color));
    model.fx.uRim.value = 0.6;
    model.update(0.016, { speed: 0, fwd: 0, side: 0, grounded: true, pitch: 0.05, attack: 0, attackSide: 1, cast: 0, levitate: 0, dash: 0, dead: false, time: 1 });
    model.root.rotation.y = 0.35;
    scene.add(model.root);
    rim.color.set(def.color);
    cam.position.set(0.25, 1.48, 2.6);
    cam.lookAt(0, 1.32, 0);
    scene.background = null;
    gl.setRenderTarget(rt);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(scene, cam);
    gl.readRenderTargetPixels(rt, 0, 0, W, H, pixels);
    const img = ctx.createImageData(W, H);
    // flip Y
    for (let y = 0; y < H; y++) img.data.set(pixels.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    ctx.clearRect(0, 0, W, H);
    ctx.putImageData(img, 0, 0);
    portraits[def.id] = canvas.toDataURL('image/png');
    scene.remove(model.root);
    model.dispose();
  }
  gl.setRenderTarget(prevTarget);
  gl.toneMapping = prevTone;
  gl.toneMappingExposure = prevExp;
  gl.setClearColor(0x000000, 1);
  rt.dispose();
}
