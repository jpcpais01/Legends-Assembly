/**
 * Every generated sound in the game, with the ElevenLabs prompt that made it.
 *
 *   ELEVENLABS_API_KEY=... node scripts/sfx/generate.mjs [names...]   → sfx-src/<name>/take-N.mp3
 *   node scripts/sfx/build.mjs                                        → public/audio/sfx/<name>-N.ogg
 *
 * `takes` is how many candidates are generated; `keep` is how many end up in the game
 * (they become the runtime variants, picked without repeats and pitch-jittered).
 * `pick` (filled in after listening/analysis) lists the chosen take numbers in order.
 */
export const SFX = [
  // ── interface ──
  { name: 'ui', dur: 0.5, takes: 4, keep: 1, inf: 0.6, text: 'Clean modern console menu select click: a soft glassy tick with a tiny bright tonal blip, premium game UI, extremely short, dry, no reverb' },
  { name: 'uiHover', dur: 0.5, takes: 4, keep: 1, inf: 0.6, text: 'Extremely subtle soft UI hover tick, a tiny airy high click, premium console menu, very short and quiet, dry' },
  { name: 'uiTab', dur: 0.5, takes: 4, keep: 1, inf: 0.6, text: 'Soft quick UI swipe flicking upward for switching menu tabs: airy little whoosh with a light glassy tick, premium game interface, very short' },
  { name: 'uiBack', dur: 0.5, takes: 4, keep: 1, inf: 0.6, text: 'Soft UI back / cancel sound: quick falling swipe with a muted low tick, premium console menu, very short, dry' },
  { name: 'lockIn', dur: 1.8, takes: 4, keep: 1, inf: 0.5, text: 'Epic character lock-in confirmation for a hero select screen: fast rising airy whoosh into a bright shimmering metallic impact with a deep sub boom and a sparkling tail, triumphant, cinematic' },
  { name: 'denied', dur: 0.5, takes: 4, keep: 1, inf: 0.6, text: 'Short muted video game error buzz: two quick low descending soft blips, ability not ready, dry' },
  { name: 'countdown', dur: 1.0, takes: 4, keep: 1, inf: 0.6, text: 'Single match countdown tick for a competitive game: one deep tonal clock-like hit with a metallic ping and a short tail, tense' },
  { name: 'go', dur: 2.8, takes: 4, keep: 1, inf: 0.5, text: 'Match start impact for a hero shooter: a huge cinematic boom with a bright brassy metallic hit and a rising whoosh, energetic, big reverb tail, no voice' },
  { name: 'ultReady', dur: 2.0, takes: 4, keep: 1, inf: 0.5, text: 'Ultimate ability ready notification: magical rising shimmer of energy charging into a bright crystalline chime with a deep warm whoomp, hero shooter, exciting' },
  { name: 'victory', dur: 5, takes: 3, keep: 1, inf: 0.5, text: 'Short triumphant victory fanfare stinger: orchestral brass and timpani hit with a shimmering choir swell, video game match won' },
  { name: 'defeat', dur: 4.5, takes: 3, keep: 1, inf: 0.5, text: 'Somber defeat stinger: low dark orchestral swell with a fading cello and a soft distant gong, video game match lost' },

  // ── combat feedback ──
  { name: 'hit', dur: 0.5, takes: 5, keep: 3, inf: 0.6, text: 'Hitmarker sound for a hero shooter: a crisp, short, satisfying tick-thud confirming a hit, clean high click with a tiny punch, extremely short, dry' },
  { name: 'crit', dur: 0.6, takes: 4, keep: 1, inf: 0.6, text: 'Headshot critical hit confirm for a shooter: sharp bright metallic ding with a crunchy punch, very satisfying, short, dry' },
  { name: 'kill', dur: 1.2, takes: 4, keep: 1, inf: 0.6, text: 'Elimination confirm sound for a hero shooter: deep punchy thud with a bright resonant metallic chime ring and a short whoosh tail, rewarding, satisfying' },
  { name: 'hurt', dur: 0.5, takes: 5, keep: 3, inf: 0.6, text: 'Player taking damage: dull meaty body thump with a muffled low impact, short, no voice' },
  { name: 'heal', dur: 0.9, takes: 3, keep: 1, inf: 0.5, text: 'Gentle video game healing sound: warm soft magical sparkle chime rising with a soft airy whoosh, restorative' },
  { name: 'comm', dur: 0.6, takes: 3, keep: 1, inf: 0.6, text: 'Short eerie theremin glide blip, a tiny radio comm stinger, quiet', variant: 0 },
  { name: 'comm', dur: 0.6, takes: 3, keep: 1, inf: 0.6, text: 'A tiny bright handbell ding with a deep 808 sub hit, short stinger', variant: 1 },
  { name: 'comm', dur: 0.6, takes: 3, keep: 1, inf: 0.6, text: 'Two soft plucked harp notes, gentle short stinger', variant: 2 },

  // ── bodies & world ──
  { name: 'step', dur: 0.5, takes: 8, keep: 6, inf: 0.7, text: 'One single footstep of a small figure on a polished hardwood desk surface, light sneaker step, close mic, dry, one step only' },
  { name: 'stepGrass', dur: 0.5, takes: 8, keep: 6, inf: 0.7, text: 'One single footstep on soft grass over dirt, light sneaker, close mic, dry, one step only' },
  { name: 'jump', dur: 0.5, takes: 4, keep: 3, inf: 0.6, text: 'Character jump takeoff: quick cloth rustle and a light push-off whoosh, short, no voice' },
  { name: 'land', dur: 0.6, takes: 4, keep: 2, inf: 0.6, text: 'Character landing after a jump: soft heavy thud with cloth rustle and a little dust, short, no voice' },
  { name: 'death', dur: 2.0, takes: 4, keep: 1, inf: 0.5, text: 'Hero elimination: heavy impact turning into magical energy dissipating, glassy shattering sparkle rising away with a whoosh, no voice' },
  { name: 'respawn', dur: 1.8, takes: 3, keep: 1, inf: 0.5, text: 'Hero respawn teleport: magical rising shimmer and energy materializing with a soft bass whoomp, sci-fi fantasy' },
  { name: 'pickup', dur: 1.2, takes: 3, keep: 1, inf: 0.5, text: 'Health pack pickup in a video game: bright pleasant chime and a soft magical whoosh, rewarding' },

  // ── Einstein ──
  { name: 'photon', dur: 0.5, takes: 6, keep: 4, inf: 0.6, text: 'One rapid sci-fi energy blaster shot: a short bright laser pew of pure light, crisp zap with electric crackle, quick decay, one shot only' },
  { name: 'photonHit', dur: 0.5, takes: 4, keep: 3, inf: 0.6, text: 'Small energy bolt impact: short electric sizzle pop with tiny sparks, one hit only' },
  { name: 'gravityThrow', dur: 0.7, takes: 3, keep: 1, inf: 0.5, text: 'Throwing a humming orb of dark energy: deep warbling whoosh with a low electric hum, sci-fi' },
  { name: 'gravity', dur: 3.2, takes: 4, keep: 1, inf: 0.5, text: 'Black hole singularity forming: deep sucking vacuum inhale, swirling wind spinning faster and faster, distorted low hum, space warping, sci-fi, no explosion' },
  { name: 'gravityCollapse', dur: 1.2, takes: 4, keep: 1, inf: 0.5, text: 'Black hole implosion: everything sucked inward with a reversed whoosh, then a sharp deep implosive pop and a bass thump' },
  { name: 'emcCharge', dur: 1.3, takes: 4, keep: 1, inf: 0.5, text: 'Massive energy charging up: rising electric whine and humming power build, crackling energy swelling to a peak, sci-fi, ends abruptly' },
  { name: 'emcBlast', dur: 4.2, takes: 4, keep: 1, inf: 0.5, text: 'Colossal pure energy explosion: blinding blast with a deep sub boom, cracking shockwave, rumbling debris and a long rolling thunder tail, cinematic' },

  // ── Yeat ──
  { name: 'bell', dur: 1.2, takes: 5, keep: 1, inf: 0.6, text: 'One strike of a bright golden handbell layered with a hard punchy trap 808 bass hit, rage beat style, one hit only' },
  { name: 'bellHit', dur: 0.5, takes: 4, keep: 3, inf: 0.6, text: 'Small metallic ring impact: short tinny clink hit, a sound wave striking a target, one hit only' },
  { name: 'tonka', dur: 2.2, takes: 6, keep: 1, inf: 0.65, text: 'A toy robot transforming into a muscle truck: a fast burst of crisp mechanical clicks, ratchets and servo whirs, a heavy satisfying metal clunk as it locks into place, then a big V8 engine cranks and roars to life with an aggressive rev, punchy, close mic, no music' },
  { name: 'engineLoop', dur: 3, takes: 4, keep: 1, inf: 0.7, loop: true, text: 'Powerful V8 muscle truck engine cruising at steady mid revs, deep throaty rumble with exhaust burble, continuous, no gear changes, seamless loop, close mic' },
  { name: 'engineHigh', dur: 3, takes: 4, keep: 1, inf: 0.7, loop: true, text: 'V8 muscle truck engine screaming at full throttle, high aggressive revs with a raspy exhaust roar, continuous, no gear changes, seamless loop, close mic' },
  { name: 'skid', dur: 2, takes: 3, keep: 1, inf: 0.7, loop: true, text: 'Rubber tires screeching and skidding on a smooth floor during a hard turn, continuous squeal, seamless loop' },
  { name: 'crash', dur: 1.3, takes: 4, keep: 2, inf: 0.5, text: 'Metal toy truck crashing into a wall: crunchy metal impact with rattling parts and a heavy thud' },
  { name: 'ram', dur: 2.0, takes: 5, keep: 1, inf: 0.6, text: 'A speeding truck smashes into someone at full speed: a massive heavy crunching metal impact with a deep sub boom, shattering debris and rattling parts tumbling, brutal and punchy, cinematic, no music' },
  { name: 'bellSummon', dur: 2.9, takes: 3, keep: 1, inf: 0.5, text: 'The sky turns dark: ominous low drone rising, swirling howling wind, distant rumbling thunder and a reversed bell swelling up, dread, cinematic' },
  { name: 'bigBell', dur: 8, takes: 3, keep: 1, inf: 0.5, text: 'One colossal bronze cathedral bell toll: an enormous deep resonant strike with a long humming bloom and beating overtones, epic' },
  { name: 'bellWhistle', dur: 0.9, takes: 3, keep: 1, inf: 0.5, text: 'Huge heavy object falling fast from the sky: descending whistling whoosh, heavy' },
  { name: 'bellDrop', dur: 5, takes: 4, keep: 1, inf: 0.5, text: 'Giant bronze bell crashing into the ground from the sky: earth-shattering impact, deep sub boom, cracking ground, dissonant metallic clang, tumbling rubble and a long rumble' },

  // ── Van Gogh ──
  { name: 'paint', dur: 0.5, takes: 6, keep: 4, inf: 0.6, text: 'Flinging a thick glob of wet oil paint off a brush: quick wet flick whoosh with a liquid bloop, one throw only' },
  { name: 'splat', dur: 0.6, takes: 6, keep: 4, inf: 0.7, text: 'One loud juicy splat of a thick glob of wet paint slapping hard against a wall: a heavy wet squelching impact with a short spatter, close mic, one splat only' },
  { name: 'seedToss', dur: 0.6, takes: 3, keep: 1, inf: 0.5, text: 'Tossing a small magic seed: light quick throw whoosh with a tiny organic pop' },
  { name: 'bloom', dur: 2.8, takes: 4, keep: 1, inf: 0.5, text: 'Giant magical sunflower bursting out of the ground and blooming: earth cracking, leaves rustling and unfurling fast, warm magical harp glissando shimmer' },
  { name: 'starry', dur: 7.8, takes: 3, keep: 1, inf: 0.5, text: 'Swirling magical starry night sky forming: dreamy shimmering pads swirling in circles, twinkling glass chimes, low warm drone, soft wind, enchanting, no drums' },
  { name: 'starFall', dur: 1.0, takes: 4, keep: 3, inf: 0.5, text: 'Falling star impact: short descending magical whistle into a sparkling crystalline burst, fantasy' },

  // ── ambience ──
  { name: 'ambStudy', dur: 20, takes: 2, keep: 1, inf: 0.5, loop: true, text: 'Quiet cozy old study room ambience: soft room tone, slow ticking clock, gentle rain on a window, faint crackling fireplace, continuous, seamless loop' },
  { name: 'ambRuins', dur: 20, takes: 2, keep: 1, inf: 0.5, loop: true, text: 'Peaceful outdoor ancient ruins ambience: soft breeze through tall grass, distant birds, light wind, continuous, seamless loop' },
];

