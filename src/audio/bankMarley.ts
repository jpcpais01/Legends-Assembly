import type { Synth } from './synth';
import type { Recipe } from './bank';

/**
 * Bob Marley's sound patches (spread into RECIPES in bank.ts). Skank chords are choked, muted offbeat
 * guitar strums over a one-drop rim click; the drop and the One Love pulses lean on a deep, round sub bass;
 * Kaya Cloud is a long slow exhale.
 */
const T = 0.004;
const A3 = 220;
/** I, IV, V, IV in A major (roots in Hz) and a major triad on top of each. */
const ROOTS = [A3, A3 * 1.3348, A3 * 1.4983, A3 * 1.3348];
const TRIAD = [1, 1.2599, 1.4983, 2];

function wet(s: Synth, seconds: number, amount: number) {
  const rev = s.reverb(seconds, amount, s.out, 2.4, 0.5);
  const mix = s.gain(1);
  mix.connect(rev);
  return mix;
}

/** A choked upstroke: the strings sound highest-first, a hair apart, and are muted a beat later. */
function skankChord(s: Synth, root: number, t: number, dest: AudioNode, amp: number, choke = 0.13) {
  const g = s.gain(1);
  g.gain.setValueAtTime(1, t);
  g.gain.setValueAtTime(1, t + choke);
  g.gain.exponentialRampToValueAtTime(0.02, t + choke + 0.05);
  const tone = s.filter('peaking', 1800, 0.8, s.filter('highpass', 180, 0.7, dest));
  (tone as BiquadFilterNode).gain.value = 6;
  tone.connect(g); g.connect(dest);
  [...TRIAD].reverse().forEach((r, i) => s.pluck(root * r, t + i * 0.006, choke + 0.1, g, amp * (1 - i * 0.12), 0.75, 0.993));
  s.burst(t, 0.001, 0.02, amp * 0.25, 'highpass', 4000, 0.7, dest);
}

export const MARLEY_RECIPES = {
  skank: {
    dur: 0.45, variants: 4, level: 0.4, jitter: 0, maxVoices: 4, reverb: 0.12,
    render(s, v) {
      const mix = wet(s, 0.6, 0.18);
      skankChord(s, ROOTS[v % 4], T, mix, 0.5);
      // the organ "bubble" doubling it, very soft
      for (const r of [1, 1.2599, 1.4983]) s.osc('square', ROOTS[v % 4] * r, T + 0.01, 0.12, s.filter('lowpass', 1400, 0.7, s.vca(T + 0.01, 0.005, 0.04, 0.1, mix)));
    },
  },
  skankDrop: {
    // the drop: a fat chord, a rim shot and a sub bass that you feel
    dur: 0.9, variants: 4, level: 0.5, maxVoices: 3, reverb: 0.15,
    render(s, v) {
      const mix = wet(s, 0.9, 0.22);
      skankChord(s, ROOTS[v % 4], T, mix, 0.55, 0.18);
      s.thump(T, 110, 46, 0.09, 0.55, 0.9, s.shaper(1.4, s.out));
      s.osc('sine', ROOTS[v % 4] / 4, T + 0.02, 0.6, s.vca(T + 0.02, 0.01, 0.35, 0.55));
      s.burst(T, 0.0005, 0.03, 0.45, 'bandpass', 2400, 2.2, mix);
      s.partials(1700, [[1, 0.12, 0.05], [2.3, 0.06, 0.03]], T, mix);
    },
  },
  noteHit: {
    dur: 0.35, variants: 3, level: 0.28, jitter: 1, maxVoices: 4, dedupe: 0.04,
    render(s) {
      s.pluck(s.r(880, 1320), T, 0.3, s.out, 0.4, 0.85, 0.994);
      s.thump(T, 200, 80, 0.03, 0.06, 0.4);
      s.burst(T, 0.0004, 0.012, 0.35, 'highpass', 5000, 0.8);
    },
  },
  smokeBlow: {
    // a long, slow, satisfied exhale that rolls away
    dur: 1.6, level: 0.42, reverb: 0.18,
    render(s) {
      const g = s.gain(0); g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(0.7, T + 0.12); g.gain.exponentialRampToValueAtTime(0.01, T + 1.5);
      const bp = s.filter('bandpass', 1300, 0.9, g);
      s.sweep(bp.frequency, T, 1500, 500, 1.4);
      s.noise(T, 1.55, bp, 'pink');
      const air = s.filter('highpass', 3500, 0.7, s.vca(T, 0.06, 0.12, 0.9));
      s.noise(T, 1.2, air);
      s.thump(T + 0.05, 90, 50, 0.3, 0.6, 0.18);
    },
  },
  loveRise: {
    // the sound system rising out of the floor: a rumble, a tape-start swell and the first chord ringing out
    dur: 2.2, level: 0.6, reverb: 0.3, stereo: true,
    render(s) {
      const mix = wet(s, 1.8, 0.35);
      const r = s.filter('lowpass', 300, 0.8, s.vca(T, 0.3, 0.6, 1.2));
      s.noise(T, 1.6, r, 'brown');
      const o = s.osc('sawtooth', 55, T, 1.1, s.filter('lowpass', 500, 2, s.vca(T, 0.6, 0.25, 0.5, mix)));
      o.frequency.exponentialRampToValueAtTime(110, T + 0.9);
      skankChord(s, A3, T + 0.95, mix, 0.6, 0.6);
      s.thump(T + 0.95, 100, 42, 0.12, 0.9, 1, s.shaper(1.6, s.out));
    },
  },
  bassPulse: {
    // one drop: a round sub on the beat, a rim click and the skank answering on the offbeat
    dur: 1.1, variants: 2, level: 0.62, maxVoices: 3, reverb: 0.2,
    render(s, v) {
      const mix = wet(s, 1.2, 0.25);
      s.thump(T, 120, 44, 0.08, 0.6, 1, s.shaper(1.5, s.out));
      s.osc('sine', v ? 41.2 : 55, T + 0.01, 0.75, s.vca(T + 0.01, 0.01, 0.5, 0.7));
      s.burst(T, 0.0005, 0.03, 0.5, 'bandpass', 2600, 2.4, mix);
      skankChord(s, ROOTS[v ? 2 : 1], T + 0.4, mix, 0.42);
    },
  },
  commMarley: {
    // Marley's subtitle stinger: a quick upstroke and a bass note
    dur: 0.5, level: 0.16, bus: 'ui',
    render(s) {
      const mix = wet(s, 1, 0.3);
      skankChord(s, A3 * 2, T, mix, 0.4, 0.1);
      s.osc('sine', 110, T + 0.08, 0.3, s.vca(T + 0.08, 0.01, 0.35, 0.25, mix));
    },
  },
} satisfies Record<string, Recipe>;

export const MARLEY_ULT_SFX = ['loveRise', 'bassPulse'] as const;
export const MARLEY_BAKE = ['skank', 'skankDrop', 'noteHit', 'smokeBlow', 'loveRise', 'bassPulse', 'commMarley'] as const;
