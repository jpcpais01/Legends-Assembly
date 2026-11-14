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
  { name: 'backfire', dur: 1.2, takes: 6, keep: 3, inf: 0.65, text: 'Muscle car exhaust backfire on throttle lift: two or three sharp loud pops and crackles from the tailpipe, close mic, no engine drone, short' },
  { name: 'gearShift', dur: 0.6, takes: 5, keep: 2, inf: 0.65, text: 'A quick mechanical gear shift clunk of a manual transmission in a muscle car, short metallic thunk, close mic, no engine' },
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

  // ── Blitzcrank (procedural patches play until these are generated) ──
  { name: 'blitzJab', dur: 0.5, takes: 6, keep: 3, inf: 0.6, text: 'A giant steam-powered robot throws a fast piston punch: sharp pneumatic hiss and a heavy iron fist cutting the air ending in a metallic piston clunk, one punch only, no impact' },
  { name: 'blitzPunchHit', dur: 0.7, takes: 6, keep: 3, inf: 0.65, text: 'A heavy brass robot fist slams into someone: deep meaty body thud with a hollow metallic clang and gritty crunch, punchy, one hit only' },
  { name: 'blitzUppercut', dur: 1.4, takes: 4, keep: 1, inf: 0.6, text: 'Giant robot uppercut: rising air whoosh into an enormous metallic clang and a deep sub boom launching someone into the air, cinematic, one hit' },
  { name: 'grabLaunch', dur: 1.0, takes: 4, keep: 1, inf: 0.6, text: 'A robot arm fires out like a rocket and telescopes: thruster ignition burst, short rocket roar flying away and rapid metal sleeves sliding out with pneumatic hiss and clacks' },
  { name: 'grabReel', dur: 0.8, takes: 4, keep: 1, inf: 0.6, text: 'A long telescoping robot arm retracting fast: metal sleeves sliding back into each other with ratcheting clacks, a falling pneumatic hiss and a heavy metallic clunk at the end' },
  { name: 'grabHit', dur: 1.0, takes: 4, keep: 1, inf: 0.6, text: 'A giant mechanical claw clamps onto someone: heavy metal clank, a buzzing magnetic lock zap and a metal arm snapping taut with a servo groan' },
  { name: 'staticCharge', dur: 1.0, takes: 4, keep: 1, inf: 0.5, text: 'Electric generators overloading: a rising high-voltage whine climbing in pitch with fizzing electrical crackles and humming coils, about to explode' },
  { name: 'staticBlast', dur: 3.0, takes: 4, keep: 1, inf: 0.5, text: 'Huge electric shockwave slammed into the ground: a thunderclap boom, a wall of crackling static and arcing electricity, deep sub impact and a buzzing electric ring-out, cinematic' },
  { name: 'staticZap', dur: 0.5, takes: 6, keep: 4, inf: 0.6, text: 'A single short electric arc zap jumping to a target, crisp crackle, short' },
  { name: 'stepBlitz', dur: 0.5, takes: 8, keep: 5, inf: 0.7, text: 'One single heavy footstep of a big brass robot on a hardwood floor, hollow metal clank with a tiny servo whirr, close mic, dry, one step only' },
  { name: 'comm', dur: 0.6, takes: 3, keep: 1, inf: 0.6, text: 'Two short square-wave robot beeps, a tiny retro comm stinger', variant: 3 },

  // ── ambience ──
  // (v0.14: the study bed is now only room air; the fire, window, clocks and creaks are separate emitters placed in the room)
  { name: 'ambStudy', dur: 30, takes: 3, keep: 1, inf: 0.55, loop: true, text: 'Room tone of a large quiet old wooden library at dusk: warm still air, very faint distant city murmur muffled through thick walls, soft low hum, no clock, no fire, no rain, no music, continuous, seamless loop' },
  { name: 'fireLoop', dur: 22, takes: 3, keep: 1, inf: 0.6, loop: true, text: 'Crackling log fire in a stone fireplace: steady warm crackle, small wood pops and soft hiss of burning logs, close, continuous, seamless loop, no music' },
  { name: 'windowLoop', dur: 22, takes: 3, keep: 1, inf: 0.55, loop: true, text: 'Soft evening wind breathing against old leaded window panes, gentle whistle through a gap in the frame, light rain pattering on glass, continuous, seamless loop, no thunder' },
  { name: 'watchTick', dur: 0.5, takes: 6, keep: 2, inf: 0.7, text: 'One single tiny tick of a mechanical brass pocket watch, crisp delicate metallic tick, close mic, dry, one tick only' },
  { name: 'metronome', dur: 0.5, takes: 5, keep: 2, inf: 0.7, text: 'One single click of an antique wooden pyramid metronome, crisp woody tock, close mic, dry, one click only' },
  { name: 'cradleClack', dur: 0.5, takes: 6, keep: 3, inf: 0.7, text: 'One single crisp clack of polished steel balls striking in a Newton\'s cradle desk toy, bright hard metallic click, close mic, dry, one clack only' },
  { name: 'woodCreak', dur: 2.2, takes: 6, keep: 4, inf: 0.6, text: 'One slow creak of old wooden floorboards and ceiling beams settling in a quiet old house, single creak, no footsteps' },
  { name: 'chainCreak', dur: 2.0, takes: 3, keep: 2, inf: 0.6, text: 'The iron chain of a heavy hanging chandelier creaking softly as it sways, slow metallic creak, quiet' },
  { name: 'cityDistant', dur: 6, takes: 4, keep: 3, inf: 0.5, text: 'Far away outside a window in an old European city at dusk: a horse carriage clip-clopping past on cobblestones, faint distant voices, very distant and soft' },
  { name: 'birdsWindow', dur: 4, takes: 4, keep: 3, inf: 0.5, text: 'A few small birds chirping outside a window at dusk, distant and soft, no other sounds' },
  { name: 'fireSurge', dur: 2.5, takes: 3, keep: 2, inf: 0.6, text: 'A log shifting and collapsing in a fireplace with a burst of loud crackles, pops and a rush of flame, then settling' },

  // ── the desk reacts ──
  { name: 'rattleChina', dur: 1.2, takes: 4, keep: 2, inf: 0.6, text: 'A porcelain teacup rattling on its saucer for a moment from a heavy thump on the table, delicate china clatter, short' },
  { name: 'rattleCoins', dur: 1.2, takes: 4, keep: 2, inf: 0.6, text: 'A stack of old coins jingling and shifting on a wooden desk from a sudden jolt, short metallic jingle' },
  { name: 'rattleGlass', dur: 1.2, takes: 4, keep: 2, inf: 0.6, text: 'Glass inkwell and small glass bottles rattling against each other on a wooden desk from a jolt, short glassy clatter' },
  { name: 'rattleWood', dur: 1.2, takes: 4, keep: 2, inf: 0.6, text: 'Pencils, a wooden ruler and small wooden objects bouncing and rattling on a hardwood desk from a heavy thump, short' },
  { name: 'paperFlutter', dur: 1.5, takes: 4, keep: 2, inf: 0.6, text: 'Loose sheets of paper lifting and fluttering in a sudden gust of air, crisp paper rustle, short' },
  { name: 'chandelierTinkle', dur: 2.5, takes: 3, keep: 1, inf: 0.6, text: 'Crystal drops of a chandelier tinkling and chiming together as it shakes, delicate glassy shimmer, short' },
  { name: 'deskThud', dur: 2.0, takes: 4, keep: 2, inf: 0.6, text: 'An enormous deep thump on a giant solid oak table, massive woody boom with a low rumble and small objects rattling on its surface' },

  // ── footsteps: one set per legend, plus the surface they land on ──
  { name: 'stepEinstein', dur: 0.5, takes: 8, keep: 5, inf: 0.7, text: 'One single footstep of an old leather dress shoe on a polished hardwood floor, crisp heel click, close mic, dry, one step only' },
  { name: 'stepYeat', dur: 0.5, takes: 8, keep: 5, inf: 0.7, text: 'One single heavy footstep of a chunky designer sneaker on a hardwood floor with a faint jingle of a metal chain necklace, close mic, dry, one step only' },
  { name: 'stepVangogh', dur: 0.5, takes: 8, keep: 5, inf: 0.7, text: 'One single footstep of a wooden clog on a hardwood floor, hollow woody clack, close mic, dry, one step only' },
  { name: 'stepPaper', dur: 0.5, takes: 6, keep: 4, inf: 0.7, text: 'One single footstep landing on a sheet of paper lying on a desk, crisp paper crinkle and crunch, close mic, dry, one step only' },
  { name: 'stepMetal', dur: 0.5, takes: 6, keep: 4, inf: 0.7, text: 'One single light footstep on a large metal coin, bright metallic clink with a short ring, close mic, dry, one step only' },
  { name: 'stepLeather', dur: 0.5, takes: 6, keep: 4, inf: 0.7, text: 'One single footstep on the leather cover of a thick old book, soft dull hollow tap, close mic, dry, one step only' },
  { name: 'stepStone', dur: 0.5, takes: 6, keep: 4, inf: 0.7, text: 'One single footstep on smooth polished marble, hard sharp click, close mic, dry, one step only' },

  // ── combat feedback ──
  { name: 'hitHeavy', dur: 0.6, takes: 5, keep: 2, inf: 0.6, text: 'Heavy hit confirm for a hero shooter: a punchy deep body impact thump with a crisp bright click on top, very satisfying, short, dry' },
  { name: 'killDrop', dur: 1.6, takes: 5, keep: 1, inf: 0.6, text: 'Elimination confirm for a hero shooter: a crisp snap into a huge deep 808 bass drop boom with a short sub rumble tail, punchy and rewarding, no music' },
  { name: 'assist', dur: 0.8, takes: 4, keep: 1, inf: 0.6, text: 'Assist confirm notification for a hero shooter: two quick soft bright chime notes rising, clean and short' },
  { name: 'heartbeat', dur: 6, takes: 3, keep: 1, inf: 0.7, loop: true, text: 'Slow heavy human heartbeat heard from inside the body, deep muffled low thumps, steady rhythm, continuous, seamless loop' },
  { name: 'lowHealth', dur: 1.5, takes: 4, keep: 1, inf: 0.6, text: 'Low health warning in a video game: a muffled low thump followed by a thin high ringing tinnitus whine fading out, tense, short' },

  // ── ultimates ──
  { name: 'ultAlly', dur: 2.0, takes: 4, keep: 1, inf: 0.55, text: 'Heroic ultimate ability activation stinger for a hero shooter: fast rising brass swell into a bright shimmering impact with a warm sub boom, triumphant, short, no voice' },
  { name: 'ultEnemy', dur: 2.0, takes: 4, keep: 1, inf: 0.55, text: 'Menacing enemy ultimate warning stinger for a hero shooter: dark distorted brass blast with a deep rumbling sub and a reversed whoosh, danger approaching, short, no voice' },

  // ── match moments ──
  { name: 'finalTick', dur: 1.0, takes: 4, keep: 1, inf: 0.65, text: 'One loud tense tick of a big old grandfather clock, deep wooden tock with a metallic edge and a short room echo, one tick only' },
  { name: 'slowmo', dur: 2.5, takes: 4, keep: 1, inf: 0.55, text: 'Cinematic time slowing down: a deep reversed whoosh pitching down into a heavy low boom with a long dark tail, slow motion' },
  { name: 'matchPointSting', dur: 2.5, takes: 3, keep: 1, inf: 0.55, text: 'Tense orchestral stinger: low strings tremolo swelling with a timpani roll and a sharp brass stab, suspense, short, no voice' },

  // ── the Assembly Hall (menu stage) ──
  { name: 'hallAmb', dur: 30, takes: 3, keep: 1, inf: 0.5, loop: true, text: 'Vast dark cosmic hall ambience: deep soft warm drone, slow airy shimmer like distant stars, faint low wind high above, calm and majestic, no melody, no drums, seamless loop' },
  { name: 'stageSwap', dur: 1.6, takes: 4, keep: 2, inf: 0.55, text: 'A hero appears on a glowing stage: soft rising magical whoosh into a warm shimmering chime with a gentle low boom, elegant, short' },
  // ── music (generated as seamless loops; the Music API takes replace these when available) ──
  { name: 'musicMenu', dur: 30, takes: 3, keep: 1, inf: 0.5, loop: true, text: 'Video game main menu music loop: warm cinematic orchestral hybrid theme, mellow felt piano melody over soft strings and a gentle pulsing synth, adventurous and inviting, mid tempo, seamless loop' },
  { name: 'musicSelect', dur: 30, takes: 3, keep: 1, inf: 0.5, loop: true, text: 'Video game hero select screen music loop: building anticipation, pulsing cinematic hybrid orchestral, steady driving low strings ostinato, deep synth pulse, light percussion, confident and exciting, mid tempo, seamless loop' },
  { name: 'musicCalm', dur: 30, takes: 3, keep: 1, inf: 0.5, loop: true, text: 'Hero shooter match music loop, low intensity: tense atmospheric hybrid orchestral underscore, ticking pizzicato strings, soft pulsing synth bass and light percussion, anticipation, seamless loop' },
  { name: 'musicCombat', dur: 30, takes: 3, keep: 1, inf: 0.5, loop: true, text: 'Hero shooter battle music loop, high intensity: driving epic hybrid orchestral action with heavy trap drums, booming 808 bass, fast staccato strings and bold brass hits, energetic, seamless loop' },
  { name: 'musicClutch', dur: 30, takes: 3, keep: 1, inf: 0.5, loop: true, text: 'Final moments of a match music loop: urgent epic orchestral climax, racing strings, pounding taiko and trap drums, rising brass, ticking clock pulse, maximum tension, seamless loop' },
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
  ambStudy: [1],
  fireLoop: [3], windowLoop: [3], watchTick: [4, 1], cradleClack: [2, 3, 5], metronome: [2, 1], woodCreak: [2, 4, 5, 6], chainCreak: [2, 3], cityDistant: [2, 3, 4], birdsWindow: [3], fireSurge: [1, 3],
  rattleChina: [3, 4], rattleCoins: [4, 1], rattleGlass: [1, 3], rattleWood: [4, 3], paperFlutter: [4, 2], chandelierTinkle: [3], deskThud: [4, 3],
  stepEinstein: [1, 3, 5, 8, 7], stepYeat: [1, 2, 7, 3, 8], stepVangogh: [6, 8, 2, 7, 3], stepPaper: [3, 2, 1, 4], stepMetal: [2, 5, 6, 3], stepLeather: [2, 5, 6, 1], stepStone: [6, 4, 5, 1],
  hitHeavy: [4, 2], killDrop: [3], assist: [4], heartbeat: [2], lowHealth: [1], ultAlly: [4], ultEnemy: [1],
  finalTick: [3], slowmo: [2], matchPointSting: [3],
  backfire: [5, 4, 1], gearShift: [1, 4],
  hallAmb: [3], stageSwap: [4, 1], musicSelect: [3],
  musicMenu: [1], musicCalm: [2], musicCombat: [1], musicClutch: [2],
  blitzJab: [1, 4, 6], blitzPunchHit: [2, 4, 6], blitzUppercut: [2], grabLaunch: [2], grabReel: [1], grabHit: [2], staticCharge: [2], staticBlast: [1], staticZap: [1, 3, 4, 5], stepBlitz: [4, 1, 3, 2, 6],
};

/** Wide, non-positional sounds keep their stereo image; everything placed in the world is mono. */
export const STEREO = new Set(['lockIn', 'countdown', 'go', 'ultReady', 'victory', 'defeat', 'kill', 'bellSummon', 'starry', 'ambStudy',
  'killDrop', 'ultAlly', 'ultEnemy', 'slowmo', 'matchPointSting', 'heartbeat', 'musicMenu', 'musicSelect', 'hallAmb', 'musicCalm', 'musicCombat', 'musicClutch']);
