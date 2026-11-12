import type { HeroId } from '../game/types';
import type { VoiceChain } from '../core/Audio';

/**
 * Every line each legend can say. All lines are original writing.
 *
 * Recorded audio is optional: drop a file named after the line id into
 * `src/assets/voice/<heroId>/<id>.(mp3|ogg|wav|m4a|webm|opus)` and it is picked up
 * automatically at build time. Lines without a recording still show as subtitles.
 * The full script lives in docs/VOICE_LINES.md.
 */
export type VoiceEvent =
  | 'matchStart' | 'primary' | 'secondary' | 'secondaryHit' | 'ult' | 'ultEnemy'
  | 'kill' | 'multiKill' | 'death' | 'respawn' | 'ultReady' | 'lowHp' | 'victory' | 'defeat';

export interface Line { id: string; text: string }
export interface Banter { id: string; vs: HeroId; text: string; reply: string }
export interface HeroVoice {
  short: string;
  chain: VoiceChain;
  lines: Partial<Record<VoiceEvent, Line[]>>;
  banter: Banter[];
}

const L = (ev: VoiceEvent, ...texts: string[]): Line[] => texts.map((text, i) => ({ id: `${ev}_${i + 1}`, text }));

export const VOICES: Record<HeroId, HeroVoice> = {
  yeat: {
    short: 'Yeat',
    // a little grit, a slapback and a touch of pitch-down: produced, not studio-clean
    chain: { hp: 110, lp: 14000, drive: 0.35, slap: 0.085, slapMix: 0.22, reverb: 0.18, rate: 0.97, gain: 1 },
    lines: {
      matchStart: L('matchStart', 'Bells on. Let\'s get it.', 'Whole lobby finna hear this.', 'Twizzy in the building. Act right.'),
      primary: L('primary', 'Ring ring.', 'You hear that? That\'s you losin\'.'),
      secondary: L('secondary', 'Tonka time!', 'Beep beep, move.', 'I\'m the truck now.'),
      secondaryHit: L('secondaryHit', 'Got \'em on the bumper.', 'Roadkill.'),
      ult: L('ult', 'Sky goin\' green...', 'Look up.'),
      ultEnemy: L('ultEnemy', 'The Bell tolls for you!'),
      kill: L('kill', 'Rang his bell.', 'Lights out, bells on.', 'Too loud for you.', 'That\'s 2093 behavior.'),
      multiKill: L('multiKill', 'Whole squad on silent.', 'They can\'t keep up with the bells.'),
      death: L('death', 'Nah... that was rigged.', 'Bell\'s off. For now.'),
      respawn: L('respawn', 'Back. Louder.', 'Can\'t mute me.'),
      ultReady: L('ultReady', 'Bell\'s ready. Somebody finna get got.'),
      lowHp: L('lowHp', 'I\'m cooked, I\'m cooked.'),
      victory: L('victory', 'Told y\'all. Bells don\'t lie.'),
      defeat: L('defeat', 'Run it back.'),
    },
    banter: [
      { id: 'vs_einstein', vs: 'einstein', text: 'Big brain, small ears. Hear this.', reply: 'I hear it. I would rather not.' },
      { id: 'vs_vangogh', vs: 'vangogh', text: 'Bro got one ear, he can\'t even hear the bell.', reply: 'I heard it. I simply chose not to care.' },
    ],
  },
  einstein: {
    short: 'Einstein',
    // warm and a little vintage
    chain: { hp: 90, lp: 9000, drive: 0.06, slap: 0, slapMix: 0, reverb: 0.14, rate: 1, gain: 1 },
    lines: {
      matchStart: L('matchStart', 'A fine day for a thought experiment.', 'Let us run the experiment.', 'Time is relative. Yours is short.'),
      primary: L('primary', 'Light, at your service.'),
      secondary: L('secondary', 'Mind the curvature!', 'Spacetime, fold!', 'Gravity is not optional.'),
      ult: L('ult', 'E equals m c squared!'),
      ultEnemy: L('ultEnemy', 'Brace yourselves. This will be relatively painful!'),
      kill: L('kill', 'Relatively easy.', 'Your theory has been disproven.', 'Elegant, like a good proof.', 'A simple equation.'),
      multiKill: L('multiKill', 'The results are conclusive!'),
      death: L('death', 'Ach. A miscalculation.'),
      respawn: L('respawn', 'Back from the fourth dimension.'),
      ultReady: L('ultReady', 'The equation is complete.'),
      lowHp: L('lowHp', 'My hypothesis... requires a medic!'),
      victory: L('victory', 'As predicted.'),
      defeat: L('defeat', 'Back to the chalkboard.'),
    },
    banter: [
      { id: 'vs_yeat', vs: 'yeat', text: 'Mr. Yeat, your music violates several laws of physics.', reply: 'Good. Laws are mid.' },
      { id: 'vs_vangogh', vs: 'vangogh', text: 'Vincent, paint me a black hole.', reply: 'Only if you sit still, Albert.' },
    ],
  },
  vangogh: {
    short: 'Van Gogh',
    // soft and dreamy: more room
    chain: { hp: 100, lp: 12000, drive: 0, slap: 0, slapMix: 0, reverb: 0.3, rate: 1, gain: 1 },
    lines: {
      matchStart: L('matchStart', 'Let\'s put some color on this canvas.', 'The light is perfect today.'),
      primary: L('primary', 'A little cadmium yellow!'),
      secondary: L('secondary', 'Grow, my sunflower!', 'Bloom for me.'),
      ult: L('ult', 'Look up. The stars are burning!'),
      ultEnemy: L('ultEnemy', 'Behold... the starry night!'),
      kill: L('kill', 'A masterpiece.', 'You\'ve been framed.', 'Another study, finished.', 'Too many swirls for you.'),
      multiKill: L('multiKill', 'My finest gallery!'),
      death: L('death', 'The colors... fade...'),
      respawn: L('respawn', 'A fresh canvas.'),
      ultReady: L('ultReady', 'The night sky is ready.'),
      lowHp: L('lowHp', 'I\'m losing my color here!'),
      victory: L('victory', 'Art endures.'),
      defeat: L('defeat', 'Even my best work went unsold.'),
    },
    banter: [
      { id: 'vs_einstein', vs: 'einstein', text: 'Albert, can your equations explain the stars like I can?', reply: 'Yes. But yours are prettier.' },
      { id: 'vs_yeat', vs: 'yeat', text: 'Your bells are loud, young man. My colors are louder.', reply: 'Colors can\'t ring, though.' },
    ],
  },
};

/** The order heroes are numbered in for per-hero stinger variants. */
export const VOICE_INDEX: Record<HeroId, number> = { einstein: 0, yeat: 1, vangogh: 2 };
