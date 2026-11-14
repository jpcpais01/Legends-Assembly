import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { World } from './collision';
import { HeightGrid } from './HeightGrid';
import { Sky } from './Sky';
import { TEAM_COLORS } from './Arena';
import { loadTemplate, type PropTemplate } from '../render/props';
import { QUALITY, settings } from '../core/settings';
import { lerp } from '../core/math';
import { HERO_RADIUS } from '../game/Hero';
import type { ArenaLike, Soundscape, Surface } from './types';
import { HALL, DOME, SUN_DIR, makeSunbeam, makeMuseumDust, MuseumRaysEffect } from './museumLight';
import { makeFloorMaterial, makeMarbleMaterial, makeCeilingMaterial, makeGoldMaterial } from './museumSurfaces';
import { paintCollection, paintingUV, type PaintingId } from './museumPaintings';

/**
 * The Grand Museum: a colossal marble hall with a broken dome over the crossing, open to the sky.
 *
 * Every piece of the building and its treasures is one of João's Meshy models (public/models/museum, made with
 * `npm run models:museum`): column bays and laurel niches repeated in two tiers around the walls, the broken dome ring,
 * the T-rex in the crossing, the winged victories and bronze riders, grand staircases and gilded frames. The floor,
 * the coffered ceiling and the cornices that tie the pieces together are code, so big surfaces never stretch a texture.
 * Repeated models are instanced (one draw each); their textures are KTX2, so they stay compressed on the GPU.
 *
 * Layout (point-symmetric, teams spawn at the short ends): the T-rex holds the middle under the sun shafts, a winged
 * victory and a bronze rider guard each side of it, a grand staircase climbs to a balcony landing on each long wall,
 * and an arched gallery screen shields each spawn.
 */
const { HX, HZ, CEIL } = HALL;
/** Bump a model's version whenever its GLB changes: /models/ is cache-first on players' devices. */
const MODEL_VER: Record<MuseumModel, number> = {
  museum_column_bay: 1, museum_wall_niche: 1, broken_dome_ring: 1, trex_skeleton: 1, winged_statue: 1, equestrian_statue: 1,
  grand_staircase: 1, painting_frame: 1,
};
const MODELS = ['museum_column_bay', 'museum_wall_niche', 'broken_dome_ring', 'trex_skeleton', 'winged_statue', 'equestrian_statue', 'grand_staircase', 'painting_frame'] as const;
type MuseumModel = (typeof MODELS)[number];

// ── the wall system: lower tier of column bays, cornice, upper tier of niches, crown cornice, ceiling
const BAY_H = 14.34, BAY_W = 1.07 * BAY_H, BAY_DZ = 0.75, BAY_D = 0.488 * BAY_H * BAY_DZ;
const CORNICE = 1.2;
const NICHE_H = CEIL - BAY_H - CORNICE, NICHE_DZ = 0.8, NICHE_D = 0.323 * NICHE_H * NICHE_DZ;
/** Bay slot centers: six along each long wall (x), four along each short wall (z). */
const LONG_SLOTS = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((i) => i * BAY_W);
const SHORT_SLOTS = [-1.5, -0.5, 0.5, 1.5].map((i) => i * BAY_W);
/** Inner corner of the hall where the bays stop: solid marble corner piers fill the rest. */
const CX = 3 * BAY_W, CZ = 2 * BAY_W;

// ── the treasures, in model height (m)
const STAIR_H = 7, STAIR_LAND = 0.696;
const STAIRS: [number, number, number][] = [[LONG_SLOTS[3], -(HZ - BAY_D - 0.849 * STAIR_H), 0], [LONG_SLOTS[2], HZ - BAY_D - 0.849 * STAIR_H, Math.PI]];
const SCREEN_X = 33.5, SCREEN_H = 10, SCREEN_DZ = 0.45;

interface Place { m: THREE.Matrix4; collide: boolean }

