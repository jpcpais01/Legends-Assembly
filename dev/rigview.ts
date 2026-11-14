/**
 * Dev-only rig and animation viewer (not part of the game build). Serves from `npm run dev` at /dev/rigview.html and is
 * driven by dev/shots.mjs, which steps the animator deterministically and saves contact sheets, so motion can be
 * checked frame by frame without a GPU.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HEROES } from '../src/heroes';
import { GltfHeroModel } from '../src/render/GltfHeroModel';
import { initGlobals } from '../src/render/materials';
import { loadProps } from '../src/render/props';
import type { AnimState } from '../src/render/HeroRig';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const gl = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
gl.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8a8f98);
scene.environment = new THREE.PMREMGenerator(gl).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(2, 4, 3); scene.add(sun);
const grid = new THREE.GridHelper(80, 160, 0x30343c, 0x5c616b); scene.add(grid);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ color: 0x777c86 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002; scene.add(floor);
const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
initGlobals();

type Extra = { turn?: number; skel?: boolean; weights?: string | null; restPose?: boolean; clip?: string | null; clipT?: number; clipRate?: number };
let model: GltfHeroModel | null = null;
let skel: THREE.SkeletonHelper | null = null;
const st: AnimState & Extra = { speed: 0, fwd: 0, side: 0, grounded: true, pitch: 0, attack: 0, attackSide: 1, cast: 0, levitate: 0, dash: 0, dead: false, time: 0, yaw: 0, vy: 0, hit: 0, turn: 0 };
const pos = new THREE.Vector3();
let y = 0, vy = 0;

const CAMS: Record<string, [number, number, number, number, number]> = {
  // x (hero right), y, z (hero forward), look-at height, fov
  front: [0, 1.25, 5.2, 0.95, 24], back: [0, 1.5, -5.2, 0.95, 24], side: [5.2, 1.2, 0, 0.95, 24], sideL: [-5.2, 1.2, 0, 0.95, 24],
  q: [2.8, 1.5, 4.2, 0.95, 24], qb: [2.6, 1.7, -4.2, 0.95, 24], face: [0.15, 1.62, 1.5, 1.58, 22], faceS: [1.4, 1.62, 0.5, 1.58, 22],
  top: [0, 7, 0.01, 0.9, 22], upper: [0.5, 1.5, 2.9, 1.3, 26], game: [0.5, 1.95, -3.3, 1.3, 42], wide: [8, 1.5, 1.5, 1.2, 50], midS: [6.5, 1.3, 0.6, 0.95, 30], midQ: [3.6, 1.5, 5, 0.95, 30],
};

function render(name = 'front', w = 480, h = 600) {
  if (canvas.width !== w || canvas.height !== h) gl.setSize(w, h, false);
  const [cx, cy, cz, ly, fov] = CAMS[name] ?? CAMS.front;
  const yaw = st.yaw ?? 0;
  const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  cam.fov = fov; cam.aspect = w / h; cam.updateProjectionMatrix();
  cam.position.copy(pos).addScaledVector(r, cx).addScaledVector(f, cz); cam.position.y = y + cy;
  cam.lookAt(pos.x, y + ly, pos.z);
  skel?.updateMatrixWorld(true);
  gl.render(scene, cam);
  return canvas.toDataURL('image/jpeg', 0.9);
}

const api = {
  get model() { return model; },
  /** Set hero fx uniforms (uWhite, uRim...) for look checks. */
  fx(u: Record<string, number>) { if (model) for (const [k, v] of Object.entries(u)) (model.fx as any)[k].value = v; },
  async load(id: keyof typeof HEROES) {
    await loadProps().catch(() => {});
    if (model) { scene.remove(model.root); model.dispose(); }
    if (skel) { scene.remove(skel); skel = null; }
    const def = HEROES[id];
    model = new GltfHeroModel(def, new THREE.Color(def.color));
    await model.ready;
    for (let i = 0; i < 400 && !(model as any).mocap; i++) await new Promise((r) => setTimeout(r, 25));
    model.fx.uRim.value = 0;
    scene.add(model.root);
    pos.set(0, 0, 0); y = 0; vy = 0;
    Object.assign(st, { speed: 0, fwd: 0, side: 0, grounded: true, pitch: 0, attack: 0, attackSide: 1, cast: 0, levitate: 0, dash: 0, dead: false, time: 0, yaw: 0, vy: 0, hit: 0, turn: 0, attackKind: undefined });
    return !!(model as any).mocap;
  },
  set(p: Partial<AnimState & Extra> & { jump?: boolean }) {
    if (p.jump) { vy = 7.6; st.grounded = false; delete p.jump; }
    if (Array.isArray(p.armTarget)) p.armTarget = new THREE.Vector3(...(p.armTarget as unknown as [number, number, number]));
    Object.assign(st, p);
    if (p.skel !== undefined && model) {
      if (skel) { scene.remove(skel); skel = null; }
      if (p.skel) { skel = new THREE.SkeletonHelper(model.root); (skel.material as THREE.Material).depthTest = false; skel.renderOrder = 9; scene.add(skel); }
    }
    if (p.weights !== undefined && model) paintWeights(p.weights);
  },
  step(dt: number, n = 1) {
    if (!model) return;
    for (let i = 0; i < n; i++) {
      st.time += dt;
      st.yaw = (st.yaw ?? 0) + (st.turn ?? 0) * dt;
      const yaw = st.yaw;
      st.speed = Math.hypot(st.fwd, st.side);
      pos.x += (-Math.sin(yaw) * st.fwd + Math.cos(yaw) * st.side) * dt;
      pos.z += (-Math.cos(yaw) * st.fwd - Math.sin(yaw) * st.side) * dt;
      if (!st.grounded) { vy -= 22 * dt; y += vy * dt; if (y <= 0) { y = 0; vy = 0; st.grounded = true; } }
      st.vy = vy;
      st.attack = Math.max(0, st.attack - dt * 4.5);
      st.hit = Math.max(0, (st.hit ?? 0) - dt * 5);
      model.root.position.set(pos.x, y, pos.z);
      model.root.rotation.y = yaw + Math.PI;
      if (st.restPose) continue;
      const mc = (model as any).mocap;
      if (mc) { if (st.clip) { st.clipT = (st.clipT ?? 0) + dt * (st.clipRate ?? 1); mc.debugClip = { name: st.clip, t: st.clipT }; } else mc.debugClip = null; }
      model.update(dt, st);
    }
  },
  render,
  /** Bone world positions relative to the hero root (model space), for numeric checks. */
  bones() {
    const out: Record<string, number[]> = {};
    model!.root.updateMatrixWorld(true);
    const inv = model!.root.matrixWorld.clone().invert();
    model!.root.traverse((o) => { if (o.name.startsWith('la_')) out[o.name.slice(3)] = o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).toArray().map((v) => +v.toFixed(4)); });
    return out;
  },
  /** World positions of the ankles and toes (foot-slide checks). */
  feet() {
    const g = (n: string) => model!.root.getObjectByName(n)!.getWorldPosition(new THREE.Vector3()).toArray();
    model!.root.updateMatrixWorld(true);
    return { L: g('la_footL'), R: g('la_footR'), tL: g('la_toeL'), tR: g('la_toeR') };
  },
  info() {
    const set = (model as any).mocap.set, out: any = { footY: set.footY, armMin: set.armMin };
    for (const n of ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop']) { const c = set.clips[n]; out[n] = { speed: +c.speed.toFixed(2), dur: +c.dur.toFixed(2), offset: +c.offset.toFixed(2), home: Array.from(c.home as Float32Array).map((v) => +v.toFixed(2)) }; }
    return out;
  },
  world() { return { x: pos.x, y, z: pos.z, yaw: st.yaw }; },
  /** Runs a scripted scenario and returns frames: steps = [{ dur, set, every }] */
  run(sc: { cam?: string | string[]; dt?: number; w?: number; h?: number; steps: { dur: number; set?: any; every?: number; cam?: string }[] }) {
    const dt = sc.dt ?? 1 / 60, shots: string[] = [];
    let t = 0;
    for (const s of sc.steps) {
      if (s.set) api.set(s.set);
      const n = Math.round(s.dur / dt); let next = s.every ? 0 : Infinity;
      for (let i = 0; i < n; i++) {
        api.step(dt); t += dt;
        if ((i + 1) * dt >= next + (s.every ?? 0) - 1e-6) {
          next += s.every!;
          for (const c of ([] as string[]).concat(s.cam ?? sc.cam ?? 'front')) shots.push(render(c, sc.w, sc.h));
        }
      }
    }
    return shots;
  },
};

