import type { HeroId } from '../game/types';
import type { VoiceChain } from '../core/Audio';

/**
 * Every line each legend can say. All lines are original writing.
 *
 * Lines are recorded with ElevenLabs text to speech (`node scripts/sfx/voices.mjs`) into
 * `src/assets/voice/<heroId>/<id>.ogg`, which the game picks up at build time. A line
 * without a recording still shows as a subtitle. `[bracketed]` words are delivery
 * directions for the voice actor: they are spoken as performance, never shown.
 */
export type VoiceEvent =
  | 'matchStart' | 'primary' | 'secondary' | 'secondaryHit' | 'ult' | 'ultEnemy'
  | 'kill' | 'multiKill' | 'death' | 'respawn' | 'ultReady' | 'lowHp' | 'victory' | 'defeat'
  | 'assist' | 'revenge' | 'streak' | 'heal' | 'takeLead' | 'behind' | 'matchPoint' | 'overtime'
  | 'enemyUlt' | 'allyDown' | 'shutdown';

export interface Line { id: string; text: string }
export interface Banter { id: string; vs: HeroId; text: string; reply: string }
export interface HeroVoice {
  short: string;
  chain: VoiceChain;
  /** ElevenLabs voice and the direction prefixed to every line when recording. */
  tts: { voice: string; direction: string; stability: number; style: number };
  lines: Partial<Record<VoiceEvent, Line[]>>;
  /** Kill lines aimed at a specific rival legend (used instead of a generic kill line sometimes). */
  rival: Partial<Record<HeroId, Line[]>>;
  banter: Banter[];
}

const L = (ev: VoiceEvent, ...texts: string[]): Line[] => texts.map((text, i) => ({ id: `${ev}_${i + 1}`, text }));
const R = (vs: HeroId, ...texts: string[]): Line[] => texts.map((text, i) => ({ id: `rival_${vs}_${i + 1}`, text }));

/** Subtitle text: the performance directions are for the voice actor only. */
export const spoken = (t: string) => t.replace(/\[[^\]]*\]\s*/g, '').trim();

