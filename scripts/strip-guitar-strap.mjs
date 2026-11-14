#!/usr/bin/env node
/**
 * The Meshy Vintage Rasta Guitar comes with a loose leather strap flapping off its body. In game the strap is
 * drawn by code (it runs over Marley's shoulder, see guitarStrap in heroes/marley.ts), so cut the loose one out:
 * it is the guitar's largest connected piece. models-src/raw/marley_guitar.glb -> models-src/props/marley_guitar.glb,
 * then npm run models:props -- --only marley_guitar.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('models-src/raw/marley_guitar.glb');
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute('POSITION').getArray();
const I = prim.getIndices().getArray();
// weld by position, then union triangles into connected pieces
const n = P.length / 3, canon = new Map(), c = new Int32Array(n);
for (let i = 0; i < n; i++) { const k = `${P[i * 3].toFixed(5)},${P[i * 3 + 1].toFixed(5)},${P[i * 3 + 2].toFixed(5)}`; if (!canon.has(k)) canon.set(k, i); c[i] = canon.get(k); }
const par = Int32Array.from({ length: n }, (_, i) => i);
const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
for (let t = 0; t < I.length; t += 3) { const a = find(c[I[t]]); par[find(c[I[t + 1]])] = a; par[find(c[I[t + 2]])] = a; }
const count = new Map();
for (let t = 0; t < I.length; t += 3) { const r = find(c[I[t]]); count.set(r, (count.get(r) ?? 0) + 1); }
const strap = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
const keep = [];
for (let t = 0; t < I.length; t += 3) if (find(c[I[t]]) !== strap) keep.push(I[t], I[t + 1], I[t + 2]);
console.log('triangles', I.length / 3, '->', keep.length / 3);
prim.getIndices().setArray(new Uint32Array(keep));
await doc.transform(prune());
await io.write('models-src/props/marley_guitar.glb', doc);
