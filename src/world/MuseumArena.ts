import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { World } from './collision';
import { HeightGrid } from './HeightGrid';
import { Sky } from './Sky';
import { TEAM_COLORS } from './types';
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
 * Layout (point-symmetric, teams spawn at the short ends): the T-rex holds the middle under the dome, a winged
 * victory and a bronze rider guard each side of it, a grand staircase climbs to a balcony landing on each long wall,
 * and an arched gallery screen shields each spawn.
 */
const { HX, HZ, CEIL } = HALL;
/** Bump a model's version whenever its GLB changes: /models/ is cache-first on players' devices. */
const MODEL_VER: Record<MuseumModel, number> = {
  museum_column_bay: 1, museum_wall_niche: 1, broken_dome_ring: 1, trex_skeleton: 1, winged_statue: 1, equestrian_statue: 1,
  grand_staircase: 1, painting_frame: 1, whale_skeleton: 1, sarcophagus: 1, rope_stanchion: 1, museum_bench: 1,
  museum_bay_drape: 1, museum_bay_relief: 1, museum_bay_fountain: 1, museum_bay_doorway: 1,
  museum_upper_loggia: 1, museum_upper_oculus: 1, museum_upper_fresco: 2, display_case: 1, orrery_base: 1, colossal_statue: 1, golden_mask: 1,
};
const MODELS = ['museum_column_bay', 'museum_wall_niche', 'broken_dome_ring', 'trex_skeleton', 'winged_statue', 'equestrian_statue', 'grand_staircase', 'painting_frame', 'whale_skeleton', 'sarcophagus', 'rope_stanchion', 'museum_bench',
  'museum_bay_drape', 'museum_bay_relief', 'museum_bay_fountain', 'museum_bay_doorway', 'museum_upper_loggia', 'museum_upper_oculus', 'museum_upper_fresco',
  'display_case', 'orrery_base', 'colossal_statue', 'golden_mask'] as const;
type MuseumModel = (typeof MODELS)[number];

// ── the wall system: lower tier of column bays, cornice, upper tier of niches, crown cornice, ceiling
const BAY_H = 14.34, BAY_W = 1.07 * BAY_H, BAY_DZ = 0.75, BAY_D = 0.488 * BAY_H * BAY_DZ;
const CORNICE = 1.2;
const NICHE_H = CEIL - BAY_H - CORNICE, NICHE_DZ = 0.8, NICHE_D = 0.323 * NICHE_H * NICHE_DZ;
/** Bay slot centers: six along each long wall (x), four along each short wall (z). */
const LONG_SLOTS = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((i) => i * BAY_W);
const SHORT_SLOTS = [-1.5, -0.5, 0.5, 1.5].map((i) => i * BAY_W);
/**
 * The wall kit: every piece fills one slot (BAY_W wide), ground pieces BAY_H tall, upper pieces NICHE_H tall. wh and dh
 * are each model's width and depth over its height, so a piece is stretched to the slot's width and backed onto the wall.
 */
const KIT: Partial<Record<MuseumModel, { wh: number; dh: number }>> = {
  museum_column_bay: { wh: 0.956 / 0.894, dh: 0.488 },
  museum_bay_drape: { wh: 0.898 / 0.954, dh: 0.46 / 0.954 },
  museum_bay_relief: { wh: 0.958 / 0.917, dh: 0.252 / 0.917 },
  museum_bay_fountain: { wh: 0.958 / 0.95, dh: 0.295 / 0.95 },
  museum_bay_doorway: { wh: 0.938 / 0.954, dh: 0.21 / 0.954 },
  museum_wall_niche: { wh: 1.009, dh: 0.323 },
  museum_upper_loggia: { wh: 0.921 / 0.946, dh: 0.97 / 0.946 },
  museum_upper_oculus: { wh: 0.958 / 0.948, dh: 0.22 / 0.948 },
  museum_upper_fresco: { wh: 0.958 / 0.955, dh: 0.261 / 0.955 },
};
const G = { B: 'museum_column_bay', D: 'museum_bay_drape', R: 'museum_bay_relief', F: 'museum_bay_fountain', E: 'museum_bay_doorway' } as const;
const U = { N: 'museum_wall_niche', L: 'museum_upper_loggia', O: 'museum_upper_oculus', P: 'museum_upper_fresco' } as const;
/**
 * Which piece goes in each slot, ground tier then upper tier, so no two neighbours match. Point-symmetric like the rest
 * of the hall: the +z wall is the -z wall reversed, +x is -x reversed. Column bays (B) hold the paintings, and the ones
 * behind the staircases (slot 3 on -z, slot 2 on +z) stay bays with the loggia above, the doorways sit behind the spawns.
 */
