#!/usr/bin/env node
/**
 * Builds the Giant's Study room backdrop from João's Meshy "Cartographer's study" cutaway
 * (models-src/room/cartographer.glb, two walls + floor) into public/models/study/study_room.glb.
 *
 * - Removes the painted window glass, the broken arch panes and the outside shutter, so the game can put
 *   real glass and real sunlight in the window (the mullions and frame stay exactly as modeled).
 * - Closes the room with two new walls built from the model's own pieces:
 *     +x: plaster wall + a copy of the arched window (with its window seat) + the star-chart frames
 *     +z: plaster wall + an arched door (the window frame stretched to the floor, the carved shutter as the door
 *         leaf) + the tall bookcase
 * - Trims what hung past the new walls and the outside faces nobody sees.
 * - Simplifies to a backdrop budget, 4K base color, 2K normal/ORM WebP, meshopt.
 *
 * Coordinates are the model's own (about 1.9 units across, floor at y = -0.43). The game scales it.
 * Usage: npm run models:room [-- --ratio 0.4]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, textureCompress, meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const SRC = arg('src', 'models-src/room/cartographer.glb');
const OUT = arg('out', 'public/models/study/study_room.glb');
const RATIO = Number(arg('ratio', '0.36'));
const RAW = args.includes('--raw'); // skip simplify/compress (fast preview)

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(SRC);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute('POSITION').getArray();
const N = prim.getAttribute('NORMAL').getArray();
const T = prim.getAttribute('TEXCOORD_0').getArray();
const I = prim.getIndices().getArray();

// ── the back window, measured from the model (glass plane z = -0.848)
export const WIN = { x0: -0.18, x1: 0.2775, y0: -0.157, ys: 0.294, top: 0.513 };
const WCX = (WIN.x0 + WIN.x1) / 2, WRX = (WIN.x1 - WIN.x0) / 2, WRY = WIN.top - WIN.ys;
const inWin = (x, y, m = 0) => {
  if (x < WIN.x0 - m || x > WIN.x1 + m || y < WIN.y0 - m) return false;
  if (y <= WIN.ys) return true;
  const u = (x - WCX) / (WRX + m), v = (y - WIN.ys) / (WRY + m);
  return u * u + v * v <= 1;
};
const ROOM = { x: 0.705, z: 0.705 }; // inner faces of the two new walls
const DOOR_DX = -0.2;   // door frame offset along the +z wall
const WIN_DZ = 0.1;     // window offset along the +x wall
const FRAMES_DZ = 0.21; // chart frames offset along the +x wall
const SHELF_DX = 1.03;  // bookcase offset along the +z wall
// window frame stretched down to the floor for the door: rect part [y0 - 0.04, ys] -> [floor, ys]
const FLOOR = -0.445;
const stretchY = (y) => (y >= WIN.ys ? y : FLOOR + (y - (WIN.y0 - 0.04)) * (WIN.ys - FLOOR) / (WIN.ys - (WIN.y0 - 0.04)));

const tri = (t) => [I[t], I[t + 1], I[t + 2]];
const cen = (v) => [0, 1, 2].map((k) => (P[v[0] * 3 + k] + P[v[1] * 3 + k] + P[v[2] * 3 + k]) / 3);
const nrm = (v) => [0, 1, 2].map((k) => (N[v[0] * 3 + k] + N[v[1] * 3 + k] + N[v[2] * 3 + k]) / 3);
const all = (v, f) => v.every((i) => f(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));

/** Window glass, broken arch panes and the outside shutter: everything inside the opening behind the mullions. */
const isPane = (v) => all(v, (x, y, z) => inWin(x, y, 0.004) && z < -0.838);
/** Outside faces (never seen from inside). */
const isOutside = (v) => { const [cx, , cz] = cen(v), n = nrm(v); return (cx < -0.885 && n[0] < -0.4) || (cz < -0.885 && n[2] < -0.4) || cen(v)[1] < -0.47; };

