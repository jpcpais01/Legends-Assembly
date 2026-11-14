import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math';

/**
 * Steve's pixel art, all made in code: the diamond sword, bow and arrows are 16x16 sprites extruded into little
 * voxel slabs (one vertex-coloured geometry each), the Build Up blocks are cubes with 16x16 nearest-filtered
 * textures, and the Ender Dragon is a jointed rig of textured blocks. Nothing here needs an asset, so it all
 * stays crisp at any distance and costs a handful of draw calls.
 */

const lin = (hex: string) => new THREE.Color(hex).convertSRGBToLinear();

// ───────────────────────── sprites ─────────────────────────

/** 16x16 diamond sword, handle at the bottom left, tip at the top right. */
function swordSprite(): string[] {
  const g: string[][] = Array.from({ length: 16 }, () => Array(16).fill('.'));
  const set = (x: number, y: number, c: string) => { if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y][x] = c; };
  // blade along the anti-diagonal x + y = 15, from just past the guard to the tip
  for (let x = 5; x <= 14; x++) {
    const y = 15 - x;
    const tip = x >= 13;
    set(x, y, 'D');
    set(x - 1, y, tip ? 'K' : 'L'); set(x, y + 1, tip ? 'K' : 'd');
    if (!tip) { set(x - 1, y - 1, 'K'); set(x + 1, y + 1, 'K'); set(x - 2, y, 'K'); set(x, y + 2, 'K'); }
  }
  set(14, 1, 'L'); set(15, 0, 'K'); set(14, 0, 'K'); set(15, 1, 'K');
  // crossguard: a short bar across the blade's root
  for (const [x, y] of [[2, 10], [3, 10], [3, 11], [4, 12], [5, 12], [5, 13]] as const) set(x, y, 'G');
  for (const [x, y] of [[1, 9], [2, 9], [4, 11], [6, 13], [6, 14]] as const) set(x, y, 'K');
  // handle and pommel
  for (const [x, y] of [[2, 13], [3, 12], [1, 14]] as const) set(x, y, 'W');
  for (const [x, y] of [[1, 13], [2, 14], [3, 13]] as const) set(x, y, 'w');
  set(0, 15, 'G'); set(0, 14, 'K'); set(1, 15, 'K');
  return g.map((r) => r.join(''));
}

/** 16x16 bow: limbs bowing out to the right, string straight down the left. `draw` pulls the string back. */
function bowSprite(draw = 0): string[] {
  const g: string[][] = Array.from({ length: 16 }, () => Array(16).fill('.'));
  const set = (x: number, y: number, c: string) => { if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y][x] = c; };
  for (let y = 1; y <= 14; y++) {
    const u = (y - 7.5) / 6.5;
    const x = Math.round(4 + 7.5 * (1 - u * u));
    set(x, y, 'W'); set(x + 1, y, 'w');
    if (Math.abs(u) > 0.25) set(x - 1, y, Math.abs(u) > 0.7 ? 'w' : 'W');
  }
  // grip wrap in the middle of the bow
  for (let y = 6; y <= 9; y++) { set(11, y, 'B'); set(12, y, 'b'); }
  // the string, pulled back to a point when drawn
  const back = Math.round(draw * 4);
  for (let y = 1; y <= 14; y++) {
    const u = Math.abs(y - 7.5) / 6.5;
    set(Math.round(3 - back * (1 - u)), y, 'S');
  }
  return g.map((r) => r.join(''));
}

