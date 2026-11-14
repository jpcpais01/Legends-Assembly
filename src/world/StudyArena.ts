import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { World } from './collision';
import { HeightGrid } from './HeightGrid';
import { Sky } from './Sky';
import { TEAM_COLORS } from './Arena';
import { loadTemplate, type PropTemplate } from '../render/props';
import { QUALITY, settings } from '../core/settings';
import { damp, lerp, mulberry32 } from '../core/math';
import { HERO_RADIUS } from '../game/Hero';
import type { ArenaLike, Soundscape, Surface } from './types';
import { addShock, makeDeskDust, makeEmbers, patchShock, tickShocks } from './studyLife';
import { audio, type Sfx } from '../core/Audio';
import { bakeWoodMaps, buildDeskGeometry, makeDeskWoodMaterial } from './studyDesk';
import * as P from './studyProps';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { SUN_DIR, WIN, ROOM_BOX, makeDust, patchSunThroughWindows, roomMatrix } from './studyLight';

/**
 * The Giant's Study: toy-sized legends fight on top of a colossal scholar's desk.
 * The desk top is the floor (y = 0). Everything on it is real collision built from the meshes
 * (HeightGrid), the room around it is a far backdrop.
 */
const DESK_HX = 43, DESK_HZ = 30; // desk top half extents in meters (1 cm of a real desk = 0.7 m)
const FLOOR_Y = -38; // the room floor, far below the desk top
/**
 * Desk drop-ins that have been delivered, with a version to bump whenever the GLB changes. /models/ is cache-first
 * on players' devices, so a new URL is what makes them fetch a model they once missed (or an updated one).
 */
const DROP_VER: Record<string, number> = {
  antique_books: 2, inkwell_quill: 2, hourglass: 2, brush_jar: 2, candle_holder: 2, coin_stack: 2, teacup_saucer: 2, rolled_map: 2,
  closed_book: 2, spectacles: 3, magnifying_glass: 3, ruler: 2, envelope_wax_seal: 2, pencil: 2, emerald_quill: 2,
};
/** Same idea for the fixed set of desk models (v2: 1K metal/roughness maps). */
const STUDY_VER = 2;
const STUDY_PROPS = ['book_stack', 'chandelier', 'chess_pieces', 'coffee_mug', 'crumpled_paper', 'desk_lamp', 'eraser_block', 'globe_ball', 'globe_stand', 'metronome', 'open_book', 'pocket_watch'] as const;
type StudyProp = (typeof STUDY_PROPS)[number];

/** What each desk object is made of underfoot, and what it sounds like when the desk jolts. */
const MATTER: Record<string, { surface: Surface; rattle?: Sfx }> = {
  paper_einstein: { surface: 'paper', rattle: 'paperFlutter' }, letter_vangogh: { surface: 'paper', rattle: 'paperFlutter' },
  music_sheet_yeat: { surface: 'paper', rattle: 'paperFlutter' }, index_cards: { surface: 'paper', rattle: 'paperFlutter' },
  envelope_wax_seal: { surface: 'paper', rattle: 'paperFlutter' }, rolled_map: { surface: 'paper', rattle: 'paperFlutter' },
  crumpled_paper: { surface: 'paper', rattle: 'paperFlutter' }, open_book: { surface: 'paper', rattle: 'paperFlutter' },
  inkwell_quill: { surface: 'stone', rattle: 'rattleGlass' }, hourglass: { surface: 'wood', rattle: 'rattleGlass' },
  brush_jar: { surface: 'stone', rattle: 'rattleGlass' }, magnifying_glass: { surface: 'metal', rattle: 'rattleGlass' },
  spectacles: { surface: 'metal', rattle: 'rattleGlass' },
  emerald_quill: { surface: 'wood', rattle: 'rattleWood' }, pencil: { surface: 'wood', rattle: 'rattleWood' },
  ruler: { surface: 'wood', rattle: 'rattleWood' }, chess_pieces: { surface: 'stone', rattle: 'rattleWood' },
  metronome: { surface: 'wood', rattle: 'rattleWood' },
  paper_clip: { surface: 'metal' }, candle_holder: { surface: 'metal', rattle: 'rattleCoins' },
  coin_stack: { surface: 'metal', rattle: 'rattleCoins' }, pocket_watch: { surface: 'metal', rattle: 'rattleCoins' },
  desk_lamp: { surface: 'metal' }, globe_stand: { surface: 'metal' },
  antique_books: { surface: 'leather' }, closed_book: { surface: 'leather' }, book_stack: { surface: 'leather' },
  eraser_block: { surface: 'leather' },
  newtons_cradle: { surface: 'metal', rattle: 'rattleCoins' },
  teacup_saucer: { surface: 'stone', rattle: 'rattleChina' }, coffee_mug: { surface: 'stone', rattle: 'rattleChina' },
};

/** A desk object's footprint (oriented box) for footsteps and rattles. */
interface Footprint { name: string; x: number; z: number; c: number; s: number; hx: number; hz: number; top: number; surface: Surface; rattle?: Sfx; lastRattle: number }

/** Where things go on the desk: [prop, x, z, height (m), yaw]. Heights follow real object sizes at the desk's scale. */
const LAYOUT: [StudyProp, number, number, number, number][] = [
  ['pocket_watch', 0, 4.5, 3.0, 0.4],
  ['eraser_block', -10, -12.5, 1.15, 0.3],
  ['eraser_block', 10, 12.5, 1.15, 0.3 + Math.PI],
  ['crumpled_paper', -21, 13, 2.6, 0.5],
  ['crumpled_paper', 21, -13, 2.6, 2.4],
  ['coffee_mug', 24, 6, 5.2, -0.6],
  ['chess_pieces', -24, -6, 5.0, 2.2],
  ['book_stack', 30, -19, 7.5, 0.2],
  ['open_book', -14, 1, 1.9, 1.2],
];

interface DeskProp {
  /** Hand-built stand-in. */
  parts: () => P.Part[];
  /** The Meshy model that replaces it once delivered. */
  meshy?: { name: string; cm: number; fit: 'len' | 'h'; collide: boolean };
  x: number; z: number; yaw: number; y?: number;
  /** Sit on top of entry #n (for stacks of Meshy models of unknown thickness). */
  stackOn?: number;
  /** Light a candle flame on its top. */
  flame?: boolean;
  /** Hang the swinging balls of a Newton's cradle in it. */
  cradle?: boolean;
  /** What it is made of (MATTER key) when it has no Meshy name. */
  matter?: string;
}

/**
 * Fit a 1 m tall template to a real size: lay long thin things down if they were modeled standing, turn the long side
 * along x, scale to `size` meters (longest horizontal side, or height), and sit it on y = 0 centered.
 */
function fitTemplate(t: PropTemplate, fit: 'len' | 'h', size: number) {
  const m = new THREE.Matrix4();
  const s = t.size;
  if (fit === 'len' && s.y > Math.max(s.x, s.z)) m.premultiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  const bb = new THREE.Box3().setFromBufferAttribute(t.geometry.getAttribute('position') as THREE.BufferAttribute).applyMatrix4(m);
  let sz = bb.getSize(new THREE.Vector3());
  if (fit === 'len' && sz.z > sz.x) {
    m.premultiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    bb.setFromBufferAttribute(t.geometry.getAttribute('position') as THREE.BufferAttribute).applyMatrix4(m);
    sz = bb.getSize(new THREE.Vector3());
  }
  const k = size / (fit === 'len' ? Math.max(sz.x, sz.z) : sz.y);
  const c = bb.getCenter(new THREE.Vector3());
  m.premultiply(new THREE.Matrix4().makeTranslation(-c.x, -bb.min.y, -c.z)).premultiply(new THREE.Matrix4().makeScale(k, k, k));
  return { m, height: sz.y * k };
}

/** Highest point near the middle of a candle model (in the fitted frame): where the wick is. */
function candleTop(g: THREE.BufferGeometry, m: THREE.Matrix4) {
  const p = g.getAttribute('position');
  const v = new THREE.Vector3(), best = new THREE.Vector3(0, -Infinity, 0);
  const bb = new THREE.Box3().setFromBufferAttribute(p as THREE.BufferAttribute).applyMatrix4(m);
  const r = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.12;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m);
    if (Math.hypot(v.x, v.z) < r && v.y > best.y) best.copy(v);
  }
  return best.y > -Infinity ? best : new THREE.Vector3(0, bb.max.y, 0);
}


function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = 1, srgb = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