// output buffers
const oP = [], oN = [], oT = [];
const vtx = (i) => ({ p: [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], n: [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], t: [T[i * 2], T[i * 2 + 1]] });
const mid = (a, b) => ({ p: a.p.map((v, k) => (v + b.p[k]) / 2), n: a.n.map((v, k) => (v + b.n[k]) / 2), t: a.t.map((v, k) => (v + b.t[k]) / 2) });
const emitV = (vs, xf) => { for (const v of vs) { oP.push(...xf.p(...v.p)); oN.push(...xf.n(...v.n)); oT.push(...v.t); } };
const ID = { p: (x, y, z) => [x, y, z], n: (x, y, z) => [x, y, z] };
const counts = {};
/**
 * Copy the selected triangles through a transform. `keep(c)` tests the transformed centroid; triangles that touch
 * the `fine(c)` region are first split down to `step` so cut edges (window and door holes) come out clean.
 */
const piece = (name, sel, xf, keep = null, fine = null, step = 0.004) => {
  let n = 0;
  const out = (vs) => {
    const c = [0, 1, 2].map((k) => (vs[0].p[k] + vs[1].p[k] + vs[2].p[k]) / 3);
    const tc = xf.p(...c);
    if (keep && !keep(tc)) return;
    emitV(vs, xf); n++;
  };
  const split = (vs, depth) => {
    const e = Math.max(...[[0, 1], [1, 2], [2, 0]].map(([i, j]) => Math.hypot(...vs[i].p.map((v, k) => v - vs[j].p[k]))));
    const tp = vs.map((v) => xf.p(...v.p));
    const near = fine && tp.some((p) => fine(p)) || fine && fine(tp.reduce((s, p) => s.map((v, k) => v + p[k] / 3), [0, 0, 0]));
    if (!near || e < step || depth > 12) return out(vs);
    const [a, b, c] = vs, ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    split([a, ab, ca], depth + 1); split([ab, b, bc], depth + 1); split([ca, bc, c], depth + 1); split([ab, bc, ca], depth + 1);
  };
  for (let t = 0; t < I.length; t += 3) {
    const v = tri(t);
    if (!sel(v)) continue;
    split(v.map(vtx), 0);
  }
  counts[name] = n;
};

// The window bay's opening in the back wall: where the bay has no front plaster. Rasterize the plaster plane.
const isPlaster = (v) => { const [, , cz] = cen(v); return nrm(v)[2] > 0.8 && cz > -0.712 && cz < -0.675; };
const G = { x0: -0.34, x1: 0.46, y0: -0.26, y1: 0.66, d: 0.0025 };
const gw = Math.ceil((G.x1 - G.x0) / G.d), gh = Math.ceil((G.y1 - G.y0) / G.d);
const plaster = new Uint8Array(gw * gh);
for (let t = 0; t < I.length; t += 3) {
  const v = tri(t);
  if (!isPlaster(v)) continue;
  const xs = v.map((i) => P[i * 3]), ys = v.map((i) => P[i * 3 + 1]);
  const minx = Math.max(0, Math.floor((Math.min(...xs) - G.x0) / G.d)), maxx = Math.min(gw - 1, Math.ceil((Math.max(...xs) - G.x0) / G.d));
  const miny = Math.max(0, Math.floor((Math.min(...ys) - G.y0) / G.d)), maxy = Math.min(gh - 1, Math.ceil((Math.max(...ys) - G.y0) / G.d));
  const [ax, bx, cx] = xs, [ay, by, cy] = ys;
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(d) < 1e-14) continue;
  for (let gy = miny; gy <= maxy; gy++) for (let gx = minx; gx <= maxx; gx++) {
    const px = G.x0 + (gx + 0.5) * G.d, py = G.y0 + (gy + 0.5) * G.d;
    const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
    if (l1 >= -0.02 && l2 >= -0.02 && 1 - l1 - l2 >= -0.02) plaster[gy * gw + gx] = 1;
  }
}
/** Inside the window bay's opening (source coords), shrunk by `erode` cells so the new wall tucks behind the reveal. */
const inOpening = (x, y, erode = 1) => {
  if (!inWin(x, y, 0.11) || y < WIN.y0 - 0.05) return false;
  const gx = Math.floor((x - G.x0) / G.d), gy = Math.floor((y - G.y0) / G.d);
  for (let dy = -erode; dy <= erode; dy++) for (let dx = -erode; dx <= erode; dx++) {
    const xx = gx + dx, yy = gy + dy;
    if (xx < 0 || yy < 0 || xx >= gw || yy >= gh || plaster[yy * gw + xx]) return false;
  }
  return true;
};
const unstretchY = (y) => (y >= WIN.ys ? y : (WIN.y0 - 0.04) + (y - FLOOR) * (WIN.ys - (WIN.y0 - 0.04)) / (WIN.ys - FLOOR));