/** 16x16 arrow, flint head at the top right, fletching at the bottom left. */
function arrowSprite(): string[] {
  const g: string[][] = Array.from({ length: 16 }, () => Array(16).fill('.'));
  const set = (x: number, y: number, c: string) => { if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y][x] = c; };
  for (let x = 3; x <= 12; x++) set(x, 15 - x, x % 3 ? 'W' : 'w');
  for (const [x, y] of [[13, 2], [14, 1], [12, 1], [13, 1], [14, 2], [15, 0], [14, 0], [15, 1], [13, 0]] as const) set(x, y, y === 0 || x === 15 ? 'K' : 'F');
  for (const [x, y] of [[1, 12], [2, 11], [1, 13], [2, 14], [0, 14], [1, 15], [3, 13], [2, 13], [0, 15]] as const) set(x, y, (x + y) % 2 ? 'E' : 'e');
  return g.map((r) => r.join(''));
}

const SPRITE_HEX: Record<string, string> = {
  D: '#33e8cf', L: '#b4fff3', d: '#1aa592', K: '#0b3b36', G: '#14786c',
  W: '#8a5a2b', w: '#5c3a17', B: '#6f6f6f', b: '#4b4b4b', S: '#b5b5b5',
  F: '#5f5f66', E: '#f2f2f2', e: '#c9c9c9',
};
const SPRITE_PAL: Record<string, THREE.Color> = Object.fromEntries(Object.entries(SPRITE_HEX).map(([k, v]) => [k, lin(v)]));

const iconCache: Record<string, string> = {};
/** A crisp 16x16 PNG of an item sprite for the HUD hotbar (scaled up with pixelated rendering). */
export function itemIcon(id: 'sword' | 'bow' | 'arrow'): string {
  if (iconCache[id]) return iconCache[id];
  const rows = id === 'sword' ? swordSprite() : id === 'bow' ? bowSprite(0) : arrowSprite();
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const x = cv.getContext('2d')!;
  for (let y = 0; y < 16; y++) for (let i = 0; i < 16; i++) {
    const c = SPRITE_HEX[rows[y][i]];
    if (c) { x.fillStyle = c; x.fillRect(i, y, 1, 1); }
  }
  return (iconCache[id] = cv.toDataURL());
}

/**
 * Extrude a 16x16 sprite into a slab of 1-pixel cubes (x right, y up, z thickness), with vertex colours.
 * `pivot` is the pixel (column, row) placed at the origin.
 */
export function spriteGeometry(rows: string[], px: number, pivot: [number, number], depth = 1, pal = SPRITE_PAL) {
  const parts: THREE.BufferGeometry[] = [];
  const box = new THREE.BoxGeometry(px, px, px * depth);
  box.deleteAttribute('uv');
  const rnd = mulberry32(rows.join('').length * 31 + rows[3].charCodeAt(7));
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
    const ch = rows[y][x];
    const c = pal[ch];
    if (!c) continue;
    const g = box.clone().translate((x - pivot[0]) * px, (pivot[1] - y) * px, 0);
    const k = 0.92 + rnd() * 0.14;
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

let itemMat: THREE.MeshStandardMaterial | null = null;
export function itemMaterial() {
  return (itemMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }));
}
let swordGlint: THREE.MeshStandardMaterial | null = null;
/** The blade catches the light like a gem: a cool sheen and a touch of glow so it reads at range. */
function swordMaterial() {
  return (swordGlint ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.15, emissive: new THREE.Color(0.02, 0.09, 0.08) }));
}

const SWORD_PX = 0.058;
/** The diamond sword, gripped at the origin, blade up its local +y (the item grip turns it). */
export function swordGeometry() {
  // the sprite's diagonal becomes the blade axis: rotate it upright, grip pixel (2, 13) at the origin
  // then spin it about the blade so its flat faces left and right (edges up and down) in the fist
  return spriteGeometry(swordSprite(), SWORD_PX, [2, 13]).rotateZ(Math.PI / 4).rotateY(Math.PI / 2);
}
export function buildSword(): THREE.Object3D {
  const m = new THREE.Mesh(swordGeometry(), swordMaterial());
  // in the fist: the blade juts forward out of the thumb side, tilted up a little
  m.rotation.set(Math.PI / 2 + 0.55, 0, 0);
  m.position.set(0, -0.07, 0.01);
  m.scale.setScalar(1);
  return m;
}

