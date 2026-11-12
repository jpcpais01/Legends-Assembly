export interface PatchNote {
  version: string;
  date: string; // ISO
  title: string;
  sections: { heading: string; items: string[] }[];
}

/** Player-facing patch notes. Newest first. Every merge to main adds an entry. */
export const PATCH_NOTES: PatchNote[] = [
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
