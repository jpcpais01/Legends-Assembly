import * as THREE from 'three';
import { PROPS, type PropTemplate } from '../render/props';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { World, SPAWNS, ARENA_RADIUS } from './collision';
import { Sky, SUN_DIR, SKY_GLSL, skyUniforms } from './Sky';
import { Grass, dirtMask } from './Grass';
import { getMarble, getRock, getBark, getNoiseTexture, sampleNoise } from '../render/textures';
import { globalUniforms, addFoliageWind } from '../render/materials';
import { mulberry32, smoothstep, TAU } from '../core/math';
import { QUALITY, settings } from '../core/settings';
import type { ArenaLike } from './types';

export const TEAM_COLORS = [new THREE.Color('#3fb4ff'), new THREE.Color('#ff3d5a')];
const WATER_Y = -2.2;

function cloneTex(t: THREE.Texture, rx: number, ry: number) {
  const c = t.clone();
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}

function marbleMaterial(rx = 1, ry = 1, tint = 0xffffff) {
  const m = getMarble();
  return new THREE.MeshStandardMaterial({
    map: cloneTex(m.map, rx, ry),
    normalMap: cloneTex(m.normalMap, rx, ry),
    roughnessMap: cloneTex(m.roughnessMap, rx, ry),
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 1,
    metalness: 0,
    color: tint,
  });
}

/** Fluted Doric-style column (base + fluted shaft + capital). */
function columnGeometry(shaftH: number, radius: number, broken: boolean, seed: number) {
  const rng = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.BoxGeometry(radius * 2.9, 0.36, radius * 2.9).translate(0, 0.18, 0);
  const plinth = new THREE.CylinderGeometry(radius * 1.22, radius * 1.32, 0.28, 32).translate(0, 0.5, 0);
  parts.push(base, plinth);
  const shaft = new THREE.CylinderGeometry(radius * 0.94, radius, shaftH, 40, 10, false);
  const p = shaft.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const rr = Math.hypot(x, z);
    if (rr < 1e-4) continue;
    const flute = 1 - 0.05 * Math.pow(0.5 + 0.5 * Math.cos(a * 20), 0.6);
    let nx = x * flute, nz = z * flute;
    let ny = y;
    if (broken && y > shaftH / 2 - 0.01) {
      ny = y - rng() * 0.7 - Math.max(0, Math.sin(a * 3 + seed)) * 0.5;
      nx *= 0.92 + rng() * 0.08; nz *= 0.92 + rng() * 0.08;
    }
    p.setXYZ(i, nx, ny, nz);
  }
  shaft.translate(0, 0.64 + shaftH / 2, 0);
  shaft.computeVertexNormals();
  parts.push(shaft);
  if (!broken) {
    const echinus = new THREE.CylinderGeometry(radius * 1.38, radius * 0.95, 0.38, 32).translate(0, 0.64 + shaftH + 0.19, 0);
    const abacus = new THREE.BoxGeometry(radius * 3.1, 0.32, radius * 3.1).translate(0, 0.64 + shaftH + 0.38 + 0.16, 0);
    parts.push(echinus, abacus);
  }
  const g = mergeGeometries(parts.map((x) => x.index ? x.toNonIndexed() : x), false)!;
  g.computeBoundingSphere();
  return g;
}

/** Rough boulder: displaced icosahedron with a flattened base. */
function rockGeometry(seed: number) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('normal'), 1e-4);
  const p = g.attributes.position as THREE.BufferAttribute;
  const ox = seed * 0.137, oz = seed * 0.291;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const n = sampleNoise(v.x * 0.25 + ox, v.z * 0.25 + v.y * 0.15 + oz, 1) * 0.9 + sampleNoise(v.x * 0.7 + oz, v.y * 0.7 + ox, 0) * 0.35;
    v.multiplyScalar(0.7 + n * 0.6);
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.2;
    v.y *= 0.75;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Italian cypress — tall flame-like silhouette (a nod to Van Gogh). */
function cypressGeometry() {
  const pts: THREE.Vector2[] = [];
  const H = 9;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const r = Math.sin(Math.pow(t, 0.75) * Math.PI) * 1.05 * (1 - t * 0.35) + 0.02;
    pts.push(new THREE.Vector2(r, 1.2 + t * H));
  }
  const g = new THREE.LatheGeometry(pts, 14);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const n = sampleNoise(a * 0.3 + 0.1, y * 0.09, 1);
    const tw = Math.sin(y * 1.3 + a * 2) * 0.12;
    const k = 0.75 + n * 0.55 + tw;
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  const colors: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) - 1.2) / H;
    const n = sampleNoise(p.getX(i) * 0.3, p.getY(i) * 0.2 + p.getZ(i) * 0.3, 0);
    colors.push(0.04 + t * 0.05 + n * 0.04, 0.11 + t * 0.08 + n * 0.06, 0.045 + t * 0.025);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

/** Broad olive/oak canopy: clustered displaced blobs. */
function canopyGeometry(seed: number) {
  const rng = mulberry32(seed);
  const blobs: THREE.BufferGeometry[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const b = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('normal').deleteAttribute('uv'), 1e-4);
    const p = b.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, k);
      const nn = sampleNoise(v.x * 0.3 + i * 0.17, v.y * 0.3 + v.z * 0.3, 0);
      v.multiplyScalar(0.8 + nn * 0.45);
      p.setXYZ(k, v.x, v.y, v.z);
    }
    const a = (i / n) * TAU + rng();
    const rr = i === 0 ? 0 : 1.3 + rng() * 0.6;
    const s = i === 0 ? 1.9 : 1.2 + rng() * 0.5;
    b.scale(s, s * 0.8, s);
    b.translate(Math.cos(a) * rr, 4.4 + (i === 0 ? 0.8 : rng() * 0.9), Math.sin(a) * rr);
    blobs.push(b);
  }
  let g = mergeGeometries(blobs.map((b) => { b.deleteAttribute('uv'); b.deleteAttribute('normal'); return mergeVertices(b, 1e-3); }), false)!;
  g = mergeVertices(g, 1e-3);
  g.computeVertexNormals();
  // bend normals outward from the canopy centre: soft, volumetric foliage shading
  {
    const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute;
    const c = new THREE.Vector3(0, 5, 0), v = new THREE.Vector3(), nn = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).sub(c).normalize();
      nn.fromBufferAttribute(n, i).lerp(v, 0.6).normalize();
      n.setXYZ(i, nn.x, nn.y, nn.z);
    }
  }
  const p = g.attributes.position as THREE.BufferAttribute;
  const colors: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = smoothstep(3, 6.5, y);
    const nn = sampleNoise(p.getX(i) * 0.4, p.getZ(i) * 0.4 + y * 0.2, 1);
    colors.push(0.07 + t * 0.09 + nn * 0.05, 0.15 + t * 0.12 + nn * 0.06, 0.035 + t * 0.03);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

