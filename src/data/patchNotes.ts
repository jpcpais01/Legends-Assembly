export interface PatchNote {
  version: string;
  date: string; // ISO
  title: string;
  sections: { heading: string; items: string[] }[];
}

/** Player-facing patch notes. Newest first. Every merge to main adds an entry. */
export const PATCH_NOTES: PatchNote[] = [
  {
    version: '0.12.1',
    date: '2026-11-13',
    title: 'Horsepower',
    sections: [
      {
        heading: 'Yeat · Tonka',
        items: [
          'Tonka has all-new sound. The transform is a crisp run of ratchets and servos that slams shut with a heavy metal clunk.',
          'The engine now has two layers: a throaty V8 rumble while cruising that builds into a full-throttle roar as the truck hits top speed. No more chipmunk revving.',
          'Tires squeal when you throw the truck into a hard turn.',
          'Ramming someone lands a much heavier crunch.',
        ],
      },
    ],
  },
  {
    version: '0.12.0',
    date: '2026-11-13',
    title: 'Through the Window',
    sections: [
      {
        heading: 'The Giant’s Study',
        items: [
          'The study is now a real, fully sculpted room: towering bookcases with a ladder, a stone fireplace, a reading chair, a window seat piled with scrolls and a carved wooden door, all closed in under a beamed ceiling.',
          'A second arched window looks out from the side wall, and both windows have clear glass you can see the sky through.',
          'Late sun now pours in through the back window: a bright patch of light, criss-crossed by the window bars, falls across the desk and the floor.',
          'Real god rays: you can see the beams of light in the air, with dust drifting through them and glinting only where the sun catches it.',
          'The fireplace glows and flickers, and the chandelier now hangs from the ceiling on a long chain.',
          'The magnifying glass and the spectacles now have real see-through lenses.',
        ],
      },
    ],
  },
  {
    version: '0.11.0',
    date: '2026-11-13',
    title: 'Sound Check',
    sections: [
      {
        heading: 'All-new sound',
        items: [
          'Every sound in the game has been re-recorded: all nine abilities, hits, headshots, eliminations, footsteps, jumps, landings, pickups, respawns and the whole menu.',
          'Einstein’s photons zap, the Gravity Well now swirls and then implodes right on the pop, and E = mc² charges up before it detonates.',
          'Yeat’s bell riff hits with a real handbell and 808, Tonka roars and revs with speed, and The Bell tolls like a cathedral before it craters the ground.',
          'Van Gogh’s paint flicks and splats wetly, the sunflower bursts out of the earth, and The Starry Night shimmers over the arena.',
          'Footsteps match the floor: polished wood on the Giant’s Study desk, grass in the Ruins.',
          'Each arena now has its own ambience: rain, a ticking clock and a crackling fire in the Study, wind and birds in the Ruins.',
          'Rapid-fire sounds vary in pitch and level every shot, so nothing machine-guns.',
        ],
      },
      {
        heading: 'Announcer',
        items: [
          'An arena announcer calls the big moments: First Blood, Double, Triple, Quadra and Penta Eliminations, streaks (On a Streak, Rampage, Unstoppable, Legendary), Shutdown, Team Wipe, Fight, Victory and Defeat.',
          'Lock In a legend and the announcer calls “Legends… assemble!”.',
          'Multi-kills now count kills chained within 4.5 seconds, separately from your streak.',
        ],
      },
      {
        heading: 'HUD',
        items: [
          'Brand-new kill callouts: a hex badge slams in with a shockwave, the title wipes on with a light sweep, extra feats show as tags and your streak as a row of diamonds.',
          'Each feat has its own color, from gold doubles to a prismatic Penta.',
        ],
      },
    ],
  },
  {
    version: '0.10.4',
    date: '2026-11-13',
    title: 'Sand and Glass',
    sections: [
      {
        heading: 'The Giant’s Study',
        items: [
          'Thirteen more desk pieces are now fully sculpted: the hourglass, brush jar, melted candle, coin stack, gold-rimmed teacup, crimson scroll, scarlet tome, brass spectacles, magnifying glass, ruler, sealed letter, yellow pencils and an emerald quill.',
          'The hourglass has real glass you can see through, with sand piled in the bottom bulb and still draining from the top.',
          'Fixed a rare white screen when some sculpted props were in view.',
        ],
      },
    ],
  },
  {
    version: '0.10.3',
    date: '2026-11-13',
    title: 'First Editions',
    sections: [
      {
        heading: 'The Giant’s Study',
        items: [
          'A tall stack of gilt-spined antique books now leans on the desk’s back corner.',
          'The inkwell is a proper brass-and-glass piece with its white quill standing in it.',
        ],
      },
    ],
  },
  {
    version: '0.10.2',
    date: '2026-11-13',
    title: 'Sharper Toys',
    sections: [
      {
        heading: 'Yeat',
        items: [
          'Tonka and The Bell now use their full 2K textures, so the emerald truck and the rune-carved bell stay crisp right up close.',
          'Updated models can no longer get stuck behind an old copy saved on your device: if you ever saw the old yellow truck or plain gold bell, they are gone for good.',
        ],
      },
    ],
  },
  {
    version: '0.10.1',
    date: '2026-11-13',
    title: 'Sculpted Desk',
    sections: [
      {
        heading: 'The Giant’s Study',
        items: [
          'The desk props are getting fully sculpted, hand-painted models, and each one swaps in as it arrives.',
          'Stacked books now sit exactly on top of each other whatever their thickness, and the candle keeps its flickering flame.',
        ],
      },
    ],
  },
  {
    version: '0.10.0',
    date: '2026-11-13',
    title: 'Second Nature',
    sections: [
      {
        heading: 'Heroes rebuilt from the bones up',
        items: [
          'Every hero has a new skeleton, placed on their real shoulders, neck, hips and knees. Arms now hang naturally at the sides instead of sticking out.',
          'Faces no longer stretch or warp. Heads move as one solid piece, so Einstein keeps his face whatever he does.',
          'Shoulders, elbows, collars and coats bend much more cleanly, with new collarbones, an extra spine joint and toes.',
          'Heroes stand in a relaxed stance instead of a wide brace.',
        ],
      },
      {
        heading: 'Movement',
        items: [
          'Real strafing and diagonals: the hips turn into the direction of travel and the feet step where you are actually going, while the chest stays on your crosshair.',
          'A proper backpedal, upright and slightly leaning back, instead of a run played backwards.',
          'Walk, jog and sprint now match your real speed, so feet grip the ground instead of sliding.',
          'Feet stay planted while they carry weight. Turn on the spot and your hero takes real steps to follow.',
          'Heroes lean into acceleration, bank into strafes and settle when they stop.',
          'Jumps keep the arms in, and landings are softer when you are already running.',
          'Looking up and down bends the whole spine, and attacks follow it.',
        ],
      },
      {
        heading: 'Attacks and abilities',
        items: [
          'Every attack has a new hand-made motion that follows your crosshair and works at full sprint.',
          'Einstein jabs photons from alternating hands and winds up a real overhand throw for his gravity orb.',
          'Yeat cocks the bell by his head and snaps it at the target.',
          'Van Gogh slashes his brush stroke from high to low and lobs seeds with an underhand toss.',
          'New ultimate poses: Einstein floats with open arms and loose legs, and Vincent sweeps his arm up to paint the sky.',
          'Getting hit now makes heroes flinch on impact.',
        ],
      },
      {
        heading: 'Under the hood',
        items: [
          'The motion library is six times smaller, so the first load is quicker.',
          'Heroes only appear once their motion is ready, so they never flash a stiff pose.',
        ],
      },
    ],
  },
  {
    version: '0.9.2',
    date: '2026-11-13',
    title: 'Fresh Varnish',
    sections: [
      {
        heading: 'A new desk',
        items: [
          'The Giant’s Study desk is rebuilt from scratch: a varnished walnut top made of glued boards, with real wood grain, knots, pores and fine scratches that stay sharp right under your feet.',
          'The desk now has rounded edges, a moulded lip, drawers with brass knobs and turned legs reaching down to the floor.',
          'The old blurry clutter that was stuck to the desk is gone. Everything on it is now a separate, detailed prop.',
        ],
      },
      {
        heading: 'New things on the desk',
        items: [
          'Einstein’s relativity notes, Vincent’s letter to Theo with a sunflower sketch, and Yeat’s session sheet, all handwritten and curling at the corners.',
          'An inkwell with a goose quill, a fountain pen, pencils, a 30 cm ruler, paper clips and a stack of index cards.',
          'A magnifying glass, round spectacles, cloth hardcovers with gilt spines, a rolled map tied with ribbon and a sealed envelope.',
          'A porcelain teacup, a lit candle in a brass holder, a stack of coins, an hourglass and a jar of paint-loaded brushes.',
          'Coffee rings and an ink splatter where the giant got careless.',
        ],
      },
      {
        heading: 'Sharper study',
        items: [
          'The bookshelves around the room are now filled with real books of every size, some leaning and some stacked, instead of a flat picture.',
          'The coffee mug, desk lamp, chess pieces, eraser and crumpled paper use twice the texture detail.',
          'The arena downloads faster too: the desk is built in code instead of a large model.',
        ],
      },
    ],
  },
  {
    version: '0.9.1',
    date: '2026-11-13',
    title: 'Locked In',
    sections: [
      {
        heading: 'Fullscreen and mouse',
        items: [
          'Matches now open in fullscreen the moment you hit Lock In, with the mouse captured right away. You can turn this off in Settings, Controls.',
          'Esc opens the pause menu without kicking you out of fullscreen. Hold Esc if you want to leave fullscreen.',
          'The mouse now uses raw input where your browser supports it, so turning matches your hand exactly with no OS acceleration.',
          'Fixed sudden camera jerks right after the mouse gets captured or recaptured.',
          'If the mouse ever gets released mid-match (alt-tab, a browser popup), the game pauses cleanly instead of leaving a stray cursor. Click anywhere on the arena to jump back in.',
          'The cursor stays hidden over the arena for the whole match.',
        ],
      },
    ],
  },
  {
    version: '0.9.0',
    date: '2026-11-13',
    title: 'Real Motion',
    sections: [
      {
        heading: 'Motion capture',
        items: [
          'Every hero now moves with real motion capture from human actors, fitted to each hero’s own body and proportions.',
          'Walking, jogging and sprinting blend smoothly with speed, and the stride matches how fast you move, so feet plant on the ground instead of sliding.',
          'Strafing turns the hips into the run while the shoulders stay on target, and backpedaling steps backwards for real.',
          'Jumps push off and tuck in the air, landings absorb the drop (lighter when you land running), and turning on the spot takes small steps.',
          'Attacks are real throws, swings, jabs and casts on the upper body while the legs keep running, with either hand, and the striking arm reaches straight down your crosshair.',
          'Taking damage makes heroes flinch from the hit, and eliminations play a proper fall.',
        ],
      },
      {
        heading: 'Credits',
        items: ['Motion capture from the Universal Animation Library by Quaternius (CC0).'],
      },
    ],
  },
  {
    version: '0.8.1',
    date: '2026-11-13',
    title: 'Clean Slate',
    sections: [
      {
        heading: 'Cleaner menus',
        items: [
          'The home screen is now one clear column: pick a mode, hit Play, and set bot skill and arena right below. Nothing overlaps anymore, on any screen size.',
          'Removed the extra cards and the clock from the home screen. What’s New now lives in a small link at the bottom left.',
          'Hero select keeps your legend’s info, the roster and Lock In in their own spaces, so the ability list never runs into the roster.',
          'How to Play drops the keyboard picture and keeps one simple list of controls.',
          'Smaller laptops and short windows get compact layouts for every menu, the pause screen and the match results.',
          'Fixed the tab highlight sometimes looking too wide when the menu first opened.',
        ],
      },
    ],
  },
  {
    version: '0.8.0',
    date: '2026-11-12',
    title: 'Feel Every Hit',
    sections: [
      {
        heading: 'Every hit lands',
        items: [
          'Big hits now freeze the action for a split second, so heavy blows, rams and eliminations land with real weight.',
          'Every hit throws a bright impact flare and sparks in the attacker’s color, and headshots burst with a golden star.',
          'Huge moments bend the screen itself: shockwaves ripple through the air, colors split and the view punches in on blasts, slams and eliminations.',
          'Damage numbers from rapid hits on the same target now stack into one growing number, and big hits show bigger numbers.',
          'Your crosshair blooms when you fire, the hitmarker grows with the damage you deal, and eliminations flash the edges of the screen.',
          'Taking a heavy hit flashes the screen red and knocks the colors out of alignment for a moment.',
        ],
      },
      {
        heading: 'Albert Einstein',
        items: [
          'Photon Burst fires flickering light tracers with a muzzle flare, and every fifth photon is a bright quantum.',
          'Gravity Well now warps space around it: the world bends into a ring around the singularity, twin jets blast out of its poles, enemies caught in it are torn into streaks of light, and it implodes with a flash.',
          'E = mc² draws two rune circles under Einstein, pulls in energy from all around and grows a small sun in his hands before it goes off.',
          'The blast whites out the screen, sends a shockwave through the air and leaves cracked, scorched ground with drifting embers and a rising smoke column.',
        ],
      },
      {
        heading: 'Yeat',
        items: [
          'Bell Ring throws music notes off the bell with every shot, and the center ring leaves a golden streak.',
          'The Tonka has glowing headlights and red tail-light streaks, leaves skid marks in hard turns, and the screen blurs with speed as it accelerates.',
          'Ramming someone is now a comic-book smash, with stars, flying toy plastic and a wall of dust.',
          'The Bell locks a rune circle onto its target that tightens as it commits, sheds green embers, and its toll ripples through the air.',
          'When it lands it cracks the ground into a crater and throws rock and dust everywhere.',
        ],
      },
      {
        heading: 'Vincent van Gogh',
        items: [
          'Impasto Shot leaves a real brushstroke trail through the air and splashes into flying strokes of paint.',
          'The Sunflower Field is painted onto the ground in thick brushstrokes, the flower glows like a small sun, and golden motes drift to every ally it heals.',
          'The Starry Night paints a swirl of strokes across the floor, brushstrokes ride the wind inside the dome, and shooting stars now streak down with real trails.',
        ],
      },
      {
        heading: 'Everywhere else',
        items: [
          'Eliminations release a rising column of light, a rune circle and the legend’s light drifting away as stars.',
          'Respawns arrive in a beam of light, and health packs lift you up in a column of healing crosses.',
          'Healing shows rising green crosses, slowed legends shed frosty sparkles, and a legend with a ready special glows at their feet.',
          'Footsteps, jumps and landings kick up dust, and big falls send out a dust ring.',
          'Each special starts with a flare, a rune circle and a pillar of light in the legend’s color.',
          'Fixed: shockwave rings, paint stains and other effects on the floor were invisible from above. They now show up everywhere they should.',
          'New settings under Interface: Screen effects and Camera shake can each be turned off.',
        ],
      },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-11-12',
    title: 'Fighting Form',
    sections: [
      {
        heading: 'Attacks you can feel',
        items: [
          'Every attack is now a full-body move with a wind-up, a strike and a follow-through, instead of an arm snapping straight out.',
          "Einstein fires photons with quick alternating palm thrusts and hurls his gravity orb overhand from behind his head.",
          'Yeat raises his golden bell high, snaps it down and shakes it out with every ring.',
          'Van Gogh slashes paint in sweeping brush strokes and lobs his sunflower seeds underhand.',
          'The chest, hips and knees drive each strike, and the head stays locked on the target.',
        ],
      },
      {
        heading: 'More natural movement',
        items: [
          'Legends shift their weight over the planted foot as they walk, and their hips sway with it.',
          'Direction changes ripple up the spine instead of turning the whole body at once.',
          'Arms swing with relaxed elbows that bend as they come forward, and hands drift toward the middle when sprinting.',
          'Starting and stopping leans harder into the change of speed.',
          'Each legend moves like themselves: Yeat bounces with a swagger, Einstein keeps a scholarly hunch and Van Gogh tilts his head like he is sizing up a canvas.',
        ],
      },
    ],
  },
  {
    version: '0.6.1',
    date: '2026-11-12',
    title: 'Steady Cam',
    sections: [
      {
        heading: 'Camera',
        items: [
          "The camera no longer clips through walls or book stacks when your back is against them. It now checks a whole lens-sized area instead of a single line, so corners can't sneak into view.",
          'Backing along a wall is smooth: the camera tucks in instantly when something gets in the way and glides back out instead of popping.',
          'Hugging a wall on your right side now slides the over-the-shoulder view inward instead of pushing the camera into the wall.',
          'If the camera ends up right behind your head, your legend steps out of view so you can still see the fight.',
          'Shots fired while the camera is squeezed in against a wall now start from your legend, not from past them.',
          'The camera snaps cleanly into place when you spawn and respawn.',
        ],
      },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-11-12',
    title: "The Giant's Study",
    sections: [
      {
        heading: 'New arena',
        items: [
          "The Giant's Study: fight on top of a scholar's desk the size of a field, shrunk to the height of a pencil.",
          'Climb around towering book stacks, duck behind a coffee mug, a chess set and a chunky eraser, and fight over open pages and scattered paper.',
          'The study is alive: the pocket watch ticks, the globe turns, the metronome swings and the chandelier sways overhead.',
          'Sunset pours in through a tall arched window while the fireplace flickers on the far wall.',
          "Pick your arena on the home screen, next to Bot skill. The Giant's Study is the new default and the Sunset Ruins are still there.",
        ],
      },
      {
        heading: 'Yeat',
        items: [
          'The Tonka is now a green-and-gold monster truck whose wheels actually roll.',
          'Yeat carries a golden hand bell that swings and rings with every shot.',
          'The Bell got its new futuristic look.',
        ],
      },
      {
        heading: 'Bots',
        items: ['Bots find their way around obstacles instead of walking into walls.'],
      },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-11-12',
    title: 'Legends Find Their Voice',
    sections: [
      {
        heading: 'All-new sound',
        items: [
          'Every sound in the game has been redesigned from scratch with richer, layered audio: punchier hits, deeper explosions and real space around every sound.',
          'Sounds now live in the arena: distant fights get softer, more muffled and more echoey, and everything pans with your camera.',
          'Footsteps for every legend, paced by their real speed, plus jump and landing sounds. Bigger falls land harder.',
          'The music sinks under a dark, muffled filter while The Bell darkens the sky, and the mix ducks around big moments so they hit harder.',
          'Pausing now hushes the battlefield.',
        ],
      },
      {
        heading: 'Ability sounds',
        items: [
          'Einstein: Photon Burst zaps and crackles on impact, Gravity Well inhales, spins up, swallows sparks and collapses with a boom, and E = mc² screams up to a blast with a golden ringing tail.',
          'Yeat: Bell Ring is now a rage bell with a distorted 808, and firing in a row plays a dark riff. Tonka ratchets, clanks, honks its air horn, and its engine revs higher the faster you drive. Ramming lands with a metal crunch and a huge 808.',
          'Yeat: The Bell rolls in with thunder, wind and a backwards toll, rings out with a colossal bronze toll, whistles as it falls, and lands with a cracked clang and an earthquake rumble.',
          'Van Gogh: Impasto Shot flicks wet paint that splats and drips, the sunflower bursts from the earth with a harp glissando, and The Starry Night swirls around you with twinkling glass. Shooting stars now whoosh and chime when they strike.',
        ],
      },
      {
        heading: 'Voice lines',
        items: [
          'Legends now talk: match openers, ability callouts, eliminations, multi-kills, low-health calls, respawns, victory and defeat.',
          'Ult callouts: hear an enemy Yeat shout "The Bell tolls for you!" and you know to move.',
          'Rival banter: when two legends meet at the start of a match, they trade lines.',
          'New subtitles show who is talking, colored for you, allies and enemies, plus a Voice lines volume slider and a Subtitles toggle in Settings.',
        ],
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-11-12',
    title: 'Center Stage',
    sections: [
      {
        heading: 'All-new menus',
        items: [
          'A brand-new console-style home screen: mode tiles across the top, a big Play button, your legend on the dais and a live clock. Switch tabs with Q and E, pick modes with the arrow keys and press Enter to play.',
          'New hero select. Your legend steps up close while their role, stats, difficulty and full kit fill the screen. Flip through the roster with A and D, then Lock In with a cinematic stamp.',
          'Redesigned Settings with Graphics, Controls, Audio, Interface and Profile pages, quality cards and smooth sliders.',
          'New Learn page with a visual control map, fundamentals and tips for the legend you play. Patch notes now live in a News tab.',
          'New pause menu with your live match stats and kit, plus a two-step Leave so you never quit by accident.',
          'New end-of-match screen: a dramatic Victory or Defeat reveal, an MVP spotlight, your personal stats counting up, full team breakdowns, and one-click Play again or Change legend.',
        ],
      },
      {
        heading: 'All-new HUD',
        items: [
          'Bigger, cleaner health readout with a damage trail, heal flash and a low-health pulse.',
          'Skewed ability slots with names, cooldown sweeps and a flash when your ability is ready. The special ring spins and glows the screen edges when it is charged.',
          'New scoreboard bar with team portraits, respawn timers and progress toward the win target.',
          'Kill feed with hero portraits, an elimination and assist ticker under your crosshair, and a death card that shows who took you out and when you respawn.',
          'Match intro card and a ring countdown before every fight. Hold Tab for a redesigned scoreboard.',
          'New Interface settings: HUD scale, crosshair color and a damage numbers toggle.',
          'The HUD only updates what changed each frame, which keeps it light on the CPU.',
        ],
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-11-12',
    title: 'Living Motion',
    sections: [
      {
        heading: 'Movement feel',
        items: [
          'All-new character motion. Feet now plant on the ground and stride with your real speed, so legends no longer skate.',
          'Running looks like running: arms pump, the pelvis and shoulders counter-twist, and the body bobs and leans with your pace.',
          'Strafing and backpedaling turn the hips toward where you are going while the chest keeps aiming at your target.',
          'Legends lean into acceleration, bank into turns and rock forward when they stop suddenly.',
          'Turning on the spot keeps your feet planted, then takes a quick step to catch up.',
        ],
      },
      {
        heading: 'Weight and impact',
        items: [
          'Jumps have a real arc: a tucked knee on the way up, legs reaching for the ground on the way down, and a squash when you land. Bigger falls land harder.',
          'Taking a hit makes your legend flinch.',
          'Attacks drive from the chest, so shots and punches have more snap.',
          'Defeated legends now buckle at the knees and topple under gravity instead of tipping over stiffly.',
          'Idle legends hold a combat stance, shift their weight and breathe.',
        ],
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-11-12',
    title: 'Legends Take Shape',
    sections: [
      {
        heading: 'Sculpted legends',
        items: [
          'Einstein, Yeat and Van Gogh now have fully sculpted, hand-textured bodies, from the cardigan and wild hair to the puffer and chains to the straw hat and paint-stained coat.',
          'Van Gogh carries his painter\'s palette into battle.',
          'Van Gogh\'s Sunflower Field now blooms a giant hand-painted sunflower.',
        ],
      },
      {
        heading: 'Yeat rework',
        items: [
          'New RMB, Tonka: Yeat turns into a speeding toy truck that keeps accelerating but turns wide. Ram an enemy for up to 140 damage. The camera pulls back while you drive.',
          'New SHIFT, The Bell: the sky turns dark and green as a colossal bell appears above your target. It tolls once, then crashes down for up to 230 damage. It tracks the target for a moment, so a sharp dodge can still escape.',
          'Rage Dash and 2093 Mode have been retired.',
        ],
      },
      {
        heading: 'Arena',
        items: [
          'Marble thinker statues now guard the four lanes into the central dais.',
          'Bronze cauldrons replace the old braziers.',
          'Ivy-covered ruined arches add cover on the north and south lanes and ring the arena\'s rim.',
        ],
      },
    ],
  },
  {
    version: '0.1.1',
    date: '2026-11-12',
    title: 'Sculpted Legends Prep',
    sections: [
      {
        heading: 'Under the hood',
        items: [
          'Groundwork for the fully sculpted hero models: legends can now wear detailed, textured bodies that use the same walk, aim, cast and ultimate animations as today.',
          'Hero models are trimmed and compressed for fast downloads and smooth frame rates, even with ten legends on screen in Assembly War.',
        ],
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-11-12',
    title: 'The Assembly Begins',
    sections: [
      {
        heading: 'New legends',
        items: [
          'Albert Einstein, The Theorist (Duelist): Photon Burst, Gravity Well, and the reality-bending E = mc² special.',
          'Yeat, The Rage Icon (Vanguard): Bell Ring sound blasts, Rage Dash, and the 2093 Mode transformation with pulsing bass drops.',
          'Vincent van Gogh, The Dreamer (Strategist): Impasto Shot paint globs, healing Sunflower Field, and The Starry Night sky dome.',
        ],
      },
      {
        heading: 'Modes',
        items: [
          '1v1 Duel, 2v2 Skirmish, 3v3 Clash and 5v5 Assembly War, with bot teammates and opponents (Easy, Normal and Hard).',
          'First team to the elimination target wins. If time runs out on a tie, it goes to sudden-death overtime.',
          'Four health pads around the arena restore 150 HP and respawn after 12 seconds.',
        ],
      },
      {
        heading: 'Arena: Sunset Ruins',
        items: [
          'A golden-hour island of marble ruins with a glowing central sigil, a lake that reflects the sky, and swaying grass that parts as heroes walk through it.',
          'Cypress groves, braziers, team banners and gates, drifting dust motes, and distant mountains fading into the haze.',
        ],
      },
      {
        heading: 'Feel and polish',
        items: [
          'Headshots deal 50% bonus damage, with hit markers, critical damage numbers and kill confirmations.',
          'Damage direction indicators, kill feed, elimination streak callouts, a live scoreboard (hold Tab) and an end-of-match MVP.',
          'Every sound is synthesized live, including Yeat’s bells, Einstein’s photon zaps and Van Gogh’s paint splats.',
          'Installable as an app (PWA), with auto-detected graphics quality and dynamic resolution to keep frame rates high.',
        ],
      },
    ],
  },
];
