export interface PatchNote {
  version: string;
  date: string; // ISO
  title: string;
  sections: { heading: string; items: string[] }[];
}

/** Player-facing patch notes. Newest first. Every merge to main adds an entry. */
export const PATCH_NOTES: PatchNote[] = [
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
