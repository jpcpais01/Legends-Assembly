#!/usr/bin/env node
/**
 * Meshy paints lenses as flat white. Split those triangles (bright, colorless texels) into their own primitive with a
 * material named "glass"; loadTemplate hands them back as `glass` so the game can render real glass.
 * Usage: node scripts/split-lens-glass.mjs magnifying_glass spectacles   (models-src/raw/<name>.glb -> models-src/study/)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const arg of process.argv.slice(2)) {
  // name:disc = one round lens: also take everything inside its rim (Meshy paints the lens's far side like the frame)
  const [name, mode] = arg.split(':');
  const doc = await io.read(`models-src/raw/${name}.glb`);
  const mesh = doc.getRoot().listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const T = prim.getAttribute('TEXCOORD_0').getArray(), I = prim.getIndices().getArray();
  const tex = prim.getMaterial().getBaseColorTexture();
  const img = sharp(Buffer.from(tex.getImage()));
  const { width: W, height: H, channels: C } = await img.metadata();
  const raw = await img.raw().toBuffer();
  const texel = (u, v) => { const x = Math.min(W - 1, Math.max(0, Math.floor(u * W))), y = Math.min(H - 1, Math.max(0, Math.floor(v * H))); const o = (y * W + x) * C; return [raw[o], raw[o + 1], raw[o + 2]]; };
  const lensy = (u, v) => { const [r, g, b] = texel(u, v); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx > 150 && (mx - mn) / mx < 0.25 && b >= r - 8; };
  const keep = [], glass = [];
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]];
    const uv = v.map((i) => [T[i * 2], T[i * 2 + 1]]);
    const cu = (uv[0][0] + uv[1][0] + uv[2][0]) / 3, cv = (uv[0][1] + uv[1][1] + uv[2][1]) / 3;
    (lensy(cu, cv) ? glass : keep).push(...v);
  }
  if (mode === 'disc' && glass.length) {
    const P = prim.getAttribute('POSITION').getArray(), N = prim.getAttribute('NORMAL').getArray();
    const c = [0, 0, 0], n = [0, 0, 0];
    for (const i of glass) for (let k = 0; k < 3; k++) { c[k] += P[i * 3 + k] / glass.length; }
    for (let t = 0; t < glass.length; t += 3) { const i = glass[t], s = N[i * 3 + 1] >= 0 ? 1 : -1; for (let k = 0; k < 3; k++) n[k] += s * N[i * 3 + k]; }
    const nl = Math.hypot(...n); for (let k = 0; k < 3; k++) n[k] /= nl;
    const rel = (i) => { const d = [0, 1, 2].map((k) => P[i * 3 + k] - c[k]); const h = d[0] * n[0] + d[1] * n[1] + d[2] * n[2]; return { h, r: Math.hypot(d[0] - h * n[0], d[1] - h * n[1], d[2] - h * n[2]) }; };
    let rmax = 0; for (const i of glass) rmax = Math.max(rmax, rel(i).r);
    const rest = keep.splice(0);
    for (let t = 0; t < rest.length; t += 3) {
      const v = rest.slice(t, t + 3);
      (v.every((i) => { const q = rel(i); return q.r < rmax * 0.97 && Math.abs(q.h) < rmax * 0.25; }) ? glass : keep).push(...v);
    }
    console.log(name, 'disc radius', rmax.toFixed(3), 'normal', n.map((v) => v.toFixed(2)).join(','));
  }
  console.log(name, 'triangles', I.length / 3, 'glass', glass.length / 3);
  prim.getIndices().setArray(new Uint32Array(keep));
  const gp = doc.createPrimitive()
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(glass)).setBuffer(prim.getIndices().getBuffer()))
    .setMaterial(doc.createMaterial('glass').setBaseColorFactor([1, 1, 1, 0.1]).setAlphaMode('BLEND').setRoughnessFactor(0.05));
  for (const s of prim.listSemantics()) gp.setAttribute(s, prim.getAttribute(s));
  mesh.addPrimitive(gp);
  await io.write(`models-src/study/${name}.glb`, doc);
}
