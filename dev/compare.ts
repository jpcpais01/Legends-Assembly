/**
 * Dev page: renders GLBs side by side under one neutral studio light, unanimated (bind pose), so a processed hero
 * can be checked against its raw Meshy export. `window.cmp.show(urls, view)` resolves when drawn.
 * view: 'body' (full figure) | 'face' (head close-up) | 'hands'
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const gl = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
gl.setSize(innerWidth, innerHeight);
gl.toneMapping = THREE.ACESFilmicToneMapping;
gl.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5d636d);
scene.environment = new THREE.PMREMGenerator(gl).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.8;
const key = new THREE.DirectionalLight(0xfff2e2, 2.2); key.position.set(-2, 3, 4);
scene.add(key, new THREE.HemisphereLight(0xffffff, 0x444444, 0.4));
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);

async function show(urls: string[], view = 'body', clipZ: number | null = null) {
  gl.localClippingEnabled = clipZ !== null;
  for (const c of [...scene.children]) if (c.userData.model) scene.remove(c);
  const n = urls.length, W = innerWidth / n;
  const objs = await Promise.all(urls.map((u) => loader.loadAsync(u).then((g) => g.scene)));
  gl.setScissorTest(true);
  gl.clear();
  objs.forEach((o, i) => {
    // normalize: 1.8 m tall, feet at 0, centred
    const box = new THREE.Box3().setFromObject(o), size = box.getSize(new THREE.Vector3());
    const s = 1.8 / size.y; o.scale.setScalar(s);
    const c = box.getCenter(new THREE.Vector3());
    o.position.set(-c.x * s, -box.min.y * s, -c.z * s);
    o.traverse((m) => {
      (m as THREE.Mesh).frustumCulled = false;
      const mat = (m as THREE.Mesh).material as THREE.Material | undefined;
      if (mat && clipZ !== null) { mat.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 0, -1), clipZ)]; mat.side = THREE.DoubleSide; }
    });
    o.userData.model = true;
    // Meshy faces +z
    const cam = new THREE.PerspectiveCamera(view === 'body' ? 30 : 22, W / innerHeight, 0.01, 50);
    if (view === 'face') { cam.position.set(0, 1.55, 1.1); cam.lookAt(0, 1.52, 0); }
    else if (view === 'hands') { cam.position.set(0.9, 1.0, 1.5); cam.lookAt(0.3, 0.95, 0); }
    else { cam.position.set(0, 0.95, 4.2); cam.lookAt(0, 0.9, 0); }
    scene.add(o);
    gl.setViewport(i * W, 0, W, innerHeight); gl.setScissor(i * W, 0, W, innerHeight);
    gl.render(scene, cam);
    scene.remove(o);
  });
  gl.setScissorTest(false);
  return true;
}
(window as unknown as { cmp: object }).cmp = { show };