const BOW_PX = 0.062;
const bowGeos: THREE.BufferGeometry[] = [];
/** Bow geometry at a draw stage 0..3 (gripped at the wrap). */
export function bowGeometry(stage: number) {
  return (bowGeos[stage] ??= spriteGeometry(bowSprite(stage / 3), BOW_PX, [11.5, 7.5]));
}
export function buildBow(): THREE.Object3D {
  const g = new THREE.Group();
  const m = new THREE.Mesh(bowGeometry(0), itemMaterial());
  m.name = 'bow';
  // in the fist: the belly faces the target (hand -x), the limbs run along the hand's z, flat to the side
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)));
  // turned about the limbs so its curve reads from the over-the-shoulder camera
  m.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.1));
  m.position.set(0, -0.07, 0);
  g.add(m);
  // the nocked arrow, shown while drawing
  const a = new THREE.Mesh(arrowGeometry(), itemMaterial());
  a.name = 'nock';
  a.visible = false;
  // along the arm, resting on the grip, pointing where the bow points
  a.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0));
  a.position.set(0.22, -0.07, 0.05);
  g.add(a);
  return g;
}

const ARROW_PX = 0.05;
let arrowGeo: THREE.BufferGeometry | null = null;
/** An arrow along +z (head forward), two crossed sprite slabs so it reads from every side; origin at its middle. */
export function arrowGeometry() {
  if (arrowGeo) return arrowGeo;
  const a = spriteGeometry(arrowSprite(), ARROW_PX, [7.5, 7.5], 0.6).rotateZ(Math.PI / 4).rotateX(Math.PI / 2);
  const b = a.clone().rotateZ(Math.PI / 2);
  arrowGeo = mergeGeometries([a, b])!;
  return arrowGeo;
}

// ───────────────────────── pixel textures ─────────────────────────

