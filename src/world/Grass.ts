import * as THREE from 'three';
import { globalUniforms } from '../render/materials';
import { sampleNoise } from '../render/textures';
import { mulberry32, smoothstep } from '../core/math';
import type { World } from './collision';
import { SPAWNS } from './collision';

export const MAX_PUSHERS = 10;

/** Dirt lanes / dais ring mask. Mirrors the terrain shader exactly so grass never grows on paths. */
export function dirtMask(x: number, z: number) {
  const r = Math.hypot(x, z);
  const n2 = sampleNoise(x * 0.06, z * 0.06, 1);
  const lane = Math.abs(z + Math.sin(x * 0.12) * 2.0);
  const laneMask = (1 - smoothstep(1.2, 3.2, lane + (n2 - 0.5) * 3.0)) * smoothstep(8, 10, r) * (1 - smoothstep(29, 31, Math.abs(x)));
  const ring = 1 - smoothstep(0.8, 2.6, Math.abs(r - 9.5) + (n2 - 0.5) * 2.5);
  return Math.max(laneMask, ring) * 0.85;
}

/** Blade geometry: 3 segments, tapered, pre-bent, with soft "up" normals for a painterly meadow. */
function bladeGeometry() {
  const segs = 3;
  const pos: number[] = [], col: number[] = [], uv: number[] = [], nrm: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = 0.055 * (1 - t * 0.85);
    const bend = t * t * 0.22;
    const y = t;
    if (i < segs) {
      pos.push(-w, y, bend, w, y, bend);
      uv.push(0, t, 1, t);
      const c = 0.35 + t * 0.65;
      col.push(c, c, c, c, c, c);
      nrm.push(-0.25, 1, 0.3, 0.25, 1, 0.3);
    } else {
      pos.push(0, y, bend);
      uv.push(0.5, 1);
      col.push(1, 1, 1);
      nrm.push(0, 1, 0.3);
    }
  }
  for (let i = 0; i < segs - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segs - 1) * 2;
  idx.push(last, last + 1, last + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const n = new THREE.Float32BufferAttribute(nrm, 3);
  for (let i = 0; i < n.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(n, i).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
  g.setAttribute('normal', n);
  g.setIndex(idx);
  return g;
}

export class Grass {
  group = new THREE.Group();
  material: THREE.MeshLambertMaterial;
  pushers: THREE.Vector4[] = [];
  private chunks: THREE.InstancedMesh[] = [];

  constructor(world: World, density: number, receiveShadows: boolean) {
    for (let i = 0; i < MAX_PUSHERS; i++) this.pushers.push(new THREE.Vector4(9999, 0, 9999, 1));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const pushers = this.pushers;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = globalUniforms.uTime;
      shader.uniforms.uNoise = globalUniforms.uNoise;
      shader.uniforms.uSunDir = globalUniforms.uSunDir;
      shader.uniforms.uSunColor = globalUniforms.uSunColor;
      shader.uniforms.uPushers = { value: pushers };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform sampler2D uNoise; uniform vec4 uPushers[${MAX_PUSHERS}];
          varying float vGrassH; varying vec3 vGrassW;`)
        .replace('#include <project_vertex>', `
          vec3 iOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float camD = distance(iOrigin.xz, cameraPosition.xz);
          float shrink = 1.0 - smoothstep(30.0, 46.0, camD);
          transformed.y *= shrink;
          float hgt = uv.y;
          vGrassH = hgt;
          vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          vec2 wdir = vec2(0.94, 0.34);
          float gust = texture2D(uNoise, wp.xz * 0.018 + uTime * vec2(0.045, 0.016)).a;
          float sway = (sin(uTime * 1.9 + wp.x * 0.33 + wp.z * 0.21) * 0.25 + (gust - 0.45) * 1.9) * hgt * hgt * 0.32;
          wp.xz += wdir * sway;
          for (int i = 0; i < ${MAX_PUSHERS}; i++) {
            vec4 pu = uPushers[i];
            vec2 d = wp.xz - pu.xz;
            float dd = length(d);
            float f = (1.0 - smoothstep(0.0, pu.w, dd)) * hgt;
            wp.xz += (d / max(dd, 0.001)) * f * 0.42;
            wp.y -= f * 0.22;
          }
          vGrassW = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          if (shrink <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        `);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uSunDir; uniform vec3 uSunColor; varying float vGrassH; varying vec3 vGrassW;`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          {
            // golden-hour translucency: backlit tips glow, gated by how lit the blade is (respects shadows)
            vec3 V = normalize(cameraPosition - vGrassW);
            float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
            float lit = clamp(dot(reflectedLight.directDiffuse, vec3(1.0)) / (dot(diffuseColor.rgb, vec3(1.0)) + 1e-4) * 2.5, 0.0, 1.0);
            reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunColor * (back * 2.2 + 0.25) * vGrassH * lit;
            // root ambient occlusion
            reflectedLight.indirectDiffuse *= mix(0.45, 1.0, vGrassH);
          }`);
    };
    mat.customProgramCacheKey = () => 'grass-v1';
    this.material = mat;

    const geo = bladeGeometry();
    const rng = mulberry32(1234);
    const R = 45;
    const chunkSize = 15;
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const palette = [new THREE.Color(0.26, 0.42, 0.08), new THREE.Color(0.36, 0.48, 0.1), new THREE.Color(0.5, 0.52, 0.16), new THREE.Color(0.2, 0.36, 0.1)];
    for (let cx = -R; cx < R; cx += chunkSize) {
      for (let cz = -R; cz < R; cz += chunkSize) {
        const transforms: THREE.Matrix4[] = [];
        const colors: THREE.Color[] = [];
        const target = Math.floor(chunkSize * chunkSize * density);
        for (let i = 0; i < target; i++) {
          const x = cx + rng() * chunkSize, z = cz + rng() * chunkSize;
          const r = Math.hypot(x, z);
          if (r > R || r < 8.4) continue;
          if (Math.hypot(x - SPAWNS[0].x, z) < 5.4 || Math.hypot(x - SPAWNS[1].x, z) < 5.4) continue;
          const dm = dirtMask(x, z);
          if (rng() < dm * 1.5) continue;
          // patchy density
          const patch = sampleNoise(x * 0.025, z * 0.025, 3);
          if (rng() > 0.35 + patch * 0.9) continue;
          const y = world.heightAt(x, z);
          if (y < -0.6) continue;
          dummy.position.set(x, y - 0.02, z);
          dummy.rotation.set((rng() - 0.5) * 0.25, rng() * Math.PI * 2, (rng() - 0.5) * 0.25);
          const h = (0.32 + rng() * 0.45) * (0.75 + patch * 0.6) * (1 - dm * 0.6);
          dummy.scale.set(0.8 + rng() * 0.6, h, 1);
          dummy.updateMatrix();
          transforms.push(dummy.matrix.clone());
          const a = palette[Math.floor(rng() * palette.length)];
          tint.copy(a).offsetHSL((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.06);
          // drier near lanes
          tint.lerp(new THREE.Color(0.55, 0.5, 0.2), dm * 0.6);
          colors.push(tint.clone());
        }
        if (!transforms.length) continue;
        const mesh = new THREE.InstancedMesh(geo, mat, transforms.length);
        for (let i = 0; i < transforms.length; i++) { mesh.setMatrixAt(i, transforms[i]); mesh.setColorAt(i, colors[i]); }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.receiveShadow = receiveShadows;
        mesh.castShadow = false;
        this.chunks.push(mesh);
        this.group.add(mesh);
      }
    }
  }

  setPushers(positions: { x: number; y: number; z: number }[]) {
    for (let i = 0; i < MAX_PUSHERS; i++) {
      const p = positions[i];
      if (p) this.pushers[i].set(p.x, p.y, p.z, 1.1);
      else this.pushers[i].set(9999, 0, 9999, 1);
    }
  }

  get count() { return this.chunks.reduce((a, c) => a + c.count, 0); }

  dispose() {
    for (const c of this.chunks) c.dispose();
    this.chunks[0]?.geometry.dispose();
    this.material.dispose();
  }
}
