# Legends Assembly — Meshy prompts & asset sources

The game ships with procedural placeholder heroes (one draw call each). Drop in Meshy models and they
replace the placeholders automatically, keeping every VFX, hitbox and animation hook.

## Meshy workflow (do this for every hero)

1. **Image** – generate with the prompt below (any image model, or Meshy's Text to Image). Pick the
   cleanest result: full body, nothing cropped, arms clearly away from the body.
2. **Image to 3D** – Meshy settings that work best for us:
   - Topology: **Triangle**, target polycount **~25k–40k** (heroes) / **~5k–10k** (props)
   - Texture: **PBR on**, 2K is plenty
   - Symmetry: **Auto** for heroes
3. **Rig** (heroes only) – Meshy auto-rigging, humanoid. Then add animations:
   **Idle, Walking, Running, Attack (punch/throw/cast), Jump**. Clip names just need to contain
   those words; the game maps them automatically.
4. **Export GLB** (with animations) and send it here. File names: `einstein.glb`, `yeat.glb`, `vangogh.glb`.

> Tip: if an image has a shadow on the floor or a cropped foot, regenerate it. Meshy copies mistakes literally.

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

## Ability & arena prop prompts (optional upgrades)

Props use this suffix instead. (Ability effects such as the Gravity Well's dark-matter core, beams, domes and auras are shader effects in code, so they need no models.)

> single game prop, stylized 3D, hand-painted PBR, centered, front three-quarter view, plain pure white
> background, soft even studio lighting, no shadow, no text, isolated object

| File name | Used for | Prompt |
|---|---|---|
| `sunflower.glb` | Van Gogh · Sunflower Field | giant stylized sunflower, thick curved green stem with two big leaves, large flower head with glowing golden petals and a deep brown seed center, slightly tilted face + suffix |
| `palette.glb` | Van Gogh · held prop | wooden painter's palette with a thumb hole and thick colorful oil paint blobs (cobalt, chrome yellow, vermilion, viridian, white) + one long paint brush with blue paint + suffix |
| `golden_bell.glb` | Yeat · Bell Ring projectile / pendant | ornate polished golden hand bell, engraved swirling patterns, small clapper visible, glossy metal + suffix |
| `marble_statue.glb` | Arena centerpiece decor | broken ancient Greek marble statue of a thinker on a square pedestal, weathered cracks, missing one arm, moss in the crevices + suffix |
| `brazier.glb` | Arena braziers | ancient bronze tripod brazier, wide shallow bowl, green patina, ornate legs, empty (no fire) + suffix |
| `ruined_arch.glb` | Arena cover | ruined classical marble archway, two fluted columns and a cracked lintel, chunks missing, ivy climbing one side + suffix |

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
