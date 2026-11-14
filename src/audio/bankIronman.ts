import { mulberry, type Synth } from './synth';
import type { Recipe } from './bank';

/**
 * Iron Man's sound patches (spread into RECIPES in bank.ts). Repulsors are a charged whump with a
 * metallic ring, missiles hiss off the pods and crack, the jet boots roar, and the Unibeam is a
 * rising reactor whine that tears open into a sustained, crackling energy roar.
 */
const T = 0.004;

function wet(s: Synth, seconds: number, amount: number) {
  const rev = s.reverb(seconds, amount, s.out, 2.5, 0.55);
  const mix = s.gain(1);
  mix.connect(rev);
  return mix;
}

/** Seamless noise loop: one-pole filtered noise with the tail crossfaded into the head. */
function loopNoise(sr: number, seconds: number, seed: number, shape: (x: number, i: number, st: number[]) => number) {
  const n = Math.round(sr * seconds), fade = Math.round(sr * 0.08);
  const rnd = mulberry(seed);
  const raw = new Float32Array(n + fade);
  const st = [0, 0, 0, 0];
  for (let i = 0; i < raw.length; i++) raw[i] = shape(rnd() * 2 - 1, i, st);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i];
  for (let i = 0; i < fade; i++) { const k = i / fade; out[i] = raw[i] * k + raw[n + i] * (1 - k); }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.9 / (peak || 1);
  return out;
}