// 1. the original room, minus panes, outside faces and anything poking past the new walls
piece('room', (v) => {
  if (isPane(v) || isOutside(v)) return false;
  const [cx, cy, cz] = cen(v);
  const lim = cy < -0.4 ? 0.74 : ROOM.x - 0.012;
  return cx < lim && cz < (cy < -0.4 ? 0.74 : ROOM.z - 0.012);
}, ID);

const leftOutside = (v) => { const [cx, cy] = cen(v), n = nrm(v); return cx < -0.87 && n[0] < -0.5 && cy > -0.445; };
const PLASTER_OUT = -0.892;
const HOLE = 0.055; // wall hole margin around the aperture: inside the recess walls (which sit about 0.09 out) // the outside plaster plane of the left wall

// 2. +x wall: the left wall's plain outside face, moved in, with a hole for the window
const xWall = { p: (x, y, z) => [x + (ROOM.x - PLASTER_OUT), y, z], n: (x, y, z) => [x, y, z] };
piece('plainX', leftOutside, xWall, ([x, y, z]) => z > -0.73 && z < ROOM.z + 0.02 && !inWin(z - WIN_DZ, y, HOLE), ([x, y, z]) => inWin(z - WIN_DZ, y, HOLE + 0.03) && !inWin(z - WIN_DZ, y, HOLE - 0.03));

// 3. +x window: the back window bay (frame, mullions, recess, window seat) turned to face -x
const rotX = { p: (x, y, z) => [-z, y, x + WIN_DZ], n: (x, y, z) => [-z, y, x] };
piece('windowX', (v) => { const [cx, cy, cz] = cen(v); return !isPane(v) && !isPlaster(v) && cx > -0.24 && cx < 0.345 && cz < -0.5 && cz > -0.89 && cy > -0.44 && cy < 0.6 && (cz < -0.705 || cy < WIN.y0 - 0.02 || !inWin(cx, cy, 0.02) && inWin(cx, cy, 0.1)); }, rotX);

// 4. +x wall chart frames (and the lantern) from the left wall, turned around
const rot180 = (dz) => ({ p: (x, y, z) => [-x, y, -z + dz], n: (x, y, z) => [-x, y, -z] });
piece('framesX', (v) => { const [cx, cy, cz] = cen(v); return cx > -0.709 && cx < -0.665 && cz > 0.36 && cz < 0.87 && cy > -0.08 && cy < 0.62; }, rot180(FRAMES_DZ));

// 5. +z wall: the same plain face turned to face -z, with a hole for the door
const zWall = { p: (x, y, z) => [-z, y, x + (ROOM.z - PLASTER_OUT)], n: (x, y, z) => [-z, y, x] };
const doorHole = (x, y) => inWin(-(x - DOOR_DX), Math.max(unstretchY(y), WIN.y0), HOLE);
piece('plainZ', leftOutside, zWall, ([x, y, z]) => x > -0.73 && x < ROOM.x + 0.02 && !doorHole(x, y), ([x, y, z]) => { const sx = -(x - DOOR_DX), sy = Math.max(unstretchY(y), WIN.y0); return inWin(sx, sy, HOLE + 0.03) && !inWin(sx, sy, HOLE - 0.03); });

// 6. door frame: the window's frame, recess and sill (no mullions), stretched to the floor, turned around
const doorXf = { p: (x, y, z) => [-x + DOOR_DX, stretchY(y), -z + (ROOM.z - 0.695 - 0.012)], n: (x, y, z) => [-x, y, -z] };
piece('doorFrame', (v) => { const [cx, cy, cz] = cen(v); return inWin(cx, cy, 0.11) && !inWin(cx, cy, -0.004) && !isPlaster(v) && cz < -0.705 && cz > -0.87 && cy > WIN.y0 - 0.04 && cy < 0.6; }, doorXf);