function trunkGeometry() {
  const g = new THREE.CylinderGeometry(0.18, 0.32, 4.6, 8, 4).translate(0, 2.3, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + Math.sin(y * 0.9) * 0.18);
  }
  // two branches
  const b1 = new THREE.CylinderGeometry(0.06, 0.12, 2.0, 6).rotateZ(0.8).translate(0.7, 3.6, 0);
  const b2 = new THREE.CylinderGeometry(0.06, 0.12, 1.8, 6).rotateZ(-0.7).rotateY(2).translate(-0.4, 3.3, 0.5);
  const g2 = mergeGeometries([g.toNonIndexed(), b1.toNonIndexed(), b2.toNonIndexed()], false)!;
  g2.computeVertexNormals();
  return g2;
}

export class Arena implements ArenaLike {
  scene: THREE.Scene;
  world = new World();
  sky = new Sky();
  sun: THREE.DirectionalLight;
  grass!: Grass;
  private grassQuality = '';
  private sigil!: THREE.Mesh;
  private beacons: THREE.Mesh[] = [];
  private statics: THREE.Mesh[] = [];
  private brazier: { bowls: THREE.InstancedMesh; fire: THREE.InstancedMesh; spots: THREE.Vector3[] } | null = null;
  readonly showcasePos = new THREE.Vector3(0, 1, 0);
  readonly soundscape = { kind: 'ruins' as const };
  surfaceAt(): 'grass' { return 'grass'; }
  readonly healthPadPositions = [new THREE.Vector3(-10, 0, 21), new THREE.Vector3(10, 0, -21), new THREE.Vector3(10, 0, 21), new THREE.Vector3(-10, 0, -21)];

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    getNoiseTexture();
    scene.add(this.sky.mesh);
    scene.environment = this.sky.bakeEnvironment(renderer);
    scene.environmentIntensity = 0.8;
    scene.fog = new THREE.FogExp2(new THREE.Color(0.78, 0.56, 0.47), 0.0062);
    scene.background = null;