export class StudyArena implements ArenaLike {
  scene: THREE.Scene;
  world = new World();
  sun: THREE.DirectionalLight;
  grass = null;
  readonly healthPadPositions: THREE.Vector3[] = [];
  readonly showcasePos = new THREE.Vector3(0, 0, 0);
  ready: Promise<void>;

  private sky = new Sky();
  private hemi: THREE.HemisphereLight;
  private fog: THREE.FogExp2;
  private lampLight: THREE.PointLight;
  private candleLight: THREE.PointLight;
  private fireLight: THREE.PointLight;
  private base = { fog: new THREE.Color(), sun: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), sunI: 0, fogD: 0 };
  private anim: {
    hour?: THREE.Object3D; minute?: THREE.Object3D; second?: THREE.Object3D;
    globe?: THREE.Object3D; arm?: THREE.Object3D; chandelier?: THREE.Object3D; flames?: THREE.InstancedMesh; fire?: THREE.Mesh;
    cradle?: { balls: THREE.InstancedMesh; strings: THREE.InstancedMesh; at: THREE.Matrix4; xs: number[]; top: number };
    beacons: THREE.Mesh[];
  } = { beacons: [] };
  private floorY = -31;
  private T: Partial<Record<StudyProp, PropTemplate>> = {};
  soundscape: Soundscape = { kind: 'study' };
  private prints: Footprint[] = [];
  private deskDust: THREE.Points | null = null;
  private embers: THREE.Points | null = null;
  /** Extra chandelier sway from blasts, and the fire's flare-up after a big one. */
  private sway = 0;
  private swayPhase = 0;
  private time = 0;
  private lastThud = -9;

  /** Remember a desk object's footprint (geometry in its own frame, placed by `m`). */
  private footprint(name: string, geo: THREE.BufferGeometry, m: THREE.Matrix4) {
    const mat = MATTER[name];
    if (!mat) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const e = m.elements;
    const yaw = Math.atan2(e[8], e[10]); // the local z axis in world xz
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(m);
      // into the prop's yaw frame
      const u = v.x * c - v.z * sn, w = v.x * sn + v.z * c;
      x0 = Math.min(x0, u); x1 = Math.max(x1, u); z0 = Math.min(z0, w); z1 = Math.max(z1, w); top = Math.max(top, v.y);
    }
    const cu = (x0 + x1) / 2, cw = (z0 + z1) / 2;
    this.prints.push({ name, x: cu * c + cw * sn, z: -cu * sn + cw * c, c, s: sn, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, top, surface: mat.surface, rattle: mat.rattle, lastRattle: -9 });
  }

  surfaceAt(x: number, y: number, z: number): Surface {
    let best: Surface = 'wood', bestTop = -Infinity;
    for (const p of this.prints) {
      // low, flat things (paper, pencils) count from the desk top up; tall ones only when you stand on them
      if (y < (p.top < 2 ? -0.3 : p.top - 0.7) || p.top < bestTop) continue;
      const dx = x - p.x, dz = z - p.z;
      const u = dx * p.c - dz * p.s, w = dx * p.s + dz * p.c;
      if (Math.abs(u) <= p.hx && Math.abs(w) <= p.hz) { best = p.surface; bestTop = p.top; }
    }
    return best;
  }

  /**
   * A blast on the desk: the clutter jolts (vertex shader), what's close rattles in its own
   * voice, the whole desk booms under a big one, the chandelier sways and the dust blows away.
   */
  shock(pos: THREE.Vector3, k: number) {
    if (k < 0.25) return;
    addShock(pos.x, pos.z, Math.min(1.6, k));
    const r = 5 + k * 16;
    let n = 0;
    const order = this.prints
      .map((p) => ({ p, d: Math.hypot(p.x - pos.x, p.z - pos.z) - Math.max(p.hx, p.hz) * 0.5 }))
      .filter((o) => o.p.rattle && o.d < r && this.time - o.p.lastRattle > 0.6)
      .sort((a, b) => a.d - b.d);
    for (const { p, d } of order) {
      if (n++ >= 3) break;
      p.lastRattle = this.time;
      const at = new THREE.Vector3(p.x, Math.max(0.2, p.top * 0.5), p.z);
      const delay = d / 70 * 1000 + Math.random() * 60;
      const vol = Math.min(1, 0.35 + k * 0.5) * (1 - Math.max(0, d) / r * 0.6);
      setTimeout(() => audio.play(p.rattle!, at, vol), delay);
    }
    if (k >= 0.6 && this.time - this.lastThud > 0.4) {
      this.lastThud = this.time;
      audio.play('deskThud', pos, Math.min(1, k * 0.7));
    }
    if (k >= 0.6) {
      this.sway = Math.min(0.09, this.sway + k * 0.025);
      if (this.soundscape.chandelier && k >= 0.9) setTimeout(() => audio.play('chandelierTinkle', this.soundscape.chandelier!, Math.min(1, k * 0.6)), 180);
    }
  }

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    patchSunThroughWindows();
    scene.background = new THREE.Color(0x1a120c);
    // the sunset sky is only seen through the window
    this.sky.material.uniforms.uSunDir.value.copy(SUN_DIR);
    // the sky only shows through the windows: draw it after every opaque so the depth test skips the walls in front of it
    this.sky.mesh.renderOrder = 10;
    scene.add(this.sky.mesh);
    scene.environment = this.bakeEnvironment(renderer);
    scene.environmentIntensity = 0.55;
    this.fog = new THREE.FogExp2(new THREE.Color(0.32, 0.2, 0.13), 0.0022);
    scene.fog = this.fog;

    const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.74, 0.48), 7.0);
    sun.position.copy(SUN_DIR).multiplyScalar(160);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -56; sc.right = 56; sc.top = 46; sc.bottom = -46; sc.near = 40; sc.far = 320;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.05;
    sun.shadow.radius = 2;
    this.sun = sun;
    scene.add(sun, sun.target);
    this.hemi = new THREE.HemisphereLight(new THREE.Color(1.0, 0.82, 0.62), new THREE.Color(0.28, 0.16, 0.09), 0.55);
    scene.add(this.hemi);
    this.lampLight = new THREE.PointLight(new THREE.Color(1.0, 0.85, 0.55), 0, 70, 1.6);
    this.candleLight = new THREE.PointLight(new THREE.Color(1.0, 0.7, 0.4), 0, 160, 1.4);
    this.fireLight = new THREE.PointLight(new THREE.Color(1.0, 0.45, 0.15), 420, 220, 1.5);
    scene.add(this.lampLight, this.candleLight, this.fireLight);
    this.base.fog.copy(this.fog.color); this.base.fogD = this.fog.density;
    this.base.sun.copy(sun.color); this.base.sunI = sun.intensity;
    this.base.hemiSky.copy(this.hemi.color); this.base.hemiGround.copy(this.hemi.groundColor);

    // provisional bounds until the desk loads
    this.world.ground = () => 0;
    this.world.bounds = { kind: 'rect', hx: 40, hz: 27 };
    this.world.spawns = [new THREE.Vector3(-36, 0, 0), new THREE.Vector3(36, 0, 0)];
    this.renderer = renderer;
    this.applyQuality();
    this.ready = this.load();
  }

  private bakeEnvironment(renderer: THREE.WebGLRenderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const s = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uSun: { value: SUN_DIR } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uSun; varying vec3 vD; void main(){
        vec3 d = normalize(vD);
        vec3 wall = mix(vec3(0.16,0.10,0.06), vec3(0.55,0.40,0.28), smoothstep(-0.6, 0.5, d.y));
        float win = pow(max(dot(d, uSun), 0.0), 18.0);
        vec3 c = wall + vec3(2.6,1.5,0.8) * win;
        gl_FragColor = vec4(c, 1.0); }`,
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat));
    const rt = pmrem.fromScene(s, 0.03, 0.1, 200);
    pmrem.dispose();
    return rt.texture;
  }

  private renderer: THREE.WebGLRenderer;

  private async load() {
    this.roomModel = await this.loadRoomModel();
    const loaded = await Promise.all(STUDY_PROPS.map((n) => loadTemplate(`/models/study/${n}.glb?v=${STUDY_VER}`)));
    STUDY_PROPS.forEach((n, i) => { const t = loaded[i]; if (t) this.T[n] = t; });
    const hx = DESK_HX, hz = DESK_HZ;
    this.floorY = FLOOR_Y;
    // playable: the top inside the rounded edge
    this.world.bounds = { kind: 'rect', hx: hx - 1.6, hz: hz - 1.6 };
    const grid = new HeightGrid(-hx, -hz, hx, hz, 0.5, 0);
    const statics: { geo: THREE.BufferGeometry; mat: THREE.Material; m: THREE.Matrix4; collide: boolean }[] = [];

    // the desk: code-built walnut top, apron, drawers and turned legs
    const wood = makeDeskWoodMaterial(bakeWoodMaps(this.renderer));
    const M = P.propMaterials();
    const desk = buildDeskGeometry(hx, hz, FLOOR_Y);
    const I = new THREE.Matrix4();
    statics.push({ geo: desk.woodGeo, mat: wood, m: I, collide: false });
    statics.push({ geo: desk.brassGeo, mat: M.brass, m: I, collide: false });

    // desk clutter: the Meshy model when it has been delivered, otherwise the hand-built stand-in
    const deskProps = this.handProps(M);
    const names = [...new Set(deskProps.flatMap((d) => (d.meshy ? [d.meshy.name] : [])))];
    const meshy = new Map<string, PropTemplate>();
    (await Promise.all(names.map((n) => loadTemplate(`/models/study/${n}.glb${DROP_VER[n] ? `?v=${DROP_VER[n]}` : ''}`)))).forEach((t, i) => { if (t) meshy.set(names[i], t); });
    const tops: number[] = [];
    for (const d of deskProps) {
      const t = d.meshy && meshy.get(d.meshy.name);
      const below = d.stackOn !== undefined ? tops[d.stackOn] : NaN;
      const y = t && !Number.isNaN(below) ? below : d.y ?? 0;
      const world = new THREE.Matrix4().compose(new THREE.Vector3(d.x, y, d.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.yaw), new THREE.Vector3(1, 1, 1));
      if (t && d.meshy) {
        const fit = fitTemplate(t, d.meshy.fit, d.meshy.cm * P.U);
        statics.push({ geo: t.geometry, mat: t.material, m: world.clone().multiply(fit.m), collide: d.meshy.collide });
        this.footprint(d.meshy.name, t.geometry, world.clone().multiply(fit.m));
        tops.push(y + fit.height);
        if (t.glass) statics.push({ geo: t.glass, mat: M.lens, m: world.clone().multiply(fit.m), collide: false });
        if (d.meshy.name === 'hourglass') for (const p of P.hourglassGlass()) statics.push({ geo: p.geo, mat: p.mat, m: world.clone().multiply(fit.m), collide: false });
        if (d.flame) {
          const f = candleTop(t.geometry, fit.m);
          for (const p of P.flame(M)) statics.push({ geo: p.geo, mat: p.mat, m: world.clone().multiply(new THREE.Matrix4().makeTranslation(f.x, f.y, f.z)), collide: false });
        }
      } else {
        for (const p of d.parts()) {
          statics.push({ geo: p.geo, mat: p.mat, m: world, collide: p.collide ?? true });
          const nm = d.meshy?.name ?? d.matter;
          if (nm) this.footprint(nm, p.geo, world);
        }
        if (d.cradle) this.hangCradle(world, grid);
        tops.push(NaN);
      }
    }

    const place = (name: StudyProp, x: number, z: number, h: number, yaw: number, y = 0, collide = true) => {
      const t = this.T[name];
      if (!t) return null;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(h, h, h));
      statics.push({ geo: t.geometry, mat: t.material, m, collide });
      this.footprint(name, t.geometry, m);
      return { m, t, h };
    };
    for (const [n, x, z, h, yaw] of LAYOUT) place(n, x, z, h, yaw);

    // globe: brass stand + spinning ball in its ring
    const stand = place('globe_stand', -31, 19, 15, -0.5);
    if (stand && this.T.globe_ball) {
      const ring = ringOf(stand.t.geometry);
      const ballR = ring.r * stand.h * 0.93;
      const ball = new THREE.Mesh(this.T.globe_ball.geometry, this.T.globe_ball.material);
      const holder = new THREE.Group();
      holder.position.set(-31, ring.cy * stand.h, 19).add(new THREE.Vector3(ring.cx, 0, ring.cz).multiplyScalar(stand.h).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.5));
      holder.rotation.z = 0.41; // earth tilt
      const sz = this.T.globe_ball.size;
      ball.scale.setScalar((ballR * 2) / Math.max(sz.x, sz.y, sz.z));
      ball.position.y = -ballR;
      ball.castShadow = ball.receiveShadow = true;
      const spin = new THREE.Group(); spin.add(ball); holder.add(spin);
      this.scene.add(holder);
      this.anim.globe = spin;
      ball.updateMatrixWorld(true);
      grid.addGeometry(this.T.globe_ball.geometry, ball.matrixWorld);
    }

    // metronome with a swinging arm
    const met = place('metronome', 31, 17, 11, -2.6);
    if (met) {
      const arm = new THREE.Group();
      const brass = new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 1, roughness: 0.3 });
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 8.2, 8).translate(0, 4.1, 0), brass);
      const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.9, 6), brass);
      weight.position.y = 5.6;
      rod.castShadow = weight.castShadow = true;
      arm.add(rod, weight);
      const pivot = new THREE.Group();
      pivot.position.set(31, 1.4, 17);
      pivot.rotation.y = -2.6;
      const off = new THREE.Group(); off.position.z = met.t.size.z * 11 * 0.32; // sits in front of the body
      off.add(arm); pivot.add(off);
      this.scene.add(pivot);
      this.anim.arm = arm;
      this.soundscape.metronome = new THREE.Vector3(31, 5, 17);
    }

    // pocket watch hands (code-made, ticking)
    const watch = LAYOUT.find((l) => l[0] === 'pocket_watch');
    if (watch && this.T.pocket_watch) {
      const dial = dialOf(this.T.pocket_watch.geometry);
      const [, wx, wz, wh, wyaw] = watch;
      const c = new THREE.Vector3(dial.cx, dial.y, dial.cz).multiplyScalar(wh).applyAxisAngle(new THREE.Vector3(0, 1, 0), wyaw).add(new THREE.Vector3(wx, 0.02, wz));
      const R = dial.r * wh;
      const black = new THREE.MeshStandardMaterial({ color: 0x15100c, metalness: 0.6, roughness: 0.35 });
      const gold = new THREE.MeshStandardMaterial({ color: 0xd8a640, metalness: 1, roughness: 0.25, emissive: new THREE.Color(0.25, 0.15, 0.02) });
      const hand = (len: number, w: number, mat: THREE.Material) => {
        const g = new THREE.Group();
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, len).translate(0, 0.04, len * 0.42), mat);
        m.castShadow = true; g.add(m); g.position.copy(c); this.scene.add(g); return g;
      };
      this.anim.hour = hand(R * 0.5, R * 0.07, black);
      this.anim.minute = hand(R * 0.78, R * 0.05, black);
      this.anim.second = hand(R * 0.85, R * 0.018, gold);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.06, R * 0.06, 0.12, 12), gold);
      cap.position.copy(c).y += 0.06; this.scene.add(cap);
      this.soundscape.watch = c.clone();
    }

    // chandelier hanging from the ceiling, swaying
    if (this.T.chandelier) {
      const ch = this.T.chandelier;
      const H = 26;
      const pivot = new THREE.Group();
      const top = this.roomModel ? WIN.ceil + 2 : 92, chainL = top - 70;
      pivot.position.set(0, top, 0);
      const mesh = new THREE.Mesh(ch.geometry, ch.material);
      mesh.scale.setScalar(H); mesh.position.y = -H - chainL;
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, chainL, 6).translate(0, -chainL / 2, 0), new THREE.MeshStandardMaterial({ color: 0x1b1714, metalness: 0.8, roughness: 0.5 }));
      pivot.add(mesh, chain);
      // candle flames
      const flames = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 8, 6).scale(1, 1.8, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.4, 0.9), fog: false }), 8);
      const ringR = ch.size.x * H * 0.42;
      const m = new THREE.Matrix4();
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; m.makeTranslation(Math.cos(a) * ringR, -chainL - H * 0.35, Math.sin(a) * ringR); flames.setMatrixAt(i, m); }
      pivot.add(flames);
      this.scene.add(pivot);
      this.anim.chandelier = pivot;
      this.anim.flames = flames;
      this.candleLight.position.set(0, 70 - H * 0.4, 0);
      this.candleLight.intensity = 650;
      this.soundscape.chandelier = new THREE.Vector3(0, top - chainL - H * 0.5, 0);
    }

    // banker lamp glow
    const lamp = place('desk_lamp', -6, -22, 20, 0.15);
    if (lamp) {
      this.lampLight.position.set(-6, 15, -18.5);
      this.lampLight.intensity = 140;
    }

    // bake statics: one mesh per material, collision from the same triangles
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const s of statics) {
      if (s.collide) grid.addGeometry(s.geo, s.m);
      const g = s.geo.clone().applyMatrix4(s.m);
      if (!byMat.has(s.mat)) byMat.set(s.mat, []);
      byMat.get(s.mat)!.push(g);
    }
    for (const [mat, geos] of byMat) {
      const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)!;
      geo.computeBoundingSphere();
      if (mat !== wood) patchShock(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = !M.noShadow.has(mat);
      mesh.receiveShadow = mat !== M.flame;
      if (mat.transparent) mesh.renderOrder = 2;
      this.scene.add(mesh);
    }
    grid.finalize();
    this.world.grid = grid;
    grid.buildNav(HERO_RADIUS, (x, z) => this.world.inBounds(x, z, HERO_RADIUS));

    // spawns at the two short ends, pads and pickups on clear ground
    const sp = new THREE.Vector3();
    this.world.spawns = [grid.openSpot(-34, 0, 9, sp).clone(), grid.openSpot(34, 0, 9, sp).clone()];
    for (const [x, z] of [[-8, -15], [18, 15], [-8, 17], [18, -13]]) this.healthPadPositions.push(grid.openSpot(x, z, 7, new THREE.Vector3(), 3).clone());
    for (const p of this.healthPadPositions) p.y = this.world.heightAt(p.x, p.z);
    grid.openSpot(6, -2, 8, this.showcasePos, 4);
    this.buildSpawns();
    if (this.roomModel) this.dressModelRoom(this.roomModel); else this.buildRoom(hx, hz);
    // the air over the desk, at the legends' scale
    this.deskDust = makeDeskDust(settings.quality === 'low' ? 220 : 520, hx, hz);
    this.scene.add(this.deskDust);
    if (this.soundscape.fire) {
      this.embers = makeEmbers(settings.quality === 'low' ? 50 : 110, this.soundscape.fire, 16);
      this.scene.add(this.embers);
    }
  }

  /**
   * The desk clutter. Each entry is a Meshy model (public/models/study/<meshy>.glb) fitted to a real-world size in
   * centimeters, with the hand-built version as the stand-in until that model is delivered.
   * fit 'len' = longest horizontal side (things that lie flat), 'h' = height. Big flat things first.
   */
  private handProps(M: P.PropMaterials): DeskProp[] {
    const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
    const flat = (name: string, cm: number) => ({ name, cm, fit: 'len' as const, collide: false });
    const lying = (name: string, cm: number) => ({ name, cm, fit: 'len' as const, collide: true });
    const tall = (name: string, cm: number) => ({ name, cm, fit: 'h' as const, collide: true });
    return [
      // papers
      { parts: () => P.paperSheet(M, 0, 1, 0), matter: 'paper_einstein', x: -2, z: -8, yaw: 0.22 },
      { parts: () => P.paperSheet(M, 1, 2, 1), matter: 'letter_vangogh', x: 13, z: 9, yaw: -0.42 },
      { parts: () => P.paperSheet(M, 2, 3, 0), matter: 'music_sheet_yeat', x: -29, z: -13, yaw: 1.32 },
      { parts: () => P.indexCards(M), matter: 'index_cards', x: -26, z: 5, yaw: 0.5 },
      { parts: () => P.envelope(M), meshy: flat('envelope_wax_seal', 22), x: 24, z: 24, yaw: -0.18 },
      { parts: () => P.decal(M, 0, 13), x: 27.5, z: 9.5, yaw: 0 },
      { parts: () => P.decal(M, 1, 9), x: -13.5, z: -15.5, yaw: 0.7 },
      { parts: () => P.decal(M, 0, 11), x: -17, z: 14, yaw: 2.1 },
      // writing things
      { parts: () => P.inkwell(M), meshy: tall('inkwell_quill', 26), x: -17, z: -20, yaw: 0.3 },
      { parts: () => P.fountainPen(M), meshy: lying('emerald_quill', 24), x: 3.5, z: -12, yaw: -0.28 },
      { parts: () => P.pencil(M, C(0.95, 0.66, 0.05)), meshy: flat('pencil', 18.5), x: -6, z: 15, yaw: 0.5 },
      { parts: () => P.pencil(M, C(0.03, 0.2, 0.1), 13.5), meshy: flat('pencil', 16), x: 16, z: -1, yaw: 2.25 },
      { parts: () => P.ruler(M), meshy: flat('ruler', 30.5), x: 1, z: 25, yaw: -0.05 },
      { parts: () => P.paperClip(M), matter: 'paper_clip', x: -1, z: -17, yaw: 0.9 },
      { parts: () => P.paperClip(M), matter: 'paper_clip', x: 22, z: 21, yaw: 2.6 },
      { parts: () => P.paperClip(M), matter: 'paper_clip', x: -23, z: -16, yaw: -0.4 },
      // reading and looking
      { parts: () => P.magnifier(M), meshy: lying('magnifying_glass', 15.5), x: -19, z: 23, yaw: 0.6 },
      { parts: () => P.spectacles(M), meshy: flat('spectacles', 11), x: -8, z: -5, yaw: 0.45 },
      {
        parts: () => [
          ...P.hardcover(M, C(0.32, 0.04, 0.035)),
          ...P.hardcover(M, C(0.04, 0.12, 0.08), 22, 15, 2.8).map((p) => ({ ...p, geo: p.geo.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(-0.2).setPosition(0, 3.2 * P.U, 0)) })),
        ],
        meshy: tall('antique_books', 17), x: -33, z: -21, yaw: 0.12,
      },
      { parts: () => P.hardcover(M, C(0.06, 0.08, 0.2), 20, 14, 2.5), meshy: lying('closed_book', 20), x: 12, z: -24, yaw: 1.4 },
      { parts: () => P.scroll(M), meshy: lying('rolled_map', 30), x: -2, z: -25, yaw: 0.08 },
      // the rest of the study
      { parts: () => P.teacup(M), meshy: tall('teacup_saucer', 7.3), x: 37, z: -11, yaw: 0.4 },
      { parts: () => P.candle(M), meshy: tall('candle_holder', 13), x: 37, z: -25, yaw: 0, flame: true },
      { parts: () => P.coins(M), meshy: tall('coin_stack', 4), x: 12, z: 20, yaw: 0 },
      { parts: () => P.brushJar(M), meshy: tall('brush_jar', 22), x: -38, z: -6, yaw: 0.2 },
      { parts: () => P.hourglass(M), meshy: tall('hourglass', 15), x: 3, z: 17, yaw: 0.5 },
      // code-built on purpose: the balls swing
      { parts: () => P.newtonsCradle(M), matter: 'newtons_cradle', x: 20.3, z: -22, yaw: Math.PI / 2 + 0.12, cradle: true },
    ];
  }

  /** The five chrome balls of the Newton's cradle: two instanced draws, re-posed every frame in update(). */
  private hangCradle(at: THREE.Matrix4, grid: HeightGrid) {
    const { r, gap, top, n } = P.CRADLE;
    const g = P.cradleBall();
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe6e9ee, metalness: 1, roughness: 0.07, envMapIntensity: 1.6 });
    const line = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.6 });
    const balls = new THREE.InstancedMesh(g.ball, chrome, n);
    const strings = new THREE.InstancedMesh(g.strings, line, n);
    balls.castShadow = true; balls.receiveShadow = true;
    strings.frustumCulled = balls.frustumCulled = false;
    const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * gap * P.U);
    this.anim.cradle = { balls, strings, at, xs, top: top * P.U };
    this.soundscape.cradle = new THREE.Vector3(0, (top - P.CRADLE.L) * P.U, 0).applyMatrix4(at);
    this.poseCradle(0);
    // heroes bump into the balls where they hang at rest
    const rest = new THREE.BoxGeometry(n * gap * P.U, 2 * r * P.U, 2 * r * P.U).translate(0, (top - P.CRADLE.L) * P.U, 0);
    grid.addGeometry(rest, at);
    this.scene.add(balls, strings);
  }

  /** Classic cradle loop: the end ball swings out and back, clacks, and the far ball answers. */
  private poseCradle(time: number) {
    const c = this.anim.cradle!;
    const T = 1.3; // one full left-right cycle in seconds
    const th = 0.55 * Math.sin((time / T) * Math.PI * 2);
    const m = _cm, rz = _cr;
    for (let i = 0; i < c.xs.length; i++) {
      const last = c.xs.length - 1;
      // the inner balls only shiver as the momentum passes through them
      const a = i === last ? Math.max(th, 0) : i === 0 ? Math.min(th, 0) : th * 0.006;
      m.makeTranslation(c.xs[i], c.top, 0).multiply(rz.makeRotationZ(a)).premultiply(c.at);
      c.balls.setMatrixAt(i, m);
      c.strings.setMatrixAt(i, m);
    }
    c.balls.instanceMatrix.needsUpdate = true;
    c.strings.instanceMatrix.needsUpdate = true;
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
      this.anim.beacons.push(beacon);
      this.scene.add(beacon);
    });
  }

  /** The giant room around the desk: plank floor + rug, timber-framed plaster walls, a sunset window, bookshelves, fireplace, beamed ceiling. */
  private roomModel: THREE.Mesh | null = null;
  private dust: THREE.Points | null = null;
  get hasRoomModel() { return !!this.roomModel; }

  /** João's Cartographer's study, closed into a full room (scripts/build-study-room.mjs). Null if it is missing. */
  private async loadRoomModel(): Promise<THREE.Mesh | null> {
    try {
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync('/models/study/study_room.glb?v=1');
      let mesh: THREE.Mesh | null = null;
      gltf.scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
      if (!mesh) return null;
      const m = mesh as THREE.Mesh;
      gltf.scene.updateMatrixWorld(true);
      const local = m.matrixWorld.clone(); // meshopt quantization keeps its dequantize transform on the node
      m.removeFromParent();
      m.matrixAutoUpdate = false;
      m.matrix.copy(roomMatrix()).multiply(local);
      m.updateMatrixWorld(true);
      m.receiveShadow = true;
      m.castShadow = false; // the windows' light is analytic (studyLight); the shadow map stays on the desk
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.envMapIntensity = 0.6;
      if (mat.map) mat.map.anisotropy = 8;
      return m;
    } catch (e) {
      console.warn('[study] room model missing, using the built room', e);
      return null;
    }
  }

  /** Ceiling, window glass, fire glow and dust around the room model. */
  private dressModelRoom(room: THREE.Mesh) {
    // the backdrop draws after the desk, props and heroes, so whatever they cover is never shaded
    room.renderOrder = 1;
    this.scene.add(room);
    const B = ROOM_BOX;
    // ceiling: dark planks and heavy beams just above the model's crown beams
    const rnd = mulberry32(11);
    const plank = canvasTex(512, 512, (c) => {
      for (let i = 0; i < 8; i++) {
        const v = 38 + rnd() * 18;
        c.fillStyle = `rgb(${v + 22},${v * 0.66},${v * 0.38})`; c.fillRect(0, i * 64, 512, 64);
        for (let k = 0; k < 50; k++) { c.fillStyle = `rgba(15,8,3,${0.05 + rnd() * 0.1})`; c.fillRect(0, i * 64 + rnd() * 64, 512, 1 + rnd() * 2); }
        c.fillStyle = 'rgba(10,5,2,0.9)'; c.fillRect(0, i * 64, 512, 3);
      }
    }, 5);
    const ceilMat = new THREE.MeshStandardMaterial({ map: plank, roughness: 0.85 });
    const cw = B.x1 - B.x0 + 30, cd = B.z1 - B.z0 + 30, cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(cw, cd).rotateX(Math.PI / 2).translate(cx, WIN.ceil + 6, cz), ceilMat);
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x2a170c, roughness: 0.75 });
    const beams: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) beams.push(new RoundedBoxGeometry(cw, 9, 8, 2, 1.5).translate(cx, WIN.ceil + 1.5, B.z0 + 20 + i * ((B.z1 - B.z0 - 40) / 4)));
    const beam = new THREE.Mesh(mergeGeometries(beams, false)!, beamMat);
    ceil.receiveShadow = beam.receiveShadow = true;
    ceil.renderOrder = beam.renderOrder = 1;
    this.scene.add(ceil, beam);

    // window glass: barely there, a sheen of the room on it
    const ap = WIN.ap;
    const sh = new THREE.Shape();
    sh.moveTo(ap.x0, ap.y0); sh.lineTo(ap.x1, ap.y0); sh.lineTo(ap.x1, ap.ys);
    sh.absellipse((ap.x0 + ap.x1) / 2, ap.ys, (ap.x1 - ap.x0) / 2, ap.top - ap.ys, 0, Math.PI, false, 0);
    sh.lineTo(ap.x0, ap.y0);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xdfe8f0, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.07, depthWrite: false, envMapIntensity: 1.6, side: THREE.DoubleSide });
    const back = new THREE.Mesh(new THREE.ShapeGeometry(sh, 24).translate(0, 0, WIN.zA - 1.5), glassMat);
    const side = new THREE.Mesh(new THREE.ShapeGeometry(sh, 24).rotateY(-Math.PI / 2).translate(WIN.xB + 1.5, 0, WIN.bOff), glassMat);
    back.renderOrder = side.renderOrder = 3;
    this.scene.add(back, side);

    // the fireplace in the left wall: its painted fire gets a real glow and light
    const fx = -108, fy = -25, fz = 21;
    const fireTex = canvasTex(128, 128, (c) => {
      const g = c.createRadialGradient(64, 120, 4, 64, 100, 90);
      g.addColorStop(0, 'rgba(255,240,180,1)'); g.addColorStop(0.35, 'rgba(255,140,40,0.9)'); g.addColorStop(0.7, 'rgba(160,40,10,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    }, 1, true);
    fireTex.wrapS = fireTex.wrapT = THREE.ClampToEdgeWrapping;
    const fire = new THREE.Mesh(new THREE.PlaneGeometry(22, 16).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ map: fireTex, color: new THREE.Color(1.6, 0.8, 0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    fire.position.set(fx + 3, fy, fz);
    this.scene.add(fire);
    this.anim.fire = fire;
    this.fireLight.position.set(fx + 14, fy + 6, fz);
    const wy = (ap.y0 + ap.top) / 2, wxm = (ap.x0 + ap.x1) / 2;
    this.soundscape.fire = new THREE.Vector3(fx + 4, fy - 4, fz);
    this.soundscape.windows = [new THREE.Vector3(wxm, wy, WIN.zA), new THREE.Vector3(WIN.xB, wy, wxm + WIN.bOff)];
    this.soundscape.room = new THREE.Box3(new THREE.Vector3(B.x0, B.y0, B.z0), new THREE.Vector3(B.x1, B.y1, B.z1));

    this.dust = makeDust(settings.quality === 'low' ? 250 : 700);
    this.scene.add(this.dust);
  }

  private buildRoom(dhx: number, dhz: number) {
    const F = this.floorY;
    const RX = 120, RZ = 105, CEIL = 95;
    const rnd = mulberry32(7);
    const boxes = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const add = (mat: THREE.Material, g: THREE.BufferGeometry) => { if (!boxes.has(mat)) boxes.set(mat, []); boxes.get(mat)!.push(g); };
    const box = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) => add(mat, new THREE.BoxGeometry(w, h, d).rotateY(ry).translate(x, y, z));

    const plank = canvasTex(512, 512, (c) => {
      for (let i = 0; i < 8; i++) {
        const v = 70 + rnd() * 40;
        c.fillStyle = `rgb(${v + 40},${v * 0.62},${v * 0.32})`; c.fillRect(0, i * 64, 512, 64);
        for (let k = 0; k < 40; k++) { c.fillStyle = `rgba(30,15,5,${0.05 + rnd() * 0.08})`; c.fillRect(0, i * 64 + rnd() * 64, 512, 1 + rnd() * 2); }
        c.fillStyle = 'rgba(20,10,4,0.8)'; c.fillRect(0, i * 64, 512, 2); c.fillRect(((i * 197) % 512), i * 64, 3, 64);
      }
    }, 8);
    const plaster = canvasTex(256, 256, (c) => {
      c.fillStyle = '#d9c7a6'; c.fillRect(0, 0, 256, 256);
      for (let k = 0; k < 900; k++) { c.fillStyle = `rgba(${120 + rnd() * 60},${100 + rnd() * 40},${70 + rnd() * 30},0.08)`; const r = 2 + rnd() * 14; c.beginPath(); c.arc(rnd() * 256, rnd() * 256, r, 0, 7); c.fill(); }
    }, 6);
    // one leather spine (gilt bands, title label, worn edges); each book tints it with its own color
    const spines = canvasTex(128, 512, (c) => {
      c.fillStyle = '#d8d8d8'; c.fillRect(0, 0, 128, 512);
      for (let k = 0; k < 400; k++) { c.fillStyle = `rgba(0,0,0,${rnd() * 0.06})`; c.fillRect(rnd() * 128, rnd() * 512, 2 + rnd() * 6, 1 + rnd() * 3); }
      const sh = c.createLinearGradient(0, 0, 128, 0);
      sh.addColorStop(0, 'rgba(0,0,0,0.45)'); sh.addColorStop(0.18, 'rgba(0,0,0,0)'); sh.addColorStop(0.5, 'rgba(255,255,255,0.12)'); sh.addColorStop(0.82, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.45)');
      c.fillStyle = sh; c.fillRect(0, 0, 128, 512);
      c.fillStyle = '#e2b860';
      for (const y of [34, 48, 452, 466]) c.fillRect(0, y, 128, 6);
      c.fillStyle = 'rgba(20,12,6,0.75)'; c.fillRect(14, 120, 100, 120);
      c.strokeStyle = '#e2b860'; c.lineWidth = 3; c.strokeRect(18, 124, 92, 112);
      c.fillStyle = '#e2b860'; for (let i = 0; i < 3; i++) c.fillRect(30, 150 + i * 26, 68 - i * 14, 6);
      for (const y of [300, 360]) { c.fillRect(20, y, 88, 3); }
    }, 1);
    spines.wrapS = spines.wrapT = THREE.ClampToEdgeWrapping;
    const rugTex = canvasTex(512, 512, (c) => {
      c.fillStyle = '#6b1d16'; c.fillRect(0, 0, 512, 512);
      c.strokeStyle = '#c99a4a'; c.lineWidth = 10; c.strokeRect(24, 24, 464, 464);
      c.strokeStyle = '#1f2a4a'; c.lineWidth = 18; c.strokeRect(50, 50, 412, 412);
      for (let i = 0; i < 6; i++) { c.strokeStyle = i % 2 ? '#c99a4a' : '#2e3f63'; c.lineWidth = 6; c.beginPath(); c.ellipse(256, 256, 40 + i * 30, 60 + i * 26, 0, 0, 7); c.stroke(); }
    }, 1);
    rugTex.wrapS = rugTex.wrapT = THREE.ClampToEdgeWrapping;

    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2a16, roughness: 0.75 });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x2c180c, roughness: 0.8 });
    const wallMat = new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.95 });
    const brick = new THREE.MeshStandardMaterial({ color: 0x7a3a24, roughness: 0.9 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x6d6258, roughness: 0.95 });
    const bookMat = new THREE.MeshStandardMaterial({ map: spines, roughness: 0.62 });

    // floor + rug
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RZ * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: plank, roughness: 0.7 }));
    floor.position.y = F; floor.receiveShadow = true; this.scene.add(floor);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(dhx * 2 + 70, dhz * 2 + 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 }));
    rug.position.y = F + 0.15; rug.receiveShadow = true; this.scene.add(rug);

    // walls (window wall at +x has an arched opening onto the sunset)
    const H = CEIL - F;
    const wall = (w: number, x: number, z: number, ry: number) => add(wallMat, new THREE.PlaneGeometry(w, H).rotateY(ry).translate(x, F + H / 2, z));
    wall(RZ * 2, -RX, 0, Math.PI / 2);
    wall(RX * 2, 0, -RZ, 0);
    wall(RX * 2, 0, RZ, Math.PI);
    {
      const s = new THREE.Shape();
      s.moveTo(-RZ, 0); s.lineTo(RZ, 0); s.lineTo(RZ, H); s.lineTo(-RZ, H); s.lineTo(-RZ, 0);
      const hole = new THREE.Path();
      const ww = 34, wb = 32, wt = 80;
      hole.moveTo(-ww, wb); hole.lineTo(ww, wb); hole.lineTo(ww, wt); hole.absarc(0, wt, ww, 0, Math.PI, false); hole.lineTo(-ww, wb);
      s.holes.push(hole);
      const g = new THREE.ShapeGeometry(s, 24).rotateY(-Math.PI / 2).translate(RX, F, 0);
      add(wallMat, g);
      // stone surround + mullions
      for (const z of [-ww - 2.5, ww + 2.5]) box(stone, 4, wt - wb, 5, RX - 1, F + (wb + wt) / 2, z);
      box(stone, 4, 3, ww * 2 + 10, RX - 1, F + wb - 1.5, 0);
      box(stone, 18, 2.5, ww * 2 + 10, RX - 8, F + wb - 0.5, 0); // window seat ledge
      for (const z of [-ww / 2, 0, ww / 2]) box(darkWood, 1.5, wt - wb + ww * 0.9, 1.4, RX, F + wb + (wt - wb + ww * 0.9) / 2, z);
      for (const y of [wb + 16, wb + 32, wt - 2]) box(darkWood, 1.5, 1.2, ww * 2, RX, F + y, 0);
    }
    // timber frame: posts, rails and corner brick piers
    for (const [x0, z0, x1, z1] of [[-RX, -RZ, -RX, RZ], [-RX, -RZ, RX, -RZ], [-RX, RZ, RX, RZ]] as const) {
      const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
      for (let i = 0; i <= 6; i++) { const t = i / 6; box(wood, 4, H, 3, lerp(x0, x1, t) * 0.995, F + H / 2, lerp(z0, z1, t) * 0.995, ry); }
      for (const y of [F + H * 0.42, F + H - 3]) box(wood, len, 3, 2.6, (x0 + x1) / 2 * 0.993, y, (z0 + z1) / 2 * 0.993, ry);
    }
    for (const [x, z] of [[-RX, -RZ], [-RX, RZ], [RX, -RZ], [RX, RZ]]) box(brick, 10, H, 10, x, F + H / 2, z);
    // ceiling + beams
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RZ * 2).rotateX(Math.PI / 2), wallMat);
    ceil.position.y = CEIL; this.scene.add(ceil);
    for (let i = -3; i <= 3; i++) box(darkWood, RX * 2, 5, 6, 0, CEIL - 2.5, i * 30);
    box(darkWood, 7, 6, RZ * 2, 0, CEIL - 5.5, 0);

    // bookshelves along the long walls, filled with instanced books (one draw call)
    const bookXf: THREE.Matrix4[] = [], bookCol: THREE.Color[] = [];
    const palette = [[0.32, 0.05, 0.04], [0.06, 0.14, 0.09], [0.07, 0.09, 0.22], [0.36, 0.2, 0.08], [0.16, 0.08, 0.04], [0.42, 0.33, 0.18], [0.1, 0.06, 0.12], [0.25, 0.03, 0.08]];
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    const shelfBooks = (x0: number, x1: number, y: number, back: number, side: number) => {
      let x = x0 + rnd() * 0.6;
      while (x < x1 - 1) {
        if (rnd() < 0.05) { x += 2 + rnd() * 3; continue; } // gap
        if (rnd() < 0.05 && x < x1 - 9) {
          // a short pile lying flat
          const n = 2 + Math.floor(rnd() * 3); let yy = y;
          const L = 7 + rnd() * 2;
          for (let i = 0; i < n; i++) {
            const t = 1.2 + rnd() * 0.8, d = 8 + rnd() * 2;
            e.set(0, (rnd() - 0.5) * 0.2, 0); q.setFromEuler(e);
            bookXf.push(new THREE.Matrix4().compose(new THREE.Vector3(x + L / 2, yy + t / 2, back - side * d / 2), q, new THREE.Vector3(L, t, d)));
            bookCol.push(new THREE.Color(...palette[Math.floor(rnd() * palette.length)] as [number, number, number]).multiplyScalar(0.7 + rnd() * 0.6));
            yy += t;
          }
          x += L + 0.6;
          continue;
        }
        const t = 1.0 + rnd() * 1.5, hgt = 8 + rnd() * 4.4, d = 8 + rnd() * 3;
        const lean = rnd() < 0.06 ? (rnd() - 0.5) * 0.5 : 0;
        e.set(0, side > 0 ? Math.PI : 0, lean); q.setFromEuler(e);
        const cxb = x + t / 2 + Math.abs(lean) * hgt * 0.5;
        bookXf.push(new THREE.Matrix4().compose(new THREE.Vector3(cxb, y + hgt / 2 * Math.cos(lean), back - side * d / 2), q, new THREE.Vector3(t, hgt, d)));
        bookCol.push(new THREE.Color(...palette[Math.floor(rnd() * palette.length)] as [number, number, number]).multiplyScalar(0.7 + rnd() * 0.6));
        x += t + Math.abs(lean) * hgt + 0.05 + rnd() * 0.15;
      }
    };
    for (const side of [-1, 1]) {
      for (const cx of [-70, -26, 26, 70]) {
        if (side < 0 && cx === 70) continue; // the door
        const z = side * (RZ - 8), w = 38, h = 92;
        // open case: back, sides, plinth and crown, real books on every shelf
        box(darkWood, w, h, 1.2, cx, F + h / 2, z + side * 6.4);
        for (const sx of [-1, 1]) box(darkWood, 1.6, h, 14, cx + sx * (w / 2 - 0.8), F + h / 2, z);
        box(darkWood, w, 7.4, 14, cx, F + 3.7, z);
        box(wood, w + 2, 2.4, 15.5, cx, F + h + 1.2, z);
        for (let s = 0; s < 6; s++) {
          const y = F + 8 + s * 14;
          box(wood, w - 2, 1.2, 14.5, cx, y - 0.6, z);
          shelfBooks(cx - w / 2 + 2, cx + w / 2 - 2, y, z + side * 6, side);
        }
      }
    }
    {
      const books = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bookMat, bookXf.length);
      bookXf.forEach((m, i) => { books.setMatrixAt(i, m); books.setColorAt(i, bookCol[i]); });
      books.receiveShadow = true;
      books.computeBoundingSphere();
      this.scene.add(books);
    }
    // ── fireplace wall (-x): brick chimney breast to the ceiling, stone surround, mantel with candles, map above
    const brickTex = canvasTex(512, 512, (c) => {
      c.fillStyle = '#3b2a22'; c.fillRect(0, 0, 512, 512);
      for (let row = 0; row < 16; row++) for (let i = -1; i < 9; i++) {
        const x = i * 64 + (row % 2) * 32, y = row * 32;
        const v = 0.75 + rnd() * 0.5;
        c.fillStyle = `rgb(${Math.round(128 * v)},${Math.round(70 * v)},${Math.round(52 * v)})`;
        c.fillRect(x + 3, y + 3, 58, 26);
        c.fillStyle = `rgba(0,0,0,${rnd() * 0.15})`; c.fillRect(x + 3, y + 3 + rnd() * 20, 58, 6);
      }
    }, 1);
    brickTex.repeat.set(3, 9);
    const brickWall = new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.92 });
    const CH = 70; // chimney breast width (z)
    box(brickWall, 16, H, CH, -RX + 8, F + H / 2, 0);
    for (const z of [-24, 24]) box(stone, 20, 34, 9, -RX + 12, F + 17, z);          // jambs
    box(stone, 21, 7, 58, -RX + 12.5, F + 37, 0);                                 // lintel
    box(darkWood, 26, 3, 74, -RX + 15, F + 42, 0);                                // mantel shelf
    box(stone, 34, 1.5, 70, -RX + 20, F + 0.75, 0);                               // hearth stone
    const soot = new THREE.Mesh(new THREE.PlaneGeometry(40, 34).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x080403 }));
    soot.position.set(-RX + 16.05, F + 17, 0); this.scene.add(soot);
    const fireTex = canvasTex(128, 128, (c) => {
      const g = c.createRadialGradient(64, 120, 4, 64, 100, 90);
      g.addColorStop(0, 'rgba(255,240,180,1)'); g.addColorStop(0.35, 'rgba(255,140,40,0.9)'); g.addColorStop(0.7, 'rgba(160,40,10,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    }, 1, true);
    fireTex.wrapS = fireTex.wrapT = THREE.ClampToEdgeWrapping;
    const fire = new THREE.Mesh(new THREE.PlaneGeometry(36, 26).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ map: fireTex, color: new THREE.Color(3, 1.6, 0.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    fire.position.set(-RX + 18, F + 12, 0); this.scene.add(fire);
    this.anim.fire = fire;
    for (let i = 0; i < 3; i++) add(darkWood, new THREE.CylinderGeometry(2.2, 2.2, 26, 8).rotateX(Math.PI / 2).rotateY(0.3 * (i - 1)).translate(-RX + 20 + (i % 2) * 3, F + 3 + (i === 2 ? 3.5 : 0), (i - 1) * 6));
    // candles on the mantel
    const wax = new THREE.MeshStandardMaterial({ color: 0xeee2c4, roughness: 0.6 });
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3, 1.2), fog: false });
    for (const [z, h] of [[-30, 7], [-25, 5], [25, 6], [31, 8], [-6, 4]]) {
      add(wax, new THREE.CylinderGeometry(1.1, 1.2, h, 10).translate(-RX + 16, F + 43.5 + h / 2, z));
      add(flameMat, new THREE.SphereGeometry(0.55, 8, 6).scale(1, 2, 1).translate(-RX + 16, F + 44.6 + h, z));
    }
    // framed maps: one over the mantel, more on the long walls above the shelves
    const mapTex = canvasTex(512, 384, (c) => {
      c.fillStyle = '#c9b083'; c.fillRect(0, 0, 512, 384);
      for (let k = 0; k < 500; k++) { c.fillStyle = `rgba(90,60,25,${rnd() * 0.06})`; c.beginPath(); c.arc(rnd() * 512, rnd() * 384, 4 + rnd() * 30, 0, 7); c.fill(); }
      c.strokeStyle = 'rgba(70,45,20,0.8)'; c.lineWidth = 3;
      for (let land = 0; land < 5; land++) {
        const cx = 60 + rnd() * 390, cy = 50 + rnd() * 280, r = 30 + rnd() * 60;
        c.beginPath();
        for (let a = 0; a <= 24; a++) { const t = (a / 24) * Math.PI * 2, rr = r * (0.6 + rnd() * 0.5); c.lineTo(cx + Math.cos(t) * rr * 1.3, cy + Math.sin(t) * rr); }
        c.fillStyle = 'rgba(150,120,70,0.5)'; c.fill(); c.stroke();
      }
      c.strokeStyle = 'rgba(70,45,20,0.25)'; c.lineWidth = 1;
      for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, 384); c.stroke(); c.beginPath(); c.moveTo(0, i * 48); c.lineTo(512, i * 48); c.stroke(); }
      c.strokeStyle = 'rgba(70,45,20,0.9)'; c.lineWidth = 8; c.strokeRect(10, 10, 492, 364);
    }, 1, true);
    mapTex.wrapS = mapTex.wrapT = THREE.ClampToEdgeWrapping;
    const mapMat = new THREE.MeshStandardMaterial({ map: mapTex, roughness: 0.9 });
    const gilt = new THREE.MeshStandardMaterial({ color: 0x8a6428, metalness: 0.7, roughness: 0.45 });
    const frame = (x: number, y: number, z: number, w: number, h: number, ry: number) => {
      const n = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
      add(gilt, new THREE.BoxGeometry(w + 3, h + 3, 1).rotateY(ry).translate(x, y, z));
      add(mapMat, new THREE.PlaneGeometry(w, h).rotateY(ry).translate(x + n.x * 0.55, y, z + n.z * 0.55));
    };
    frame(-RX + 16.1, F + 66, 0, 36, 26, Math.PI / 2);
    frame(-RX + 3.2, F + 70, -64, 24, 32, Math.PI / 2);
    frame(-RX + 3.2, F + 70, 64, 24, 32, Math.PI / 2);
    for (const x of [-48, 48]) frame(x, F + 112, RZ - 2, 30, 20, Math.PI);
    frame(-48, F + 112, -RZ + 2, 30, 20, 0);

    // ── door on the back wall (-z), where one bookshelf would be
    {
      const dx = 70, dw = 32, dh = 74, z = -RZ + 1.5;
      box(darkWood, dw + 8, 5, 4, dx, F + dh + 2.5, z);
      for (const sx of [-1, 1]) box(darkWood, 4, dh, 4, dx + sx * (dw / 2 + 2), F + dh / 2, z);
      box(wood, dw, dh, 2, dx, F + dh / 2, z);
      for (const [px, py, pw, ph] of [[-7.5, 18, 12, 26], [7.5, 18, 12, 26], [-7.5, 52, 12, 30], [7.5, 52, 12, 30]]) box(darkWood, pw, ph, 1, dx + px, F + py, z + 1.3);
      add(gilt, new THREE.SphereGeometry(1.3, 12, 8).translate(dx - dw / 2 + 4, F + 36, z + 2.6));
      box(stone, dw + 6, 1.2, 8, dx, F + 0.6, z + 3);
    }
    // ── wainscot on the plaster walls
    for (const [x, z, w, ry] of [[0, -RZ + 0.6, RX * 2, 0], [0, RZ - 0.6, RX * 2, Math.PI], [-RX + 0.6, 0, RZ * 2, Math.PI / 2]] as const) {
      box(darkWood, w, 22, 1, x, F + 11, z, ry);
      box(wood, w, 1.6, 2.2, x, F + 22.5, z, ry);
    }
    // ── library ladder leaning on a shelf (+z wall)
    {
      const lz = RZ - 17, lx = 26, tilt = 0.2, len = 96;
      for (const sx of [-5, 5]) add(wood, new THREE.BoxGeometry(1.4, len, 1.4).translate(0, len / 2, 0).rotateX(-tilt).translate(lx + sx, F, lz - 6));
      for (let i = 1; i < 14; i++) add(wood, new THREE.CylinderGeometry(0.5, 0.5, 10, 6).rotateZ(Math.PI / 2).translate(0, i * 6.8, 0).rotateX(-tilt).translate(lx, F, lz - 6));
    }
    // ── hanging lanterns from the beams (glow only, no extra lights)
    {
      const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.6, 0.7), fog: false });
      const iron = new THREE.MeshStandardMaterial({ color: 0x1b1714, metalness: 0.8, roughness: 0.5 });
      for (const [x, z] of [[-62, -60], [62, -60], [-62, 60], [62, 60]]) {
        const top = CEIL - 5;
        add(iron, new THREE.CylinderGeometry(0.2, 0.2, 18, 5).translate(x, top - 9, z));
        add(iron, new THREE.CylinderGeometry(3.2, 3.6, 1.2, 6).translate(x, top - 18.6, z));
        add(glass, new THREE.CylinderGeometry(2.6, 2.2, 7, 6).translate(x, top - 22.8, z));
        add(iron, new THREE.ConeGeometry(3.8, 2.5, 6).translate(x, top - 17.4, z));
        add(iron, new THREE.CylinderGeometry(2.8, 2.8, 1, 6).translate(x, top - 26.8, z));
      }
    }
    // ── leather armchair + side table by the fire, telescope by the window
    {
      const leather = new THREE.MeshStandardMaterial({ color: 0x6a3a22, roughness: 0.55 });
      const chair = new THREE.Group();
      const rb = (w: number, h: number, d: number, x: number, y: number, z: number, r = 2.5) => { const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), leather); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; chair.add(m); };
      rb(34, 12, 32, 0, 8, 0);          // seat base
      rb(28, 5, 26, 0, 16, 1.5, 2.2);   // cushion
      rb(34, 34, 8, 0, 26, -14);        // back
      for (const sx of [-1, 1]) rb(7, 20, 32, sx * 17, 15, 0, 3);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.8, 3, 8), darkWood); leg.position.set(sx * 14, 1.5, sz * 12); chair.add(leg); }
      chair.position.set(-70, F, 58); chair.rotation.y = -2.3;
      this.scene.add(chair);
      add(darkWood, new THREE.CylinderGeometry(9, 9, 1.5, 24).translate(-88, F + 24, 30));
      add(darkWood, new THREE.CylinderGeometry(1.2, 1.6, 24, 10).translate(-88, F + 12, 30));
      add(darkWood, new THREE.CylinderGeometry(6, 6, 1, 16).translate(-88, F + 0.5, 30));
      add(wax, new THREE.CylinderGeometry(1, 1.1, 6, 10).translate(-88, F + 27.8, 30));
      add(flameMat, new THREE.SphereGeometry(0.5, 8, 6).scale(1, 2, 1).translate(-88, F + 31.8, 30));
      // telescope on a tripod, pointed at the window
      const tx = 92, tz = -78;
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; add(wood, new THREE.CylinderGeometry(0.5, 0.6, 34, 6).translate(0, 17, 0).rotateZ(0.28).rotateY(a).translate(tx, F, tz)); }
      add(gilt, new THREE.CylinderGeometry(1.8, 2.4, 30, 14).rotateZ(Math.PI / 2 - 0.35).rotateY(-0.6).translate(tx, F + 34, tz));
    }
    this.fireLight.position.set(-RX + 30, F + 14, 0);
    this.soundscape.fire = new THREE.Vector3(-RX + 18, F + 8, 0);
    this.soundscape.windows = [new THREE.Vector3(RX - 8, F + 60, 0)];
    this.soundscape.room = new THREE.Box3(new THREE.Vector3(-RX, F, -RZ), new THREE.Vector3(RX, CEIL, RZ));

    for (const [mat, geos] of boxes) {
      const g = mergeGeometries(geos, false)!;
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      this.scene.add(m);
    }
    // light shafts from the window
    const shaftMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.75, 0.45), transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < 3; i++) {
      const shaft = new THREE.Mesh(new THREE.PlaneGeometry(240, 40 - i * 8), shaftMat);
      shaft.position.copy(SUN_DIR).multiplyScalar(-10 - i * 6).add(new THREE.Vector3(60, F + 70, (i - 1) * 16));
      shaft.lookAt(shaft.position.clone().add(SUN_DIR));
      shaft.rotateY(Math.PI / 2);
      this.scene.add(shaft);
    }
  }

  placeProps() { /* everything is placed by load() */ }

  applyQuality() {
    const q = QUALITY[settings.quality];
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); (this.sun.shadow as any).map = null; }
  }

  setDoom(k: number) {
    const b = this.base;
    const green = new THREE.Color(0.08, 0.28, 0.12);
    this.fog.color.copy(b.fog).lerp(green, k);
    this.fog.density = lerp(b.fogD, 0.009, k);
    this.sun.color.copy(b.sun).lerp(new THREE.Color(0.45, 1.0, 0.5), k);
    this.sun.intensity = lerp(b.sunI, 1.4, k);
    this.hemi.color.copy(b.hemiSky).lerp(new THREE.Color(0.35, 0.8, 0.4), k);
    this.hemi.groundColor.copy(b.hemiGround).lerp(new THREE.Color(0.02, 0.1, 0.03), k);
    this.scene.environmentIntensity = lerp(0.55, 0.25, k);
  }

  private flick = 1;
  update(time: number, camera: THREE.Camera) {
    const dt = Math.min(0.1, Math.max(0, time - this.time));
    this.time = time;
    this.sky.update(time, camera.position);
    if (this.dust) (this.dust.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    tickShocks(time);
    if (this.deskDust) (this.deskDust.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    if (this.embers) (this.embers.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    this.sway *= Math.exp(-dt * 0.45);
    this.swayPhase += dt * 1.7;
    const a = this.anim;
    // watch: real-ish clock, ticking second hand
    if (a.second) {
      const secs = Math.floor(time);
      const tick = secs + Math.min(1, (time - secs) * 9);
      a.second.rotation.y = -(tick / 60) * Math.PI * 2;
      a.minute!.rotation.y = -(time / 3600 + 0.35) * Math.PI * 2;
      a.hour!.rotation.y = -(time / 43200 + 0.3) * Math.PI * 2;
    }
    if (a.globe) a.globe.rotation.y = time * 0.08;
    if (a.cradle) this.poseCradle(time);
    if (a.arm) a.arm.rotation.z = Math.sin(time * Math.PI * 1.1) * 0.42;
    if (a.chandelier) {
      a.chandelier.rotation.z = Math.sin(time * 0.35) * 0.018 + Math.sin(this.swayPhase) * this.sway;
      a.chandelier.rotation.x = Math.sin(time * 0.27 + 1) * 0.012 + Math.cos(this.swayPhase * 0.83) * this.sway * 0.6;
    }
    this.flick = damp(this.flick, 0.75 + Math.random() * 0.5, 12, 1 / 60);
    this.fireLight.intensity = 420 * this.flick;
    if (this.candleLight.intensity > 0) this.candleLight.intensity = 650 * (0.92 + this.flick * 0.08);
    if (a.fire) a.fire.scale.set(1, 0.85 + this.flick * 0.25 + Math.sin(time * 7.3) * 0.04, 0.92 + Math.sin(time * 5.1) * 0.06);
    for (let i = 0; i < a.beacons.length; i++) { const bc = a.beacons[i]; bc.rotation.y = time * 0.8; bc.position.y = 6.5 + Math.sin(time * 1.4 + i) * 0.35; }
  }
}

const _cm = new THREE.Matrix4(), _cr = new THREE.Matrix4();

/** Ring of a globe stand: center + inner radius from the upper part of the template. */
function ringOf(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position');
  const bb = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); if (v.y > 0.3) bb.expandByPoint(v); }
  const c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
  return { cx: c.x, cy: c.y, cz: c.z, r: Math.min(s.y, Math.max(s.x, s.z)) * 0.42 };
}

/** Dial of a face-up pocket watch: the flat-topped disc's center, height and radius. */
function dialOf(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const v = new THREE.Vector3();
  // up-facing points in the lower half are the dial face
  let maxY = 0;
  for (let i = 0; i < p.count; i++) if (n.getY(i) > 0.9 && p.getY(i) < 0.5) maxY = Math.max(maxY, p.getY(i));
  const bb = new THREE.Box3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); if (n.getY(i) > 0.9 && Math.abs(v.y - maxY) < 0.03) bb.expandByPoint(v); }
  const c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
  return { cx: c.x, cz: c.z, y: maxY, r: Math.min(s.x, s.z) / 2 };
}
