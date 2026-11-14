import * as THREE from 'three';
import { getNoiseTexture } from './textures';
import { SUN_DIR } from '../world/Sky';

/** Uniforms shared by every animated material (single update per frame). */
export const globalUniforms = {
  uTime: { value: 0 },
  uNoise: { value: null as THREE.Texture | null },
  uSunDir: { value: SUN_DIR.clone() },
  uSunColor: { value: new THREE.Color(1.6, 0.95, 0.6) },
};

export function initGlobals() {
  globalUniforms.uNoise.value = getNoiseTexture();
}

/** Adds gentle wind sway (scaled by local height) to an instanced foliage material. */
export function addFoliageWind(mat: THREE.Material, amount: number, heightRef: number) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float hf = clamp(position.y / ${heightRef.toFixed(2)}, 0.0, 1.0);
          hf *= hf;
          #ifdef USE_INSTANCING
            vec3 io = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 io = vec3(0.0);
          #endif
          float ph = io.x * 0.37 + io.z * 0.21;
          float s = sin(uTime * 1.25 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25;
          transformed.x += s * hf * ${amount.toFixed(3)};
          transformed.z += cos(uTime * 1.05 + ph) * hf * ${(amount * 0.6).toFixed(3)};
          // leaf flutter
          transformed += normal * sin(uTime * 6.0 + position.x * 4.0 + position.y * 3.0 + ph) * 0.02 * hf;
        }`);
  };
  mat.customProgramCacheKey = () => `wind-${amount}-${heightRef}`;
}

/**
 * Hero material patch: hit flash (white rim), team rim light, and a glowing noise dissolve
 * used for deaths and respawns. Uniform objects are shared per hero so one write updates all parts.
 */
export interface HeroFxUniforms {
  uFlash: { value: number };
  uDissolve: { value: number };
  uRimColor: { value: THREE.Color };
  uRim: { value: number };
  uTint: { value: THREE.Color };
  uTintAmt: { value: number };
  /** 0..1 bleach toward glowing white (Luffy's Gear Fifth). */
  uWhite: { value: number };
}

export function makeHeroFxUniforms(rim: THREE.Color): HeroFxUniforms {
  return {
    uFlash: { value: 0 },
    uDissolve: { value: 0 },
    uRimColor: { value: rim.clone() },
    uRim: { value: 0.35 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uTintAmt: { value: 0 },
    uWhite: { value: 0 },
  };
}

export function patchHeroMaterial(mat: THREE.MeshStandardMaterial, fx: HeroFxUniforms) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fx, { uNoise: globalUniforms.uNoise });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFxPos;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvFxPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFlash; uniform float uDissolve; uniform vec3 uRimColor; uniform float uRim;
        uniform vec3 uTint; uniform float uTintAmt; uniform float uWhite; uniform sampler2D uNoise; varying vec3 vFxPos;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float dn = 0.0;
        if (uDissolve > 0.0) {
          dn = texture2D(uNoise, vFxPos.xz * 0.9 + vFxPos.y * 0.6).r * 0.65 + texture2D(uNoise, vFxPos.xy * 2.3).g * 0.35;
          if (dn < uDissolve) discard;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uTint, uTintAmt);
        if (uWhite > 0.0) {
          // Gear Fifth: hair and clothes bleach to white, warm skin (and straw) keeps its colour
          vec3 wc = diffuseColor.rgb;
          float wl = dot(wc, vec3(0.299, 0.587, 0.114));
          float warm = smoothstep(0.2, 0.06, abs(wc.g / max(wc.r, 1e-3) - 0.5)) * step(wc.b, wc.g) * smoothstep(0.06, 0.18, wc.r);
          diffuseColor.rgb = mix(wc, vec3(0.94, 0.95, 0.98) * (0.72 + 0.4 * wl), uWhite * (1.0 - 0.8 * warm));
        }
        {
          vec3 vdir = normalize(vViewPosition);
          float fres = pow(1.0 - abs(dot(normalize(vNormal), -vdir)), 3.0);
          totalEmissiveRadiance += uRimColor * fres * uRim;
          totalEmissiveRadiance += vec3(1.0, 0.95, 0.9) * uFlash * (0.6 + fres * 2.0);
          totalEmissiveRadiance += vec3(0.9, 0.95, 1.1) * uWhite * (0.02 + fres * 1.2);
          if (uDissolve > 0.0) {
            float edge = 1.0 - smoothstep(0.0, 0.06, dn - uDissolve);
            totalEmissiveRadiance += uRimColor * edge * 6.0;
          }
        }`);
  };
  mat.customProgramCacheKey = () => 'herofx';
}

/** Rig material: per-vertex roughness / metalness / emissive + the hero FX layer. */
export function patchRigMaterial(mat: THREE.MeshStandardMaterial, fx: HeroFxUniforms) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fx, { uNoise: globalUniforms.uNoise });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aPbr; attribute vec3 aEmis; varying vec2 vPbr; varying vec3 vEmis; varying vec3 vFxPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvPbr = aPbr; vEmis = aEmis;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vFxPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFlash; uniform float uDissolve; uniform vec3 uRimColor; uniform float uRim;
        uniform vec3 uTint; uniform float uTintAmt; uniform float uWhite; uniform sampler2D uNoise;
        varying vec2 vPbr; varying vec3 vEmis; varying vec3 vFxPos;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float dn = 0.0;
        if (uDissolve > 0.0) {
          dn = texture2D(uNoise, vFxPos.xz * 0.9 + vFxPos.y * 0.6).r * 0.65 + texture2D(uNoise, vFxPos.xy * 2.3).g * 0.35;
          if (dn < uDissolve) discard;
        }`)
      .replace('#include <emissivemap_fragment>', `
        totalEmissiveRadiance = vEmis;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uTint, uTintAmt);
        if (uWhite > 0.0) {
          // Gear Fifth: hair and clothes bleach to white, warm skin (and straw) keeps its colour
          vec3 wc = diffuseColor.rgb;
          float wl = dot(wc, vec3(0.299, 0.587, 0.114));
          float warm = smoothstep(0.2, 0.06, abs(wc.g / max(wc.r, 1e-3) - 0.5)) * step(wc.b, wc.g) * smoothstep(0.06, 0.18, wc.r);
          diffuseColor.rgb = mix(wc, vec3(0.94, 0.95, 0.98) * (0.72 + 0.4 * wl), uWhite * (1.0 - 0.8 * warm));
        }
        {
          vec3 vdir = normalize(vViewPosition);
          float fres = pow(1.0 - abs(dot(normalize(vNormal), -vdir)), 3.0);
          totalEmissiveRadiance += uRimColor * fres * uRim;
          totalEmissiveRadiance += vec3(1.0, 0.95, 0.9) * uFlash * (0.6 + fres * 2.0);
          totalEmissiveRadiance += vec3(0.9, 0.95, 1.1) * uWhite * (0.02 + fres * 1.2);
          if (uDissolve > 0.0) {
            float edge = 1.0 - smoothstep(0.0, 0.06, dn - uDissolve);
            totalEmissiveRadiance += uRimColor * edge * 6.0;
          }
        }`);
  };
  mat.customProgramCacheKey = () => 'rigfx';
}
