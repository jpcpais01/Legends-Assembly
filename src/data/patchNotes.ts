export interface PatchNote {
  version: string;
  date: string; // ISO
  title: string;
  sections: { heading: string; items: string[] }[];
}

/** Player-facing patch notes. Newest first. Every merge to main adds an entry. */
export const PATCH_NOTES: PatchNote[] = [
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