/** Yaw that turns a model's front (+z) toward (tx, tz) from (x, z). */
const facing = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);
const mat4 = (x: number, y: number, z: number, yaw: number, s: number, sx = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s * sx, s, s * sz));

export class MuseumArena implements ArenaLike {
  scene: THREE.Scene;
  world = new World();
  /** Soft sky light from the dome and high windows: grounds everything with a broad shadow. */
  sun: THREE.DirectionalLight;
  /** The real sun: a narrow far spot through the broken dome (museumLight.ts). */
  beam: THREE.SpotLight;
  grass = null;
  readonly healthPadPositions: THREE.Vector3[] = [];
  readonly showcasePos = new THREE.Vector3(3, 0, -6);
  /** A vast airy room tone, the same family as the Assembly Hall. */
  readonly soundscape: Soundscape = { kind: 'hall', room: new THREE.Box3(new THREE.Vector3(-HX, 0, -HZ), new THREE.Vector3(HX, CEIL, HZ)) };
  /** Marble everywhere; bronze and brass would ring, but heroes only stand on stone here. */
  surfaceAt(): Surface { return 'stone'; }
  ready: Promise<void>;

  private renderer: THREE.WebGLRenderer;
  private sky = new Sky();
  private hemi: THREE.HemisphereLight;
  private fog: THREE.FogExp2;
  private lamps: THREE.PointLight[] = [];
  private dust: ReturnType<typeof makeMuseumDust> | null = null;
  private dustOn = false;
  private beacons: THREE.Mesh[] = [];
  private envI = 0.85;
  private base = { fog: new THREE.Color(), fogD: 0, beam: new THREE.Color(), beamI: 0, sunI: 0, hemiSky: new THREE.Color(), hemiGround: new THREE.Color() };
  private T: Partial<Record<MuseumModel, PropTemplate>> = {};
  private instanced: Partial<Record<MuseumModel, THREE.InstancedMesh>> = {};

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;
    scene.background = new THREE.Color(0x8a8378);
    // noon sky, only ever seen through the dome
    const su = this.sky.material.uniforms;
    su.uSunDir.value.copy(SUN_DIR);
    su.uZenith.value.setRGB(0.12, 0.3, 0.72);
    su.uHorizon.value.setRGB(0.68, 0.8, 0.95);
    su.uSunColor.value.setRGB(1.5, 1.35, 1.1);
    su.uCloudDark.value.setRGB(0.62, 0.66, 0.74);
    su.uCloudLit.value.setRGB(1.35, 1.3, 1.22);
    this.sky.mesh.renderOrder = 10; // after every opaque: the depth test keeps it to the openings
    scene.add(this.sky.mesh);
    scene.environment = this.provisionalEnvironment(renderer);
    scene.environmentIntensity = this.envI;
    this.fog = new THREE.FogExp2(new THREE.Color(0.62, 0.57, 0.5), 0.0026);
    scene.fog = this.fog;

    this.beam = makeSunbeam();
    scene.add(this.beam, this.beam.target);
    // sky light straight down from under the ceiling (the ceiling and dome sit above its shadow camera, so they never block it)
    const sun = new THREE.DirectionalLight(new THREE.Color(0.93, 0.95, 1.0), 1.25);
    sun.position.set(SUN_DIR.x * 6, CEIL - 1, SUN_DIR.z * 6);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -HX; sc.right = HX; sc.top = HZ + 2; sc.bottom = -HZ - 2; sc.near = 0.5; sc.far = CEIL + 4;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.06;
    sun.shadow.radius = 4;
    this.sun = sun;
    scene.add(sun, sun.target);
    this.hemi = new THREE.HemisphereLight(new THREE.Color(0.95, 0.93, 0.88), new THREE.Color(0.5, 0.4, 0.3), 0.75);
    scene.add(this.hemi);
    this.base.fog.copy(this.fog.color); this.base.fogD = this.fog.density;
    this.base.beam.copy(this.beam.color); this.base.beamI = this.beam.intensity; this.base.sunI = sun.intensity;
    this.base.hemiSky.copy(this.hemi.color); this.base.hemiGround.copy(this.hemi.groundColor);