const WALL_PLAN: { slots: number[]; at: (s: number) => [number, number, number]; ground: (keyof typeof G)[]; upper: (keyof typeof U)[] }[] = [
  { slots: LONG_SLOTS, at: (x) => [x, -HZ, 0], ground: ['B', 'D', 'R', 'B', 'F', 'B'], upper: ['N', 'O', 'P', 'L', 'N', 'O'] },
  { slots: LONG_SLOTS, at: (x) => [x, HZ, Math.PI], ground: ['B', 'F', 'B', 'R', 'D', 'B'], upper: ['O', 'N', 'L', 'P', 'O', 'N'] },
  { slots: SHORT_SLOTS, at: (z) => [-HX, z, Math.PI / 2], ground: ['R', 'E', 'B', 'D'], upper: ['P', 'L', 'O', 'N'] },
  { slots: SHORT_SLOTS, at: (z) => [HX, z, -Math.PI / 2], ground: ['D', 'B', 'E', 'R'], upper: ['N', 'O', 'L', 'P'] },
];
/** The lion fountain's recess backdrop is cut in the build (broken shards in the Meshy mesh): a verde marble panel replaces it, in template space. */
const FOUNTAIN_PATCH = { w: 0.4548, y0: 0.006, y1: 0.848, z: -0.1353 };
const FOUNTAIN_SIDES = { x: 0.5063, z0: -0.1553, z1: -0.0616, rx: 0.2263, rz0: -0.1353, rz1: -0.045, ry0: 0.006, ry1: 0.62, sill: 0.0705 };
/** Inner corner of the hall where the bays stop: solid marble corner piers fill the rest. */
const CX = 3 * BAY_W, CZ = 2 * BAY_W;

