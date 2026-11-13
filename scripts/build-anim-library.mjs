/**
 * Builds public/models/anim/ual.glb from Quaternius' Universal Animation Library (CC0, motion data only):
 * keeps the clips the game uses, drops the mannequin mesh and the finger tracks.
 * Usage: node scripts/build-anim-library.mjs <AnimationLibrary_Godot_Standard.gltf>
 */
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';

const KEEP = new Set([
  'A_TPose', 'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop',
  'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Hit_Chest', 'Hit_Head', 'Death01',
  'Punch_Jab', 'Punch_Cross', 'Spell_Simple_Shoot', 'Spell_Simple_Enter', 'Spell_Simple_Idle_Loop',
  'Sword_Attack', 'Pistol_Shoot', 'Roll', 'Idle_Talking_Loop',
]);
const DROP_NODE = /f_(index|middle|pinky|ring)|thumb/;

const io = new NodeIO();
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
for (const a of root.listAnimations()) {
  if (!KEEP.has(a.getName())) { a.dispose(); continue; }
  for (const ch of a.listChannels()) {
    const n = ch.getTargetNode();
    if (!n || DROP_NODE.test(n.getName()) || ch.getTargetPath() === 'scale') { const s = ch.getSampler(); ch.dispose(); s?.dispose(); }
  }
}
for (const m of root.listMeshes()) m.dispose();
for (const s of root.listSkins()) s.dispose();
for (const n of root.listNodes()) if (DROP_NODE.test(n.getName())) n.dispose();
await doc.transform(prune({ keepLeaves: true }), dedup());
await io.write('public/models/anim/ual.glb', doc);
console.log('clips:', root.listAnimations().map((a) => a.getName()).join(', '));