    this.world.ground = () => 0;
    this.world.bounds = { kind: 'rect', hx: HX - 1, hz: HZ - 1 };
    this.world.spawns = [new THREE.Vector3(-44, 0, 0), new THREE.Vector3(44, 0, 0)];
    this.applyQuality();
    this.ready = this.load();
  }

  /** The volumetric shafts for the renderer's god-ray slot. */
  raysEffect(camera: THREE.Camera, steps: number) { return new MuseumRaysEffect(camera, this.beam, steps); }

  /** Warm marble-and-sky light until the finished hall is captured. */
  private provisionalEnvironment(renderer: THREE.WebGLRenderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const s = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vD; void main(){ vec3 d = normalize(vD);
        vec3 c = mix(vec3(0.42,0.37,0.31), vec3(0.9,0.86,0.8), smoothstep(-0.5, 0.6, d.y)) + vec3(1.6,1.5,1.3) * smoothstep(0.85, 0.98, d.y);
        gl_FragColor = vec4(c, 1.0); }`,
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat));
    const rt = pmrem.fromScene(s, 0.03, 0.1, 200);
    pmrem.dispose();
    return rt.texture;
  }

  private async load() {
    const ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(this.renderer);
    const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
    const loaded = await Promise.all(MODELS.map((n) => loadTemplate(`/models/museum/${n}.glb?v=${MODEL_VER[n]}`, loader)));
    MODELS.forEach((n, i) => {
      const t = loaded[i];
      if (!t) { console.warn(`[museum] ${n} missing`); return; }
      const m = t.material as THREE.MeshStandardMaterial;
      for (const tex of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap]) if (tex) tex.anisotropy = 8;
      this.T[n] = t;
    });
    ktx2.dispose();

    const grid = new HeightGrid(-HX, -HZ, HX, HZ, 0.5, 0);
    const places: Partial<Record<MuseumModel, Place[]>> = {};
    const put = (n: MuseumModel, m: THREE.Matrix4, collide: boolean) => { (places[n] ??= []).push({ m, collide }); return m; };
    const frames: { m: THREE.Matrix4; h: number; art: PaintingId }[] = [];
    const ART: PaintingId[] = ['starry', 'relativity', 'sunflowers', 'bell', 'seascape', 'wheatfield', 'ruins', 'grid'];
    let artI = 0;
    const nextArt = () => ART[artI++ % ART.length];

    // ── walls: column bays below, niches above, each backed onto the wall plane and facing in
    const wallPieces: [number, number, number][] = [];
    for (const x of LONG_SLOTS) { wallPieces.push([x, -HZ, 0], [x, HZ, Math.PI]); }
    for (const z of SHORT_SLOTS) { wallPieces.push([-HX, z, Math.PI / 2], [HX, z, -Math.PI / 2]); }
    for (const [wx, wz, yaw] of wallPieces) {
      const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); // inward
      const bay = put('museum_column_bay', mat4(wx + n.x * BAY_D / 2, 0, wz + n.z * BAY_D / 2, yaw, BAY_H, 1, BAY_DZ), true);
      put('museum_wall_niche', mat4(wx + n.x * NICHE_D / 2, BAY_H + CORNICE, wz + n.z * NICHE_D / 2, yaw, NICHE_H, BAY_W / (1.009 * NICHE_H), NICHE_DZ), false);
      // a painting in the arch (raised where a staircase landing stands in front of it)
      const stairHere = STAIRS.some(([sx, sz]) => Math.abs(sx - wx) < 1 && Math.sign(sz) === Math.sign(wz) && Math.abs(wz) === HZ);
      const fh = 6.2;
      const local = new THREE.Matrix4().makeTranslation(0, (stairHere ? 5.6 : 2.5) / BAY_H, -0.145 + (0.123 * fh / BAY_H) / BAY_DZ * 0.5 + 0.002);
      frames.push({ m: bay.clone().multiply(local).multiply(new THREE.Matrix4().makeScale(fh / BAY_H, fh / BAY_H, fh / BAY_H / BAY_DZ)), h: fh, art: nextArt() });
    }

    // ── gallery screens shielding each spawn: two bays back to back, a painting in each arch
    for (const sx of [-SCREEN_X, SCREEN_X]) {
      for (const face of [-1, 1]) {
        const yaw = face > 0 ? Math.PI / 2 : -Math.PI / 2; // front faces +x or -x
        const d = 0.488 * SCREEN_H * SCREEN_DZ;
        const bay = put('museum_column_bay', mat4(sx + face * d / 2, 0, 0, yaw, SCREEN_H, 1, SCREEN_DZ), true);
        const fh = 4.5;
        const local = new THREE.Matrix4().makeTranslation(0, 1.5 / SCREEN_H, -0.145 + (0.123 * fh / SCREEN_H) / SCREEN_DZ * 0.5 + 0.002);
        frames.push({ m: bay.clone().multiply(local).multiply(new THREE.Matrix4().makeScale(fh / SCREEN_H, fh / SCREEN_H, fh / SCREEN_H / SCREEN_DZ)), h: fh, art: face * sx < 0 ? 'starry' : 'bell' });
      }
    }
    for (const f of frames) put('painting_frame', f.m, false);

    // ── the crossing: the T-rex under the dome, statues guarding it, stairs to the balconies
    put('trex_skeleton', mat4(0, 0, 0, Math.PI / 2 + 0.42, 10.2), true);
    for (const s of [-1, 1]) {
      put('winged_statue', mat4(s * 20, 0, s * 14.5, facing(s * 20, s * 14.5, 0, 0) - s * 0.35, 11), true);
      put('equestrian_statue', mat4(s * 20, 0, -s * 14.5, facing(s * 20, -s * 14.5, 0, 0) + s * 0.4, 12.5), true);
    }
    for (const [x, z, yaw] of STAIRS) put('grand_staircase', mat4(x, 0, z, yaw, STAIR_H), false);

    // ── instance everything: one draw per model
    const noShadow = new Set<MuseumModel>(['museum_column_bay', 'museum_wall_niche', 'painting_frame']);
    for (const n of MODELS) {
      const t = this.T[n], list = places[n] ?? [];
      if (!t || !list.length) continue;
      const mesh = new THREE.InstancedMesh(t.geometry, t.material, list.length);
      list.forEach((p, i) => mesh.setMatrixAt(i, p.m));
      mesh.computeBoundingSphere();
      mesh.castShadow = !noShadow.has(n);
      mesh.receiveShadow = true;
      mesh.layers.enable(2); // casts into the baked floor occlusion
      this.scene.add(mesh);
      this.instanced[n] = mesh;
      for (const p of list) if (p.collide) grid.addGeometry(t.geometry, p.m);
    }

    // the broken dome over the crossing: its own mesh so it can turn and catch the sun through its breach
    const domeT = this.T.broken_dome_ring;
    if (domeT) {
      const dome = new THREE.Mesh(domeT.geometry, domeT.material);
      dome.position.set(0, CEIL - 0.6, 0);
      dome.rotation.y = DOME.YAW;
      dome.scale.setScalar(DOME.K);
      dome.castShadow = true; dome.receiveShadow = true;
      this.scene.add(dome);
    }

    this.buildArchitecture(grid);
    this.hangPaintings(frames);
    for (const [x, z, yaw] of STAIRS) this.stairCollision(grid, mat4(x, 0, z, yaw, STAIR_H));
    this.lightStairLamps();

    grid.finalize();
    this.world.grid = grid;
    grid.buildNav(HERO_RADIUS, (x, z) => this.world.inBounds(x, z, HERO_RADIUS));

    const sp = new THREE.Vector3();
    this.world.spawns = [grid.openSpot(-44, 0, 6, sp).clone(), grid.openSpot(44, 0, 6, sp).clone()];
    for (const [x, z] of [[17, 0], [-17, 0], [-3, -21], [3, 21]]) this.healthPadPositions.push(grid.openSpot(x, z, 6, new THREE.Vector3(), 3).clone());
    for (const p of this.healthPadPositions) p.y = this.world.heightAt(p.x, p.z);
    grid.openSpot(this.showcasePos.x, this.showcasePos.z, 6, this.showcasePos, 3);
    this.buildSpawns();

    const ao = this.bakeFloorOcclusion();
    this.buildFloor(ao);
    this.captureEnvironment();
    this.dust = makeMuseumDust(settings.quality === 'low' ? 300 : 900, this.beam);
  }

  /** Floor-level occlusion: everything up to head height seen from above, blurred into soft contact shadows. */
  private bakeFloorOcclusion() {
    const W = 512, H = Math.round(512 * HZ / HX);
    const mk = () => new THREE.WebGLRenderTarget(W, H, { depthBuffer: true, type: THREE.UnsignedByteType });
    const a = mk(), b = mk();
    const cam = new THREE.OrthographicCamera(-HX, HX, HZ, -HZ, 0.05, 3.6);
    cam.position.set(0, 3.7, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
    cam.layers.set(2);
    const r = this.renderer;
    const prev = { rt: r.getRenderTarget(), auto: r.autoClear, clear: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha(), ov: this.scene.overrideMaterial, bg: this.scene.background, fog: this.scene.fog };
    this.scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.scene.background = null; this.scene.fog = null;
    r.setClearColor(0xffffff, 1); r.autoClear = true;
    r.setRenderTarget(a); r.render(this.scene, cam);
    // separable blur, twice, for a broad soft falloff (about 1.5 m)
    const blur = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main(){ float s = 0.0, w = 0.0; for (int i = -7; i <= 7; i++) { float k = exp(-float(i * i) / 18.0); s += texture2D(tSrc, vUv + uDir * float(i)).r * k; w += k; }
          gl_FragColor = vec4(vec3(s / w), 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blur);
    const qs = new THREE.Scene(); qs.add(quad);
    const qc = new THREE.Camera();
    this.scene.overrideMaterial = prev.ov; this.scene.background = prev.bg; this.scene.fog = prev.fog;
    for (let pass = 0; pass < 2; pass++) {
      blur.uniforms.tSrc.value = a.texture; blur.uniforms.uDir.value.set(1.6 / W, 0); r.setRenderTarget(b); r.render(qs, qc);
      blur.uniforms.tSrc.value = b.texture; blur.uniforms.uDir.value.set(0, 1.6 / H); r.setRenderTarget(a); r.render(qs, qc);
    }
    r.setRenderTarget(prev.rt); r.autoClear = prev.auto; r.setClearColor(prev.clear, prev.alpha);
    blur.dispose(); quad.geometry.dispose(); b.dispose();
    a.texture.colorSpace = THREE.NoColorSpace;
    return a.texture;
  }

  private buildFloor(ao: THREE.Texture) {
    const mat = makeFloorMaterial(this.renderer, {
      hx: HX, hz: HZ,
      probe: new THREE.Vector3(0, 4, 0), boxMin: new THREE.Vector3(-HX, -1, -HZ), boxMax: new THREE.Vector3(HX, CEIL, HZ),
      ao, aoRect: new THREE.Vector4(-HX, -HZ, HX, HZ),
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2).rotateX(-Math.PI / 2), mat);
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  /** The marble that ties the Meshy pieces into one building: back walls, cornices, piers, the ceiling and the dome's ring. */
  private buildArchitecture(grid: HeightGrid) {
    const marble = makeMarbleMaterial(this.renderer, 'carrara', 0.22);
    const gold = makeGoldMaterial();
    const ceilMat = makeCeilingMaterial(this.renderer, 4.4);
    const geos = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const add = (m: THREE.Material, g: THREE.BufferGeometry) => { if (!geos.has(m)) geos.set(m, []); geos.get(m)!.push(g); };
    const box = (m: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      add(m, g);
      return g;
    };
    // back walls behind every piece (seen through the gaps between the upper niches)
    box(marble, -HX, HX, 0, CEIL, -HZ - 1, -HZ); box(marble, -HX, HX, 0, CEIL, HZ, HZ + 1);
    box(marble, -HX - 1, -HX, 0, CEIL, -HZ, HZ); box(marble, HX, HX + 1, 0, CEIL, -HZ, HZ);
    // corner piers (solid, they collide)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x0 = Math.min(sx * CX, sx * HX), x1 = Math.max(sx * CX, sx * HX), z0 = Math.min(sz * CZ, sz * HZ), z1 = Math.max(sz * CZ, sz * HZ);
      grid.addGeometry(box(marble, x0, x1, 0, CEIL, z0, z1), new THREE.Matrix4());
      box(gold, x0 - 0.06, x1 + 0.06, BAY_H + 0.15, BAY_H + 0.35, z0 - 0.06, z1 + 0.06);
    }
    // cornice between the tiers and the crown under the ceiling: marble bands with a gilded fillet, all the way round
    const ring = (y0: number, y1: number, depth: number, m: THREE.Material) => {
      box(m, -HX, HX, y0, y1, -HZ, -HZ + depth); box(m, -HX, HX, y0, y1, HZ - depth, HZ);
      box(m, -HX, -HX + depth, y0, y1, -HZ + depth, HZ - depth); box(m, HX - depth, HX, y0, y1, -HZ + depth, HZ - depth);
    };
    ring(BAY_H, BAY_H + CORNICE, BAY_D + 0.7, marble);
    ring(BAY_H + 0.12, BAY_H + 0.3, BAY_D + 0.78, gold);
    ring(BAY_H + CORNICE - 0.3, BAY_H + CORNICE, BAY_D + 1.0, marble);
    ring(CEIL - 0.9, CEIL, NICHE_D + 0.9, marble);
    ring(CEIL - 1.0, CEIL - 0.85, NICHE_D + 0.98, gold);
    // pilasters over the seams between the upper niches
    const pil = (a: number, along: 'x' | 'z', side: number) => {
      const d0 = side < 0 ? (along === 'x' ? -HZ : -HX) : (along === 'x' ? HZ : HX) - NICHE_D - 0.25;
      const d1 = side < 0 ? d0 + NICHE_D + 0.25 : (along === 'x' ? HZ : HX);
      if (along === 'x') box(marble, a - 0.45, a + 0.45, BAY_H + CORNICE, CEIL - 0.9, d0, d1);
      else box(marble, d0, d1, BAY_H + CORNICE, CEIL - 0.9, a - 0.45, a + 0.45);
    };
    for (let i = 0; i <= LONG_SLOTS.length; i++) for (const s of [-1, 1]) pil((i - LONG_SLOTS.length / 2) * BAY_W, 'x', s);
    for (let i = 0; i <= SHORT_SLOTS.length; i++) for (const s of [-1, 1]) pil((i - SHORT_SLOTS.length / 2) * BAY_W, 'z', s);
    // the coffered ceiling with the crossing open to the dome, and the dome's gilded ring
    const sh = new THREE.Shape();
    sh.moveTo(-HX - 1, -HZ - 1); sh.lineTo(HX + 1, -HZ - 1); sh.lineTo(HX + 1, HZ + 1); sh.lineTo(-HX - 1, HZ + 1); sh.lineTo(-HX - 1, -HZ - 1);
    const hole = new THREE.Path(); hole.absarc(0, 0, DOME.HOLE_R, 0, Math.PI * 2, true); sh.holes.push(hole);
    const ceil = new THREE.Mesh(new THREE.ShapeGeometry(sh, 64).rotateX(Math.PI / 2).translate(0, CEIL, 0), ceilMat);
    ceil.castShadow = true; ceil.receiveShadow = true;
    this.scene.add(ceil);
    add(gold, new THREE.TorusGeometry(DOME.HOLE_R + 0.15, 0.42, 10, 128).rotateX(Math.PI / 2).translate(0, CEIL - 0.45, 0));
    add(gold, new THREE.TorusGeometry(DOME.HOLE_R + 0.9, 0.22, 8, 128).rotateX(Math.PI / 2).translate(0, CEIL - 0.2, 0));
    const drumBand = new THREE.CylinderGeometry(DOME.HOLE_R + 0.05, DOME.HOLE_R + 0.05, 2.2, 128, 1, true).translate(0, CEIL + 0.6, 0);
    add(marble, drumBand);

    for (const [m, list] of geos) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false)!, m);
      mesh.receiveShadow = true;
      mesh.layers.enable(2);
      if (m === marble) (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      this.scene.add(mesh);
    }
  }

  /** The collection, in one atlas: a canvas in front of each frame's blank, one draw for all of them. */
  private hangPaintings(frames: { m: THREE.Matrix4; h: number; art: PaintingId }[]) {
    if (!this.T.painting_frame) return;
    const tex = paintCollection();
    const parts: THREE.BufferGeometry[] = [];
    for (const f of frames) {
      // canvas opening of the frame model (normalized, height 1): x ±0.31, y 0.155..0.8, just proud of the blank
      const g = new THREE.PlaneGeometry(0.62, 0.645).translate(0, 0.4775, 0.006);
      const [u0, v0, u1, v1] = paintingUV(f.art);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
      parts.push(g.applyMatrix4(f.m));
    }
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.16 });
    const mesh = new THREE.Mesh(mergeGeometries(parts, false)!, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  /**
   * Stairs collide as a smooth ramp, a landing block and two balustrades (the steps themselves are finer than the
   * collision grid). Numbers are the model's, normalized to height 1.
   */
  private stairCollision(grid: HeightGrid, at: THREE.Matrix4) {
    const prism = (x0: number, x1: number, z0: number, z1: number, t0: number, t1: number) => {
      const g = new THREE.BoxGeometry(1, 1, 1);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const sx = p.getX(i) > 0, sy = p.getY(i) > 0, sz = p.getZ(i) > 0;
        const z = sz ? z0 : z1;
        p.setXYZ(i, sx ? x1 : x0, sy ? (sz ? t0 : t1) : 0, z);
      }
      return g;
    };
    const RZ0 = 0.83, RZ1 = -0.38, BACK = -0.849;
    const parts = [
      prism(-0.31, 0.31, RZ0, RZ1, 0.02, STAIR_LAND),
      prism(-0.39, 0.39, RZ1, BACK, STAIR_LAND, STAIR_LAND),
      prism(0.31, 0.4, RZ0, RZ1, 0.16, STAIR_LAND + 0.13),
      prism(-0.4, -0.31, RZ0, RZ1, 0.16, STAIR_LAND + 0.13),
      prism(0.61, 0.69, 0.66, 0.58, 0.77, 0.77),
      prism(-0.69, -0.61, 0.66, 0.58, 0.77, 0.77),
    ];
    for (const g of parts) grid.addGeometry(g, at);
  }

  /** The bronze lamp posts at the foot of each staircase glow, and two of them light the stairs. */
  private lightStairLamps() {
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.6, 2.0), fog: false });
    const bulbs: THREE.BufferGeometry[] = [];
    for (const [x, z, yaw] of STAIRS) {
      const at = mat4(x, 0, z, yaw, STAIR_H);
      for (const s of [-1, 1]) bulbs.push(new THREE.SphereGeometry(0.03, 10, 8).scale(1, 1.4, 1).translate(s * 0.652, 0.715, 0.62).applyMatrix4(at));
      const l = new THREE.PointLight(new THREE.Color(1.0, 0.72, 0.42), 60, 26, 1.6);
      l.position.set(0, 0.72, 0.5).applyMatrix4(at);
      this.lamps.push(l);
      this.scene.add(l);
    }
    this.scene.add(new THREE.Mesh(mergeGeometries(bulbs, false)!, glow));
  }

  private buildSpawns() {
    this.world.spawns.forEach((s, team) => {
      const col = TEAM_COLORS[team];
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.3, 3.55, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(3), transparent: true, opacity: 0.85, depthWrite: false }));
      ring.position.set(s.x, this.world.heightAt(s.x, s.z) + 0.05, s.z);
      this.scene.add(ring);
      const beacon = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.5, 0),
        new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.8, roughness: 0.2, metalness: 0.3, flatShading: true }),
      );
      beacon.position.set(s.x, 6.5, s.z);
      beacon.scale.set(1, 1.8, 1);
      this.beacons.push(beacon);
      this.scene.add(beacon);
    });
  }

  /**
   * Image-based light from the finished hall: a cube capture at head height in the crossing (the treasures hidden, so the
   * capture is just architecture and light, which box projection maps back onto the floor correctly).
   */
  private captureEnvironment() {
    const r = this.renderer;
    const hide = (['trex_skeleton', 'winged_statue', 'equestrian_statue', 'grand_staircase'] as const).map((n) => this.instanced[n]).filter(Boolean) as THREE.Object3D[];
    hide.forEach((o) => (o.visible = false));
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cc = new THREE.CubeCamera(0.5, 400, rt);
    cc.position.set(0, 4, 0);
    this.sky.update(0, cc.position);
    const prevFog = this.scene.fog; this.scene.fog = null;
    cc.update(r, this.scene);
    this.scene.fog = prevFog;
    hide.forEach((o) => (o.visible = true));
    const pmrem = new THREE.PMREMGenerator(r);
    const env = pmrem.fromCubemap(rt.texture).texture;
    pmrem.dispose(); rt.dispose();
    const old = this.scene.environment;
    this.scene.environment = env;
    old?.dispose();
  }

  placeProps() { /* everything is placed by load() */ }

  applyQuality() {
    const q = QUALITY[settings.quality];
    for (const l of [this.sun, this.beam]) {
      l.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      if (l.shadow.map) { l.shadow.map.dispose(); (l.shadow as any).map = null; }
    }
  }

  setDoom(k: number) {
    const b = this.base;
    const green = new THREE.Color(0.06, 0.24, 0.1);
    this.fog.color.copy(b.fog).lerp(green, k);
    this.fog.density = lerp(b.fogD, 0.009, k);
    this.beam.color.copy(b.beam).lerp(new THREE.Color(0.45, 1.0, 0.5), k);
    this.beam.intensity = lerp(b.beamI, 3, k);
    this.sun.intensity = lerp(b.sunI, 0.5, k);
    this.hemi.color.copy(b.hemiSky).lerp(new THREE.Color(0.3, 0.8, 0.4), k);
    this.hemi.groundColor.copy(b.hemiGround).lerp(new THREE.Color(0.02, 0.1, 0.03), k);
    this.scene.environmentIntensity = lerp(this.envI, 0.3, k);
  }

  update(time: number, camera: THREE.Camera) {
    this.sky.update(time, camera.position);
    if (this.dust) {
      if (!this.dustOn && this.dust.sync()) { this.scene.add(this.dust.points); this.dustOn = true; }
      if (this.dustOn) { this.dust.sync(); (this.dust.points.material as THREE.ShaderMaterial).uniforms.uTime.value = time; }
    }
    for (let i = 0; i < this.lamps.length; i++) this.lamps[i].intensity = 60 * (0.96 + Math.sin(time * 9.1 + i * 2.3) * 0.02 + Math.sin(time * 23.7 + i) * 0.015);
    for (let i = 0; i < this.beacons.length; i++) { const bc = this.beacons[i]; bc.rotation.y = time * 0.8; bc.position.y = 6.5 + Math.sin(time * 1.4 + i) * 0.35; }
  }
}