// 7. door leaf: the carved outside shutter (and the sunburst in the arch), stretched the same way
const leafShift = DOOR_DX - WIN.x0 - WIN.x1;
const leafXf = { p: (x, y, z) => [x + leafShift, stretchY(y), z + (ROOM.z + 0.13 + 0.8545)], n: (x, y, z) => [x, y, z] };
piece('doorLeaf', (v) => isPane(v) && nrm(v)[2] < -0.5, leafXf);

// 8. the tall bookcase from the back wall, on the +z wall right of the door
piece('shelfZ', (v) => { const [cx, cy, cz] = cen(v); return cx > 0.345 && cx < 0.84 && cz > -0.69 && cz < -0.36 && cy > -0.44; }, rot180(SHELF_DX));

console.log(counts);

// Plaster backing and reveals, built flat. The Meshy walls were a cutaway, so their far ends are ragged and the copied
// window bay's right reveal was hidden by the bookcase; these fill every such hole with plain plaster just behind.
{
  let uv = [0.5, 0.5];
  for (let t = 0; t < I.length; t += 3) { const v = tri(t); const c = cen(v); if (leftOutside(v) && Math.abs(c[1] - 0.1) < 0.02 && Math.abs(c[2] - 0.3) < 0.02) { uv = [T[v[0] * 2], T[v[0] * 2 + 1]]; break; } }
  console.log('plaster uv', uv);
  const quad = (a, b, c, d, n) => { for (const p of [a, b, c, a, c, d]) { oP.push(...p); oN.push(...n); oT.push(...uv); } };
  const D = 0.0125, TOP = 0.72;
  // backing planes with the same holes (cells inside the hole are skipped)
  const backing = (map, n, u0, u1, hole, flip = false) => {
    for (let u = u0; u < u1 - 1e-9; u += D) for (let y = FLOOR; y < TOP - 1e-9; y += D) {
      if (hole(u + D / 2, y + D / 2)) continue;
      if (flip) quad(map(u, y + D), map(u + D, y + D), map(u + D, y), map(u, y), n);
      else quad(map(u, y), map(u + D, y), map(u + D, y + D), map(u, y + D), n);
    }
  };
  backing((z, y) => [ROOM.x + 0.008, y, z], [-1, 0, 0], -0.72, 0.72, (z, y) => inWin(z - WIN_DZ, y, HOLE));
  backing((x, y) => [x, y, ROOM.z + 0.008], [0, 0, -1], -0.72, 0.72, doorHole, true);
  // floor under the cutaway's ragged front edge: dark plank (uv sampled from the floor near the +x+z corner)
  { const keep = uv; uv = [0.8837, 0.8351]; for (let x = -0.72; x < 0.72 - 1e-9; x += 0.06) for (let z = -0.72; z < 0.72 - 1e-9; z += 0.06) quad([x, -0.447, z], [x, -0.447, z + 0.06], [x + 0.06, -0.447, z + 0.06], [x + 0.06, -0.447, z], [0, 1, 0]); quad([-0.54, -0.447, 0.72], [-0.54, -0.447, 0.86], [0.08, -0.447, 0.86], [0.08, -0.447, 0.72], [0, 1, 0]); uv = keep; }
  // the back wall's cutaway end behind the right bookcase
  backing((x, y) => [x, y, -0.704], [0, 0, 1], 0.3, 0.72, () => false);
  // the old left wall's cutaway front end (clear of the fireplace)
  backing((z, y) => [-0.723, y, z], [1, 0, 0], 0.35, 0.72, () => false, true);
  // reveal tubes around the openings, outline in aperture coords (sx, y) from bottom-left over the arch to bottom-right
  const outline = (yBot) => {
    const pts = [[WIN.x0 - HOLE, yBot], [WIN.x0 - HOLE, WIN.ys]];
    for (let i = 1; i < 32; i++) { const a = Math.PI * (1 - i / 32); pts.push([WCX + Math.cos(a) * (WRX + HOLE), WIN.ys + Math.sin(a) * (WRY + HOLE)]); }
    pts.push([WIN.x1 + HOLE, WIN.ys], [WIN.x1 + HOLE, yBot]);
    return pts;
  };
  const reveal = (pts, map, d0, d1) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      let nx = -(by - ay), ny = bx - ax; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      if (nx * (WCX - mx) + ny * (Math.min(my, WIN.ys) - my + (my > WIN.ys ? 0 : 0)) < 0 && my <= WIN.ys) { nx = -nx; ny = -ny; }
      if (my > WIN.ys && nx * (WCX - mx) + ny * (WIN.ys - my) < 0) { nx = -nx; ny = -ny; }
      const A = map(ax, ay, d0), B = map(bx, by, d0), C = map(bx, by, d1), Dd = map(ax, ay, d1);
      const n = map.n(nx, ny);
      quad(A, B, C, Dd, n);
    }
  };
  // window on +x: aperture (sx, y) at depth d -> [d, y, sx + WIN_DZ]
  const wMap = (sx, y, d) => [d, y, sx + WIN_DZ]; wMap.n = (nx, ny) => [0, ny, nx];
  reveal(outline(WIN.y0 - 0.03), wMap, 0.70, 0.86);
  // door on +z: aperture (sx, y) -> [DOOR_DX - sx, y, d], straight sides run to the floor
  const dMap = (sx, y, d) => [DOOR_DX - sx, y, d]; dMap.n = (nx, ny) => [-nx, ny, 0];
  reveal(outline(FLOOR), dMap, 0.70, ROOM.z + 0.13);
}