function pixelTexture(paint: (x: number, y: number, rnd: () => number) => string, seed: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry32(seed);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { ctx.fillStyle = paint(x, y, rnd); ctx.fillRect(x, y, 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}
const shadeHex = (base: [number, number, number], k: number) => `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`;
const DIRT: [number, number, number] = [134, 96, 67];
const GRASS: [number, number, number] = [104, 166, 62];
const STONE: [number, number, number] = [125, 125, 125];

function dirtPx(_x: number, _y: number, rnd: () => number) {
  const r = rnd();
  return r < 0.12 ? shadeHex(DIRT, 0.68) : r < 0.22 ? shadeHex([150, 108, 74], 1.06) : r < 0.3 ? shadeHex([110, 110, 110], 0.9) : shadeHex(DIRT, 0.9 + rnd() * 0.16);
}

export interface BlockMats { grass: THREE.Material[]; dirt: THREE.Material; stone: THREE.Material }
let blockMats: BlockMats | null = null;
/** Grass (top, side, dirt bottom), dirt and stone. Box face order: +x, -x, +y, -y, +z, -z. */
export function blockMaterials(): BlockMats {
  if (blockMats) return blockMats;
  const top = pixelTexture((_x, _y, rnd) => shadeHex(GRASS, 0.78 + rnd() * 0.3), 11);
  const drip = Array.from({ length: 16 }, (_, i) => 3 + ((i * 7) % 3 === 0 ? 1 : 0) + (i % 5 === 2 ? 1 : 0));
  const side = pixelTexture((x, y, rnd) => (y < drip[x] ? shadeHex(GRASS, 0.74 + rnd() * 0.28) : dirtPx(x, y, rnd)), 12);
  const dirt = pixelTexture(dirtPx, 13);
  const stone = pixelTexture((x, y, rnd) => {
    const r = rnd(), crack = (x * 3 + y * 5) % 11 === 0 || (x + y * 2) % 13 === 0;
    return crack ? shadeHex(STONE, 0.62) : r < 0.2 ? shadeHex(STONE, 0.82) : shadeHex(STONE, 0.94 + rnd() * 0.14);
  }, 14);
  const mk = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
  const sideM = mk(side), topM = mk(top), dirtM = mk(dirt);
  // the grass top is painted grey-green in the original; tint it a little more vivid here for the arena light
  topM.color.setRGB(1, 1.05, 0.95);
  blockMats = { grass: [sideM, sideM, topM, dirtM, sideM, sideM], dirt: dirtM, stone: mk(stone) };
  return blockMats;
}

// ───────────────────────── Ender Dragon ─────────────────────────

export interface DragonRig {
  root: THREE.Group;
  /** Body, then neck segments, head, jaw. */
  neck: THREE.Group[];
  head: THREE.Group;
  jaw: THREE.Group;
  mouth: THREE.Object3D;
  eyes: THREE.Object3D[];
  tail: THREE.Group[];
  wings: { inner: THREE.Group; outer: THREE.Group; side: 1 | -1 }[];
  mats: THREE.Material[];
}

let dragonMats: { scale: THREE.MeshStandardMaterial; bone: THREE.MeshStandardMaterial; skin: THREE.MeshStandardMaterial; eye: THREE.MeshBasicMaterial } | null = null;
function dragonMaterials() {
  if (dragonMats) return dragonMats;
  const scale = pixelTexture((x, y, rnd) => {
    const r = rnd();
    const ridge = (x + y) % 6 === 0;
    return ridge ? 'rgb(34,28,40)' : r < 0.15 ? 'rgb(44,32,58)' : r < 0.3 ? 'rgb(10,9,12)' : `rgb(${16 + Math.round(rnd() * 8)},${15 + Math.round(rnd() * 6)},${20 + Math.round(rnd() * 8)})`;
  }, 21);
  const skin = pixelTexture((x, y, rnd) => {
    const vein = x % 5 === 0 || (x + y) % 9 === 0;
    return vein ? 'rgb(58,52,66)' : `rgb(${30 + Math.round(rnd() * 10)},${28 + Math.round(rnd() * 8)},${36 + Math.round(rnd() * 10)})`;
  }, 22);
  dragonMats = {
    scale: new THREE.MeshStandardMaterial({ map: scale, roughness: 0.62, metalness: 0.15 }),
    bone: new THREE.MeshStandardMaterial({ color: lin('#7a7882'), roughness: 0.7 }),
    skin: new THREE.MeshStandardMaterial({ map: skin, roughness: 0.8, side: THREE.DoubleSide }),
    eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.7, 4.6) }),
  };
  return dragonMats;
}

/**
 * A blocky Ender Dragon about 18 m from snout to tail and 20 m across the wings, built from boxes on a little
 * hierarchy so the neck, jaw, tail and two-jointed wings can move. Faces +z, its origin in the middle of the body.
 */