/** Announcer lines (ElevenLabs text to speech, premade voice "Brian", eleven_v3 with audio tags). */
export const ANNOUNCER_VOICE = 'nPczCjzI2devNBz1zQrb';
export const ANNOUNCER_TAKES = 3;
export const ANNOUNCER = [
  { name: 'firstBlood', text: '[excited] First blood!' },
  { name: 'double', text: '[excited] Double elimination!' },
  { name: 'triple', text: '[excited] Triple elimination!' },
  { name: 'quadra', text: '[excited] Quadra elimination!' },
  { name: 'penta', text: '[excited] PENTA ELIMINATION!' },
  { name: 'streak3', text: "[excited] You're on a streak!" },
  { name: 'streak5', text: '[excited] Rampage!' },
  { name: 'streak7', text: '[excited] Unstoppable!' },
  { name: 'streak10', text: '[excited] LEGENDARY!' },
  { name: 'shutdown', text: '[excited] Shut down!' },
  { name: 'teamWipe', text: '[excited] Team wipe!' },
  { name: 'assemble', text: '[dramatic] Legends... assemble!' },
  { name: 'three', text: '[serious] Three.' },
  { name: 'two', text: '[serious] Two.' },
  { name: 'one', text: '[serious] One.' },
  { name: 'fight', text: '[excited] FIGHT!' },
  { name: 'victory', text: '[excited] Victory!' },
  { name: 'defeat', text: '[serious] Defeat.' },
];

