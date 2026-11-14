/** Dev-only: step the T-Rex animator deterministically and render frames. window.rx.frame(state, beast, cam) */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TrexModel, beastPose } from '../src/render/TrexModel';
import { initGlobals } from '../src/render/materials';
import type { AnimState } from '../src/render/HeroRig';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const gl = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
gl.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8a8f98);
scene.environment = new THREE.PMREMGenerator(gl).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(3, 6, 4); scene.add(sun);
scene.add(new THREE.GridHelper(40, 40, 0x30343c, 0x5c616b));
const cam = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
initGlobals();
const model = new TrexModel('/models/heroes/trex.glb?dev=' + Date.now(), new THREE.Color('#7fd36b'));
scene.add(model.root);
const st: AnimState = { speed: 0, fwd: 0, side: 0, grounded: true, pitch: 0, attack: 0, attackSide: 1, cast: 0, levitate: 0, dash: 0, dead: false, time: 0, yaw: 0, vy: 0, hit: 0 };
st.beast = beastPose();
let x = 0, z = 0;
const CAMS: Record<string, [number, number, number, number]> = {
  side: [7, 1.6, 0.3, 1.3], sideL: [-9, 2, 0.3, 1.4], front: [0, 1.8, 7.5, 1.3], q: [6, 3.2, 6.5, 1.3], back: [2, 3.6, -8, 1.5], game: [0.8, 3.4, -6.4, 2.4], top: [0, 12, 0.1, 0],
};
(window as any).rx = {
  ready: model.ready,
  /** advance `dur` s at 60 Hz with this state, moving along the speed, then render from `camName` */
  step(s: Partial<AnimState>, beast: Partial<ReturnType<typeof beastPose>>, dur: number) {
    Object.assign(st, s); Object.assign(st.beast!, beast);
    const n = Math.max(1, Math.round(dur * 60));
    for (let i = 0; i < n; i++) {
      st.time += 1 / 60;
      x += 0; z += 0; // the model root stays put: feet planting is checked in the model frame
      model.root.rotation.y = 0;
      model.update(1 / 60, st);
    }
  },
  render(name = 'side', w = 480, h = 360) {
    gl.setSize(w, h, false);
    const [cx, cy, cz, ly] = CAMS[name];
    cam.aspect = w / h; cam.updateProjectionMatrix();
    cam.position.set(cx, cy, cz); cam.lookAt(0, ly, 0.3);
    gl.render(scene, cam);
    return canvas.toDataURL('image/jpeg', 0.85);
  },
};
