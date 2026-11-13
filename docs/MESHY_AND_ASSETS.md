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
Einstein, Yeat and Van Gogh are in. Props in: sunflower, palette, thinker statue, bronze cauldron and ivy ruins.

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

### Arena dressing (Sunset Ruins)
| File name | Used for | Prompt |
|---|---|---|
| `fallen_column.glb` | cover | toppled fluted white marble Greek column broken into three chunky drum segments lying on the ground, cracked edges, moss and small flowers in the cracks + suffix |
| `ruined_wall.glb` | cover | waist-high crumbling ancient stone wall segment, irregular sandstone blocks, one broken end, ivy draping over the top, tufts of grass at the base + suffix |
| `healing_altar.glb` | health pads | low round ancient marble altar with a shallow carved basin on top, laurel-leaf reliefs around the side, four small steps, gold inlay lines + suffix |
| `spawn_gate.glb` | team spawn gates | grand ancient marble triumphal gateway, two tall fluted columns, heavy carved lintel with an empty round crest in the middle, cloth banner hooks, slightly weathered + suffix |
| `amphora_cluster.glb` | decor | cluster of four ancient terracotta amphorae and clay pots of different sizes, one tipped over and cracked, black-figure painted patterns + suffix |
| `muse_statue.glb` | decor | weathered marble statue of a Greek muse in flowing robes holding a lyre, on a square plinth, cracked, missing one hand, moss at the feet + suffix |
| `olive_tree.glb` | decor trees | gnarled ancient olive tree, twisted thick trunk, silver-green rounded leaf canopy, stylized hand-painted look + suffix |
| `boulder_set.glb` | cover rocks | three mossy weathered granite boulders of different sizes grouped together, rounded stylized shapes + suffix |

### Whole arena (experiment)
Meshy builds one object, so a whole arena comes out as a single low-detail mesh with no clean collision. I'll use it as the **distant backdrop ring** around the playable area, which is where it will look best:

> top-down three-quarter view of a circular ruined ancient Greek colosseum arena on a grassy hill, crumbling
> tiered marble seating rings, broken columns and arches around the rim, cypress trees, golden sunset light,
> stylized hand-painted game environment, plain pure white background, isolated diorama, no text

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

Recommended picks for the Sunset Ruins arena: Quaternius MegaKit trees + rocks for the outer forest,
Poly Haven "rock_moss_set" / "boulder" models for cover, and an ambientCG marble set for columns.
Download the GLB/GLTF zips and send them; the engine instancing is already in place.

## Meshy references
- Image to 3D guide: https://docs.meshy.ai/en/webapp/image-to-3d
- Auto-rigging: https://docs.meshy.ai/webapp/guides/3d-model/rigging
- Animate: https://docs.meshy.ai/en/webapp/guides/animate


## Giant's Study desk props

The desk is built in code. Every prop on it is a Meshy model, listed in `StudyArena.handProps()` with its real size in centimeters. Until a model arrives, a hand-built stand-in from `src/world/studyProps.ts` takes its place.

To drop a model in: put the raw GLB in `models-src/study/<name>.glb`, run `npm run models:study` (2K WebP, no decimation), and the game picks it up by filename. Then add or bump its entry in `DROP_VER` in `src/world/StudyArena.ts`, because players' devices cache models by URL. Lying props are laid flat and turned to their long side automatically. Names: paper_einstein, letter_vangogh, music_sheet_yeat, index_cards, envelope_wax_seal, inkwell_quill, fountain_pen, pencil, ruler, paper_clip, magnifying_glass, spectacles, closed_book, antique_books, rolled_map, teacup_saucer, candle_holder, coin_stack, brush_jar, hourglass.