export function buildDragon(): DragonRig {
  const M = dragonMaterials();
  const root = new THREE.Group();
  const box = (parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, shadow = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    parent.add(m);
    return m;
  };
  // body with spine plates and tucked legs
  box(root, 2.6, 2.1, 5.4, M.scale, 0, 0, 0, true);
  for (let i = 0; i < 4; i++) box(root, 0.35, 0.55, 0.6, M.bone, 0, 1.3, 1.8 - i * 1.3);
  for (const sx of [1, -1]) for (const z of [1.6, -1.6]) {
    box(root, 0.6, 1.2, 0.7, M.scale, sx * 1.0, -1.4, z);
    box(root, 0.7, 0.35, 1.0, M.scale, sx * 1.0, -2.0, z + 0.25);
  }
  // neck: five segments chained forward
  const neck: THREE.Group[] = [];
  let parent: THREE.Object3D = root, z0 = 2.7;
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.35 : 0, i === 0 ? z0 : 1.25);
    parent.add(seg);
    box(seg, 1.15 - i * 0.04, 1.15 - i * 0.04, 1.3, M.scale, 0, 0, 0.6, i < 2);
    box(seg, 0.28, 0.4, 0.5, M.bone, 0, 0.72, 0.6);
    neck.push(seg);
    parent = seg;
  }
  // head: skull, long snout with nostrils, horns, glowing eyes, and a hinged jaw
  const head = new THREE.Group();
  head.position.set(0, 0, 1.25);
  parent.add(head);
  box(head, 1.9, 1.3, 1.9, M.scale, 0, 0.1, 0.8, true);
  box(head, 1.3, 0.75, 1.8, M.scale, 0, -0.08, 2.5);
  for (const sx of [1, -1]) {
    box(head, 0.25, 0.14, 0.3, M.bone, sx * 0.38, 0.32, 3.2);
    box(head, 0.28, 0.7, 0.28, M.bone, sx * 0.55, 0.95, 0.15);
    box(head, 0.22, 0.4, 0.22, M.bone, sx * 0.55, 1.4, -0.1);
  }
  const eyes: THREE.Object3D[] = [];
  for (const sx of [1, -1]) {
    const e = box(head, 0.08, 0.24, 0.58, M.eye, sx * 0.96, 0.25, 1.35);
    eyes.push(e);
  }
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.45, 0.6);
  head.add(jaw);
  box(jaw, 1.2, 0.32, 2.7, M.scale, 0, -0.1, 1.3);
  for (const sx of [1, -1]) for (let i = 0; i < 4; i++) box(jaw, 0.1, 0.18, 0.1, M.bone, sx * 0.48, 0.12, 0.6 + i * 0.6);
  const mouth = new THREE.Object3D();
  mouth.position.set(0, -0.35, 3.4);
  head.add(mouth);
  // tail: ten tapering segments trailing back, each with a spike
  const tail: THREE.Group[] = [];
  parent = root;
  for (let i = 0; i < 10; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.2 : 0, i === 0 ? -2.7 : -1.3);
    parent.add(seg);
    const s = 1.2 - i * 0.07;
    box(seg, s, s, 1.35, M.scale, 0, 0, -0.65, i < 3);
    box(seg, 0.22, 0.45 - i * 0.02, 0.45, M.bone, 0, s / 2 + 0.2, -0.65);
    tail.push(seg);
    parent = seg;
  }
  // wings: an arm bone with a membrane behind it, then the outer half the same way, hinged at the wrist
  const wings: DragonRig['wings'] = [];
  for (const side of [1, -1] as const) {
    const inner = new THREE.Group();
    inner.position.set(side * 1.25, 0.8, 1.4);
    root.add(inner);
    box(inner, 5, 0.38, 0.42, M.bone, side * 2.5, 0, 0, true);
    box(inner, 5, 0.08, 4.4, M.skin, side * 2.5, -0.05, -2.3, true);
    for (const x of [1.6, 3.3]) box(inner, 0.12, 0.12, 4.2, M.bone, side * x, 0.02, -2.2);
    const outer = new THREE.Group();
    outer.position.set(side * 5, 0, 0);
    inner.add(outer);
    box(outer, 5, 0.3, 0.32, M.bone, side * 2.5, 0, 0, true);
    box(outer, 5, 0.08, 3.4, M.skin, side * 2.5, -0.05, -1.8, true);
    box(outer, 2.6, 0.08, 1.2, M.skin, side * 1.3, -0.05, -4.0);
    for (const x of [1.2, 2.6, 4.0]) box(outer, 0.1, 0.1, 3.6 - x * 0.35, M.bone, side * x, 0.02, -1.8 + x * 0.17);
    box(outer, 0.18, 0.18, 0.6, M.bone, side * 5.05, 0, 0.35);
    wings.push({ inner, outer, side });
  }
  return { root, neck, head, jaw, mouth, eyes, tail, wings, mats: [M.scale, M.bone, M.skin, M.eye] };
}