export const VOICES: Record<HeroId, HeroVoice> = {
  yeat: {
    short: 'Yeat',
    // a little grit, a slapback and a touch of pitch-down: produced, not studio-clean
    chain: { hp: 110, lp: 14000, drive: 0.3, slap: 0.085, slapMix: 0.2, reverb: 0.16, rate: 0.97, gain: 1.05 },
    tts: { voice: 'TxGEqnHWrfWFTfGW9XjX', direction: '[laid back, young rapper, confident drawl]', stability: 0.35, style: 0.7 },
    lines: {
      matchStart: L('matchStart', '[hyped] Bells on. Let\'s get it.', 'Whole lobby finna hear this.', '[smug] Twizzy in the building. Act right.', 'Turn it up. We outside.'),
      primary: L('primary', 'Ring ring.', '[laughs] You hear that? That\'s you losin\'.', 'Ding ding.'),
      secondary: L('secondary', '[shouting] Tonka time!', 'Beep beep, move.', '[hyped] I\'m the truck now.', 'Outta the way!'),
      secondaryHit: L('secondaryHit', '[laughs] Got \'em on the bumper.', 'Roadkill.', 'Hit and run, baby.'),
      ult: L('ult', '[menacing whisper] Sky goin\' green...', '[shouting] Look up!', '[hyped] Bell\'s comin\' down!'),
      ultEnemy: L('ultEnemy', '[menacing] The Bell tolls for you!', '[shouting] Y\'all hear that? That\'s the end.'),
      kill: L('kill', 'Rang his bell.', 'Lights out, bells on.', '[laughs] Too loud for you.', 'That\'s 2093 behavior.', 'Sit down.', '[smug] Easy. Too easy.', 'Bell rung. Next.'),
      multiKill: L('multiKill', '[hyped] Whole squad on silent.', '[laughing] They can\'t keep up with the bells.', '[shouting] Who next? Who next?!'),
      death: L('death', '[annoyed] Nah... that was rigged.', 'Bell\'s off. For now.', '[groans] Lag. Had to be lag.'),
      respawn: L('respawn', 'Back. Louder.', 'Can\'t mute me.', '[hyped] Round two, let\'s go.'),
      ultReady: L('ultReady', '[smug] Bell\'s ready. Somebody finna get got.', 'Big bell loaded. Say the word.', '[hyped] Sky about to turn green.'),
      lowHp: L('lowHp', '[panicked] I\'m cooked, I\'m cooked.', '[nervous] Need a heal, like, now.', 'Bro I\'m one tap!'),
      victory: L('victory', '[hyped] Told y\'all. Bells don\'t lie.', '[laughs] Ring the bell, we won.', 'Easy money.'),
      defeat: L('defeat', '[sighs] Run it back.', '[annoyed] That ain\'t it.'),
      assist: L('assist', 'We cookin\'.', 'Good look.', 'Teamwork, twin.'),
      revenge: L('revenge', '[smug] Remember me?', '[laughs] Told you I\'d be back.', 'Payback\'s loud.'),
      streak: L('streak', '[hyped] I\'m on fire right now!', 'Can\'t nobody stop the bell.', '[laughs] They keep runnin\' it up to me.'),
      heal: L('heal', 'Ahh. Back to full.', 'Topped up.'),
      takeLead: L('takeLead', '[hyped] We up now! Keep goin\'!', 'Lead\'s ours. Don\'t fumble.'),
      behind: L('behind', '[serious] Lock in, we down bad.', 'We gotta turn this around.'),
      matchPoint: L('matchPoint', '[hyped] One more! Close it out!', 'Match point. Ring it.'),
      overtime: L('overtime', '[hyped] Overtime? Say less.', 'Bonus round. My favorite.'),
      enemyUlt: L('enemyUlt', '[shouting] Watch out, they poppin\' off!', '[panicked] Move, move, move!'),
      allyDown: L('allyDown', 'We lost one!', '[annoyed] Bro went down.'),
      shutdown: L('shutdown', '[laughs] Streak over. Sit down.', 'Not on my watch.'),
    },
    rival: {
      einstein: R('einstein', '[laughs] Do the math on that one.', 'Big brain, still lost.', 'Relativity? Relatively dead.'),
      vangogh: R('vangogh', '[laughs] Paint that.', 'Frame that one, Vinny.', 'Starry night? Lights out.'),
      yeat: R('yeat', 'Only one Twizzy, bro.', '[smug] Copycat got rung.'),
    },
    banter: [
      { id: 'vs_einstein', vs: 'einstein', text: 'Big brain, small ears. Hear this.', reply: 'I hear it. I would rather not.' },
      { id: 'vs_vangogh', vs: 'vangogh', text: 'Bro got one ear, he can\'t even hear the bell.', reply: 'I heard it. I simply chose not to care.' },
      { id: 'vs_yeat', vs: 'yeat', text: 'Two Twizzys? Somebody gotta go.', reply: 'Then ring the bell, twin.' },
    ],
  },
  einstein: {
    short: 'Einstein',
    // warm and a little vintage
    chain: { hp: 90, lp: 9000, drive: 0.06, slap: 0, slapMix: 0, reverb: 0.14, rate: 1, gain: 1 },
    tts: { voice: 'JBFqnCBsd6RMkjVDRZzb', direction: '[elderly professor, strong German accent, playful]', stability: 0.45, style: 0.55 },
    lines: {
      matchStart: L('matchStart', 'A fine day for a thought experiment.', 'Let us run the experiment.', '[chuckles] Time is relative. Yours is short.', 'Imagination will take us everywhere. Starting here.'),
      primary: L('primary', 'Light, at your service.', 'Photons, away!'),
      secondary: L('secondary', '[excited] Mind the curvature!', 'Spacetime, fold!', 'Gravity is not optional.', 'Fall in, please.'),
      secondaryHit: L('secondaryHit', '[chuckles] Caught in the well.', 'Ah, the apple falls.'),
      ult: L('ult', '[shouting] E equals m c squared!', '[shouting] Mass... becomes... energy!'),
      ultEnemy: L('ultEnemy', '[menacing] Brace yourselves. This will be relatively painful!', '[shouting] Observe the equation!'),
      kill: L('kill', 'Relatively easy.', 'Your theory has been disproven.', 'Elegant, like a good proof.', 'A simple equation.', '[chuckles] Peer reviewed.', 'Q, E, D.'),
      multiKill: L('multiKill', '[excited] The results are conclusive!', '[laughs] A chain reaction!', '[excited] Fascinating! Again!'),
      death: L('death', '[sighs] Ach. A miscalculation.', 'I forgot to carry the one.', '[groans] Entropy wins this round.'),
      respawn: L('respawn', 'Back from the fourth dimension.', 'Revised, and resubmitted.', 'A new hypothesis.'),
      ultReady: L('ultReady', 'The equation is complete.', '[excited] My formula is ready!', 'All the energy I need.'),
      lowHp: L('lowHp', '[worried] My hypothesis... requires a medic!', '[nervous] I am losing mass here!', 'This experiment is going badly!'),
      victory: L('victory', '[chuckles] As predicted.', 'The math was always on our side.', 'A beautiful result.'),
      defeat: L('defeat', '[sighs] Back to the chalkboard.', 'A failed experiment is still data.'),
      assist: L('assist', 'A fine collaboration.', 'Together, we are greater than the sum.', 'Good work, colleague.'),
      revenge: L('revenge', '[chuckles] I recalculated.', 'The second trial went better.', 'Science corrects itself.'),
      streak: L('streak', '[excited] The data keeps agreeing with me!', 'A perfect series.', '[laughs] Is anyone checking my work?'),
      heal: L('heal', 'Ah. Restored to equilibrium.', 'Much better.'),
      takeLead: L('takeLead', 'The numbers favor us now.', '[pleased] We lead. Do not get careless.'),
      behind: L('behind', 'We must rethink our approach.', '[serious] The numbers are against us. For now.'),
      matchPoint: L('matchPoint', 'One more variable to solve.', '[excited] We are so close to proof!'),
      overtime: L('overtime', 'Time dilates. How fitting.', '[chuckles] Extra time? Relativity at work.'),
      enemyUlt: L('enemyUlt', '[urgent] Take cover! Their energy is spiking!', '[shouting] Incoming! Scatter!'),
      allyDown: L('allyDown', 'We have lost a colleague!', '[worried] Our numbers are down!'),
      shutdown: L('shutdown', 'Your streak has collapsed.', '[chuckles] Every curve comes down.'),
    },
    rival: {
      yeat: R('yeat', '[chuckles] Silence, at last.', 'Your bell is out of tune.', 'Noise, cancelled.'),
      vangogh: R('vangogh', 'Sorry, Vincent. Physics beats paint.', '[chuckles] A still life now.', 'Even the stars must fall.'),
      einstein: R('einstein', '[chuckles] Only one genius per universe.', 'Imitation is not a theory.'),
    },
    banter: [
      { id: 'vs_yeat', vs: 'yeat', text: 'Mr. Yeat, your music violates several laws of physics.', reply: 'Good. Laws are mid.' },
      { id: 'vs_vangogh', vs: 'vangogh', text: 'Vincent, paint me a black hole.', reply: 'Only if you sit still, Albert.' },
      { id: 'vs_einstein', vs: 'einstein', text: 'Two of me? This disproves everything.', reply: 'Or proves everything. Fascinating.' },
    ],
  },
  vangogh: {
    short: 'Van Gogh',
    // soft and dreamy: more room
    chain: { hp: 100, lp: 12000, drive: 0, slap: 0, slapMix: 0, reverb: 0.28, rate: 1, gain: 1 },
    tts: { voice: 'N2lVS1w4EtoT3dr4eOWO', direction: '[passionate painter, Dutch accent, intense]', stability: 0.4, style: 0.6 },
    lines: {
      matchStart: L('matchStart', 'Let\'s put some color on this canvas.', '[dreamy] The light is perfect today.', 'Brushes ready. Let\'s paint.', '[intense] I feel a masterpiece coming.'),
      primary: L('primary', 'A little cadmium yellow!', 'Bold strokes!'),
      secondary: L('secondary', '[joyful] Grow, my sunflower!', 'Bloom for me.', 'A little life, here.'),
      secondaryHit: L('secondaryHit', 'The sunflower sees you.', '[laughs] Petals and pain.'),
      ult: L('ult', '[shouting] Look up. The stars are burning!', '[awed] The night swirls for me!'),
      ultEnemy: L('ultEnemy', '[menacing] Behold... the starry night!', '[shouting] Let the stars fall!'),
      kill: L('kill', 'A masterpiece.', 'You\'ve been framed.', 'Another study, finished.', 'Too many swirls for you.', '[satisfied] Signed, Vincent.', 'Hang that in a gallery.'),
      multiKill: L('multiKill', '[excited] My finest gallery!', '[laughs] A whole exhibition!', '[intense] The canvas is full!'),
      death: L('death', '[weakly] The colors... fade...', '[sighs] Unfinished...', 'A dark palette, today.'),
      respawn: L('respawn', 'A fresh canvas.', 'Begin again. Always begin again.', '[determined] More paint!'),
      ultReady: L('ultReady', '[dreamy] The night sky is ready.', 'The stars are waiting for me.', '[intense] I can feel the swirls.'),
      lowHp: L('lowHp', '[worried] I\'m losing my color here!', '[panicked] My canvas is torn!', 'Help me, quickly!'),
      victory: L('victory', '[proud] Art endures.', 'A painting worth a fortune.', '[joyful] Finally, someone appreciates my work!'),
      defeat: L('defeat', '[sighs] Even my best work went unsold.', 'Next time, brighter colors.'),
      assist: L('assist', 'We painted that together.', 'Lovely work, friend.', 'A shared canvas.'),
      revenge: L('revenge', '[intense] I paint over my mistakes.', 'Now it is my turn.', 'You owed me a portrait.'),
      streak: L('streak', '[excited] I cannot stop painting!', 'The inspiration flows!', '[laughs] Another, and another!'),
      heal: L('heal', 'Ah. The color returns.', 'Fresh paint.'),
      takeLead: L('takeLead', '[joyful] Our picture is taking shape!', 'We lead. Keep the strokes steady.'),
      behind: L('behind', 'This sketch needs work.', '[determined] We can still save this painting.'),
      matchPoint: L('matchPoint', 'One final brushstroke!', '[intense] Finish the masterpiece!'),
      overtime: L('overtime', 'The paint is still wet!', '[laughs] More time to create.'),
      enemyUlt: L('enemyUlt', '[urgent] Careful, something is coming!', '[shouting] Run, friends!'),
      allyDown: L('allyDown', 'We lost a friend!', '[sad] One less color.'),
      shutdown: L('shutdown', 'Your streak is painted over.', 'Not so loud now.'),
    },
    rival: {
      yeat: R('yeat', '[satisfied] Finally, some quiet.', 'Ring that, young man.', 'A still life, with bell.'),
      einstein: R('einstein', 'Your equation lacked color, Albert.', '[laughs] Relative to me, you lost.', 'Beauty beats logic.'),
      vangogh: R('vangogh', 'A forgery. Obviously.', '[laughs] Only the original survives.'),
    },
    banter: [
      { id: 'vs_einstein', vs: 'einstein', text: 'Albert, can your equations explain the stars like I can?', reply: 'Yes. But yours are prettier.' },
      { id: 'vs_yeat', vs: 'yeat', text: 'Your bells are loud, young man. My colors are louder.', reply: 'Colors can\'t ring, though.' },
      { id: 'vs_vangogh', vs: 'vangogh', text: 'Another Vincent? Which of us is the forgery?', reply: 'Let the canvas decide.' },
    ],
  },
  luffy: {
    short: 'Luffy',
    // bright and bouncy: a little room, no grit
    chain: { hp: 120, lp: 14500, drive: 0, slap: 0, slapMix: 0, reverb: 0.14, rate: 1.03, gain: 1.05 },
    tts: { voice: 'pNInz6obpgDQGcFmaJgB', direction: '[cheerful young pirate, loud, fearless, always grinning]', stability: 0.3, style: 0.75 },
    lines: {
      matchStart: L('matchStart', '[excited] Alright! Let\'s go have an adventure!', '[laughs] Shishishi! This is gonna be fun!', 'I\'m not losing to anybody!', '[hungry] Can we eat after this? Okay, let\'s fight!'),
      primary: L('primary', 'Gum-Gum Pistol!', '[shouting] Pistol!'),
      secondary: L('secondary', '[shouting] Gum-Gum Rocket!', 'Here I come!', '[laughs] Wheee!'),
      secondaryHit: L('secondaryHit', '[laughs] Got ya!', 'Bullseye!', 'Heads up!'),
      ult: L('ult', '[laughing] Shishishi! Gear Fifth!', '[shouting] I can hear the drums!', '[joyful] Now I can do anything!'),
      ultEnemy: L('ultEnemy', '[shouting] Hey! Watch this!', '[laughing] You\'re gonna love this part!'),
      kill: L('kill', 'Down you go!', '[laughs] Shishishi! Too slow!', 'That one\'s for my crew!', 'Rubber beats you!', '[proud] Told ya I\'d win!', 'Next!'),
      multiKill: L('multiKill', '[excited] Who\'s next? Come on!', '[laughing] I could do this all day!', '[shouting] Everybody at once? Sure!'),
      death: L('death', '[groans] Ow... I\'m so hungry...', '[annoyed] Hey! No fair!', 'I\'ll get you next time!'),
      respawn: L('respawn', '[cheerful] I\'m back! Did ya miss me?', 'Okay, round two!', 'That didn\'t even hurt! ...Much.'),
      ultReady: L('ultReady', '[excited] My heart\'s drumming!', 'I feel a big one coming!', '[laughs] Ready to go wild!'),
      lowHp: L('lowHp', '[worried] I need meat! Lots of meat!', '[panicked] Okay, that one hurt!', 'Gotta bounce back!'),
      victory: L('victory', '[cheering] We did it! Party time!', '[laughs] Shishishi! Told ya!', 'Let\'s feast!'),
      defeat: L('defeat', '[sighs] I\'ll get stronger. Just watch.', 'Next time, we win. Promise.'),
      assist: L('assist', '[excited] Nice one!', 'That\'s my crew!', '[laughs] Teamwork!'),
      revenge: L('revenge', '[angry] That\'s for earlier!', 'Remember me?', 'I don\'t forget!'),
      streak: L('streak', '[laughing] Nobody can stop me!', '[excited] I\'m on a roll!', 'Keep \'em coming!'),
      heal: L('heal', '[happy] Ahh, that\'s the stuff!', 'All better!'),
      takeLead: L('takeLead', '[excited] We\'re winning! Keep going!', 'Lead\'s ours!'),
      behind: L('behind', '[determined] We\'re not done yet!', 'We can still turn this around!'),
      matchPoint: L('matchPoint', '[shouting] One more! Let\'s finish it!', 'Last one, everybody!'),
      overtime: L('overtime', '[laughs] More fighting? Yes!', 'Overtime! I love it!'),
      enemyUlt: L('enemyUlt', '[shouting] Whoa, look out!', '[urgent] Something big\'s coming!'),
      allyDown: L('allyDown', '[angry] Hey! Nobody hurts my friends!', 'Hang in there!'),
      shutdown: L('shutdown', '[laughs] Your streak\'s over!', 'Not so tough now!'),
    },
    rival: {
      einstein: R('einstein', 'Smart guy, but I hit harder!', '[laughs] Your hair\'s cooler than mine, though.'),
      yeat: R('yeat', 'Your bell\'s too loud!', '[laughs] I like your music. Still beat ya!'),
      vangogh: R('vangogh', 'Paint me a picture of meat!', '[laughs] Pretty colors!'),
      luffy: R('luffy', 'Hey! There\'s only one me!', '[confused] Wait, which one\'s the real me?'),
    },
    banter: [
      { id: 'vs_einstein', vs: 'einstein', text: 'Hey, old man! Can your science make infinite meat?', reply: 'In theory... yes. In practice, sadly no.' },
      { id: 'vs_yeat', vs: 'yeat', text: 'Your music\'s cool! Can you play at my party?', reply: 'Only if the party\'s loud.' },
      { id: 'vs_vangogh', vs: 'vangogh', text: 'Will you paint my Jolly Roger?', reply: 'With the brightest yellow I have.' },
      { id: 'vs_luffy', vs: 'luffy', text: 'Whoa! Are you me?', reply: 'Nope! You\'re me!' },
    ],
  },
};
/** The order heroes are numbered in for per-hero stinger variants. */
export const VOICE_INDEX: Record<HeroId, number> = { einstein: 0, yeat: 1, vangogh: 2, luffy: 3 };

