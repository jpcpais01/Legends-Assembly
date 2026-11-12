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
Put a rigged GLB at `public/models/heroes/<hero>.glb` and set `modelUrl: '/models/heroes/<hero>.glb'`
in `src/heroes/<hero>.ts`. The loader normalizes scale to 1.8 m, plants the feet and maps clips named
idle / walk / run / attack / jump. The procedural rig shows until the GLB finishes loading.

## Patch notes

Player-facing notes live in `src/data/patchNotes.ts` and show in the in-game **Patch notes** menu.
Every merge to `main` adds an entry.