/**
 * The takes that made it into the game, in variant order (chosen from spectrogram contact
 * sheets and level/onset analysis of every take). Keys with a `.n` suffix are per-variant
 * sounds (comm = one stinger per hero).
 */
export const PICKS = {
  ui: [3], uiHover: [4], uiTab: [3], uiBack: [3], lockIn: [2], denied: [4], countdown: [3], go: [4], ultReady: [4],
  victory: [3], defeat: [1],
  hit: [4, 2], crit: [2], kill: [3], hurt: [5, 3, 2], heal: [3],
  'comm.0': [1], 'comm.1': [1], 'comm.2': [2],
  step: [1, 5, 2, 4, 7, 3], stepGrass: [1, 3, 5, 6, 7, 8], jump: [1, 4, 3], land: [2, 4], death: [4], respawn: [3], pickup: [1],
  photon: [2, 4, 1, 6], photonHit: [1, 2, 3], gravityThrow: [3], gravity: [4], gravityCollapse: [2], emcCharge: [2], emcBlast: [2],
  bell: [5], bellHit: [4, 3, 1], tonka: [1], engineLoop: [1], engineHigh: [3], skid: [3], crash: [3, 1], ram: [4], bellSummon: [1], bigBell: [1], bellWhistle: [3], bellDrop: [3],
  paint: [2, 4, 1, 3], splat: [4, 5, 1, 2], seedToss: [2], bloom: [3], starry: [3], starFall: [2, 4, 1],
  ambStudy: [1], ambRuins: [2],
};

/** Wide, non-positional sounds keep their stereo image; everything placed in the world is mono. */
export const STEREO = new Set(['lockIn', 'countdown', 'go', 'ultReady', 'victory', 'defeat', 'kill', 'bellSummon', 'starry', 'ambStudy', 'ambRuins']);
