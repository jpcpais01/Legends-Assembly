# Legends Assembly — Meshy prompts & asset sources

The game ships with procedural placeholder heroes (one draw call each). Drop in Meshy models and they
replace the placeholders automatically, keeping every VFX, hitbox and animation hook.

## Meshy workflow

1. **Image**: generate it with the prompt below. Pick the cleanest result, with the full body visible, nothing cropped and the arms clearly away from the body.
2. **Image to 3D**: use **Meshy 7.1** with PBR on and **2K** textures. The polycount doesn't matter, because `npm run models` cuts it 10x.
3. **No rigging needed.** Export the **unrigged** GLB at any size. The pipeline scales the model, turns it to face forward and auto-rigs it onto the game skeleton.
4. Drop the GLB in the project chat.

> Tip: if an image has a shadow on the floor or a cropped foot, regenerate it. Meshy copies mistakes literally.

### Delivered so far
Einstein, Yeat and Van Gogh are in. Props in: sunflower, palette, Tonka truck and the bells.

---

## Hero image prompts

Shared style suffix (append to every hero prompt):

> stylized 3D hero game character, premium hand-painted PBR look, slightly exaggerated proportions
> (head 1/7 of height, large hands and feet), full body head to toe, front view, symmetrical **A-pose**
> with arms 45° away from the body, palms facing down, legs slightly apart, feet flat, neutral face with
> eyes open, mouth closed, **plain pure white background**, soft even studio lighting, no cast shadow,
> no floor, no text, nothing held in the hands, single character, centered, 8k, sharp details

### Albert Einstein — The Theorist
> Albert Einstein as a heroic elderly physicist, wild voluminous white hair, thick bushy white mustache,
> kind twinkling eyes, warm skin with subtle wrinkles, brown hand-knit wool cardigan with leather buttons
> over a crisp white collared shirt, loose grey wool trousers, scuffed brown leather oxford shoes, thin gold
> pocket-watch chain on the cardigan, faint glowing cyan equations embroidered along the cuffs + style suffix

### Yeat — The Rage Icon
> Yeat-inspired rapper hero, light skin, glossy black oversized quilted puffer jacket with high collar,
> red knit beanie, black wraparound designer sunglasses, two heavy gold Cuban link chains with a small
> golden bell pendant, baggy black cargo pants stacked over chunky white sneakers with red soles,
> gold rings, confident relaxed stance + style suffix

### Vincent van Gogh — The Dreamer
> Vincent van Gogh as a heroic painter, ginger-orange hair and short ginger beard, pale skin, green eyes,
> wide-brimmed woven straw hat with a navy band, white bandage wrapped around the head over one ear,
> prussian-blue long work coat with brass buttons, olive-brown trousers, worn brown boots,
> small dabs of colorful oil paint on the coat and hands + style suffix

---

## Prop prompts

Props use this suffix. (Ability effects such as the Gravity Well core, beams, domes, auras and blasts are shader code, so they need no models.)

> single game prop, stylized 3D, hand-painted PBR, centered, front three-quarter view, plain pure white
> background, soft even studio lighting, no shadow, no text, isolated object

### Yeat's new kit (needed now)
| File name | Used for | Prompt |
|---|---|---|
| `tonka_truck.glb` | Yeat · RMB **Tonka** | big chunky classic yellow steel toy dump truck, oversized black rubber tires with deep treads, tilted dump bed, chrome front bumper and grille, round headlights, black and yellow hazard stripes, a few scuffs and dents, side view three-quarter + suffix |
| `giant_bell.glb` | Yeat · Shift **The Bell** | colossal ancient bronze church bell hanging from a thick wooden yoke with iron straps, flared lip, engraved rings of runes around the waist, heavy iron clapper visible inside, green patina in the grooves, polished gold highlights + suffix |

---

## Free (CC0) arena & nature packs worth using

All of these are CC0 (free for commercial use, no attribution required) and export glTF/GLB that drops
straight into the engine as instanced meshes:

- **Quaternius — Stylized Nature MegaKit** (trees, bushes, rocks, flowers, grass): https://quaternius.com/packs/stylizednaturemegakit.html (also on itch: https://quaternius.itch.io/stylized-nature-megakit)
- **All Quaternius CC0 packs** (ruins, props, characters for reference): https://opengameart.org/content/all-cc0-uploader-quaternius
- **KayKit — Forest Nature Pack** by Kay Lousberg: https://kaylousberg.itch.io/kaykit-forest
- **Kenney — Nature Kit**: https://opengameart.org/content/nature-kit (and https://kenney.nl/assets)
- **Poly Haven** (photoreal CC0 rocks, ground textures, HDRIs): https://polyhaven.com
- **ambientCG** (CC0 PBR textures: marble, ground, bark): https://ambientcg.com


## Meshy references
- Image to 3D guide: https://docs.meshy.ai/en/webapp/image-to-3d
- Auto-rigging: https://docs.meshy.ai/webapp/guides/3d-model/rigging
- Animate: https://docs.meshy.ai/en/webapp/guides/animate


## Giant's Study desk props

The desk is built in code. Every prop on it is a Meshy model, listed in `StudyArena.handProps()` with its real size in centimeters. Until a model arrives, a hand-built stand-in from `src/world/studyProps.ts` takes its place.

To drop a model in: put the raw GLB in `models-src/study/<name>.glb`, run `npm run models:study` (2K WebP, no decimation), and the game picks it up by filename. Then add or bump its entry in `DROP_VER` in `src/world/StudyArena.ts`, because players' devices cache models by URL. The hourglass is special: put the raw file in `models-src/raw/hourglass.glb` and run `node scripts/strip-hourglass-glass.mjs` first, which cuts out the painted glass so the game can add real glass and sand. Lying props are laid flat and turned to their long side automatically. Names: paper_einstein, letter_vangogh, music_sheet_yeat, index_cards, envelope_wax_seal, inkwell_quill, fountain_pen, pencil, ruler, paper_clip, magnifying_glass, spectacles, closed_book, antique_books, emerald_quill, rolled_map, teacup_saucer, candle_holder, coin_stack, brush_jar, hourglass.

## Study room backdrop

The room around the desk is João's Meshy "Cartographer's study" (a two-wall cutaway). `npm run models:room` (scripts/build-study-room.mjs) reads `models-src/room/cartographer.glb`, removes the painted window glass, builds the two missing walls from the model's own pieces (a copy of the arched window on +x, the window frame stretched into a door with the carved shutter as its leaf on +z, plus a bookcase and chart frames), fills the cutaway's ragged edges with plaster and floor backing, simplifies it to about 510k triangles and writes `public/models/study/study_room.glb`. If you change it, bump the `?v=` on its URL in `StudyArena.loadRoomModel`.

Sunlight only enters through the windows. `src/world/studyLight.ts` holds one analytic test (window arch, recess and mullions, with a soft penumbra). It shades every lit material, drives the god-ray pass and lights the dust. If the window geometry changes, update the numbers there.

Painted lenses: `node scripts/split-lens-glass.mjs magnifying_glass:disc spectacles` (raw files in `models-src/raw/`) splits the lens triangles into a "glass" material, which the game renders as clear glass.

