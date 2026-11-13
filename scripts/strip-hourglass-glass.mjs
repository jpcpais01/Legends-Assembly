#!/usr/bin/env node
/**
 * The Meshy hourglass has its glass painted onto an opaque shell. Cut that shell out (everything inside the posts
 * between the two caps) so the game can put real glass and sand in its place (see hourglassGlass in studyProps.ts).
 * models-src/raw/hourglass.glb -> models-src/study/hourglass.glb, then npm run models:study.
 */
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('models-src/raw/hourglass.glb');
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute('POSITION').getArray();
const I = prim.getIndices().getArray();
const glass = (i) => Math.hypot(P[i * 3], P[i * 3 + 2]) < 0.172 && Math.abs(P[i * 3 + 1]) < 0.355;
const keep = [];
for (let t = 0; t < I.length; t += 3) if (!(glass(I[t]) && glass(I[t + 1]) && glass(I[t + 2]))) keep.push(I[t], I[t + 1], I[t + 2]);
console.log('triangles', I.length / 3, '->', keep.length / 3);
prim.getIndices().setArray(new Uint32Array(keep));
await doc.transform(prune());
const b = getBounds(doc.getRoot().listScenes()[0]);
console.log('bounds', b.min, b.max);
await io.write('models-src/study/hourglass.glb', doc);