    const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.8, 0.6), 3.4);
    sun.position.copy(SUN_DIR).multiplyScalar(120);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -52; sc.right = 52; sc.top = 52; sc.bottom = -52; sc.near = 10; sc.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 2;
    this.sun = sun;
    scene.add(sun, sun.target);
    // subtle cool fill from the opposite sky
    const fill = new THREE.DirectionalLight(new THREE.Color(0.45, 0.55, 1.0), 0.35);
    fill.position.set(-SUN_DIR.x, 0.6, -SUN_DIR.z).multiplyScalar(50);
    scene.add(fill);

    for (const p of this.healthPadPositions) p.y = this.world.heightAt(p.x, p.z);

    this.buildTerrain();
    this.buildWater();
    this.buildMountains();
    this.buildDais();
    this.buildColumns();
    this.buildWalls();
    this.buildRocks();
    this.buildTrees();
    this.buildSpawns();
    this.buildBraziers();
    this.buildFlowers();
    this.buildMotes();
    this.flushStatics();
    this.applyQuality();
  }

  private addStatic(m: THREE.Mesh) { this.statics.push(m); }

  /** Merge static meshes that share a material into single draw calls. */
  private flushStatics() {
    const groups = new Map<THREE.Material, THREE.Mesh[]>();
    for (const m of this.statics) {
      const mat = m.material as THREE.Material;
      if (!groups.has(mat)) groups.set(mat, []);
      groups.get(mat)!.push(m);
    }
    for (const [mat, meshes] of groups) {
      const geos = meshes.map((m) => {
        m.updateMatrixWorld(true);
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g = g.applyMatrix4(m.matrixWorld);
        return g;
      });
      const merged = mergeGeometries(geos, false);
      if (!merged) { for (const m of meshes) this.scene.add(m); continue; }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = meshes.some((m) => m.castShadow);
      mesh.receiveShadow = meshes.some((m) => m.receiveShadow);
      this.scene.add(mesh);
      geos.forEach((g) => g.dispose());
    }
    this.statics = [];
  }

  applyQuality() {
    const q = QUALITY[settings.quality];
    const key = `${q.grassDensity}-${q.grassShadows}`;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); (this.sun.shadow as any).map = null; }
    if (key === this.grassQuality) return;
    this.grassQuality = key;
    if (this.grass) { this.scene.remove(this.grass.group); this.grass.dispose(); }
    this.grass = new Grass(this.world, q.grassDensity, q.grassShadows);
    this.scene.add(this.grass.group);
  }

  private buildTerrain() {
    const size = 140, seg = 200;
    const g = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      let y = this.world.heightAt(x, z);
      const r = Math.hypot(x, z);
      // rocky cliff noise on the rim
      if (r > 44) y += (sampleNoise(x * 0.05, z * 0.05, 2) - 0.5) * 2.2 * smoothstep(44, 50, r);
      if (r > 58) y = -9;
      p.setY(i, y);
    }
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uNoise = globalUniforms.uNoise;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vGPos; varying float vUp;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvGPos = (modelMatrix * vec4(position, 1.0)).xyz; vUp = normal.y;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform sampler2D uNoise; varying vec3 vGPos; varying float vUp;`)
        .replace('#include <map_fragment>', `
          vec2 gp = vGPos.xz;
          float n1 = texture2D(uNoise, gp * 0.013).a;
          float n2 = texture2D(uNoise, gp * 0.06).g;
          float n3 = texture2D(uNoise, gp * 0.35).r;
          float n4 = texture2D(uNoise, gp * 1.7).r;
          vec3 grassA = vec3(0.10, 0.19, 0.035);
          vec3 grassB = vec3(0.19, 0.25, 0.05);
          vec3 dry = vec3(0.32, 0.29, 0.12);
          vec3 col = mix(grassA, grassB, smoothstep(0.3, 0.7, n1));
          col = mix(col, dry, smoothstep(0.55, 0.8, n2) * 0.5);
          float rr = length(gp);
          float lane = abs(gp.y + sin(gp.x * 0.12) * 2.0);
          float laneMask = (1.0 - smoothstep(1.2, 3.2, lane + (n2 - 0.5) * 3.0)) * smoothstep(8.0, 10.0, rr) * (1.0 - smoothstep(29.0, 31.0, abs(gp.x)));
          float ring = 1.0 - smoothstep(0.8, 2.6, abs(rr - 9.5) + (n2 - 0.5) * 2.5);
          vec3 dirt = mix(vec3(0.30, 0.22, 0.14), vec3(0.46, 0.37, 0.25), n3) * (0.85 + n4 * 0.3);
          // pebbles
          dirt = mix(dirt, vec3(0.55, 0.5, 0.44), smoothstep(0.72, 0.8, n4) * 0.6);
          col = mix(col, dirt, max(laneMask, ring) * 0.85);
          float slope = 1.0 - vUp;
          vec3 rock = vec3(0.36, 0.32, 0.29) * (0.65 + n3 * 0.5 + n4 * 0.2);
          col = mix(col, rock, smoothstep(0.22, 0.45, slope));
          col = mix(col, vec3(0.52, 0.45, 0.34) * (0.8 + n3 * 0.3), smoothstep(-0.9, -1.8, vGPos.y));
          col = mix(col, col * 0.55, smoothstep(-1.9, -2.3, vGPos.y)); // wet shoreline
          col *= 0.86 + n3 * 0.28;
          diffuseColor.rgb = col;
        `)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.95, 0.6, smoothstep(-1.9, -2.3, vGPos.y));`);
    };
    mat.customProgramCacheKey = () => 'terrain-v1';
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  private buildWater() {
    const g = new THREE.CircleGeometry(900, 64).rotateX(-Math.PI / 2);
    const u = skyUniforms();
    const mat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        varying vec3 vW;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        ${SKY_GLSL}
        uniform float uTime;
        uniform sampler2D uNoise;
        varying vec3 vW;
        void main() {
          vec2 p = vW.xz;
          vec2 t = vec2(uTime * 0.02, uTime * 0.013);
          float e = 0.6;
          float h0 = texture2D(uNoise, p * 0.045 + t).r + texture2D(uNoise, p * 0.11 - t * 1.6).g * 0.6;
          float hx = texture2D(uNoise, (p + vec2(e, 0.0)) * 0.045 + t).r + texture2D(uNoise, (p + vec2(e, 0.0)) * 0.11 - t * 1.6).g * 0.6;
          float hz = texture2D(uNoise, (p + vec2(0.0, e)) * 0.045 + t).r + texture2D(uNoise, (p + vec2(0.0, e)) * 0.11 - t * 1.6).g * 0.6;
          vec3 n = normalize(vec3((h0 - hx) * 2.2, 1.0, (h0 - hz) * 2.2));
          vec3 V = normalize(vW - cameraPosition);
          vec3 R = reflect(V, n);
          R.y = abs(R.y);
          float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, n), 0.0), 5.0);
          vec3 refl = skyColor(R);
          vec3 deep = vec3(0.02, 0.09, 0.12);
          vec3 shallow = vec3(0.06, 0.25, 0.25);
          float r = length(p);
          vec3 base = mix(shallow, deep, smoothstep(46.0, 70.0, r));
          vec3 col = mix(base, refl, fres);
          float spec = pow(max(dot(R, uSunDir), 0.0), 420.0) * 30.0 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.6;
          col += uSunColor * spec;
          // shore foam band around the island
          float fn = texture2D(uNoise, p * 0.08 + vec2(uTime * 0.01, 0.0)).g;
          float shore = 1.0 - smoothstep(0.0, 2.2, abs(r - 47.6 - (fn - 0.5) * 3.0));
          float waves = 0.5 + 0.5 * sin(r * 2.2 - uTime * 1.6 + fn * 6.0);
          col = mix(col, vec3(0.9, 0.85, 0.8), shore * smoothstep(0.35, 0.9, waves * fn + shore * 0.3) * 0.7);
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    });
    Object.assign(mat.uniforms, u, { uTime: globalUniforms.uTime, uNoise: globalUniforms.uNoise, uSunDir: globalUniforms.uSunDir, uSunColor: globalUniforms.uSunColor });
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.y = WATER_Y;
    this.scene.add(mesh);
  }

  private buildMountains() {
    const make = (radius: number, depth: number, minH: number, maxH: number, haze: number, seed: number) => {
      const seg = 220;
      const pos: number[] = [], col: number[] = [], idx: number[] = [];
      const horizon = new THREE.Color(1.0, 0.62, 0.45);
      const shade = new THREE.Color(0.2, 0.16, 0.3);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        const n = sampleNoise(i / seg * 4 + seed, seed * 0.3, 2) * 0.65 + sampleNoise(i / seg * 13 + seed, 0.7, 0) * 0.35;
        const h = minH + Math.pow(n, 1.6) * (maxH - minH);
        const ca = Math.cos(a), sa = Math.sin(a);
        // front base, ridge, back base
        pos.push(ca * radius, -12, sa * radius);
        pos.push(ca * (radius + depth * 0.5), h, sa * (radius + depth * 0.5));
        pos.push(ca * (radius + depth), -12, sa * (radius + depth));
        const facing = Math.max(0, ca * SUN_DIR.x + sa * SUN_DIR.z);
        const ridge = shade.clone().lerp(horizon, haze + facing * 0.12);
        const base = shade.clone().lerp(horizon, Math.min(1, haze + 0.25));
        col.push(base.r, base.g, base.b, ridge.r, ridge.g, ridge.b, base.r, base.g, base.b);
      }
      for (let i = 0; i < seg; i++) {
        const a = i * 3, b = (i + 1) * 3;
        idx.push(a, b, a + 1, b, b + 1, a + 1, a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
      m.renderOrder = -5;
      this.scene.add(m);
    };
    make(560, 120, 20, 150, 0.62, 3.1);
    make(330, 60, 6, 55, 0.4, 7.7);
  }

  private buildDais() {
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, 1.03)];
    for (let i = 0; i <= 20; i++) {
      const r = 6.0 + (i / 20) * 2.8;
      pts.push(new THREE.Vector2(r, 1.0 * (1 - smoothstep(6.2, 8.6, r)) + 0.03));
    }
    pts.push(new THREE.Vector2(8.85, -0.3));
    const g = new THREE.LatheGeometry(pts, 72);
    const mat = marbleMaterial(4, 2);
    const dais = new THREE.Mesh(g, mat);
    dais.receiveShadow = true;
    this.scene.add(dais);
    // gold inlay ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(6.15, 0.07, 8, 96).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xffc66b, metalness: 1, roughness: 0.25 }),
    );
    ring.position.y = 1.0;
    this.addStatic(ring);

    // glowing sigil
    const sg = new THREE.CircleGeometry(5.6, 96).rotateX(-Math.PI / 2);
    const sm = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: globalUniforms.uTime, uNoise: globalUniforms.uNoise },
      vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform sampler2D uNoise; varying vec2 vP;
        float ring(float r, float c, float w) { return smoothstep(w, 0.0, abs(r - c)); }
        void main() {
          float r = length(vP);
          float a = atan(vP.y, vP.x);
          float g = ring(r, 5.2, 0.05) + ring(r, 4.85, 0.025) + ring(r, 2.6, 0.04) + ring(r, 1.2, 0.05) * 0.8;
          // rotating rune ticks
          float ticks = step(0.82, fract((a + uTime * 0.05) * 48.0 / 6.2831)) * step(4.9, r) * step(r, 5.15);
          float ticks2 = step(0.6, fract((a - uTime * 0.08) * 12.0 / 6.2831)) * step(2.65, r) * step(r, 2.85);
          // star rays
          float rays = pow(abs(cos(a * 4.0 + uTime * 0.1)), 40.0) * smoothstep(5.0, 1.0, r) * step(1.25, r);
          float hexa = smoothstep(0.03, 0.0, abs(r * cos(mod(a + 0.5236, 1.0472) - 0.5236) - 3.8)) * step(r, 4.4);
          float n = texture2D(uNoise, vP * 0.12 + uTime * 0.02).g;
          float v = (g + ticks * 0.7 + ticks2 * 0.6 + rays * 0.35 + hexa * 0.7) * (0.6 + 0.4 * sin(uTime * 1.5 - r * 0.8)) * (0.7 + n * 0.6);
          vec3 c = mix(vec3(1.0, 0.65, 0.25), vec3(1.0, 0.9, 0.6), n);
          gl_FragColor = vec4(c * v * 1.6, 1.0);
        }`,
    });
    const sigil = new THREE.Mesh(sg, sm);
    sigil.position.y = 1.045;
    sigil.renderOrder = 2;
    this.sigil = sigil;
    this.scene.add(sigil);
  }

  private buildColumns() {
    const mat = marbleMaterial(1, 3);
    const full = columnGeometry(6.2, 0.62, false, 1);
    const broken = columnGeometry(2.6, 0.62, true, 7);
    const fullM: THREE.Matrix4[] = [], brokenM: THREE.Matrix4[] = [];
    const d = new THREE.Object3D();
    const rng = mulberry32(99);
    // inner ring around the dais
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + TAU / 16;
      const x = Math.cos(a) * 12.5, z = Math.sin(a) * 12.5;
      const isBroken = i === 1 || i === 5 || i === 6 || i === 2;
      d.position.set(x, this.world.heightAt(x, z) - 0.05, z);
      d.rotation.set(0, rng() * TAU, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      (isBroken ? brokenM : fullM).push(d.matrix.clone());
      this.world.addCircle(x, z, 0.72, isBroken ? 3.2 : 8);
    }
    // outer colonnade with lintels
    const lintelM: THREE.Matrix4[] = [];
    const N = 30;
    const R = 42.2;
    const tops: (THREE.Vector3 | null)[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const y = this.world.heightAt(x, z) - 0.1;
      const isBroken = rng() < 0.28;
      d.position.set(x, y, z);
      d.rotation.set(0, -a, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      (isBroken ? brokenM : fullM).push(d.matrix.clone());
      tops.push(isBroken ? null : new THREE.Vector3(x, y + 0.64 + 6.2 + 0.7, z));
    }
    for (let i = 0; i < N; i++) {
      const a = tops[i], b = tops[(i + 1) % N];
      if (!a || !b || i % 5 === 4) continue;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const len = a.distanceTo(b) + 1.8;
      d.position.copy(mid).setY(Math.max(a.y, b.y) + 0.35);
      d.lookAt(b.x, d.position.y, b.z);
      d.scale.set(1, 1, len);
      d.updateMatrix();
      lintelM.push(d.matrix.clone());
    }
    const mk = (geo: THREE.BufferGeometry, arr: THREE.Matrix4[], m: THREE.Material) => {
      const im = new THREE.InstancedMesh(geo, m, arr.length);
      arr.forEach((x, i) => im.setMatrixAt(i, x));
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im);
    };
    mk(full, fullM, mat);
    mk(broken, brokenM, mat);
    mk(new THREE.BoxGeometry(1.6, 0.7, 1), lintelM, marbleMaterial(4, 1, 0xf0e6d8));
  }

  private buildWalls() {
    const mat = marbleMaterial(2, 1, 0xe8dccb);
    const walls = [
      { x: -16, z: -12, rot: 0.6, len: 6.5, h: 2.6 },
      { x: 16, z: 12, rot: 0.6, len: 6.5, h: 2.6 },
      { x: -16, z: 12, rot: -0.6, len: 6.5, h: 2.6 },
      { x: 16, z: -12, rot: -0.6, len: 6.5, h: 2.6 },
      { x: 0, z: -27, rot: 0, len: 9, h: 2.9 },
      { x: 0, z: 27, rot: 0, len: 9, h: 2.9 },
      { x: -25, z: -8.5, rot: Math.PI / 2, len: 4.5, h: 2.2 },
      { x: 25, z: 8.5, rot: Math.PI / 2, len: 4.5, h: 2.2 },
      { x: -25, z: 8.5, rot: Math.PI / 2, len: 4.5, h: 2.2 },
      { x: 25, z: -8.5, rot: Math.PI / 2, len: 4.5, h: 2.2 },
    ];
    let seed = 3;
    for (const w of walls) {
      const g = new THREE.BoxGeometry(w.len, w.h, 0.9, Math.ceil(w.len * 2), 4, 1);
      const p = g.attributes.position as THREE.BufferAttribute;
      const rng = mulberry32(seed++);
      const prof: number[] = [];
      for (let i = 0; i < 64; i++) prof.push(rng());
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i);
        if (y > w.h / 2 - 0.01) {
          const t = (x / w.len + 0.5);
          const k = Math.floor(t * 12);
          const brk = Math.max(0, Math.sin(t * Math.PI * 1.3 + seed) * 0.9) + prof[k % 64] * 0.35;
          p.setY(i, y - brk);
        }
      }
      g.computeVertexNormals();
      g.translate(0, w.h / 2, 0);
      const m = new THREE.Mesh(g, mat);
      m.position.set(w.x, this.world.heightAt(w.x, w.z) - 0.15, w.z);
      m.rotation.y = -w.rot;
      m.castShadow = m.receiveShadow = true;
      this.addStatic(m);
      // collision: rotation sign matches local axes mapping in World.resolve
      this.world.addBox(w.x, w.z, w.len / 2, 0.45, w.rot, m.position.y + w.h - 0.4);
      // rubble at the base
      for (let k = 0; k < 3; k++) {
        const rb = new THREE.Mesh(new THREE.BoxGeometry(0.5 + rng() * 0.4, 0.3 + rng() * 0.3, 0.5 + rng() * 0.4), mat);
        const off = (rng() - 0.5) * w.len;
        const side = rng() < 0.5 ? -1 : 1;
        const lx = off, lz = side * (0.8 + rng() * 0.6);
        rb.position.set(w.x + lx * Math.cos(w.rot) - lz * Math.sin(w.rot), 0, w.z + lx * Math.sin(w.rot) + lz * Math.cos(w.rot));
        rb.position.y = this.world.heightAt(rb.position.x, rb.position.z) + 0.1;
        rb.rotation.set(rng(), rng() * 3, rng());
        rb.castShadow = true; rb.receiveShadow = true;
        this.addStatic(rb);
      }
    }
  }

  private buildRocks() {
    const rock = getRock();
    const mat = new THREE.MeshStandardMaterial({ map: rock.map, normalMap: rock.normalMap, roughnessMap: rock.roughnessMap, roughness: 1 });
    const geos = [rockGeometry(1), rockGeometry(2), rockGeometry(3)];
    const lists: THREE.Matrix4[][] = [[], [], []];
    const d = new THREE.Object3D();
    const rng = mulberry32(555);
    const big = [
      [8, 20, 1.7], [-8, -20, 1.7], [28, 19, 2.0], [-28, -19, 2.0], [-29, 21, 1.6], [29, -21, 1.6], [20, 0.5, 1.2], [-20, -0.5, 1.2],
    ];
    big.forEach(([x, z, s], i) => {
      d.position.set(x, this.world.heightAt(x, z) - 0.2, z);
      d.rotation.set(0, rng() * TAU, 0);
      d.scale.set(s * 1.1, s * 1.15, s);
      d.updateMatrix();
      lists[i % 3].push(d.matrix.clone());
      this.world.addCircle(x, z, s * 0.95, d.position.y + s * 0.8);
    });
    // decorative rocks on the rim & cliffs
    const n = Math.floor(70 * QUALITY[settings.quality].foliage + 20);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU;
      const r = 43 + rng() * 8;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const s = 0.4 + rng() * 1.6;
      d.position.set(x, this.world.heightAt(x, z) - 0.3 * s, z);
      d.rotation.set(rng() * 0.4, rng() * TAU, rng() * 0.4);
      d.scale.set(s * (0.8 + rng() * 0.6), s * (0.6 + rng() * 0.6), s);
      d.updateMatrix();
      lists[i % 3].push(d.matrix.clone());
    }
    // pebbles in the play space
    for (let i = 0; i < 40; i++) {
      const a = rng() * TAU, r = 10 + rng() * 30;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const s = 0.12 + rng() * 0.25;
      d.position.set(x, this.world.heightAt(x, z) - 0.03, z);
      d.rotation.set(rng(), rng() * TAU, rng());
      d.scale.setScalar(s);
      d.updateMatrix();
      lists[i % 3].push(d.matrix.clone());
    }
    geos.forEach((g, i) => {
      const im = new THREE.InstancedMesh(g, mat, lists[i].length);
      lists[i].forEach((m, k) => im.setMatrixAt(k, m));
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im);
    });
  }

  private buildTrees() {
    const bark = getBark();
    const barkMat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.95 });
    const cyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    addFoliageWind(cyMat, 0.25, 10);
    const canMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    addFoliageWind(canMat, 0.22, 7);
    const cyGeo = cypressGeometry();
    const cyTrunk = new THREE.CylinderGeometry(0.12, 0.2, 2, 6).translate(0, 1, 0);
    const canGeo = canopyGeometry(4);
    const canGeo2 = canopyGeometry(9);
    const trGeo = trunkGeometry();
    const cy: THREE.Matrix4[] = [], ro: THREE.Matrix4[] = [], ro2: THREE.Matrix4[] = [];
    const rng = mulberry32(2024);
    const d = new THREE.Object3D();
    const place = (x: number, z: number, kind: 'cy' | 'ro', s: number, collide: boolean) => {
      d.position.set(x, this.world.heightAt(x, z) - 0.15, z);
      d.rotation.set(0, rng() * TAU, 0);
      d.scale.set(s, s * (0.9 + rng() * 0.25), s);
      d.updateMatrix();
      if (kind === 'cy') cy.push(d.matrix.clone());
      else (rng() < 0.5 ? ro : ro2).push(d.matrix.clone());
      if (collide) this.world.addCircle(x, z, kind === 'cy' ? 0.55 * s : 0.4 * s, 20);
    };
    // inside the arena: a few cover trees
    const inner: [number, number, 'cy' | 'ro'][] = [
      [-21, -27, 'cy'], [21, 27, 'cy'], [-22, 27.5, 'ro'], [22, -27.5, 'ro'], [-35, 17, 'cy'], [35, -17, 'cy'], [-35, -17, 'cy'], [35, 17, 'cy'],
      [-12, 33, 'cy'], [12, -33, 'cy'], [12, 33, 'ro'], [-12, -33, 'ro'],
    ];
    for (const [x, z, k] of inner) place(x, z, k, 0.9 + rng() * 0.25, true);
    // outer forest ring
    const n = Math.floor(90 * QUALITY[settings.quality].foliage + 30);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU;
      const r = 44 + rng() * 6;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.world.heightAt(x, z) < -1.4) continue;
      place(x, z, rng() < 0.55 ? 'cy' : 'ro', 0.8 + rng() * 0.6, false);
    }
    const mk = (geo: THREE.BufferGeometry, arr: THREE.Matrix4[], m: THREE.Material, cast = true) => {
      if (!arr.length) return;
      const im = new THREE.InstancedMesh(geo, m, arr.length);
      arr.forEach((x, i) => im.setMatrixAt(i, x));
      im.castShadow = cast; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im);
    };
    mk(cyGeo, cy, cyMat);
    mk(cyTrunk, cy, barkMat);
    mk(canGeo, ro, canMat);
    mk(canGeo2, ro2, canMat);
    mk(trGeo, [...ro, ...ro2], barkMat);
  }

  private buildSpawns() {
    const mat = marbleMaterial(3, 1);
    const archMat = marbleMaterial(1, 2, 0xf3eadc);
    const lintelMat = marbleMaterial(4, 1, 0xf3eadc);
    SPAWNS.forEach((s, team) => {
      const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0.48)];
      for (let i = 0; i <= 12; i++) { const r = 4.0 + (i / 12) * 1.9; pts.push(new THREE.Vector2(r, 0.45 * (1 - smoothstep(4.2, 5.8, r)) + 0.03)); }
      pts.push(new THREE.Vector2(6, -0.3));
      const plat = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), mat);
      plat.position.set(s.x, 0, s.z);
      plat.receiveShadow = true;
      this.addStatic(plat);
      const col = TEAM_COLORS[team];
      // team ring
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(3.6, 0.06, 8, 64).rotateX(Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(3) }),
      );
      ring.position.set(s.x, 0.48, s.z);
      this.addStatic(ring);
      // floating beacon crystal
      const beacon = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.45, 0),
        new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6, roughness: 0.2, metalness: 0.3, flatShading: true }),
      );
      const dir = Math.sign(s.x);
      beacon.position.set(s.x - dir * 4.6, 8.2, s.z);
      beacon.scale.set(1, 1.8, 1);
      this.beacons.push(beacon);
      this.scene.add(beacon);
      // gate arch facing the arena
      const colGeo = columnGeometry(4.4, 0.45, false, 11);
      for (const zz of [-4.6, 4.6]) {
        const c = new THREE.Mesh(colGeo, archMat);
        c.position.set(s.x - dir * 4.6, this.world.heightAt(s.x - dir * 4.6, zz) - 0.05, zz);
        c.castShadow = c.receiveShadow = true;
        this.addStatic(c);
        this.world.addCircle(c.position.x, zz, 0.55, 8);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 11), lintelMat);
      lintel.position.set(s.x - dir * 4.6, 6.2, 0);
      lintel.castShadow = true;
      this.addStatic(lintel);
      // banners
      const bannerMat = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.7), side: THREE.DoubleSide, roughness: 0.7, emissive: col, emissiveIntensity: 0.15 });
      bannerMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = globalUniforms.uTime;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            float hang = (1.5 - position.y) / 3.0;
            transformed.x += sin(uTime * 2.4 + position.y * 1.5 + position.z * 2.0) * 0.18 * hang;
            transformed.z += sin(uTime * 3.1 + position.y * 2.0) * 0.05 * hang;`);
      };
      bannerMat.customProgramCacheKey = () => 'banner';
      for (const zz of [-4.6, 4.6]) {
        const b = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 3, 4, 10), bannerMat);
        b.position.set(s.x - dir * 4.0, 4.0, zz);
        b.rotation.y = Math.PI / 2;
        b.castShadow = true;
        this.scene.add(b);
      }
    });
  }

  private buildBraziers() {
    const spots: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + TAU / 8;
      spots.push(new THREE.Vector3(Math.cos(a) * 5.4, 1.0, Math.sin(a) * 5.4));
    }
    for (const s of SPAWNS) for (const zz of [-6.5, 6.5]) spots.push(new THREE.Vector3(s.x, this.world.heightAt(s.x, zz), zz));
    const bowlPts = [new THREE.Vector2(0.0, 0), new THREE.Vector2(0.28, 0), new THREE.Vector2(0.22, 0.2), new THREE.Vector2(0.14, 0.9), new THREE.Vector2(0.18, 1.0), new THREE.Vector2(0.6, 1.25), new THREE.Vector2(0.72, 1.45), new THREE.Vector2(0.62, 1.42), new THREE.Vector2(0.0, 1.3)];
    const bowl = new THREE.LatheGeometry(bowlPts, 24);
    const bronze = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, metalness: 0.9, roughness: 0.38 });
    const im = new THREE.InstancedMesh(bowl, bronze, spots.length);
    const d = new THREE.Object3D();
    spots.forEach((p, i) => { d.position.copy(p); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.castShadow = true;
    this.scene.add(im);
    for (const p of spots) if (Math.hypot(p.x, p.z) > 6) this.world.addCircle(p.x, p.z, 0.45, p.y + 1.4);

    // fire: camera-facing billboards, fully procedural flame shader
    const fireGeo = new THREE.PlaneGeometry(1.25, 1.5).translate(0, 0.62, 0);
    const fireMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: globalUniforms.uTime, uNoise: globalUniforms.uNoise },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying float vSeed;
        void main() {
          vUv = uv;
          vec3 o = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          vSeed = o.x * 0.3 + o.z * 0.7;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 wp = o + right * position.x + vec3(0.0, position.y, 0.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform sampler2D uNoise; varying vec2 vUv; varying float vSeed;
        void main() {
          vec2 uv = vUv;
          float n = texture2D(uNoise, vec2(uv.x * 0.6 + vSeed, uv.y * 0.5 - uTime * 0.9)).g;
          float n2 = texture2D(uNoise, vec2(uv.x * 1.3 - vSeed, uv.y * 1.1 - uTime * 1.7)).r;
          float x = (uv.x - 0.5) * 2.0;
          float wob = (n - 0.5) * 0.5 * uv.y;
          float width = mix(0.85, 0.15, pow(uv.y, 0.8));
          float shape = 1.0 - smoothstep(0.0, 1.0, abs(x + wob) / width);
          float tongues = smoothstep(0.25, 0.75, n2 + (1.0 - uv.y) * 0.55);
          float flame = shape * tongues * smoothstep(1.0, 0.3, uv.y + (n - 0.5) * 0.45) * smoothstep(0.0, 0.1, uv.y);
          flame = clamp(flame, 0.0, 1.0);
          vec3 c = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.55, 0.12), flame);
          c = mix(c, vec3(1.0, 0.9, 0.6), smoothstep(0.7, 1.0, flame));
          gl_FragColor = vec4(c * flame * 2.2, 1.0);
        }`,
    });
    const fire = new THREE.InstancedMesh(fireGeo, fireMat, spots.length);
    spots.forEach((p, i) => { d.position.copy(p).setY(p.y + 1.3); d.updateMatrix(); fire.setMatrixAt(i, d.matrix); });
    fire.frustumCulled = false;
    this.scene.add(fire);
    this.brazier = { bowls: im, fire, spots };
    // embers: GPU-animated points
    this.scene.add(gpuPoints({
      count: spots.length * 40,
      origin: (i) => spots[i % spots.length].clone().setY(spots[i % spots.length].y + 1.5),
      mode: 'ember',
    }));
  }

  /** Swap in / add the Meshy props once they're loaded (see render/props.ts). Each kind is one instanced draw. */
  placeProps() {
    const d = new THREE.Object3D();
    const inst = (t: PropTemplate, list: { p: THREE.Vector3; ry: number; h: number }[]) => {
      const im = new THREE.InstancedMesh(t.geometry, t.material, list.length);
      list.forEach((x, i) => { d.position.copy(x.p); d.rotation.set(0, x.ry, 0); d.scale.setScalar(x.h); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im);
      return im;
    };
    const ground = (x: number, z: number, sink = 0.05) => new THREE.Vector3(x, this.world.heightAt(x, z) - sink, z);

    // bronze cauldrons replace the lathe braziers (fire + embers stay)
    const cauldron = PROPS.cauldron;
    if (cauldron && this.brazier) {
      const H = 1.15;
      const { bowls, fire, spots } = this.brazier;
      bowls.geometry = cauldron.geometry;
      bowls.material = cauldron.material;
      spots.forEach((p, i) => {
        d.position.copy(p); d.rotation.set(0, i * 1.7, 0); d.scale.setScalar(H); d.updateMatrix(); bowls.setMatrixAt(i, d.matrix);
        d.position.copy(p).setY(p.y + H * 0.82); d.rotation.set(0, 0, 0); d.scale.setScalar(1); d.updateMatrix(); fire.setMatrixAt(i, d.matrix);
        if (Math.hypot(p.x, p.z) > 6) this.world.addCircle(p.x, p.z, cauldron.size.x * H * 0.5, p.y + H);
      });
      bowls.instanceMatrix.needsUpdate = true;
      fire.instanceMatrix.needsUpdate = true;
      bowls.computeBoundingSphere();
    }

    // thinker statues guarding the four lanes into the dais, facing out toward the approaching legends
    const statue = PROPS.statue;
    if (statue) {
      const H = 3.3;
      const list = [[0, 10.9], [0, -10.9], [10.9, 0], [-10.9, 0]].map(([x, z]) => ({ p: ground(x, z, 0.08), ry: Math.atan2(x, z), h: H }));
      inst(statue, list);
      for (const s of list) this.world.addCircle(s.p.x, s.p.z, Math.max(statue.size.x, statue.size.z) * H * 0.5, s.p.y + H);
    }

    // ivy ruins: two cover arches on the north/south lanes + a ring of backdrop arches on the rim
    const ruins = PROPS.ruins;
    if (ruins) {
      const H = 4.6;
      const cover = [{ p: ground(0, 18.5), ry: 0, h: H }, { p: ground(0, -18.5), ry: Math.PI, h: H }];
      const rim: { p: THREE.Vector3; ry: number; h: number }[] = [];
      for (const a of [0.55, 1.2, 1.95, 2.6, 3.7, 4.35, 5.1, 5.75]) {
        const r = 47.5;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        rim.push({ p: ground(x, z, 0.3), ry: Math.atan2(-x, -z), h: 6 });
      }
      inst(ruins, [...cover, ...rim]);
      const off = ruins.size.x * H * 0.33;
      for (const c of cover) for (const sgn of [-1, 1]) this.world.addCircle(c.p.x + sgn * off, c.p.z, 0.55, c.p.y + H);
    }
  }

  private buildFlowers() {
    const rng = mulberry32(77);
    const n = Math.floor(900 * QUALITY[settings.quality].foliage);
    const petals: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const p = new THREE.SphereGeometry(1, 6, 4).scale(0.045, 0.008, 0.02).translate(0.045, 0, 0).rotateY((i / 5) * TAU);
      petals.push(p.toNonIndexed());
    }
    const centre = new THREE.SphereGeometry(0.022, 6, 4).scale(1, 0.6, 1).toNonIndexed();
    const head = mergeGeometries([...petals, centre])!.rotateX(0.35).translate(0, 0.36, 0);
    const stem = new THREE.CylinderGeometry(0.005, 0.007, 0.36, 3).translate(0, 0.18, 0).toNonIndexed();
    for (const gg of [head, stem]) gg.deleteAttribute('uv');
    const geo = mergeGeometries([head, stem])!;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    addFoliageWind(mat, 0.05, 0.5);
    const im = new THREE.InstancedMesh(geo, mat, n);
    const d = new THREE.Object3D();
    const cols = [new THREE.Color(1.0, 0.78, 0.1), new THREE.Color(0.95, 0.95, 0.9), new THREE.Color(0.55, 0.35, 0.95), new THREE.Color(1.0, 0.45, 0.2)];
    let k = 0;
    for (let i = 0; i < n * 3 && k < n; i++) {
      const a = rng() * TAU, r = 10 + rng() * 34;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (dirtMask(x, z) > 0.2) continue;
      if (sampleNoise(x * 0.04, z * 0.04, 1) < 0.5) continue; // clustered patches
      d.position.set(x, this.world.heightAt(x, z), z);
      d.rotation.set((rng() - 0.5) * 0.3, rng() * TAU, (rng() - 0.5) * 0.3);
      d.scale.setScalar(0.8 + rng() * 0.7);
      d.updateMatrix();
      im.setMatrixAt(k, d.matrix);
      im.setColorAt(k, cols[Math.floor(rng() * cols.length)]);
      k++;
    }
    im.count = k;
    im.computeBoundingSphere();
    this.scene.add(im);
  }

  private buildMotes() {
    const rng = mulberry32(31);
    this.scene.add(gpuPoints({
      count: Math.floor(500 * QUALITY[settings.quality].foliage + 150),
      origin: () => {
        const a = rng() * TAU, r = Math.sqrt(rng()) * ARENA_RADIUS;
        return new THREE.Vector3(Math.cos(a) * r, 0.5 + rng() * 7, Math.sin(a) * r);
      },
      mode: 'mote',
    }));
  }

  private doomBase: { zen: THREE.Color; hor: THREE.Color; gnd: THREE.Color; sunc: THREE.Color; fog: THREE.Color; fogD: number; sun: number; env: number } | null = null;
  private doomK = -1;
  /** The Bell's doom sky: 0 = golden hour, 1 = dark, sickly green storm light. */
  setDoom(k: number) {
    if (Math.abs(k - this.doomK) < 0.002) return;
    this.doomK = k;
    const u = this.sky.material.uniforms;
    const fog = this.scene.fog as THREE.FogExp2;
    if (!this.doomBase) {
      this.doomBase = { zen: u.uZenith.value.clone(), hor: u.uHorizon.value.clone(), gnd: u.uGround.value.clone(), sunc: u.uSunColor.value.clone(), fog: fog.color.clone(), fogD: fog.density, sun: this.sun.intensity, env: this.scene.environmentIntensity };
    }
    const b = this.doomBase;
    const e = k * k * (3 - 2 * k);
    u.uZenith.value.copy(b.zen).lerp(new THREE.Color(0.01, 0.05, 0.03), e);
    u.uHorizon.value.copy(b.hor).lerp(new THREE.Color(0.2, 0.55, 0.22), e);
    u.uGround.value.copy(b.gnd).lerp(new THREE.Color(0.05, 0.14, 0.07), e);
    u.uSunColor.value.copy(b.sunc).lerp(new THREE.Color(0.35, 1.1, 0.4), e);
    fog.color.copy(b.fog).lerp(new THREE.Color(0.08, 0.2, 0.1), e);
    fog.density = b.fogD * (1 + e * 1.3);
    this.sun.intensity = b.sun * (1 - e * 0.72);
    this.sun.color.setRGB(1.0 - e * 0.45, 0.8 + e * 0.1, 0.6 - e * 0.15);
    this.scene.environmentIntensity = b.env * (1 - e * 0.6);
  }

  update(time: number, camera: THREE.Camera) {
    this.sky.update(time, camera.position);
    this.beacons.forEach((b, i) => {
      b.rotation.y = time * 0.8 + i;
      b.position.y = 8.2 + Math.sin(time * 1.4 + i) * 0.2;
    });
    void this.sigil;
  }
}

/** Points animated entirely on the GPU — zero per-frame CPU cost. */
function gpuPoints(opts: { count: number; origin: (i: number) => THREE.Vector3; mode: 'ember' | 'mote' }) {
  const n = opts.count;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = opts.origin(i);
    pos[i * 3] = o.x; pos[i * 3 + 1] = o.y; pos[i * 3 + 2] = o.z;
    seed[i * 4] = Math.random(); seed[i * 4 + 1] = Math.random(); seed[i * 4 + 2] = Math.random(); seed[i * 4 + 3] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const ember = opts.mode === 'ember';
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: globalUniforms.uTime, uSunDir: globalUniforms.uSunDir, uScale: { value: window.innerHeight / 2 } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; uniform float uTime; uniform float uScale; uniform vec3 uSunDir;
      varying float vA; varying vec3 vC;
      void main() {
        vec3 p = position;
        ${ember ? `
          float life = fract(uTime * (0.35 + aSeed.x * 0.3) + aSeed.y);
          p.y += life * (2.5 + aSeed.z * 2.0);
          p.x += sin(life * 6.0 + aSeed.w * 6.28) * 0.35 * life + (aSeed.z - 0.5) * 0.5 * life;
          p.z += cos(life * 5.0 + aSeed.x * 6.28) * 0.35 * life;
          vA = (1.0 - life) * smoothstep(0.0, 0.1, life);
          vC = mix(vec3(1.0, 0.5, 0.1), vec3(1.0, 0.85, 0.4), aSeed.w) * 4.0;
          float size = 0.05 + aSeed.x * 0.04;
        ` : `
          p.x += sin(uTime * 0.13 + aSeed.x * 6.28) * 1.5;
          p.y += sin(uTime * 0.21 + aSeed.y * 6.28) * 0.6;
          p.z += cos(uTime * 0.11 + aSeed.z * 6.28) * 1.5;
          vec3 v = normalize(p - cameraPosition);
          float back = pow(max(dot(v, uSunDir), 0.0), 2.0);
          vA = (0.25 + back * 1.6) * (0.5 + 0.5 * sin(uTime * (1.0 + aSeed.w * 2.0) + aSeed.x * 20.0));
          vC = vec3(1.0, 0.85, 0.55) * 1.4;
          float size = 0.035 + aSeed.w * 0.03;
        `}
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(size * uScale / -mv.z * 2.0, 1.0, 24.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA; varying vec3 vC;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(d));
        gl_FragColor = vec4(vC * a * vA, 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  window.addEventListener('resize', () => { mat.uniforms.uScale.value = window.innerHeight / 2; });
  return pts;
}