// ── the treasures, in model height (m)
const STAIR_H = 7, STAIR_LAND = 0.696;
const STAIRS: [number, number, number][] = [[LONG_SLOTS[3], -(HZ - BAY_D - 0.849 * STAIR_H), 0], [LONG_SLOTS[2], HZ - BAY_D - 0.849 * STAIR_H, Math.PI]];
const SCREEN_X = 33.5, SCREEN_H = 10, SCREEN_DZ = 0.45;
/** Exhibits on the floor: sarcophagi (with a rope in front) by the spawn corners, velvet benches facing the art. */
const SARC_H = 4, ROPE_H = 1.2, BENCH_H = 1;
const SARCOPHAGI: [number, number][] = [[40, 16], [40, -16], [-40, 16], [-40, -16]];
/** Glass display cases (a golden mask inside each), orreries with orbiting planets, and a seated colossus in each corner. */
const CASE_H = 2.6, ORRERY_H = 3.4, COLOSSUS_H = 10;
const CASES: [number, number][] = [[30, 14], [-30, -14], [12, 17], [-12, -17]];
const ORRERIES: [number, number][] = [[30, -14], [-30, 14]];
const COLOSSI: [number, number][] = [[41.5, 27.5], [-41.5, -27.5], [41.5, -27.5], [-41.5, 27.5]];
/** Display case interior in template space: glass panes at ±R (half width W) from the case floor Y0 to the lid Y1. */
const CASE = { R: 0.1893, W: 0.1735, Y0: 0.244, Y1: 0.978, MASK_Y: 0.52, MASK_H: 0.3 };
/** The orrery's planets: arm radius, arm height (both template space), size, colour, angular speed (rad/s). */
const ORRERY = { SUN_Y: 0.9, ARMS: [
  [0.17, 0.70, 0.022, 0xb8a78a, 1.6], [0.23, 0.73, 0.03, 0xe8c27a, 1.15], [0.3, 0.76, 0.034, 0x3f7fd0, 0.9],
  [0.37, 0.79, 0.027, 0xc0502e, 0.7], [0.46, 0.82, 0.06, 0xd8a868, 0.38], [0.55, 0.85, 0.05, 0xe0c890, 0.27],
] as [number, number, number, number, number][] };
/** [x, z, yaw]: the benches look at the screens' inner paintings and at the long walls' arches. */
const BENCHES: [number, number, number][] = [
  [26.5, 0, Math.PI / 2], [-26.5, 0, -Math.PI / 2],
  [LONG_SLOTS[4], -(HZ - BAY_D - 6), Math.PI], [LONG_SLOTS[1], HZ - BAY_D - 6, 0],
  [LONG_SLOTS[1], -(HZ - BAY_D - 6), Math.PI], [LONG_SLOTS[4], HZ - BAY_D - 6, 0],
];
/** The blue whale hangs on cables over the +x half of the hall (pivot at the ceiling) and sways a little. */
const WHALE = { x: 33, z: 0, yaw: 0.35, H: 7, DROP: 6.5 };

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
  private whale: THREE.Group | null = null;
  private orreries: THREE.Vector3[] = [];
  private planetRods: THREE.InstancedMesh | null = null;
  private planets: THREE.InstancedMesh | null = null;
  private dust: ReturnType<typeof makeMuseumDust> | null = null;
  private dustOn = false;
  private beacons: THREE.Mesh[] = [];
  private envI = 0.55;
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
    const sun = new THREE.DirectionalLight(new THREE.Color(0.93, 0.95, 1.0), 0.8);
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
    this.hemi = new THREE.HemisphereLight(new THREE.Color(0.95, 0.93, 0.88), new THREE.Color(0.5, 0.4, 0.3), 0.35);
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

    // ── walls: the kit pieces of WALL_PLAN, ground tier below the cornice and upper tier above, backed onto the wall plane
    const fountains: THREE.Matrix4[] = [];
    const piece = (name: MuseumModel, wx: number, wz: number, yaw: number, y: number, h: number, maxD: number, collide: boolean) => {
      const k = KIT[name]!;
      const d = Math.min(maxD, k.dh * h);
      const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); // inward
      return put(name, mat4(wx + n.x * d / 2, y, wz + n.z * d / 2, yaw, h, BAY_W / (k.wh * h), d / (k.dh * h)), collide);
    };
    for (const wall of WALL_PLAN) wall.slots.forEach((slot, i) => {
      const [wx, wz, yaw] = wall.at(slot);
      const g = G[wall.ground[i]];
      const m = piece(g, wx, wz, yaw, 0, BAY_H, BAY_D, true);
      piece(U[wall.upper[i]], wx, wz, yaw, BAY_H + CORNICE, NICHE_H, NICHE_D, false);
      if (g === 'museum_bay_fountain') fountains.push(m);
      if (g !== 'museum_column_bay') return;
      const bay = m;
      // a painting in the arch (raised where a staircase landing stands in front of it)
      const stairHere = STAIRS.some(([sx, sz]) => Math.abs(sx - wx) < 1 && Math.sign(sz) === Math.sign(wz) && Math.abs(wz) === HZ);
      const fh = 6.2;
      const local = new THREE.Matrix4().makeTranslation(0, (stairHere ? 5.6 : 2.5) / BAY_H, -0.145 + (0.123 * fh / BAY_H) / BAY_DZ * 0.5 + 0.002);
      frames.push({ m: bay.clone().multiply(local).multiply(new THREE.Matrix4().makeScale(fh / BAY_H, fh / BAY_H, fh / BAY_H / BAY_DZ)), h: fh, art: nextArt() });
    });
    if (fountains.length) {
      const P = FOUNTAIN_PATCH;
      const g = mergeGeometries(fountains.map((m) => new THREE.PlaneGeometry(P.w, P.y1 - P.y0).translate(0, (P.y0 + P.y1) / 2, P.z).applyMatrix4(m)));
      const patch = new THREE.Mesh(g, makeMarbleMaterial(this.renderer, 'verde', 0.25));
      patch.receiveShadow = true;
      // its outer sides are textured a sickly yellow: clad them in white marble
      const S = FOUNTAIN_SIDES;
      const sides = mergeGeometries(fountains.flatMap((m) => [-1, 1].map((sx) =>
        new THREE.PlaneGeometry(S.z1 - S.z0, 1).rotateY(sx * Math.PI / 2).translate(sx * S.x, 0.5, (S.z0 + S.z1) / 2).applyMatrix4(m)).concat(
        // and the recess under the basin: its inner sides and its sill
        [-1, 1].map((sx) => new THREE.PlaneGeometry(S.rz1 - S.rz0, S.ry1 - S.ry0).rotateY(-sx * Math.PI / 2).translate(sx * S.rx, (S.ry0 + S.ry1) / 2, (S.rz0 + S.rz1) / 2).applyMatrix4(m)),
        new THREE.PlaneGeometry(2 * S.rx, S.rz1 - S.rz0).rotateX(-Math.PI / 2).translate(0, S.sill, (S.rz0 + S.rz1) / 2).applyMatrix4(m))));
      const clad = new THREE.Mesh(sides, makeMarbleMaterial(this.renderer, 'carrara', 0.25));
      clad.receiveShadow = true;
      this.scene.add(patch, clad);
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
    for (const [x, z] of SARCOPHAGI) {
      const yaw = facing(x, z, x, 0);
      put('sarcophagus', mat4(x, 0, z, yaw, SARC_H), true);
      // a rope on three sides: in front and to either side of the exhibit
      const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), r = new THREE.Vector3(f.z, 0, -f.x);
      put('rope_stanchion', mat4(x + f.x * 2, 0, z + f.z * 2, yaw, ROPE_H), true);
      for (const sd of [-1, 1]) put('rope_stanchion', mat4(x + r.x * sd * 1.7 + f.x * 0.9, 0, z + r.z * sd * 1.7 + f.z * 0.9, yaw + Math.PI / 2, ROPE_H), true);
    }
    for (const [x, z, yaw] of BENCHES) put('museum_bench', mat4(x, 0, z, yaw, BENCH_H), true);
    const caseMats = CASES.map(([x, z]) => put('display_case', mat4(x, 0, z, facing(x, z, 0, 0), CASE_H), false));
    for (const [x, z] of ORRERIES) { put('orrery_base', mat4(x, 0, z, 0, ORRERY_H), true); this.orreries.push(new THREE.Vector3(x, 0, z)); }
    for (const [x, z] of COLOSSI) put('colossal_statue', mat4(x, 0, z, facing(x, z, 0, 0), COLOSSUS_H), true);

    // ── instance everything: one draw per model
    const noShadow = new Set<MuseumModel>([...(Object.keys(KIT) as MuseumModel[]), 'painting_frame']);
    for (const n of MODELS) {
      if (n === 'whale_skeleton' || n === 'broken_dome_ring') continue;
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
      dome.scale.setScalar(DOME.H);
      dome.castShadow = true; dome.receiveShadow = true;
      this.scene.add(dome);
    }

    this.hangWhale();
    this.fillDisplayCases(grid, caseMats);
    this.buildOrreryPlanets();
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
  /**
   * The whale skeleton on four steel cables. The group's origin is the ceiling, so swinging it is a slow pendulum and the
   * cables stay attached. Far above any hero, so it never collides.
   */
  private hangWhale() {
    const t = this.T.whale_skeleton;
    if (!t) return;
    const g = new THREE.Group();
    g.position.set(WHALE.x, CEIL, WHALE.z);
    g.rotation.y = WHALE.yaw;
    const whale = new THREE.Mesh(t.geometry, t.material);
    whale.scale.setScalar(WHALE.H);
    whale.position.y = -WHALE.DROP - WHALE.H;
    whale.rotation.z = 0.06; // a slight banking turn, as if gliding
    whale.castShadow = true; whale.receiveShadow = true;
    g.add(whale);
    const len = WHALE.H * 4.41; // the model is 4.41x as long (z) as it is tall
    const cable = new THREE.CylinderGeometry(0.025, 0.025, 1, 5, 1, true).translate(0, -0.5, 0);
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.9, roughness: 0.35 });
    const cables = new THREE.InstancedMesh(cable, steel, 4);
    [-0.32, -0.1, 0.12, 0.34].forEach((f, i) => {
      const top = new THREE.Vector3((i % 2 ? 1 : -1) * 0.6, 0, f * len);
      const bot = new THREE.Vector3(0, whale.position.y + WHALE.H * 0.8, f * len);
      const d = bot.clone().sub(top);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d.clone().normalize());
      cables.setMatrixAt(i, new THREE.Matrix4().compose(top, q, new THREE.Vector3(1, d.length(), 1)));
    });
    g.add(cables);
    this.scene.add(g);
    this.whale = g;
  }

  /**
   * The display cases keep only their Meshy frame and base (the build strips the painted glass and the mask): real glass
   * goes in here as additive panes, so all they add is the hall's reflection, brightest at grazing angles, for no
   * extra pass. Each case holds the Meshy golden mask on a rod (a code stand-in if it fails to load). The glass is solid.
   */
  private fillDisplayCases(grid: HeightGrid, mats: THREE.Matrix4[]) {
    if (!mats.length) return;
    const panes: THREE.BufferGeometry[] = [];
    for (const m of mats) {
      const h = CASE.Y1 - CASE.Y0, y = (CASE.Y0 + CASE.Y1) / 2;
      for (const s of [-1, 1]) {
        panes.push(new THREE.PlaneGeometry(2 * CASE.W, h).translate(0, y, s * CASE.R).applyMatrix4(m));
        panes.push(new THREE.PlaneGeometry(2 * CASE.W, h).rotateY(Math.PI / 2).translate(s * CASE.R, y, 0).applyMatrix4(m));
      }
      grid.addGeometry(new THREE.BoxGeometry(0.48, 1, 0.48).translate(0, 0.5, 0), m);
    }
    const glass = new THREE.Mesh(mergeGeometries(panes), new THREE.MeshStandardMaterial({
      color: 0x000000, roughness: 0.03, metalness: 0, envMapIntensity: 2.4,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    glass.renderOrder = 5;
    // the mask and the rod it stands on
    const rodMat = new THREE.MeshStandardMaterial({ color: 0x2a2420, metalness: 0.8, roughness: 0.45 });
    const rod = new THREE.CylinderGeometry(0.006, 0.006, CASE.MASK_Y - CASE.Y0, 8).translate(0, (CASE.MASK_Y + CASE.Y0) / 2, -0.03);
    const parts: [THREE.BufferGeometry, THREE.Material, THREE.Matrix4][] = [[rod, rodMat, new THREE.Matrix4()]];
    const mask = this.T.golden_mask;
    if (mask) {
      // the template stands on y = 0 with unit height: centre it on the rod top
      parts.push([mask.geometry, mask.material as THREE.Material,
        new THREE.Matrix4().compose(new THREE.Vector3(0, CASE.MASK_Y - CASE.MASK_H / 2, 0), new THREE.Quaternion(), new THREE.Vector3().setScalar(CASE.MASK_H))]);
    } else {
      const face = makeMaskGeometry();
      const local = new THREE.Matrix4().compose(new THREE.Vector3(0, CASE.MASK_Y, 0.01), new THREE.Quaternion(), new THREE.Vector3().setScalar(CASE.MASK_H));
      parts.push([face.mask, new THREE.MeshStandardMaterial({ color: 0xffc35a, metalness: 1, roughness: 0.24 }), local],
        [face.eyes, new THREE.MeshStandardMaterial({ color: 0x1b3f9e, metalness: 0.1, roughness: 0.25 }), local]);
    }
    for (const [g, mat, l] of parts) {
      const im = new THREE.InstancedMesh(g, mat, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m.clone().multiply(l)));
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im);
    }
    this.scene.add(glass);
  }

  /** Planet arms for the orrery bases: brass rods and painted planets, re-posed every frame (two draws for all of them). */
  private buildOrreryPlanets() {
    if (!this.orreries.length) return;
    const n = this.orreries.length * ORRERY.ARMS.length;
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a050, metalness: 1, roughness: 0.3 });
    this.planetRods = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), brass, n * 2);
    this.planets = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 }), n);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) this.planets.setColorAt(i, c.setHex(ORRERY.ARMS[i % ORRERY.ARMS.length][3]));
    for (const im of [this.planetRods, this.planets]) { im.castShadow = true; im.frustumCulled = false; this.scene.add(im); }
    this.spinOrreries(0);
  }

  private spinOrreries(time: number) {
    if (!this.planets || !this.planetRods) return;
    const S = ORRERY_H, m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    let k = 0, r = 0;
    this.orreries.forEach((o, oi) => ORRERY.ARMS.forEach(([rad, armY, size, , speed], ai) => {
      const a = time * speed * 0.35 + ai * 1.7 + oi * 0.9;
      const dx = Math.cos(a), dz = Math.sin(a);
      // horizontal arm from the axis, then a short upright to the planet at the sun's height
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a).multiply(flat);
      m.compose(p.set(o.x + dx * rad * S / 2, armY * S, o.z + dz * rad * S / 2), q, sc.set(0.012 * S, rad * S, 0.012 * S));
      this.planetRods!.setMatrixAt(r++, m);
      const up = (ORRERY.SUN_Y - armY) * S;
      m.compose(p.set(o.x + dx * rad * S, armY * S + up / 2, o.z + dz * rad * S), q.identity(), sc.set(0.01 * S, up, 0.01 * S));
      this.planetRods!.setMatrixAt(r++, m);
      m.compose(p.set(o.x + dx * rad * S, ORRERY.SUN_Y * S, o.z + dz * rad * S), q.identity(), sc.setScalar(size * S));
      this.planets!.setMatrixAt(k++, m);
    }));
    this.planetRods.instanceMatrix.needsUpdate = true;
    this.planets.instanceMatrix.needsUpdate = true;
  }

  private captureEnvironment() {
    const r = this.renderer;
    const hide = (['trex_skeleton', 'winged_statue', 'equestrian_statue', 'grand_staircase', 'sarcophagus', 'rope_stanchion', 'museum_bench',
      'display_case', 'orrery_base', 'colossal_statue'] as const)
      .map((n): THREE.Object3D | undefined => this.instanced[n]).concat(this.whale ?? undefined).filter(Boolean) as THREE.Object3D[];
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
    this.spinOrreries(time);
    if (this.whale) {
      this.whale.rotation.x = Math.sin(time * 0.21) * 0.012;
      this.whale.rotation.z = Math.sin(time * 0.17 + 1.3) * 0.016;
      this.whale.rotation.y = WHALE.yaw + Math.sin(time * 0.11) * 0.02;
    }
    for (let i = 0; i < this.lamps.length; i++) this.lamps[i].intensity = 60 * (0.96 + Math.sin(time * 9.1 + i * 2.3) * 0.02 + Math.sin(time * 23.7 + i) * 0.015);
    for (let i = 0; i < this.beacons.length; i++) { const bc = this.beacons[i]; bc.rotation.y = time * 0.8; bc.position.y = 6.5 + Math.sin(time * 1.4 + i) * 0.35; }
  }
}

