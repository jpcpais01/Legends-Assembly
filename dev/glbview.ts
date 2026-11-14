/** Dev-only: render a GLB from fixed views (orientation and landmark checks). window.gv.shot(url, views) */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const gl = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
gl.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8a8f98);
scene.environment = new THREE.PMREMGenerator(gl).fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(2, 4, 3); scene.add(sun);
scene.add(new THREE.GridHelper(10, 20, 0x30343c, 0x5c616b));
scene.add(new THREE.AxesHelper(1.5));
const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
let obj: THREE.Object3D | null = null;
const markers = new THREE.Group(); scene.add(markers);

(window as any).gv = {
  async load(url: string) {
    if (obj) scene.remove(obj);
    const g = await loader.loadAsync(url); obj = g.scene; scene.add(obj);
    const b = new THREE.Box3().setFromObject(obj); return { min: b.min.toArray(), max: b.max.toArray() };
  },
  mark(pts: [number, number, number][], color = 0xff2040, r = 0.008) {
    markers.clear();
    for (const p of pts) { const m = new THREE.Mesh(new THREE.SphereGeometry(r), new THREE.MeshBasicMaterial({ color, depthTest: false })); m.renderOrder = 9; m.position.set(...p); markers.add(m); }
  },
  /** cam: [x,y,z] position, look: [x,y,z] target */
  render(camPos: number[], look: number[], fov = 30, w = 640, h = 480) {
    gl.setSize(w, h, false); cam.fov = fov; cam.aspect = w / h; cam.updateProjectionMatrix();
    cam.position.set(camPos[0], camPos[1], camPos[2]); cam.lookAt(look[0], look[1], look[2]);
    gl.render(scene, cam); return canvas.toDataURL('image/jpeg', 0.88);
  },
};
const ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
/** Orthographic view along an axis ('x' from +x, '-x' from -x, 'z' from front), framing [u0,u1]x[v0,v1] (raw units). Optional game-unit grid. */
(window as any).gv.ortho = (axis: string, u0: number, u1: number, v0: number, v1: number, pxPerUnit = 800, clipX?: [number, number]) => {
  const w = Math.round((u1 - u0) * pxPerUnit), h = Math.round((v1 - v0) * pxPerUnit);
  gl.setSize(w, h, false);
  ocam.left = u0; ocam.right = u1; ocam.top = v1; ocam.bottom = v0; ocam.near = 0.01; ocam.far = 100;
  if (axis === 'x') { ocam.position.set(10, 0, 0); ocam.up.set(0, 1, 0); ocam.lookAt(0, 0, 0); ocam.left = -u1; ocam.right = -u0; }
  if (axis === '-x') { ocam.position.set(-10, 0, 0); ocam.up.set(0, 1, 0); ocam.lookAt(0, 0, 0); }
  if (axis === 'z') { ocam.position.set(0, 0, 10); ocam.up.set(0, 1, 0); ocam.lookAt(0, 0, 0); }
  ocam.updateProjectionMatrix();
  gl.localClippingEnabled = true;
  const planes = clipX ? [new THREE.Plane(new THREE.Vector3(1, 0, 0), -clipX[0]), new THREE.Plane(new THREE.Vector3(-1, 0, 0), clipX[1])] : [];
  obj?.traverse((o: any) => { if (o.isMesh) { o.material.clippingPlanes = planes; o.material.needsUpdate = true; } });
  gl.render(scene, ocam);
  return canvas.toDataURL('image/png');
};
