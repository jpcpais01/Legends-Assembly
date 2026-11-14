import { mulberry, type Synth } from './synth';
import type { Recipe } from './bank';

/**
 * Steve's sound patches (spread into RECIPES in bank.ts): blocky, chunky and a little retro. Sword swipes are short
 * air whooshes with a glassy diamond ring, the bow creaks and twangs, blocks thud up out of the ground with a
 * gravelly crunch, and the Ender Dragon is a huge growl, leathery wing beats and a roaring stream of fire.
 */
const T = 0.004;

/** Seamless noise loop: filtered noise with the tail crossfaded into the head. */
function loopNoise(sr: number, seconds: number, seed: number, shape: (x: number, i: number, st: number[]) => number) {
  const n = Math.round(sr * seconds), fade = Math.round(sr * 0.08);
  const rnd = mulberry(seed);
  const raw = new Float32Array(n + fade);
  const st = [0, 0, 0, 0, 0];
  for (let i = 0; i < raw.length; i++) raw[i] = shape(rnd() * 2 - 1, i, st);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i];
  for (let i = 0; i < fade; i++) { const k = i / fade; out[i] = raw[i] * k + raw[n + i] * (1 - k); }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.9 / (peak || 1);
  return out;
}

/** A body of gravel and dirt: a lowpassed noise crunch with a few grains. */
function crunch(s: Synth, t: number, amp: number, f = 900) {
  s.burst(t, 0.002, 0.09, amp, 'lowpass', f, 0.8, s.out, 'pink');
  s.crackle(t, 0.08, 12, amp * 0.45, s.out, 700, 3200, 1.2);
}

