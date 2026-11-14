import type { Synth } from './synth';
import type { Recipe } from './bank';

/**
 * The T-Rex's sound patches (spread into RECIPES in bank.ts). Procedural fallbacks: the ElevenLabs recordings in
 * scripts/sfx/manifest.mjs replace each one once decoded. A roar is a growl of detuned saws through moving vocal
 * formants over a sub rumble; steps are huge low thuds with dirt.
 */
const T = 0.004;

function wet(s: Synth, seconds: number, amount: number) {
  const rev = s.reverb(seconds, amount, s.out, 2.4, 0.5);
  const mix = s.gain(1);
  mix.connect(rev);
  return mix;
}

/** A throaty growl: detuned saws -> drive -> two moving formants, with a breath of noise. */
function growl(s: Synth, t: number, dur: number, f0: number, f1: number, amp: number, dest: AudioNode, open = 1) {
  const out = s.gain(0, dest);
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(amp, t + Math.min(0.25, dur * 0.25));
  out.gain.setValueAtTime(amp, t + dur * 0.7);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const f1a = s.filter('bandpass', 420 * open, 3, out), f2a = s.filter('bandpass', 1100 * open, 4, out);
  const lp = s.filter('lowpass', 2600, 0.7, out);
  for (const f of [f1a.frequency, f2a.frequency]) { f.setValueAtTime(f.value * 0.7, t); f.linearRampToValueAtTime(f.value * 1.25, t + dur * 0.4); f.linearRampToValueAtTime(f.value * 0.8, t + dur); }
  const drive = s.shaper(3.2, s.gain(1, f1a));
  drive.connect(f2a); drive.connect(lp);
  for (const det of [-14, 0, 11]) {
    const o = s.osc('sawtooth', f0, t, dur, drive, det);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f1, t + dur * 0.35);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dur);
    // jitter in the vocal folds
    const lfo = s.osc('triangle', s.r(17, 24), t, dur, s.gain(f0 * 0.06, o.frequency));
    void lfo;
  }
  s.burst(t, dur * 0.2, dur * 0.8, amp * 0.5, 'bandpass', 900 * open, 0.7, out, 'pink');
}