/**
 * Arena announcer lines beyond the kill feats (recorded into src/assets/announcer/).
 * Same voice and direction as the original announcer set.
 */
export const ANNOUNCER_EXTRA: { name: string; text: string }[] = [
  { name: 'revenge', text: '[excited] Revenge!' },
  { name: 'clutch', text: '[excited] Clutch!' },
  { name: 'ultDenied', text: '[excited] Ultimate denied!' },
  { name: 'comeback', text: '[excited] What a comeback!' },
  { name: 'takeLead', text: '[excited] Your team has taken the lead!' },
  { name: 'lostLead', text: '[serious] The enemy has taken the lead.' },
  { name: 'tied', text: '[excited] All tied up!' },
  { name: 'matchPoint', text: '[excited] Match point!' },
  { name: 'enemyMatchPoint', text: '[serious] Enemy match point!' },
  { name: 'oneMinute', text: '[serious] One minute remaining.' },
  { name: 'overtime', text: '[excited] OVERTIME!' },
  { name: 'finalKill', text: '[excited] And that... is the match!' },
  { name: 'playOfGame', text: '[dramatic] Play of the game!' },
  { name: 'flawless', text: '[excited] Flawless victory!' },
  { name: 'ultReady', text: '[confident] Ultimate ready.' },
  { name: 'longshot', text: '[excited] Long shot!' },
];