export const STEVE_RECIPES = {
  swordSwing: {
    // a quick swipe of air
    dur: 0.32, variants: 4, level: 0.34, jitter: 1, maxVoices: 4,
    render(s) {
      const f = s.filter('bandpass', s.r(1300, 1700), 1.1, s.vca(T, 0.06, 0.6, 0.16));
      s.noise(T, 0.26, f, 'white');
      f.frequency.exponentialRampToValueAtTime(500, T + 0.24);
      s.burst(T + 0.03, 0.03, 0.12, 0.3, 'highpass', 3500, 0.7);
    },
  },
  swordHit: {
    // a meaty thwack with a short glassy ring from the diamond blade
    dur: 0.4, variants: 4, level: 0.4, jitter: 0.8, maxVoices: 5, dedupe: 0.04,
    render(s) {
      s.thump(T, 210, 70, 0.04, 0.09, 0.8, s.shaper(1.6, s.out));
      s.burst(T, 0.001, 0.05, 0.6, 'bandpass', 1600, 1.2, s.out, 'pink');
      s.partials(s.r(2300, 2600), [[1, 0.16, 0.18], [2.32, 0.08, 0.12], [3.9, 0.04, 0.08]], T + 0.005, s.out);
    },
  },
  swordCrit: {
    // a heavier hit with a bright sparkle on top
    dur: 0.6, variants: 3, level: 0.46, jitter: 0.6, maxVoices: 3, dedupe: 0.05,
    render(s) {
      s.thump(T, 260, 60, 0.05, 0.12, 0.95, s.shaper(2, s.out));
      s.burst(T, 0.001, 0.08, 0.7, 'bandpass', 1300, 1, s.out, 'pink');
      s.partials(s.r(2900, 3200), [[1, 0.22, 0.3], [1.5, 0.12, 0.26], [2.5, 0.07, 0.2]], T + 0.01, s.out);
      for (let i = 0; i < 4; i++) { const o = s.osc('sine', s.r(3000, 5200), T + 0.04 + i * 0.05, 0.08, s.vca(T + 0.04 + i * 0.05, 0.002, 0.06, 0.07)); void o; }
    },
  },
  itemSwap: {
    // the hotbar click: a soft cloth-and-wood flick
    dur: 0.18, level: 0.22, bus: 'ui', maxVoices: 2,
    render(s) {
      s.burst(T, 0.004, 0.05, 0.5, 'bandpass', 2200, 1.3, s.out, 'pink');
      s.partials(1200, [[1, 0.2, 0.03], [2.4, 0.08, 0.02]], T + 0.03, s.out);
    },
  },
  bowDraw: {
    // the string creaks back
    dur: 0.8, level: 0.26, maxVoices: 3,
    render(s) {
      const f = s.filter('bandpass', 700, 6, s.vca(T, 0.25, 0.5, 0.5));
      const o = s.osc('sawtooth', 95, T, 0.75, f);
      o.frequency.linearRampToValueAtTime(140, T + 0.7);
      s.crackle(T, 0.6, 26, 0.18, s.out, 900, 2500, 1);
    },
  },
  bowFull: {
    // a little tick when the draw is full
    dur: 0.12, level: 0.18, bus: 'ui',
    render(s) { s.partials(1900, [[1, 0.25, 0.05], [2.1, 0.1, 0.03]], T, s.out); },
  },
  bowShoot: {
    // twang and whoosh
    dur: 0.45, variants: 3, level: 0.36, jitter: 0.8, maxVoices: 4,
    render(s) {
      s.pluck(s.r(150, 175), T, 0.35, s.out, 0.7, 0.4, 0.993);
      const f = s.filter('bandpass', 2400, 0.9, s.vca(T + 0.01, 0.01, 0.35, 0.18));
      s.noise(T + 0.01, 0.2, f, 'white');
    },
  },
  bowShootFull: {
    // a harder twang with a ringing crit chime
    dur: 0.6, variants: 2, level: 0.42, jitter: 0.4, maxVoices: 3,
    render(s) {
      s.pluck(s.r(120, 140), T, 0.45, s.out, 0.85, 0.5, 0.994);
      const f = s.filter('bandpass', 2800, 0.9, s.vca(T + 0.01, 0.01, 0.5, 0.22));
      s.noise(T + 0.01, 0.25, f, 'white');
      s.partials(2600, [[1, 0.12, 0.3], [1.5, 0.07, 0.25]], T + 0.02, s.out);
    },
  },
  arrowHit: {
    dur: 0.25, variants: 3, level: 0.34, jitter: 1, maxVoices: 4, dedupe: 0.03,
    render(s) {
      s.thump(T, 260, 110, 0.02, 0.05, 0.6);
      s.burst(T, 0.001, 0.04, 0.5, 'bandpass', 2000, 1.4, s.out, 'pink');
    },
  },
  arrowStick: {
    // thunk into wood or dirt, the shaft quivering
    dur: 0.35, variants: 3, level: 0.3, jitter: 1, maxVoices: 4, dedupe: 0.03,
    render(s) {
      s.thump(T, 320, 140, 0.02, 0.05, 0.7);
      const o = s.osc('triangle', s.r(180, 220), T + 0.01, 0.25, s.vca(T + 0.01, 0.002, 0.18, 0.22));
      o.detune.setValueAtTime(0, T);
      for (let i = 0; i < 6; i++) o.detune.setValueAtTime(i % 2 ? 40 : -40, T + 0.02 + i * 0.03);
    },
  },
  wallRise: {
    // a rumble and a run of chunky block thuds as the hill bursts up
    dur: 1.1, level: 0.5, reverb: 0.16, maxVoices: 2,
    render(s) {
      s.burst(T, 0.08, 0.7, 0.45, 'lowpass', 220, 0.8, s.out, 'brown');
      for (let i = 0; i < 7; i++) {
        const t = T + i * 0.045 + s.r(0, 0.015);
        s.thump(t, s.r(150, 190), 55, 0.04, 0.09, 0.55 - i * 0.04);
        crunch(s, t, 0.35, s.r(700, 1300));
      }
    },
  },
  blockBreak: {
    // blocks crumbling: lots of little crunches
    dur: 0.9, level: 0.42, maxVoices: 2,
    render(s) {
      for (let i = 0; i < 9; i++) crunch(s, T + i * 0.06 + s.r(0, 0.03), s.r(0.25, 0.45), s.r(800, 1800));
      s.thump(T, 120, 50, 0.05, 0.15, 0.4);
    },
  },
  stepSteve: {
    // a dull step on blocky boots
    dur: 0.18, variants: 6, level: 0.24, jitter: 1, maxVoices: 10, dedupe: 0,
    render(s) {
      s.thump(T, 140, 70, 0.02, 0.05, 0.5);
      s.burst(T, 0.002, 0.05, 0.4, 'lowpass', s.r(700, 1100), 0.8, s.out, 'pink');
    },
  },
  commSteve: {
    // subtitle stinger: a soft blocky "pop" like an item pickup
    dur: 0.3, level: 0.16, bus: 'ui',
    render(s) {
      const o = s.osc('square', 520, T, 0.1, s.filter('lowpass', 2400, 0.7, s.vca(T, 0.004, 0.3, 0.08)));
      o.frequency.exponentialRampToValueAtTime(1040, T + 0.07);
    },
  },
  dragonSummon: {
    // the End portal tears open: a deep sub drop, a shimmering whoosh and a choir-like hum
    dur: 2.4, level: 0.6, reverb: 0.4, stereo: true,
    render(s) {
      s.thump(T, 90, 28, 0.6, 1.2, 1);
      const f = s.filter('bandpass', 400, 1.5, s.vca(T, 0.5, 0.5, 1.6));
      s.noise(T, 2.2, f, 'pink');
      f.frequency.exponentialRampToValueAtTime(2600, T + 1.4);
      s.partials(110, [[1, 0.15, 2], [1.5, 0.1, 1.8], [2.02, 0.08, 1.6], [3.01, 0.05, 1.4]], T + 0.2, s.out, 1.5, 0.4);
    },
  },
  dragonRoar: {
    // a huge growling roar: detuned saws through a formant filter with a rumble underneath
    dur: 2.2, level: 0.7, reverb: 0.35, stereo: true,
    render(s) {
      const sh = s.shaper(3, s.out);
      const form = s.filter('bandpass', 520, 2.2, s.vca(T, 0.25, 0.7, 1.6, sh));
      for (const d of [-14, 0, 11]) {
        const o = s.osc('sawtooth', 82, T, 2, form, d);
        o.frequency.linearRampToValueAtTime(118, T + 0.5);
        o.frequency.linearRampToValueAtTime(64, T + 1.9);
      }
      const n = s.filter('bandpass', 900, 1.2, s.vca(T, 0.2, 0.35, 1.5));
      s.noise(T, 1.9, n, 'pink');
      s.thump(T, 70, 30, 0.4, 1, 0.6);
    },
  },
  dragonDive: {
    // wind tearing past as it dives
    dur: 1.2, level: 0.4, reverb: 0.2,
    render(s) {
      const f = s.filter('bandpass', 500, 1, s.vca(T, 0.5, 0.6, 0.6));
      s.noise(T, 1.1, f, 'pink');
      f.frequency.exponentialRampToValueAtTime(1800, T + 0.8);
    },
  },
  dragonFlap: {
    // one leathery wing beat
    dur: 0.6, variants: 3, level: 0.4, jitter: 0.8, maxVoices: 3, reverb: 0.2,
    render(s) {
      s.burst(T, 0.08, 0.35, 0.8, 'lowpass', 380, 0.9, s.out, 'brown');
      s.thump(T + 0.06, 80, 40, 0.1, 0.25, 0.5);
      s.burst(T + 0.05, 0.02, 0.12, 0.25, 'bandpass', 1100, 1.2, s.out, 'pink');
    },
  },
  dragonBreathStart: {
    // the jaws open: a hissing intake into a whoomp
    dur: 0.7, level: 0.5, reverb: 0.2,
    render(s) {
      const f = s.filter('highpass', 2500, 0.7, s.vca(T, 0.2, 0.3, 0.05));
      s.noise(T, 0.25, f, 'white');
      s.thump(T + 0.22, 140, 45, 0.15, 0.3, 0.9, s.shaper(2, s.out));
      s.burst(T + 0.22, 0.01, 0.35, 0.6, 'lowpass', 1600, 0.8, s.out, 'pink');
    },
  },
  dragonBreath: {
    // the stream of fire: a roaring, crackling torrent with an eerie whistling top
    dur: 2, loop: true, level: 0.5, reverb: 0.1,
    raw(sr: number) {
      return [loopNoise(sr, 2, 4321, (x, i, st) => {
        st[0] += (x - st[0]) * 0.08; // roar (low)
        st[1] += (x - st[1]) * 0.45; st[2] += (st[1] - st[2]) * 0.45; // hiss band
        const crack = Math.abs(x) > 0.997 ? x * 4 : 0;
        st[3] += (crack - st[3]) * 0.5;
        const t = i / sr;
        const whistle = Math.sin(2 * Math.PI * 1320 * t + Math.sin(2 * Math.PI * 3 * t) * 3) * 0.04;
        return st[0] * 2.6 + (st[1] - st[2]) * 0.5 + st[3] + whistle;
      })];
    },
  },
} satisfies Record<string, Recipe>;

export const STEVE_ULT_SFX = ['dragonSummon', 'dragonRoar', 'dragonDive', 'dragonFlap', 'dragonBreathStart', 'dragonBreath'] as const;
export const STEVE_BAKE = ['swordSwing', 'swordHit', 'swordCrit', 'itemSwap', 'bowDraw', 'bowFull', 'bowShoot', 'bowShootFull', 'arrowHit', 'arrowStick', 'wallRise', 'blockBreak', 'stepSteve', 'commSteve', 'dragonSummon', 'dragonRoar', 'dragonDive', 'dragonFlap', 'dragonBreathStart', 'dragonBreath'] as const;
