# Legends Assembly

Legends of history and pop culture clash in fast, gorgeous 3D hero battles — right in the browser.
Einstein, Yeat and Van Gogh, 1v1 to 5v5, installable as an app.

**Stack:** Vite · TypeScript · Three.js (WebGL2) · pmndrs `postprocessing` · `vite-plugin-pwa` · deployed on Vercel from `main`.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

## Controls

WASD move · Space jump · Mouse aim · **LMB** basic attack · **RMB** ability · **Shift** special · Tab scoreboard · Esc pause

## How it stays fast

- Every hero is baked into **one rigidly skinned mesh** with per-vertex PBR → 1 draw call per hero.
- Static ruins are merged per material; trees, rocks, columns and grass are instanced.
- Grass, embers, dust motes, water, sky and fire are animated entirely on the GPU.
- All VFX run through two instanced particle systems (one additive, one alpha) → 2 draw calls.
- One half-float scene pass → one merged post pass (bloom, grade, ACES tonemap, vignette) → SMAA/FXAA.
- Auto-detected quality preset + dynamic resolution that tracks your display's refresh rate.
- All textures and sounds are procedural: zero texture/audio downloads.

## Adding Meshy models

See [`docs/MESHY_AND_ASSETS.md`](docs/MESHY_AND_ASSETS.md) for the image prompts and Meshy settings.
1. Drop the raw Meshy export (any size, rigged or not, A/T-pose) at `models-src/heroes/<hero>.glb`.
   This folder is git-ignored because raw exports are huge.
2. Run `npm run models`. It cuts triangles 10x with meshoptimizer (`--ratio 0.1`), keeping UVs and normals.
   It also shrinks textures to 2K WebP and meshopt-compresses the result into `public/models/heroes/<hero>.glb`.
3. Unrigged models are **auto-rigged** (`scripts/autorig.mjs`). The script scales the model to 1.8 m, turns it to face
   forward, finds the crotch, armpits, shoulders, neck and chin from cross-sections, and binds the mesh to a
   22-bone skeleton (spine, clavicles, arms, legs, toes). Skin weights follow distances measured through the body,
   and the head is bound rigidly so faces never stretch.
4. Set `modelUrl: '/models/heroes/<hero>.glb?v=1'` in `src/heroes/<hero>.ts`. Bump `?v=` whenever the file changes,
   because models are cached forever on players' devices.

`npm run rerig` rebuilds the skeleton and weights of the shipped hero GLBs in place (no raw export needed) after a
change to `scripts/autorig.mjs`. Per-hero landmark fixes go in `scripts/rig-overrides.json`.

## Hero motion

- `src/render/mocap.ts` retargets a small motion-capture library (`public/models/anim/ual.glb`, Quaternius' Universal
  Animation Library, CC0) onto each hero's proportions once at load. `scripts/build-anim-library.mjs` builds that
  file with only the clips the game plays.
- `src/render/MocapAnimator.ts` plays it: speed-matched walk, jog and sprint, strafes and backpedals made by turning
  the pelvis and swinging the strides, feet pinned to the ground with leg IK, steps when turning on the spot, lean
  and bank from acceleration, aim through the spine, jumps, hit flinches and deaths.
- Attacks and ultimates are hand-authored arm gestures (hand paths solved with arm IK along the crosshair), so they
  layer over any movement. Tune them in the `GESTURES` table.
- `dev/` holds the rig viewer and contact-sheet tools used to check all of this frame by frame
  (`npm run dev`, then open `/dev/rigview.html` or run `node dev/suite.mjs <outDir> <hero> <scenarios>`).

Props such as statues, cauldrons, ruins, the sunflower, the palette, `tonka_truck` and `giant_bell` go in `models-src/props/<name>.glb`.
Run `npm run models:props` to process them. Textures shrink to 1K WebP and props are never decimated. `src/render/props.ts` loads every prop at boot.
Anything missing keeps its procedural stand-in.

GLBs that were already rigged elsewhere also load. They are scaled to 1.8 m and their clips are mapped by name
(idle / walk / run / attack / jump). The procedural rig shows until the GLB finishes loading.

## Patch notes

Player-facing notes live in `src/data/patchNotes.ts` and show in the in-game **Patch notes** menu.
Every merge to `main` adds an entry.
