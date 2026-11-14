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
  /** Lens triangles split out by scripts/split-lens-glass.mjs (material named "glass"), in the same space. */
  glass?: THREE.BufferGeometry;
}

export type PropName = 'palette' | 'sunflower' | 'tonka_truck' | 'giant_bell' | 'golden_bell' | 'rocket_fist' | 'luffy_hat' | 'steamboat' | 'potato' | 'micro_missile';
export const PROP_NAMES: PropName[] = ['palette', 'sunflower', 'tonka_truck', 'giant_bell', 'golden_bell', 'rocket_fist', 'luffy_hat', 'steamboat', 'potato', 'micro_missile'];
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
  // Meshy exports the odd zero-length normal; normalize() turns it into NaN, and one NaN pixel blows up the bloom
  // chain into a white screen. Renormalize everything and point the degenerate ones up.
  const n = g.getAttribute('normal');
  if (n) for (let i = 0; i < n.count; i++) {
    const x = n.getX(i), y = n.getY(i), z = n.getZ(i), l = Math.hypot(x, y, z);
    if (l > 1e-6) n.setXYZ(i, x / l, y / l, z / l); else n.setXYZ(i, 0, 1, 0);
  }
  return g;
}

async function loadOne(name: PropName): Promise<void> {
  const v = PROP_VER[name];
  const t = await loadTemplate(`/models/props/${name}.glb${v ? `?v=${v}` : ''}`);
  if (t) PROPS[name] = t;
  else console.warn(`[props] ${name} failed to load, using the procedural fallback`);
}

/**
 * Load any static GLB as one baked geometry + material (feet on y=0, centered on x/z, 1 m tall). Null if missing.
 * `from` is a loader with extra decoders (the museum's KTX2 textures).
 */
export async function loadTemplate(url: string, from: GLTFLoader = loader): Promise<PropTemplate | null> {
  try {
    const gltf = await from.loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    const geos: THREE.BufferGeometry[] = [], lens: THREE.BufferGeometry[] = [];
    let material: THREE.Material | null = null;
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = dequantize(m.geometry.clone());
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      g.applyMatrix4(m.matrixWorld);
      const mat = m.material as THREE.Material;
      if (mat.name === 'glass') { lens.push(g); return; }
      geos.push(g);
      material ??= mat;
    });
    if (!geos.length || !material) return null;
    const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)!;
    const glass = lens.length ? (lens.length === 1 ? lens[0] : mergeGeometries(lens, false)!) : undefined;
    const bb = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute);
    if (glass) bb.union(new THREE.Box3().setFromBufferAttribute(glass.getAttribute('position') as THREE.BufferAttribute));
    const h = Math.max(1e-4, bb.max.y - bb.min.y);
    const c = bb.getCenter(new THREE.Vector3());
    for (const g of glass ? [geometry, glass] : [geometry]) { g.translate(-c.x, -bb.min.y, -c.z); g.scale(1 / h, 1 / h, 1 / h); }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    return { geometry, material, size, glass };
  } catch {
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