/**
 * A stand-in golden funerary mask: the front half of an ellipsoid pushed out into a brow, nose, cheeks, lips and chin,
 * with lapis almond eyes. Unit height, centred on the origin, facing +z.
 */
function makeMaskGeometry() {
  const feat = (X: number, Y: number) => {
    const ax = Math.abs(X), e = (v: number) => Math.exp(-v);
    return 0.2 * e((X / 0.1) ** 2 + ((Y + 0.03) / 0.2) ** 2)            // nose
      + 0.07 * e(((Y - 0.24) / 0.07) ** 2) * (ax < 0.62 ? 1 : 0.3)        // brow
      - 0.11 * e(((ax - 0.3) / 0.13) ** 2 + ((Y - 0.12) / 0.07) ** 2)     // eye sockets
      + 0.05 * e(((ax - 0.38) / 0.15) ** 2 + ((Y + 0.12) / 0.15) ** 2)    // cheeks
      + 0.06 * e((X / 0.22) ** 2 + ((Y + 0.42) / 0.05) ** 2)              // lips
      - 0.03 * e((X / 0.18) ** 2 + ((Y + 0.43) / 0.012) ** 2)             // their parting
      + 0.05 * e((X / 0.2) ** 2 + ((Y + 0.66) / 0.1) ** 2);               // chin
  };
  const zAt = (X: number, Y: number) => Math.sqrt(Math.max(0, 1 - X * X - Y * Y)) * 0.55 + feat(X, Y);
  const g = new THREE.SphereGeometry(1, 56, 44, 0, Math.PI, 0.06 * Math.PI, 0.88 * Math.PI);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const X = pos.getX(i), Y = pos.getY(i), Z = pos.getZ(i);
    pos.setXYZ(i, X * 0.36, Y * 0.5, (Z * 0.55 + feat(X, Y) * Math.min(1, Z * 3)) * 0.5);
  }
  g.computeVertexNormals();
  const eye = (sx: number) => new THREE.CircleGeometry(0.05, 20).scale(1, 0.42, 1).rotateZ(sx * 0.12)
    .translate(sx * 0.3 * 0.36, 0.12 * 0.5, zAt(sx * 0.3, 0.12) * 0.5 + 0.004);
  return { mask: g, eyes: mergeGeometries([eye(-1), eye(1)]) };
}