export const IRONMAN_RECIPES = {
  repulsor: {
    // ionised whump: a down-chirp body, a bright crack, a ringing metallic tail
    dur: 0.36, variants: 4, level: 0.42, jitter: 0.6, maxVoices: 6, reverb: 0.12,
    render(s) {
      s.thump(T, 260, 70, 0.05, 0.09, 0.8, s.shaper(1.8, s.out));
      const z = s.osc('sawtooth', s.r(1700, 2100), T, 0.12, s.filter('lowpass', 4200, 1.2, s.vca(T, 0.001, 0.28, 0.1)));
      z.frequency.exponentialRampToValueAtTime(240, T + 0.1);
      s.burst(T, 0.0004, 0.018, 0.75, 'highpass', 3800, 0.8);
      s.burst(T, 0.001, 0.06, 0.35, 'bandpass', 900, 1.4, s.out, 'pink');
      const ring = s.fm(s.r(1450, 1600), 1.41, 2.5, T + 0.005, 0.26, s.vca(T + 0.005, 0.002, 0.12, 0.24), 0.2);
      ring.frequency.exponentialRampToValueAtTime(1150, T + 0.25);
    },
  },
  repulsorHit: {
    dur: 0.3, variants: 3, level: 0.3, jitter: 1, maxVoices: 4, dedupe: 0.05,
    render(s) {
      s.crackle(T, 0.08, 9, 0.6, s.out, 2500, 9000, 1);
      s.thump(T, 180, 70, 0.03, 0.06, 0.5);
      const o = s.osc('square', s.r(1100, 1400), T, 0.08, s.filter('bandpass', 1800, 2, s.vca(T, 0.001, 0.22, 0.07)));
      o.frequency.exponentialRampToValueAtTime(400, T + 0.07);
    },
  },
  missilePods: {
    // servo whir and two latches as the shoulder pods flip open
    dur: 0.45, level: 0.4, reverb: 0.1,
    render(s) {
      const bp = s.filter('bandpass', 1500, 5, s.vca(T, 0.02, 0.2, 0.18));
      const sv = s.osc('sawtooth', 500, T, 0.22, bp);
      sv.frequency.exponentialRampToValueAtTime(1500, T + 0.18);
      for (const at of [T + 0.1, T + 0.17]) { s.burst(at, 0.0005, 0.015, 0.6, 'bandpass', s.r(2500, 4000), 3); s.thump(at, 300, 160, 0.02, 0.04, 0.3); }
      s.burst(T + 0.18, 0.01, 0.2, 0.25, 'highpass', 3000, 0.7);
    },
  },
  missileLaunch: {
    // a pop out of the tube and a hissing rocket motor tearing away
    dur: 0.7, variants: 4, level: 0.34, jitter: 1.2, maxVoices: 6, reverb: 0.15,
    render(s) {
      s.thump(T, 200, 80, 0.03, 0.06, 0.6);
      s.burst(T, 0.0005, 0.02, 0.5, 'bandpass', 2400, 1.5);
      const g = s.gain(0);
      s.swell(g.gain, T + 0.01, 0.04, 0.5, 0.5);
      const bp = s.filter('bandpass', 2600, 0.9, g);
      s.sweep(bp.frequency, T, 2600, 900, 0.6);
      s.noise(T, 0.62, bp);
      s.noise(T, 0.5, s.filter('lowpass', 500, 0.7, s.vca(T, 0.02, 0.35, 0.4)), 'brown');
    },
  },
  missileBoom: {
    // sharp crack, a short boom and debris
    dur: 1.0, variants: 3, level: 0.45, jitter: 1.5, maxVoices: 5, dedupe: 0.03, reverb: 0.25,
    render(s) {
      const mix = wet(s, 1.2, 0.25);
      s.burst(T, 0.0004, 0.03, 0.9, 'highpass', 1500, 0.7, mix);
      s.thump(T, 130, 40, 0.1, 0.3, 1, s.shaper(2.2, mix));
      s.burst(T, 0.002, 0.35, 0.5, 'lowpass', 1600, 0.7, mix, 'pink');
      s.crackle(T + 0.05, 0.4, 14, 0.25, mix, 1500, 6000);
    },
  },
  jetIgnite: {
    // the boot thrusters catch: a whoomp and a rising hiss
    dur: 0.55, level: 0.42, jitter: 0.5, maxVoices: 3, dedupe: 0.1, reverb: 0.12,
    render(s) {
      s.thump(T, 140, 60, 0.05, 0.12, 0.6);
      const g = s.gain(0);
      s.swell(g.gain, T, 0.12, 0.5, 0.35);
      const bp = s.filter('bandpass', 700, 0.8, g);
      s.sweep(bp.frequency, T, 700, 3200, 0.3);
      s.noise(T, 0.5, bp, 'pink');
    },
  },
  jetLoop: {
    // jet-boot roar: low rumble + a hissy flame band with a slow flutter; playback rate follows the thrust
    dur: 2, level: 0.32, loop: true, ref: 4, rolloff: 0.08,
    raw(sr) {
      return [loopNoise(sr, 2, 77, (x, i, st) => {
        st[0] += (x - st[0]) * 0.02; // rumble
        st[1] += (x - st[1]) * 0.35; st[2] += (st[1] - st[2]) * 0.35; // hiss band
        const flutter = 0.8 + 0.2 * Math.sin((i / sr) * Math.PI * 2 * 7);
        return st[0] * 9 + (st[1] - st[2]) * 1.6 * flutter;
      })];
    },
  },
  unibeamCharge: {
    // arc reactor spinning up: a rising whine stack, servo clicks and a reverse rush into the release
    dur: 0.75, level: 0.7,
    render(s) {
      const E = T + 0.6;
      const sg = s.gain(0);
      sg.gain.setValueAtTime(0.0001, T); sg.gain.exponentialRampToValueAtTime(0.32, E); sg.gain.linearRampToValueAtTime(0, E + 0.04);
      const lp = s.filter('lowpass', 600, 6, sg);
      s.sweep(lp.frequency, T, 600, 9000, 0.6);
      for (const m of [1, 1.5, 2, 3]) {
        const o = s.osc('sawtooth', 220 * m, T, 0.66, lp, s.r(-6, 6));
        o.frequency.exponentialRampToValueAtTime(880 * m, E);
      }
      const w = s.osc('sine', 1200, T, 0.66, s.vca(T, 0.3, 0.14, 0.3));
      w.frequency.exponentialRampToValueAtTime(5200, E);
      for (let i = 0; i < 5; i++) { const at = T + i * 0.1; s.burst(at, 0.0005, 0.01, 0.35, 'bandpass', 3500, 3); }
      const ng = s.gain(0);
      s.swell(ng.gain, T + 0.1, 0.5, 0.45, 0.03);
      s.noise(T + 0.1, 0.55, s.filter('highpass', 2000, 0.7, ng), 'pink');
    },
  },
  unibeamFire: {
    // the release: a concussive blast with a tearing electric crack on top
    dur: 1.6, level: 0.75, reverb: 0.3,
    render(s) {
      const mix = wet(s, 1.8, 0.35);
      s.thump(T, 110, 32, 0.2, 0.5, 1, s.shaper(2.4, mix));
      s.burst(T, 0.0005, 0.05, 0.9, 'highpass', 2000, 0.7, mix);
      s.crackle(T, 0.5, 30, 0.5, mix, 2000, 10000, 1.2);
      const z = s.osc('sawtooth', 3000, T, 0.4, s.filter('lowpass', 6000, 1, s.vca(T, 0.001, 0.25, 0.35, mix)));
      z.frequency.exponentialRampToValueAtTime(200, T + 0.38);
      s.burst(T, 0.01, 0.9, 0.35, 'lowpass', 1200, 0.7, mix, 'pink');
    },
  },
  unibeamLoop: {
    // sustained beam: a droning reactor chord, a bright sizzle band and electric crackle
    dur: 2, level: 0.55, loop: true, ref: 16, rolloff: 0.04,
    raw(sr) {
      const tone = (i: number) => {
        const t = i / sr;
        // integer cycles over 2 s so the tones loop seamlessly
        return Math.sin(2 * Math.PI * 110 * t) * 0.35 + Math.sin(2 * Math.PI * 165 * t) * 0.22 + Math.sin(2 * Math.PI * 220.5 * t) * 0.18
          + Math.sin(2 * Math.PI * 55 * t + Math.sin(2 * Math.PI * 3 * t) * 2) * 0.3;
      };
      return [loopNoise(sr, 2, 1234, (x, i, st) => {
        st[0] += (x - st[0]) * 0.5; st[1] += (st[0] - st[1]) * 0.5; // sizzle (band)
        const crackle = Math.abs(x) > 0.9985 ? x * 6 : 0;
        st[2] += (crackle - st[2]) * 0.6;
        return Math.tanh(tone(i) * 1.6) * 0.6 + (st[0] - st[1]) * 0.9 + st[2];
      })];
    },
  },
  stepIronman: {
    // armoured boots: a heavy metal clank, a servo tick and a little rattle
    dur: 0.3, variants: 6, level: 0.3, reverb: 0.14, jitter: 0.8, maxVoices: 10, dedupe: 0,
    render(s) {
      s.thump(T, 120, 55, 0.03, 0.08, 0.7);
      s.partials(s.r(380, 460), [[1, 0.25, 0.08], [2.71, 0.12, 0.06], [4.1, 0.08, 0.04]], T, s.out);
      s.burst(T, 0.0005, 0.025, 0.45, 'bandpass', s.r(2200, 3200), 2);
      const o = s.osc('square', 900, T + 0.03, 0.04, s.filter('bandpass', 2400, 4, s.vca(T + 0.03, 0.002, 0.06, 0.035)));
      o.frequency.exponentialRampToValueAtTime(1500, T + 0.065);
    },
  },
} satisfies Record<string, Recipe>;

/** Specials carry across the whole arena and are never ducked by the moment they create. */
export const IRONMAN_ULT_SFX = ['unibeamCharge', 'unibeamFire', 'unibeamLoop'] as const;
export const IRONMAN_BAKE = ['repulsor', 'repulsorHit', 'missilePods', 'missileLaunch', 'missileBoom', 'jetIgnite', 'jetLoop', 'stepIronman', 'unibeamCharge', 'unibeamFire', 'unibeamLoop'] as const;