const HUES = [0, 0.08, 0.16, 0.3, 0.42, 0.52, 0.6, 0.7, 0.8, 0.9];
function paintWeights(bone: string | null) {
  model!.root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const ud = m.userData;
    if (!bone) { if (ud.orig) m.material = ud.orig; return; }
    ud.orig ??= m.material;
    const g = m.geometry, si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
    const col = new Float32Array(si.count * 3), c = new THREE.Color(), acc = new THREE.Color();
    const names = m.skeleton.bones.map((b) => b.name.replace(/^la_/, ''));
    const k = names.indexOf(bone);
    for (let i = 0; i < si.count; i++) {
      acc.setRGB(0, 0, 0);
      for (let j = 0; j < 4; j++) {
        const b = si.getComponent(i, j), w = sw.getComponent(i, j);
        if (w <= 0) continue;
        if (bone === 'all') { c.setHSL(HUES[b % HUES.length], 0.85, b % 2 ? 0.45 : 0.6); acc.r += c.r * w; acc.g += c.g * w; acc.b += c.b * w; }
        else if (b === k) acc.setRGB(w, w * w, 1 - w);
      }
      if (bone !== 'all' && acc.r === 0) acc.setRGB(0.12, 0.12, 0.14);
      col[i * 3] = acc.r; col[i * 3 + 1] = acc.g; col[i * 3 + 2] = acc.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    m.material = new THREE.MeshLambertMaterial({ vertexColors: true });
  });
}

(window as any).rv = api;
