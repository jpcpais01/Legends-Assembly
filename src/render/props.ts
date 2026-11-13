import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Static Meshy props (public/models/props/<name>.glb, produced by `npm run models:props`).
 * Each prop is baked into ONE geometry (feet on y=0, centered on x/z, normalized to 1 m tall) + one
 * material, so callers can instance it freely. Missing props stay undefined and callers keep their
 * procedural fallback.
 */
export interface PropTemplate {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Size after normalization (height = 1). */
  size: THREE.Vector3;
}

export type PropName = 'cauldron' | 'palette' | 'ruins' | 'statue' | 'sunflower' | 'tonka_truck' | 'giant_bell' | 'golden_bell';
export const PROP_NAMES: PropName[] = ['cauldron', 'palette', 'ruins', 'statue', 'sunflower', 'tonka_truck', 'giant_bell', 'golden_bell'];
export const PROPS: Partial<Record<PropName, PropTemplate>> = {};
/**
 * Bump a prop's version whenever its GLB changes: /models/ is cache-first on players' devices, so an
 * unversioned URL can keep serving an old copy (or keep a failed load failing) indefinitely.
 */
const PROP_VER: Partial<Record<PropName, number>> = { tonka_truck: 2, giant_bell: 2, golden_bell: 2 };

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

/** Quantized (int16/uint16 normalized) attributes -> float32 so matrices can be baked in. */
function dequantize(g: THREE.BufferGeometry) {
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    if (!('isInterleavedBufferAttribute' in a && a.isInterleavedBufferAttribute) && a.array instanceof Float32Array && !a.normalized) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  return g;
}

async function loadOne(name: PropName): Promise<void> {
  const v = PROP_VER[name];
  const t = await loadTemplate(`/models/props/${name}.glb${v ? `?v=${v}` : ''}`);
  if (t) PROPS[name] = t;
  else console.warn(`[props] ${name} failed to load, using the procedural fallback`);
}

/** Load any static GLB as one baked geometry + material (feet on y=0, centered on x/z, 1 m tall). Null if missing. */
export async function loadTemplate(url: string): Promise<PropTemplate | null> {
  try {
    const gltf = await loader.loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    const geos: THREE.BufferGeometry[] = [];
    let material: THREE.Material | null = null;
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = dequantize(m.geometry.clone());
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      g.applyMatrix4(m.matrixWorld);
      geos.push(g);
      material ??= m.material as THREE.Material;
    });
    if (!geos.length || !material) return null;
    const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)!;
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const h = Math.max(1e-4, bb.max.y - bb.min.y);
    const c = bb.getCenter(new THREE.Vector3());
    geometry.translate(-c.x, -bb.min.y, -c.z);
    geometry.scale(1 / h, 1 / h, 1 / h);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    return { geometry, material, size };
  } catch (e) {
    console.warn('[props] load failed', url, e);
    return null; // not delivered yet: procedural fallback stays
  }
}

/** Loads every known prop in parallel (404s are fine). */
export function loadProps() {
  return Promise.all(PROP_NAMES.map(loadOne));
}

/** One mesh per call, sharing the template geometry/material. Height in meters. */
export function propMesh(name: PropName, height: number): THREE.Mesh | null {
  const t = PROPS[name];
  if (!t) return null;
  const m = new THREE.Mesh(t.geometry, t.material);
  m.scale.setScalar(height);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