export const TREX_RECIPES = {
  rexStep: {
    // a multi-tonne footfall: sub thud, a dull crunch of dirt, a little rattle
    dur: 0.7, variants: 5, level: 0.62, jitter: 1.2, maxVoices: 6, reverb: 0.2, dedupe: 0.05,
    render(s) {
      s.thump(T, 70, 32, 0.12, 0.42, 1, s.shaper(1.8, s.out));
      s.burst(T, 0.002, 0.16, 0.6, 'lowpass', 700, 0.8, s.out, 'brown');
      s.burst(T + 0.01, 0.003, 0.09, 0.3, 'bandpass', 1800, 1.2, s.out, 'pink');
      s.crackle(T + 0.02, 0.2, 12, 0.18, s.out, 1500, 5000, 1.5);
    },
  },
  rexSnap: {
    // the jaws thrown open: a short growl and a whoosh of the head
    dur: 0.6, variants: 3, level: 0.5, jitter: 1.5, maxVoices: 4, reverb: 0.12,
    render(s) {
      growl(s, T, 0.45, s.r(70, 85), s.r(100, 120), 0.5, s.out, 0.8);
      s.burst(T + 0.05, 0.12, 0.2, 0.25, 'bandpass', 700, 0.8, s.out, 'pink');
    },
  },
  rexChomp: {
    // teeth slamming shut on something: a heavy wet clack and a thud
    dur: 0.45, variants: 4, level: 0.62, jitter: 1.2, maxVoices: 5, dedupe: 0.04, reverb: 0.1,
    render(s) {
      s.burst(T, 0.0004, 0.02, 0.9, 'bandpass', 2400, 2.5);
      s.burst(T + 0.012, 0.0004, 0.025, 0.7, 'bandpass', 1500, 2.5);
      s.thump(T, 140, 50, 0.06, 0.18, 0.9, s.shaper(2, s.out));
      s.burst(T + 0.01, 0.003, 0.12, 0.35, 'lowpass', 900, 0.8, s.out, 'pink');
    },
  },
  rexSweep: {
    // the tail scything round: a long heavy whoosh
    dur: 0.8, variants: 2, level: 0.5, jitter: 1, maxVoices: 3, reverb: 0.12,
    render(s) {
      const g = s.gain(0); s.swell(g.gain, T, 0.32, 0.8, 0.3);
      const bp = s.filter('bandpass', 300, 1.2, g);
      bp.frequency.setValueAtTime(250, T); bp.frequency.exponentialRampToValueAtTime(900, T + 0.3); bp.frequency.exponentialRampToValueAtTime(200, T + 0.65);
      s.noise(T, 0.7, bp, 'pink');
      growl(s, T, 0.5, 60, 72, 0.25, s.out, 0.7);
    },
  },
  rexSweepHit: {
    dur: 0.6, variants: 3, level: 0.55, jitter: 1.2, maxVoices: 4, dedupe: 0.05, reverb: 0.15,
    render(s) {
      s.thump(T, 110, 40, 0.1, 0.35, 1, s.shaper(2.2, s.out));
      s.burst(T, 0.001, 0.1, 0.6, 'lowpass', 1400, 0.7, s.out, 'pink');
      s.burst(T + 0.02, 0.01, 0.3, 0.3, 'lowpass', 400, 0.7, s.out, 'brown');
    },
  },
  stampede: {
    // head down: a snorting bellow and the ground starting to drum
    dur: 1.4, level: 0.75, reverb: 0.2,
    render(s) {
      const mix = wet(s, 1.6, 0.25);
      growl(s, T, 0.9, 62, 95, 0.7, mix, 0.9);
      for (let i = 0; i < 4; i++) s.thump(T + 0.12 + i * 0.22, 75, 35, 0.1, 0.3, 0.7 - i * 0.08, mix);
      s.burst(T, 0.02, 0.25, 0.4, 'bandpass', 600, 1, mix, 'pink');
    },
  },
  rexCrash: {
    // head-first into a wall
    dur: 1.6, level: 0.9, reverb: 0.3, stereo: true,
    render(s) {
      const mix = wet(s, 2, 0.3);
      s.burst(T, 0.0004, 0.04, 1, 'highpass', 900, 0.6, mix);
      s.thump(T, 95, 28, 0.35, 0.9, 1, s.shaper(2.6, mix));
      s.burst(T + 0.01, 0.003, 0.5, 0.6, 'lowpass', 1600, 0.7, mix, 'pink');
      s.crackle(T, 0.9, 60, 0.35, mix, 900, 5000, 2);
    },
  },
  rexRumble: {
    // rearing up: a growl swelling from deep in the chest while the ground starts to shake
    dur: 1.0, level: 0.8, reverb: 0.25, stereo: true,
    render(s) {
      const mix = wet(s, 2, 0.3);
      growl(s, T, 0.95, 45, 58, 0.55, mix, 0.6);
      const g = s.gain(0, mix); s.swell(g.gain, T, 0.8, 0.7, 0.15);
      s.noise(T, 0.95, s.filter('lowpass', 120, 0.8, g), 'brown');
    },
  },
  rexRoar: {
    // THE roar: a huge layered bellow, rising then breaking, with a sub that you feel
    dur: 3.2, level: 1, reverb: 0.3, stereo: true,
    render(s) {
      const mix = wet(s, 3, 0.4);
      growl(s, T, 2.4, 70, 128, 0.85, mix, 1);
      growl(s, T + 0.03, 2.3, 52, 90, 0.6, s.pan(-0.3, mix), 0.75);
      growl(s, T + 0.05, 2.2, 104, 170, 0.4, s.pan(0.3, mix), 1.25);
      s.thump(T, 55, 24, 0.9, 2.4, 0.8, mix);
      s.burst(T, 0.15, 2, 0.4, 'bandpass', 1500, 0.6, mix, 'pink');
    },
  },
  meteorFall: {
    // a burning rock tearing down through the air
    dur: 0.9, variants: 3, level: 0.45, jitter: 2, maxVoices: 4, reverb: 0.15, dedupe: 0.08,
    render(s) {
      const g = s.gain(0); s.swell(g.gain, T, 0.75, 0.8, 0.08);
      const bp = s.filter('bandpass', 2600, 1.5, g);
      bp.frequency.exponentialRampToValueAtTime(500, T + 0.75);
      s.noise(T, 0.85, bp, 'white');
      s.crackle(T, 0.8, 30, 0.2, g, 2000, 7000, 0.7);
    },
  },
  meteorImpact: {
    dur: 1.6, variants: 4, level: 0.75, jitter: 1.5, maxVoices: 6, reverb: 0.25, dedupe: 0.04,
    render(s) {
      s.burst(T, 0.0004, 0.03, 0.9, 'highpass', 1000, 0.6);
      s.thump(T, 85, 26, 0.3, 0.9, 1, s.shaper(2.4, s.out));
      s.burst(T + 0.005, 0.003, 0.45, 0.6, 'lowpass', 1800, 0.7, s.out, 'pink');
      s.crackle(T + 0.02, 1, 50, 0.3, s.out, 1200, 6000, 2);
      s.burst(T + 0.05, 0.1, 1.1, 0.25, 'lowpass', 220, 0.7, s.out, 'brown');
    },
  },
} satisfies Record<string, Recipe>;

export const TREX_ULT_SFX = ['rexRumble', 'rexRoar', 'meteorImpact', 'meteorFall'] as const;
export const TREX_BAKE = ['rexStep', 'rexSnap', 'rexChomp', 'rexSweep', 'rexSweepHit', 'stampede', 'rexCrash', 'rexRumble', 'rexRoar', 'meteorFall', 'meteorImpact'] as const;