// door backing: a flat dark-wood arch right behind the leaf so its carved gaps never show the void
{
  // pick the uv of a dark shutter plank
  let uv = [0.5, 0.5];
  for (let t = 0; t < I.length; t += 3) { const v = tri(t); if (isPane(v) && nrm(v)[2] < -0.9) { uv = [T[v[0] * 2], T[v[0] * 2 + 1]]; break; } }
  const z = ROOM.z + 0.13 + 0.012;
  const pts = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) { const a = Math.PI * (i / steps); pts.push([WCX + Math.cos(a) * WRX, WIN.ys + Math.sin(a) * WRY]); }
  pts.push([WIN.x0, FLOOR], [WIN.x1, FLOOR]);
  const map = ([x, y]) => [-x + DOOR_DX, y, z];
  const c = map([WCX, (FLOOR + WIN.ys) / 2]);
  const ring = [[WIN.x1, FLOOR], ...pts.slice(0, steps + 1), [WIN.x0, FLOOR]].map(map);
  for (let i = 0; i < ring.length - 1; i++) {
    for (const p of [c, ring[i + 1], ring[i]]) { oP.push(...p); oN.push(0, 0, -1); oT.push(...uv); }
  }
  for (const p of [ring[ring.length - 1], ring[0], c]) { oP.push(...p); oN.push(0, 0, -1); oT.push(...uv); }
}

prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(oP)).setBuffer(prim.getAttribute('POSITION').getBuffer()));
prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(oN)).setBuffer(prim.getAttribute('POSITION').getBuffer()));
prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(oT)).setBuffer(prim.getAttribute('POSITION').getBuffer()));
const idx = new Uint32Array(oP.length / 3); for (let i = 0; i < idx.length; i++) idx[i] = i;
prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(prim.getAttribute('POSITION').getBuffer()));
console.log('assembled triangles', idx.length / 3);

if (!RAW) {
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.0008 }));
  const n = doc.getRoot().listMeshes()[0].listPrimitives()[0].getIndices().getCount() / 3;
  console.log('simplified triangles', n);
  await doc.transform(
    prune(), dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColor/, resize: [4096, 4096], quality: 88 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(normal|metallicRoughness)/, resize: [2048, 2048], quality: 90 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
} else {
  await doc.transform(weld());
}
await io.write(OUT, doc);
console.log('=>', OUT);
