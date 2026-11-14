import { Synth, semi, mulberry } from './synth';

/**
 * The sound bank. Each recipe is a small sound-design patch rendered offline once
 * (see synth.ts). Layers are described in comments so they are easy to tweak.
 */
export interface Recipe {
  dur: number;
  /** Bake in stereo (wide, mostly non-positional sounds). */
  stereo?: boolean;
  /** Number of baked takes; playback picks one (or the caller does). */
  variants?: number;
  /** Mix level after peak normalization. */
  level?: number;
  /** Random pitch spread at playback, in semitones. */
  jitter?: number;
  /** Concurrent copies before the oldest is stolen. */
  maxVoices?: number;
  /** Reverb send (scaled up with distance). */
  reverb?: number;
  /** Minimum seconds between two triggers of this sound. */
  dedupe?: number;
  /**
   * sfx: the world (ducked, filtered by low health / slow motion). ui: interface and personal feedback.
   * ult: specials, which cut through the ducking they cause. amb: the room itself.
   */
  bus?: 'sfx' | 'ui' | 'ult' | 'amb';
  /** Distance (m) inside which a placed sound plays at full level. */
  ref?: number;
  /** How fast it fades past `ref` (gain = 1 / (1 + (d - ref) * rolloff)). */
  rolloff?: number;
  /** Muffle when the desk's clutter stands between it and you (default: placed sfx do). */
  occlude?: boolean;
  loop?: boolean;
  /** When a recorded sample replaces the patch: variant n plays the one sample shifted by these semitones. */
  pitchVariants?: number[];
  /** Sample-only sound (no procedural patch, never baked). */
  sampleOnly?: boolean;
  render?(s: Synth, v: number): void;
  raw?(sr: number, v: number): Float32Array[];
}

const T = 0.004;
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
/** Yeat's Bell Ring notes (semitones over Bb4); the kit plays them as a riff. */
export const BELL_SEMIS = [0, 3, 5, 7, 10];

// ───────────────────────── shared layers ─────────────────────────

function hitClick(s: Synth, t: number, f: number, amp: number) {
  s.burst(t, 0.0004, 0.008, 0.8 * amp, 'bandpass', 5200, 1.2);
  const g = s.vca(t, 0.001, 0.6 * amp, 0.055);
  const o = s.osc('sine', f, t, 0.07, g);
  o.frequency.exponentialRampToValueAtTime(f * 0.76, t + 0.04);
  s.thump(t, 320, 180, 0.03, 0.04, 0.35 * amp);
}

/** Metal crunch: crumple bursts, a ringing panel, debris tinkles, low thud. */
function metalCrash(s: Synth, t: number, amp: number, dest: AudioNode = s.out) {
  s.thump(t, 120, 38, 0.15, 0.4, 0.9 * amp, s.shaper(2, dest));
  for (let i = 0; i < 10; i++) {
    const at = t + s.r(0, 0.15);
    s.burst(at, 0.0005, s.r(0.02, 0.07), s.r(0.3, 0.75) * amp, 'bandpass', s.r(900, 3400), s.r(1.5, 4), dest);
  }
  s.partials(s.r(280, 340), [[1, 0.25 * amp, 0.75], [1.47, 0.2 * amp, 0.55], [2.09, 0.16 * amp, 0.45], [2.56, 0.12 * amp, 0.35], [3.6, 0.07 * amp, 0.2]], t, dest, 0.012);
  for (let i = 0; i < 12; i++) {
    const at = t + 0.08 + Math.pow(s.rnd(), 1.5) * 0.8;
    s.partials(s.r(2500, 5200), [[1, s.r(0.04, 0.13) * amp, 0.07]], at, dest);
  }
  s.burst(t, 0.002, 0.5, 0.45 * amp, 'lowpass', 320, 0.7, dest, 'pink');
}

/** A send bus that feeds both the dry output and a baked reverb. */
function wetBus(s: Synth, seconds: number, wet: number, decay = 2.5, bright = 0.55) {
  const rev = s.reverb(seconds, wet, s.out, decay, bright);
  const mix = s.gain(1);
  mix.connect(rev);
  return mix;
}

// ───────────────────────── the bank ─────────────────────────

export const RECIPES = {
  // ── interface ──
  ui: {
    dur: 0.14, level: 0.3, bus: 'ui',
    render(s) {
      s.burst(T, 0.0005, 0.012, 0.6, 'highpass', 4500, 0.7);
      const o = s.osc('sine', 1500, T, 0.08, s.vca(T, 0.001, 0.7, 0.06));
      o.frequency.exponentialRampToValueAtTime(1050, T + 0.05);
      s.osc('triangle', 3000, T, 0.05, s.vca(T, 0.001, 0.2, 0.03));
    },
  },
  uiHover: {
    dur: 0.07, level: 0.09, bus: 'ui',
    render(s) {
      s.osc('sine', 2300, T, 0.04, s.vca(T, 0.001, 0.6, 0.025));
      s.burst(T, 0.0004, 0.006, 0.3, 'highpass', 6000, 0.7);
    },
  },
  uiTab: {
    // soft rising flick between tabs
    dur: 0.16, level: 0.2, bus: 'ui',
    render(s) {
      const o = s.osc('triangle', 820, T, 0.1, s.vca(T, 0.002, 0.6, 0.08));
      o.frequency.exponentialRampToValueAtTime(1500, T + 0.07);
      s.burst(T, 0.0005, 0.01, 0.3, 'highpass', 5000, 0.7);
    },
  },
  uiBack: {
    // the same flick, falling
    dur: 0.18, level: 0.2, bus: 'ui',
    render(s) {
      const o = s.osc('sine', 1100, T, 0.13, s.vca(T, 0.002, 0.7, 0.1));
      o.frequency.exponentialRampToValueAtTime(520, T + 0.11);
      s.burst(T, 0.0005, 0.01, 0.25, 'highpass', 4500, 0.7);
    },
  },
  lockIn: {
    // airy whoosh into a bright rising chord with a sub drop: the legend is chosen
    dur: 1.6, level: 0.6, bus: 'ui', stereo: true,
    render(s) {
      const mix = wetBus(s, 1.6, 0.35);
      const bp = s.filter('bandpass', 400, 0.8, s.vca(T, 0.12, 0.35, 0.35, mix));
      s.sweep(bp.frequency, T, 400, 5000, 0.35);
      s.noise(T, 0.6, bp, 'pink');
      [0, 7, 12, 16, 19].forEach((n, i) => s.pluck(523.25 * semi(n), T + 0.05 + i * 0.035, 1.3, s.pan(-0.5 + i * 0.25, mix), 0.4, 0.7, 0.997));
      const pad = s.vca(T + 0.05, 0.01, 0.12, 1.1, mix);
      for (const n of [0, 7, 16]) s.osc('triangle', 523.25 * semi(n), T + 0.05, 1.2, pad, s.r(-5, 5));
      s.thump(T, 110, 50, 0.35, 0.45, 0.8, s.shaper(1.6, mix));
      s.partials(2093, [[1, 0.1, 0.7], [2.76, 0.03, 0.3]], T + 0.2, mix);
    },
  },
  denied: {
    dur: 0.3, level: 0.26, bus: 'ui', dedupe: 0.15,
    render(s) {
      [[0, 196], [0.075, 165]].forEach(([dt, f]) => {
        const lp = s.filter('lowpass', 1300, 0.8, s.vca(T + dt, 0.002, 0.6, 0.08));
        s.osc('triangle', f, T + dt, 0.1, lp);
        s.osc('square', f, T + dt, 0.1, s.gain(0.15, lp));
      });
    },
  },
  countdown: {
    dur: 1.0, level: 0.5, bus: 'ui', stereo: true,
    render(s) {
      const mix = wetBus(s, 1.2, 0.25);
      s.thump(T, 190, 110, 0.05, 0.45, 0.8, mix);
      s.partials(660, [[1, 0.5, 0.4], [2, 0.18, 0.25], [2.76, 0.14, 0.16]], T, mix);
      s.burst(T, 0.0005, 0.01, 0.5, 'bandpass', 3000, 1, mix);
    },
  },
  go: {
    dur: 2.8, level: 0.85, bus: 'ui', stereo: true,
    render(s) {
      const mix = wetBus(s, 2.2, 0.35);
      s.thump(T, 110, 36, 0.25, 1.2, 1.0, s.shaper(1.8, mix));
      const lp = s.filter('lowpass', 7000, 0.7, s.vca(T, 0.002, 0.7, 1.0, mix));
      s.sweep(lp.frequency, T, 7000, 250, 0.9);
      s.noise(T, 1.1, lp, 'pink');
      // bright A-major add9 stab, spread wide
      const notes = [0, 4, 7, 12, 14, 19];
      const g = s.vca(T, 0.004, 0.32, 1.7, mix);
      const f = s.filter('lowpass', 5200, 1.2, g);
      f.frequency.setTargetAtTime(700, T + 0.05, 0.4);
      notes.forEach((n, i) => {
        const p = s.pan(i % 2 ? 0.55 : -0.55, f);
        for (const d of [-9, 9]) s.osc('sawtooth', 220 * semi(n), T, 1.8, p, d);
      });
      s.partials(1760, [[1, 0.14, 1.3], [1.5, 0.1, 1], [2, 0.07, 0.8]], T + 0.02, mix);
    },
  },
  ultReady: {
    dur: 2.0, level: 0.5, bus: 'ui', stereo: true,
    render(s) {
      const mix = wetBus(s, 1.8, 0.4);
      const sw = s.gain(0, mix);
      s.swell(sw.gain, T, 0.42, 0.5, 0.04);
      s.noise(T, 0.5, s.filter('highpass', 2200, 0.7, sw), 'pink');
      const notes = [0, 7, 12, 16, 19, 24];
      notes.forEach((n, i) => s.pluck(523.25 * semi(n), T + 0.44 + i * 0.055, 1.4, s.pan(-0.6 + i * 0.24, mix), 0.4, 0.7, 0.997));
      s.thump(T + 0.44, 95, 48, 0.15, 0.35, 0.6, mix);
      const pad = s.vca(T + 0.44, 0.08, 0.1, 1.3, mix);
      for (const n of [0, 7, 16]) s.osc('sine', 1046.5 * semi(n), T + 0.44, 1.4, pad, s.r(-6, 6));
    },
  },
  victory: {
    dur: 4.8, level: 0.8, bus: 'ui', stereo: true,
    render(s) {
      const mix = wetBus(s, 2.5, 0.35);
      const chords = [[0, 4, 7, 12], [5, 9, 12, 17], [7, 11, 14, 19], [0, 4, 7, 12, 16, 19]];
      const times = [0, 0.3, 0.6, 0.95];
      chords.forEach((ch, ci) => {
        const t = T + times[ci];
        const last = ci === chords.length - 1;
        const g = s.vca(t, 0.02, last ? 0.3 : 0.24, last ? 3.4 : 0.42, mix);
        const f = s.filter('lowpass', 800, 1.4, g);
        f.frequency.setValueAtTime(800, t);
        f.frequency.linearRampToValueAtTime(3800, t + 0.05);
        f.frequency.setValueAtTime(3800, t + 0.06);
        f.frequency.setTargetAtTime(1300, t + 0.06, last ? 0.8 : 0.2);
        ch.forEach((n, i) => {
          const p = s.pan((i / (ch.length - 1)) * 1.2 - 0.6, f);
          for (const d of [-7, 7]) s.osc('sawtooth', 196 * semi(n), t, last ? 3.6 : 0.5, p, d);
        });
        s.thump(t, 98 * semi(ch[0] - 12 + 12) * 0.5 * 2, 70, 0.08, last ? 0.9 : 0.35, 0.7, mix);
      });
      const cy = s.gain(0, mix);
      cy.gain.setValueAtTime(0, T + 0.95); cy.gain.linearRampToValueAtTime(0.22, T + 1.0); cy.gain.setValueAtTime(0.22, T + 1.05); cy.gain.setTargetAtTime(0, T + 1.05, 0.5);
      s.noise(T + 0.95, 3, s.filter('highpass', 5500, 0.7, cy));
      [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => s.pluck(784 * semi(n), T + 1.0 + i * 0.06, 1.8, s.pan(i % 2 ? 0.5 : -0.5, mix), 0.25, 0.7, 0.998));
    },
  },
  defeat: {
    dur: 4.4, level: 0.55, bus: 'ui', stereo: true,
    render(s) {
      const mix = wetBus(s, 3, 0.45);
      const chords = [[0, 3, 7], [-2, 2, 5], [-4, 0, 3, 8]];
      chords.forEach((ch, ci) => {
        const t = T + ci * 0.55;
        const last = ci === chords.length - 1;
        const g = s.vca(t, 0.12, 0.2, last ? 3 : 0.8, mix);
        const f = s.filter('lowpass', 1200, 0.7, g);
        ch.forEach((n, i) => { const p = s.pan(i % 2 ? 0.4 : -0.4, f); for (const d of [-6, 6]) s.osc('sawtooth', 196 * semi(n), t, last ? 3.2 : 1, p, d); });
      });
      s.osc('sine', 49, T, 3.5, s.vca(T, 0.4, 0.35, 3));
      s.partials(392 * semi(-4), [[1, 0.2, 2.2], [2.76, 0.07, 1], [5.4, 0.03, 0.5]], T + 1.15, mix);
    },
  },

  // ── combat feedback (local, non-positional) ──
  hit: {
    dur: 0.13, variants: 3, level: 0.3, jitter: 0.4, maxVoices: 4, bus: 'ui',
    render(s, v) { hitClick(s, T, 1850 + v * 70, 1); },
  },
  crit: {
    dur: 0.5, level: 0.38, maxVoices: 3, bus: 'ui',
    render(s) {
      hitClick(s, T, 2100, 0.8);
      s.partials(2400, [[1, 0.55, 0.32], [2.76, 0.25, 0.18], [5.4, 0.1, 0.09]], T + 0.004, s.out);
      s.fm(4800, 1.41, 1.5, T, 0.12, s.vca(T, 0.001, 0.12, 0.1));
    },
  },
  kill: {
    dur: 1.1, level: 0.5, stereo: true, bus: 'ui',
    render(s) {
      const mix = wetBus(s, 1.2, 0.25);
      s.thump(T, 140, 48, 0.12, 0.45, 0.9, s.shaper(2, mix));
      const bp = s.filter('bandpass', 800, 1.4, s.vca(T, 0.004, 0.4, 0.25, mix));
      s.sweep(bp.frequency, T, 800, 5200, 0.2);
      s.noise(T, 0.3, bp, 'pink');
      s.partials(1320, [[1, 0.35, 0.65], [1.5, 0.2, 0.5], [2.76, 0.18, 0.35], [4.1, 0.1, 0.2]], T + 0.01, mix, 0.003);
    },
  },
  hurt: {
    dur: 0.4, variants: 3, level: 0.42, maxVoices: 2, bus: 'ui',
    render(s) {
      s.thump(T, 150, 60, 0.12, 0.22, 0.9);
      s.burst(T, 0.001, 0.12, 0.6, 'lowpass', s.r(550, 800), 0.7, s.out, 'pink');
      s.burst(T, 0.0005, 0.03, 0.25, 'bandpass', 2200, 1.4);
    },
  },
  heal: {
    dur: 0.8, level: 0.2, bus: 'ui', dedupe: 0.5,
    render(s) {
      const mix = wetBus(s, 1.2, 0.35);
      [1318.5, 1760].forEach((f, i) => s.fm(f, 2, 0.6, T + i * 0.07, 0.6, s.vca(T + i * 0.07, 0.01, 0.4, 0.5, mix)));
    },
  },
  comm: {
    // stinger under a subtitle when a voice line has no recording yet (variant = hero)
    dur: 0.5, variants: 5, level: 0.16, bus: 'ui',
    render(s, v) {
      const mix = wetBus(s, 1, 0.3);
      if (v === 0) { // Einstein: soft theremin glide
        const o = s.osc('sine', 880, T, 0.3, s.vca(T, 0.03, 0.5, 0.25, mix));
        o.frequency.exponentialRampToValueAtTime(1320, T + 0.12);
      } else if (v === 1) { // Yeat: tiny bell + sub
        s.partials(1244.5, [[1, 0.45, 0.35], [2.76, 0.15, 0.15]], T, mix);
        s.thump(T, 110, 55, 0.05, 0.15, 0.45, mix);
      } else if (v === 2) { // Van Gogh: two plucked notes
        s.pluck(1046.5, T, 0.4, mix, 0.5, 0.6);
        s.pluck(1568, T + 0.06, 0.4, mix, 0.4, 0.6);
      } else if (v === 3) { // Blitzcrank: two square-wave robot beeps
        s.osc('square', 1318.5, T, 0.06, s.filter('lowpass', 4000, 1, s.vca(T, 0.002, 0.3, 0.05, mix)));
        s.osc('square', 987.8, T + 0.08, 0.08, s.filter('lowpass', 4000, 1, s.vca(T + 0.08, 0.002, 0.3, 0.07, mix)));
      } else { // Luffy (4): a rubbery boing
        const o = s.osc('triangle', 330, T, 0.3, s.vca(T, 0.005, 0.5, 0.25, mix));
        o.frequency.exponentialRampToValueAtTime(660, T + 0.05); o.frequency.exponentialRampToValueAtTime(420, T + 0.22);
        s.osc('sine', 7, T, 0.3, s.gain(40, o.frequency));
      }
    },
  },

  // ── Blitzcrank ──
  blitzJab: {
    // piston punch: pneumatic hiss, a fist of iron cutting the air, the piston slamming home
    dur: 0.45, variants: 3, level: 0.5, jitter: 0.8, maxVoices: 4, reverb: 0.1,
    render(s) {
      s.burst(T, 0.002, 0.09, 0.45, 'highpass', 3800, 0.7, s.out, 'white');
      const bp = s.filter('bandpass', 700, 1.4, s.vca(T, 0.01, 0.55, 0.12));
      s.sweep(bp.frequency, T, 500, 1900, 0.1);
      s.noise(T, 0.16, bp, 'pink');
      // piston: a short metallic knock, the clank of the rod hitting its stop
      s.partials(s.r(380, 430), [[1, 0.3, 0.12], [2.32, 0.18, 0.08], [3.9, 0.08, 0.05]], T + 0.07, s.out);
      s.thump(T + 0.07, 140, 70, 0.04, 0.09, 0.6);
      s.burst(T + 0.07, 0.0005, 0.02, 0.5, 'bandpass', 2600, 2);
    },
  },
  blitzPunchHit: {
    // iron knuckles land: meaty thud, a hollow metal clang and grit
    dur: 0.7, variants: 3, level: 0.62, jitter: 0.8, maxVoices: 4, reverb: 0.14, dedupe: 0.04,
    render(s) {
      s.thump(T, 160, 48, 0.08, 0.24, 1, s.shaper(2.4, s.out));
      s.burst(T, 0.0005, 0.05, 0.7, 'lowpass', 1800, 0.7, s.out, 'pink');
      s.partials(s.r(240, 290), [[1, 0.26, 0.4], [1.51, 0.18, 0.3], [2.43, 0.12, 0.22], [3.7, 0.06, 0.12]], T + 0.004, s.out, 0.01);
      s.crackle(T, 0.06, 10, 0.25, s.out, 1800, 6000, 1);
    },
  },
  blitzUppercut: {
    // the finisher: a rising whoosh, a huge clang, a sub boom that throws them skyward
    dur: 1.3, level: 0.8, reverb: 0.22, maxVoices: 3,
    render(s) {
      const mix = wetBus(s, 1.2, 0.25);
      const bp = s.filter('bandpass', 400, 1.6, s.vca(T, 0.06, 0.6, 0.12, mix));
      s.sweep(bp.frequency, T, 300, 2600, 0.12);
      s.noise(T, 0.2, bp, 'pink');
      const at = T + 0.13;
      s.thump(at, 120, 34, 0.25, 0.6, 1, s.shaper(3, mix));
      s.partials(196, [[1, 0.3, 0.9], [1.48, 0.22, 0.7], [2.21, 0.16, 0.5], [2.94, 0.1, 0.4], [4.1, 0.06, 0.25]], at, mix, 0.012);
      s.burst(at, 0.0005, 0.08, 0.6, 'lowpass', 2400, 0.7, mix, 'pink');
      s.crackle(at, 0.15, 18, 0.3, mix, 2000, 7000, 1.2);
    },
  },
  grabLaunch: {
    // Rocket Grab: the thrusters ignite, the arm decouples, the chain screams out of the shoulder
    dur: 0.9, level: 0.62, reverb: 0.12, maxVoices: 3,
    render(s) {
      s.burst(T, 0.001, 0.05, 0.6, 'bandpass', 1400, 1.2);
      s.thump(T, 180, 70, 0.05, 0.12, 0.6);
      // rocket roar: low noise through a filter that opens and drops away with distance
      const lp = s.filter('lowpass', 900, 1.2, s.vca(T + 0.01, 0.02, 0.7, 0.45));
      s.sweep(lp.frequency, T, 900, 3600, 0.08);
      lp.frequency.exponentialRampToValueAtTime(700, T + 0.5);
      s.noise(T, 0.6, lp, 'brown');
      s.noise(T, 0.5, s.filter('highpass', 4000, 0.7, s.vca(T, 0.005, 0.25, 0.3)));
      // chain rattling out: fast metallic ticks that slow down
      for (let i = 0; i < 26; i++) {
        const at = T + 0.03 + Math.pow(i / 26, 1.35) * 0.55;
        s.partials(s.r(2100, 3600), [[1, s.r(0.05, 0.12), 0.025], [1.7, 0.04, 0.015]], at, s.out);
      }
    },
  },
  grabReel: {
    // the chain winds back in: a ratchet and a motor whine
    dur: 0.7, level: 0.45, maxVoices: 3,
    render(s) {
      const o = s.osc('sawtooth', 160, T, 0.5, s.filter('bandpass', 900, 3, s.vca(T, 0.03, 0.25, 0.42)));
      o.frequency.exponentialRampToValueAtTime(320, T + 0.45);
      for (let i = 0; i < 18; i++) {
        const at = T + (i / 18) * 0.5;
        s.burst(at, 0.0005, 0.012, 0.35, 'bandpass', s.r(1800, 3000), 3);
      }
      s.partials(520, [[1, 0.2, 0.15], [2.7, 0.1, 0.08]], T + 0.52, s.out);
      s.thump(T + 0.52, 160, 80, 0.04, 0.1, 0.5);
    },
  },
  grabHit: {
    // gotcha: the claw clamps shut, a magnetic thunk, and the chain snaps taut
    dur: 1.0, level: 0.78, reverb: 0.15,
    render(s) {
      const mix = wetBus(s, 0.9, 0.2);
      s.thump(T, 140, 45, 0.1, 0.35, 1, s.shaper(2.5, mix));
      s.partials(310, [[1, 0.3, 0.5], [1.34, 0.2, 0.4], [2.6, 0.14, 0.25], [3.9, 0.07, 0.15]], T, mix, 0.008);
      s.burst(T, 0.0005, 0.04, 0.7, 'bandpass', 2200, 1.5, mix);
      // magnetic lock: a buzzy downward zap
      const z = s.osc('square', 880, T + 0.02, 0.18, s.filter('lowpass', 3000, 2, s.vca(T + 0.02, 0.002, 0.22, 0.16, mix)));
      z.frequency.exponentialRampToValueAtTime(110, T + 0.18);
      // chain snaps taut
      s.burst(T + 0.12, 0.0005, 0.03, 0.5, 'highpass', 3000, 1, mix);
      s.partials(1800, [[1, 0.1, 0.2], [1.5, 0.06, 0.12]], T + 0.12, mix);
    },
  },
  staticCharge: {
    // Static Field winds up: generators spin, the air fizzes, the pitch climbs to breaking point
    dur: 0.9, level: 0.75,
    render(s) {
      const E = T + 0.7;
      const sg = s.gain(0);
      sg.gain.setValueAtTime(0.0001, T); sg.gain.exponentialRampToValueAtTime(0.4, E); sg.gain.linearRampToValueAtTime(0, E + 0.03);
      const lp = s.filter('lowpass', 400, 6, sg);
      s.sweep(lp.frequency, T, 400, 6500, 0.7);
      for (const n of [0, 7, 12]) {
        const o = s.osc('sawtooth', 70 * semi(n), T, 0.75, lp, s.r(-10, 10));
        o.frequency.exponentialRampToValueAtTime(420 * semi(n), E);
      }
      const hum = s.osc('square', 50, T, 0.72, s.filter('bandpass', 1800, 1, s.vca(T, 0.3, 0.14, 0.5)));
      hum.frequency.linearRampToValueAtTime(120, E);
      s.crackle(T + 0.05, 0.65, 50, 0.35, s.out, 2500, 9000, 0.5);
      const ng = s.gain(0);
      s.swell(ng.gain, T, 0.7, 0.45, 0.03);
      s.noise(T, 0.75, s.filter('highpass', 2000, 0.7, ng), 'pink');
    },
  },
  staticBlast: {
    // the slam: a thunderclap from the floor, a wall of static and a long electric ring-out
    dur: 3.0, level: 1, reverb: 0.28, stereo: true,
    render(s) {
      const mix = wetBus(s, 2.5, 0.35, 2.2, 0.6);
      s.burst(T, 0.0003, 0.03, 1, 'highpass', 1200, 0.5, mix);
      s.thump(T, 90, 26, 0.6, 1.2, 1, s.shaper(2.5, mix));
      s.burst(T, 0.002, 0.35, 0.8, 'lowpass', 2600, 0.7, mix, 'pink');
      s.burst(T + 0.03, 0.05, 1.8, 0.45, 'lowpass', 160, 0.7, mix, 'brown');
      // thunder crackle rolling away
      s.crackle(T, 1.6, 120, 0.4, mix, 1500, 9000, 2.2);
      // electric zap sweeping down, and a buzzing ring-out
      const z = s.osc('sawtooth', 2400, T, 0.4, s.filter('lowpass', 5000, 3, s.vca(T, 0.002, 0.3, 0.35, mix)));
      z.frequency.exponentialRampToValueAtTime(80, T + 0.35);
      const buzz = s.osc('square', 100, T + 0.05, 1.6, s.filter('bandpass', 1300, 2, s.vca(T + 0.05, 0.05, 0.12, 1.3, mix)));
      buzz.frequency.linearRampToValueAtTime(60, T + 1.6);
      s.partials(147, [[1, 0.16, 1.8], [2.01, 0.1, 1.4], [3.02, 0.06, 1]], T + 0.02, mix, 0.006);
    },
  },
  staticZap: {
    // a stray bolt from the overcharged coils to someone too close
    dur: 0.35, variants: 4, level: 0.42, jitter: 1.5, maxVoices: 5, dedupe: 0.05,
    render(s) {
      s.crackle(T, 0.1, 22, 0.7, s.out, 2500, 10000, 0.8);
      const o = s.osc('sawtooth', s.r(1400, 2200), T, 0.14, s.filter('bandpass', 2500, 1.5, s.vca(T, 0.001, 0.35, 0.12)));
      o.frequency.exponentialRampToValueAtTime(200, T + 0.12);
      s.thump(T, 220, 90, 0.03, 0.06, 0.3);
    },
  },
  stepBlitz: {
    // a quarter ton of brass putting its foot down: a hollow clank, a servo, a thud
    dur: 0.32, variants: 5, level: 0.36, jitter: 0.7, maxVoices: 10, dedupe: 0, reverb: 0.12,
    render(s) {
      s.thump(T, 110, 48, 0.05, 0.12, 0.9);
      s.burst(T, 0.0008, 0.04, 0.5, 'lowpass', 900, 0.8, s.out, 'pink');
      s.partials(s.r(330, 420), [[1, 0.14, 0.12], [2.4, 0.08, 0.07]], T + 0.002, s.out);
      const sv = s.osc('square', s.r(420, 520), T + 0.03, 0.08, s.filter('bandpass', 1400, 4, s.vca(T + 0.03, 0.01, 0.05, 0.06)));
      sv.frequency.linearRampToValueAtTime(s.r(600, 700), T + 0.1);
    },
  },

  // ── bodies & world ──
  step: {
    dur: 0.18, variants: 6, level: 0.24, jitter: 1, maxVoices: 10, dedupe: 0,
    render(s) {
      s.burst(T, 0.001, 0.035, 0.7, 'lowpass', s.r(700, 1100), 0.8, s.out, 'pink');
      s.thump(T, 95, 60, 0.03, 0.05, 0.5);
      s.burst(T + s.r(0.025, 0.045), 0.001, 0.04, 0.32, 'bandpass', s.r(1500, 2600), 1.2);
      s.crackle(T, 0.06, 4, 0.12, s.out, 2500, 7000);
    },
  },
  stepGrass: {
    // footsteps on the outdoor arena; the procedural fallback is the same scuff as the desk
    dur: 0.18, variants: 6, level: 0.24, jitter: 1, maxVoices: 10, dedupe: 0,
    render(s) {
      s.burst(T, 0.001, 0.035, 0.5, 'lowpass', s.r(500, 800), 0.8, s.out, 'pink');
      s.crackle(T, 0.08, 8, 0.18, s.out, 2000, 6000);
    },
  },
  jump: {
    dur: 0.32, variants: 3, level: 0.28, jitter: 0.8,
    render(s) {
      const bp = s.filter('bandpass', 600, 1.4, s.vca(T, 0.015, 0.6, 0.16));
      s.sweep(bp.frequency, T, 500, 1700, 0.14);
      s.noise(T, 0.25, bp, 'pink');
      s.burst(T, 0.001, 0.04, 0.35, 'lowpass', 1800, 0.7);
    },
  },
  land: {
    dur: 0.42, variants: 2, level: 0.45, jitter: 0.8,
    render(s) {
      s.thump(T, 120, 45, 0.09, 0.2, 1);
      s.burst(T, 0.001, 0.12, 0.6, 'lowpass', 600, 0.7, s.out, 'pink');
      s.crackle(T, 0.08, 10, 0.25, s.out, 1500, 5000);
    },
  },
  death: {
    dur: 1.9, level: 0.5, reverb: 0.25,
    render(s) {
      const mix = wetBus(s, 1.6, 0.3);
      s.thump(T, 110, 40, 0.2, 0.4, 0.7, mix);
      for (let i = 0; i < 5; i++) {
        const o = s.osc('sine', 1800 * semi(-i * 2), T + i * 0.06, 0.9, s.vca(T + i * 0.06, 0.005, 0.18, 0.7, mix));
        o.frequency.exponentialRampToValueAtTime(900 * semi(-i * 2), T + i * 0.06 + 0.8);
      }
      s.crackle(T + 0.1, 1.2, 40, 0.18, mix, 2500, 8000);
      const bp = s.filter('bandpass', 3000, 1.2, s.vca(T, 0.01, 0.35, 0.9, mix));
      s.sweep(bp.frequency, T, 3000, 300, 0.9);
      s.noise(T, 1, bp, 'pink');
    },
  },
  respawn: {
    dur: 1.6, level: 0.5, reverb: 0.25,
    render(s) {
      const mix = wetBus(s, 1.5, 0.3);
      const sw = s.gain(0, mix);
      s.swell(sw.gain, T, 0.9, 0.45, 0.05);
      const bp = s.filter('bandpass', 800, 1.5, sw);
      s.sweep(bp.frequency, T, 800, 4000, 0.9);
      s.noise(T, 1, bp, 'pink');
      [0, 4, 7, 12, 16].forEach((n, i) => s.fm(659.25 * semi(n), 2, 0.8, T + 0.3 + i * 0.08, 0.7, s.vca(T + 0.3 + i * 0.08, 0.02, 0.14, 0.6, mix)));
      s.thump(T + 0.95, 300, 120, 0.05, 0.15, 0.5, mix);
      s.crackle(T + 0.95, 0.4, 14, 0.2, mix, 4000, 9000);
    },
  },
  pickup: {
    dur: 1.2, level: 0.5,
    render(s) {
      const mix = wetBus(s, 1.2, 0.3);
      [0, 4, 7, 12, 16].forEach((n, i) => s.pluck(784 * semi(n), T + i * 0.04, 0.9, mix, 0.45, 0.65));
      const o = s.osc('sine', 600, T, 0.35, s.vca(T, 0.02, 0.2, 0.3, mix));
      o.frequency.exponentialRampToValueAtTime(1800, T + 0.3);
      s.crackle(T + 0.05, 0.5, 18, 0.18, mix, 5000, 10000);
    },
  },

  // ── Einstein ──
  photon: {
    dur: 0.3, variants: 4, level: 0.4, jitter: 0.5, maxVoices: 6, reverb: 0.12,
    render(s) {
      const base = s.r(2900, 3500);
      // FM zap that collapses in pitch: the "pew" of a light quantum
      const zap = s.fm(base, 1.5, 2.2, T, 0.13, s.vca(T, 0.001, 0.55, 0.11), 0.1);
      zap.frequency.exponentialRampToValueAtTime(base * 0.22, T + 0.09);
      const bp = s.filter('bandpass', 2200, 2, s.vca(T, 0.002, 0.18, 0.08));
      const sq = s.osc('square', 1400, T, 0.1, bp);
      sq.frequency.exponentialRampToValueAtTime(380, T + 0.08);
      s.burst(T, 0.0004, 0.012, 0.6, 'highpass', 5000, 0.7);
      const sp = s.osc('sine', base * 1.6, T + 0.01, 0.16, s.vca(T + 0.01, 0.004, 0.1, 0.15));
      sp.frequency.exponentialRampToValueAtTime(base * 1.2, T + 0.15);
      s.thump(T, 200, 90, 0.03, 0.05, 0.35);
    },
  },
  photonHit: {
    dur: 0.26, variants: 3, level: 0.26, jitter: 1, maxVoices: 4, dedupe: 0.05,
    render(s) {
      s.crackle(T, 0.07, 8, 0.6, s.out, 2500, 8000, 1);
      const o = s.osc('sine', s.r(2200, 2800), T, 0.1, s.vca(T, 0.001, 0.3, 0.08));
      o.frequency.exponentialRampToValueAtTime(1200, T + 0.08);
      s.burst(T, 0.0005, 0.02, 0.3, 'bandpass', 1200, 1);
    },
  },
  gravityThrow: {
    dur: 0.6, level: 0.48,
    render(s) {
      const o = s.osc('sine', 180, T, 0.4, s.vca(T, 0.01, 0.6, 0.35));
      o.frequency.exponentialRampToValueAtTime(520, T + 0.3);
      const bp = s.filter('bandpass', 400, 1.6, s.vca(T, 0.02, 0.4, 0.3));
      s.sweep(bp.frequency, T, 400, 1600, 0.3);
      s.noise(T, 0.35, bp, 'pink');
      s.thump(T, 90, 50, 0.08, 0.18, 0.5);
      s.fm(660, 2.01, 1.5, T, 0.4, s.vca(T, 0.02, 0.12, 0.35));
    },
  },
  gravity: {
    // the singularity: opens with an inhale-thump, spins up, swallows sparks, collapses at 3.2 s
    dur: 3.8, level: 0.58, reverb: 0.2,
    render(s) {
      const END = T + 3.2;
      const sw = s.gain(0);
      s.swell(sw.gain, T, 0.18, 0.7, 0.03);
      const bp0 = s.filter('bandpass', 6000, 0.8, sw);
      s.sweep(bp0.frequency, T, 6000, 500, 0.18);
      s.noise(T, 0.25, bp0, 'pink');
      s.thump(T + 0.18, 110, 40, 0.3, 0.6, 0.9, s.shaper(2.5, s.out));
      // sub drone with a spin that accelerates
      const dg = s.gain(0);
      dg.gain.setValueAtTime(0, T); dg.gain.linearRampToValueAtTime(0.55, T + 0.4);
      dg.gain.setValueAtTime(0.55, END - 0.4); dg.gain.linearRampToValueAtTime(0.2, END);
      const sub = s.osc('sine', 52, T, 3.2, dg);
      const lfo = s.osc('sine', 0.8, T, 3.2, s.gain(6, sub.frequency));
      lfo.frequency.exponentialRampToValueAtTime(7, END);
      // dark resonant hum with a swirling filter
      const hg = s.gain(0);
      hg.gain.setValueAtTime(0, T); hg.gain.linearRampToValueAtTime(0.2, T + 0.5); hg.gain.setValueAtTime(0.2, END - 0.2); hg.gain.linearRampToValueAtTime(0, END);
      const lp = s.filter('lowpass', 260, 6, hg);
      s.osc('sawtooth', 55, T, 3.2, lp); s.osc('sawtooth', 55.6, T, 3.2, lp);
      const lfo2 = s.osc('sine', 1.3, T, 3.2, s.gain(160, lp.frequency));
      lfo2.frequency.exponentialRampToValueAtTime(5, END);
      // whirling wind
      const wg = s.gain(0);
      wg.gain.setValueAtTime(0, T); wg.gain.linearRampToValueAtTime(0.35, T + 0.6); wg.gain.setValueAtTime(0.35, END - 0.35); wg.gain.linearRampToValueAtTime(0, END);
      const bp = s.filter('bandpass', 900, 3, wg);
      const lfo3 = s.osc('sine', 2, T, 3.2, s.gain(600, bp.frequency));
      lfo3.frequency.exponentialRampToValueAtTime(6.5, END);
      s.noise(T, 3.2, bp, 'pink');
      // sparks sucked inward
      for (let i = 0; i < 26; i++) {
        const at = T + s.r(0.3, 3.0);
        const o = s.osc('sine', s.r(1800, 3200), at, 0.1, s.vca(at, 0.002, s.r(0.05, 0.14), 0.09));
        o.frequency.exponentialRampToValueAtTime(s.r(250, 500), at + 0.08);
      }
      // collapse: reverse rush into a pop and a boom
      const cs = s.gain(0);
      s.swell(cs.gain, END - 0.35, 0.35, 0.55, 0.02);
      s.noise(END - 0.35, 0.4, s.filter('highpass', 1200, 0.7, cs));
      const mix = wetBus(s, 2, 0.3);
      s.thump(END, 160, 35, 0.25, 0.45, 1, s.shaper(2.5, mix));
      s.burst(END, 0.001, 0.25, 0.7, 'lowpass', 2500, 0.7, mix, 'pink');
      const pop = s.osc('sine', 900, END, 0.05, s.vca(END, 0.0008, 0.5, 0.03, mix));
      pop.frequency.exponentialRampToValueAtTime(120, END + 0.025);
    },
  },
  emcCharge: {
    dur: 1.3, level: 0.7,
    render(s) {
      const E = T + 1.15;
      // octave stack of saws rising through a screaming resonant filter
      const sg = s.gain(0);
      sg.gain.setValueAtTime(0.0001, T); sg.gain.exponentialRampToValueAtTime(0.35, E); sg.gain.linearRampToValueAtTime(0, E + 0.03);
      const lp = s.filter('lowpass', 250, 7, sg);
      s.sweep(lp.frequency, T, 250, 7000, 1.15);
      for (const n of [-12, 0, 7, 12, 19]) {
        const o = s.osc('sawtooth', 110 * semi(n), T, 1.17, lp, s.r(-8, 8));
        o.frequency.exponentialRampToValueAtTime(440 * semi(n), E);
      }
      // electrical buzz
      const eg = s.gain(0);
      eg.gain.setValueAtTime(0, T); eg.gain.linearRampToValueAtTime(0.16, E); eg.gain.linearRampToValueAtTime(0, E + 0.02);
      s.osc('square', 60, T, 1.17, s.filter('bandpass', 2500, 0.8, eg));
      // reverse noise rush
      const ng = s.gain(0);
      s.swell(ng.gain, T, 1.15, 0.5, 0.03);
      s.noise(T, 1.2, s.filter('highpass', 1500, 0.7, ng), 'pink');
      // sparkles that get denser as the equation completes
      for (let i = 0; i < 22; i++) {
        const at = T + 1.12 * (1 - Math.pow(1 - i / 22, 0.6));
        const f = 1046.5 * semi(s.pick(PENTA.slice(0, 7)));
        s.fm(f, 2, 0.7, at, 0.25, s.vca(at, 0.002, 0.08, 0.2));
      }
      s.crackle(T + 0.3, 0.85, 40, 0.25, s.out, 3000, 9000, 0.5);
    },
  },
  emcBlast: {
    dur: 4.2, level: 1, reverb: 0.25,
    render(s) {
      const mix = wetBus(s, 3, 0.35, 2.5, 0.5);
      s.burst(T, 0.0003, 0.02, 1, 'highpass', 1500, 0.5, mix);
      s.thump(T, 75, 24, 1.0, 1.6, 1, s.shaper(2, mix));
      const lp = s.filter('lowpass', 9000, 0.9, s.vca(T, 0.002, 0.9, 2.4, mix));
      s.sweep(lp.frequency, T, 9000, 140, 1.6);
      s.noise(T, 2.5, lp, 'pink');
      s.burst(T + 0.05, 0.08, 3.2, 0.6, 'lowpass', 120, 0.7, mix, 'brown');
      s.burst(T, 0.003, 0.5, 0.5, 'bandpass', 380, 1.2, mix, 'pink');
      // golden energy shimmer: a major chord ringing out of the blast
      s.partials(440, [[1, 0.14, 2.6], [1.25, 0.11, 2.4], [1.5, 0.11, 2.2], [2, 0.09, 2], [2.5, 0.06, 1.6], [3, 0.05, 1.4]], T + 0.04, mix, 0.004, 0.06);
      s.crackle(T + 0.15, 2.4, 70, 0.3, mix, 1500, 7000, 2.2);
    },
  },

  // ── Yeat ──
  bell: {
    // rage bell: struck handbell + FM edge + distorted 808 + hat. Variant = riff note.
    dur: 1.4, variants: BELL_SEMIS.length, pitchVariants: BELL_SEMIS, level: 0.55, maxVoices: 4, reverb: 0.15, dedupe: 0.05,
    render(s, v) {
      const f = 466.16 * semi(BELL_SEMIS[v]);
      s.partials(f, [[1, 0.9, 1.25], [2, 0.25, 0.7], [2.76, 0.45, 0.55], [5.4, 0.22, 0.25], [8.93, 0.1, 0.12]], T, s.out, 0.0015);
      s.fm(f, 3.5, 4, T, 0.4, s.vca(T, 0.001, 0.25, 0.35), 0.1);
      s.burst(T, 0.0004, 0.006, 0.6, 'highpass', 6000, 0.7);
      s.thump(T, 130, 58.27, 0.07, 0.38, 0.85, s.shaper(3, s.gain(0.9)));
      s.burst(T, 0.0005, 0.03, 0.35, 'highpass', 8000, 0.7);
    },
  },
  bellHit: {
    dur: 0.22, variants: 3, level: 0.26, jitter: 1, maxVoices: 3, dedupe: 0.06,
    render(s) {
      s.partials(s.r(2000, 2600), [[1, 0.5, 0.14], [2.76, 0.25, 0.08]], T, s.out);
      s.burst(T, 0.0004, 0.008, 0.4, 'highpass', 5000, 0.7);
    },
  },
  tonka: {
    // transform ratchets + servo whine, a big clank, the engine catches, air horn
    dur: 2.0, level: 0.62, reverb: 0.15,
    render(s) {
      for (let i = 0; i < 7; i++) {
        const at = T + 0.33 * Math.pow(i / 7, 0.8);
        s.burst(at, 0.0005, 0.02, 0.5, 'bandpass', s.r(1800, 3800), 3);
        s.thump(at, 260, 140, 0.02, 0.04, 0.35);
      }
      const bp = s.filter('bandpass', 1400, 4, s.vca(T, 0.03, 0.12, 0.32));
      const servo = s.osc('sawtooth', 420, T, 0.35, bp);
      servo.frequency.exponentialRampToValueAtTime(1300, T + 0.3);
      const C = T + 0.36;
      s.partials(190, [[1, 0.5, 0.5], [1.47, 0.35, 0.4], [2.09, 0.3, 0.3], [2.56, 0.2, 0.25], [3.6, 0.12, 0.15]], C, s.out, 0.01);
      s.thump(C, 160, 60, 0.06, 0.2, 0.9);
      s.burst(C, 0.0005, 0.06, 0.6, 'bandpass', 2500, 0.8);
      // engine catches and roars
      const E = T + 0.42;
      const eg = s.gain(0);
      eg.gain.setValueAtTime(0, E); eg.gain.linearRampToValueAtTime(0.45, E + 0.13); eg.gain.setValueAtTime(0.45, E + 0.7); eg.gain.setTargetAtTime(0, E + 0.7, 0.25);
      const lp = s.filter('lowpass', 300, 2.5, eg);
      const drive = s.shaper(2.5, lp);
      lp.frequency.setValueAtTime(300, E); lp.frequency.exponentialRampToValueAtTime(1800, E + 0.33); lp.frequency.exponentialRampToValueAtTime(600, E + 1.2);
      for (const d of [1, 1.03]) {
        const o = s.osc('sawtooth', 46 * d, E, 1.4, drive);
        o.frequency.exponentialRampToValueAtTime(120 * d, E + 0.38); o.frequency.exponentialRampToValueAtTime(85 * d, E + 1.2);
      }
      // two-tone air horn with a little pitch "blat" at the start
      const H = T + 0.5;
      for (const f of [311.13, 370]) {
        const g = s.gain(0);
        g.gain.setValueAtTime(0, H); g.gain.linearRampToValueAtTime(0.34, H + 0.03); g.gain.setValueAtTime(0.34, H + 0.42); g.gain.linearRampToValueAtTime(0, H + 0.5);
        const hl = s.filter('lowpass', 3500, 0.7, s.filter('bandpass', 1100, 0.9, g));
        for (const d of [-8, 0, 8]) {
          const o = s.osc('sawtooth', f * 0.94, H, 0.52, hl, d);
          o.frequency.linearRampToValueAtTime(f, H + 0.06);
        }
      }
    },
  },
  engineLoop: {
    // seamless 1 s loop: 36 firings/s + half-order lope; playback rate follows truck speed
    dur: 1, level: 0.3, loop: true,
    raw(sr) {
      const n = sr;
      const rnd = mulberry(99);
      const fire = 36;
      const amps = Array.from({ length: fire }, () => 0.7 + rnd() * 0.3);
      const raw = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const ph = (i * fire) / n;
        const k = Math.floor(ph);
        const f = ph - k;
        const a = amps[k];
        raw[i] = Math.exp(-f * 6) * a * 0.8
          + (rnd() * 2 - 1) * Math.exp(-f * 14) * 0.5 * a
          + Math.sin(2 * Math.PI * ph) * 0.4 + Math.sin(4 * Math.PI * ph) * 0.18 + Math.sin(Math.PI * ph) * 0.25;
      }
      const out = new Float32Array(n);
      let l1 = 0, l2 = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) {
          l1 += (raw[i] - l1) * 0.18;
          l2 += (l1 - l2) * 0.25;
          if (pass === 1) out[i] = Math.tanh(l2 * 2.2);
        }
      }
      let mean = 0;
      for (let i = 0; i < n; i++) mean += out[i];
      mean /= n;
      for (let i = 0; i < n; i++) out[i] -= mean;
      return [out];
    },
  },
  crash: {
    dur: 1.3, variants: 2, level: 0.75, reverb: 0.15,
    render(s) { metalCrash(s, T, 1); },
  },
  ram: {
    // Tonka connects: metal crunch + huge distorted 808 + a cartoon-bright ding
    dur: 2.0, level: 1, reverb: 0.2,
    render(s) {
      const mix = wetBus(s, 1.5, 0.25);
      metalCrash(s, T, 0.9, mix);
      s.thump(T, 110, 42, 0.12, 1.3, 1, s.shaper(3.5, mix));
      s.partials(1046.5, [[1, 0.22, 0.8], [2.76, 0.09, 0.4]], T + 0.02, mix);
      const bp = s.filter('bandpass', 2400, 1, s.vca(T, 0.002, 0.4, 0.3, mix));
      s.sweep(bp.frequency, T, 2400, 500, 0.3);
      s.noise(T, 0.35, bp, 'pink');
    },
  },
  bellSummon: {
    // the sky turns: a low drone, swirling wind, distant thunder, and a bell played backwards
    dur: 2.9, level: 0.8, stereo: true,
    render(s) {
      const mix = wetBus(s, 3.5, 0.45, 2, 0.4);
      const dg = s.gain(0, mix);
      dg.gain.setValueAtTime(0, T); dg.gain.linearRampToValueAtTime(0.4, T + 1.6); dg.gain.setValueAtTime(0.4, T + 1.9); dg.gain.setTargetAtTime(0, T + 1.9, 0.3);
      const lp = s.filter('lowpass', 180, 2, dg);
      s.sweep(lp.frequency, T, 180, 600, 1.8, 'lin');
      for (const f of [41.2, 41.45, 61.7]) s.osc('sawtooth', f, T, 2.8, lp);
      for (const side of [-0.65, 0.65]) {
        const wg = s.gain(0, s.pan(side, mix));
        wg.gain.setValueAtTime(0, T); wg.gain.linearRampToValueAtTime(0.32, T + 1.7); wg.gain.setValueAtTime(0.32, T + 1.9); wg.gain.setTargetAtTime(0, T + 1.9, 0.35);
        const bp = s.filter('bandpass', 500, 0.8, wg);
        s.osc('sine', side < 0 ? 0.37 : 0.5, T, 2.8, s.gain(320, bp.frequency));
        s.noise(T, 2.8, bp, 'pink');
      }
      const bg = s.gain(0, mix);
      s.swell(bg.gain, T, 1.75, 0.5, 0.05);
      for (const [r, a] of [[0.5, 0.6], [1, 0.9], [1.19, 0.5], [1.5, 0.3], [2, 0.6], [2.67, 0.25], [4.17, 0.15]]) s.osc('sine', 98 * r, T, 1.85, s.gain(a, bg), s.r(-4, 4));
      for (const at of [T + 0.15, T + 1.05]) s.burst(at, 0.05, 1.2, 0.45, 'lowpass', 140, 0.7, mix, 'brown');
    },
  },
  bigBell: {
    // a colossal bronze toll: hum/prime/tierce/quint/nominal partials with beating, long bloom
    dur: 8, level: 0.95, reverb: 0.2,
    render(s) {
      const mix = wetBus(s, 4, 0.35, 2, 0.45);
      const base = 98;
      s.partials(base, [
        [0.5, 0.55, 7.5], [1, 0.85, 6], [1.19, 0.5, 5], [1.5, 0.3, 4], [2, 0.65, 4.2], [2.5, 0.28, 3],
        [2.67, 0.25, 2.6], [3.01, 0.22, 2.2], [4.17, 0.16, 1.6], [5.43, 0.1, 1.1], [6.8, 0.06, 0.7],
      ], T, mix, 0.0025, 0.003);
      s.burst(T, 0.0004, 0.03, 0.7, 'bandpass', 2200, 0.9, mix);
      s.thump(T, 240, 90, 0.04, 0.12, 0.6, mix);
      s.fm(base * 4.17, 1.41, 6, T, 0.3, s.vca(T, 0.001, 0.25, 0.25, mix));
      s.thump(T, 70, 40, 0.8, 1.5, 0.5, s.shaper(1.5, mix));
    },
  },
  bellWhistle: {
    dur: 0.9, level: 0.55,
    render(s) {
      const g = s.gain(0);
      g.gain.setValueAtTime(0.0001, T); g.gain.exponentialRampToValueAtTime(0.6, T + 0.65); g.gain.linearRampToValueAtTime(0, T + 0.72);
      const bp = s.filter('bandpass', 2600, 5, g);
      s.sweep(bp.frequency, T, 2600, 350, 0.7);
      s.noise(T, 0.75, bp);
      const o = s.osc('sine', 1100, T, 0.72, s.gain(0.25, g));
      o.frequency.exponentialRampToValueAtTime(280, T + 0.7);
    },
  },
  bellDrop: {
    // the bell hits the earth: sub crater, crack, a cracked dissonant clang, tumbling debris, rumble
    dur: 5, level: 1, reverb: 0.25,
    render(s) {
      const mix = wetBus(s, 3.5, 0.3, 2.5, 0.4);
      s.thump(T, 70, 22, 1.2, 2.2, 1, s.shaper(2.5, mix));
      s.burst(T, 0.0003, 0.025, 1, 'highpass', 1200, 0.5, mix);
      const lp = s.filter('lowpass', 7000, 0.8, s.vca(T, 0.002, 0.9, 2.0, mix));
      s.sweep(lp.frequency, T, 7000, 120, 1.4);
      s.noise(T, 2.1, lp, 'pink');
      s.partials(130, [[1, 0.5, 1.8], [1.41, 0.38, 1.5], [2.13, 0.32, 1.2], [2.9, 0.22, 0.9], [3.7, 0.15, 0.7], [5.1, 0.09, 0.4]], T, mix, 0.03);
      for (let i = 0; i < 16; i++) {
        const at = T + 0.1 + Math.pow(s.rnd(), 1.3) * 2.0;
        s.burst(at, 0.002, s.r(0.05, 0.18), s.r(0.15, 0.4) * (1 - (at - T) / 2.4), 'lowpass', s.r(400, 1500), 0.8, mix, 'pink');
      }
      s.crackle(T + 0.05, 1.5, 60, 0.25, mix, 1500, 6000, 2);
      s.burst(T + 0.05, 0.1, 3.8, 0.65, 'lowpass', 90, 0.7, mix, 'brown');
    },
  },

  // ── Van Gogh ──
  paint: {
    // brush flick + liquid bloop + wet smack
    dur: 0.35, variants: 4, level: 0.45, jitter: 1, maxVoices: 4,
    render(s) {
      const bp = s.filter('bandpass', 900, 1.3, s.vca(T, 0.006, 0.5, 0.07));
      s.sweep(bp.frequency, T, 800, 3800, 0.06);
      s.noise(T, 0.1, bp, 'pink');
      const o = s.osc('sine', s.r(320, 420), T + 0.012, 0.08, s.vca(T + 0.012, 0.001, 0.5, 0.06));
      o.frequency.exponentialRampToValueAtTime(s.r(1000, 1400), T + 0.057);
      s.burst(T, 0.0008, 0.018, 0.35, 'lowpass', 1500, 0.7, s.out, 'pink');
    },
  },
  splat: {
    // wet impact, a squish, then droplets raining back down
    dur: 0.65, variants: 4, level: 0.52, jitter: 1.5, maxVoices: 4,
    render(s) {
      const lp = s.filter('lowpass', 2800, 1.5, s.vca(T, 0.002, 0.8, 0.2));
      s.sweep(lp.frequency, T, 2800, 380, 0.16);
      s.noise(T, 0.25, lp, 'pink');
      s.thump(T, 170, 60, 0.06, 0.09, 0.55);
      s.burst(T + 0.01, 0.003, 0.06, 0.3, 'bandpass', s.r(600, 900), 5);
      const n = 4 + Math.floor(s.rnd() * 4);
      for (let i = 0; i < n; i++) {
        const at = T + 0.04 + Math.pow(s.rnd(), 1.4) * 0.35;
        const o = s.osc('sine', s.r(500, 900), at, 0.05, s.vca(at, 0.001, 0.3 * (1 - (at - T) / 0.45), 0.035));
        o.frequency.exponentialRampToValueAtTime(s.r(1300, 2200), at + 0.025);
      }
    },
  },
  seedToss: {
    dur: 0.6, level: 0.34,
    render(s) {
      const bp = s.filter('bandpass', 500, 1.4, s.vca(T, 0.02, 0.5, 0.25));
      s.sweep(bp.frequency, T, 500, 1500, 0.25);
      s.noise(T, 0.3, bp, 'pink');
      s.pluck(1568, T + 0.02, 0.4, s.out, 0.3, 0.7);
      s.pluck(2093, T + 0.07, 0.4, s.out, 0.25, 0.7);
    },
  },
  bloom: {
    // earth bursts open, leaves rustle up, a harp glissando and a warm chord as the sunflower opens
    dur: 2.8, level: 0.62, reverb: 0.2,
    render(s) {
      const mix = wetBus(s, 2.5, 0.35);
      s.thump(T, 95, 50, 0.12, 0.3, 0.7, mix);
      s.burst(T, 0.003, 0.25, 0.5, 'lowpass', 500, 0.7, mix, 'pink');
      const rg = s.gain(0, mix);
      rg.gain.setValueAtTime(0, T); rg.gain.linearRampToValueAtTime(0.3, T + 0.3); rg.gain.setValueAtTime(0.3, T + 0.6); rg.gain.setTargetAtTime(0, T + 0.6, 0.25);
      const bp = s.filter('bandpass', 600, 1.5, rg);
      s.sweep(bp.frequency, T, 500, 3200, 0.7);
      s.noise(T, 1.4, bp, 'pink');
      s.crackle(T + 0.05, 0.8, 50, 0.22, mix, 1500, 5000, 1.2);
      PENTA.forEach((n, i) => s.pluck(587.33 * semi(n), T + 0.08 + i * 0.045, 1.6, mix, 0.33, 0.6, 0.997));
      const pg = s.gain(0, mix);
      pg.gain.setValueAtTime(0, T); pg.gain.linearRampToValueAtTime(0.11, T + 0.5); pg.gain.setValueAtTime(0.11, T + 1.6); pg.gain.setTargetAtTime(0, T + 1.6, 0.35);
      for (const n of [0, 4, 7, 14]) s.osc('triangle', 293.66 * semi(n), T, 2.7, pg, s.r(-5, 5));
      for (const at of [0.6, 0.78, 0.95]) s.partials(2349.3 * semi(s.pick([0, 2, 4])), [[1, 0.08, 0.8], [2.76, 0.02, 0.3]], T + at, mix);
    },
  },
  starry: {
    // a swirling Lydian sky: wide pads panning in circles, twinkling glass, a low drone
    dur: 7.8, level: 0.6, stereo: true, reverb: 0.15,
    render(s) {
      const mix = wetBus(s, 4, 0.5, 2, 0.5);
      const end = T + 6.4;
      for (const [side, notes] of [[1, [0, 12, 16, 23]], [-1, [7, 18, 26, 14]]] as [number, number[]][]) {
        const pg = s.gain(0);
        pg.gain.setValueAtTime(0, T); pg.gain.linearRampToValueAtTime(0.2, T + 1.0); pg.gain.setValueAtTime(0.2, end); pg.gain.setTargetAtTime(0, end, 0.35);
        const pan = s.pan(0, mix);
        pg.connect(pan);
        s.osc('sine', 0.18, T, 7.6, s.gain(0.75 * side, pan.pan));
        const lp = s.filter('lowpass', 1200, 1, pg);
        s.osc('sine', 0.15 * (side > 0 ? 1 : 1.3), T, 7.6, s.gain(700, lp.frequency));
        for (const n of notes) for (const d of [-7, 7]) s.osc('sawtooth', 130.81 * semi(n), T, 7.6, lp, d + s.r(-2, 2));
        pg.disconnect(s.out);
      }
      const dr = s.gain(0, mix);
      dr.gain.setValueAtTime(0, T); dr.gain.linearRampToValueAtTime(0.3, T + 1.5); dr.gain.setValueAtTime(0.3, end); dr.gain.setTargetAtTime(0, end, 0.4);
      const trem = s.gain(1, dr);
      s.osc('sine', 3, T, 7.6, s.gain(0.3, trem.gain));
      s.osc('sine', 65.41, T, 7.6, trem); s.osc('sine', 98, T, 7.6, s.gain(0.5, trem));
      const wp = s.pan(-0.8, mix);
      s.sweep(wp.pan, T, -0.8, 0.8, 1.1, 'lin');
      const bp = s.filter('bandpass', 300, 1.5, s.vca(T, 0.3, 0.4, 1.0, wp));
      s.sweep(bp.frequency, T, 300, 4000, 1.0);
      s.noise(T, 1.4, bp, 'pink');
      for (let t = T + 0.3; t < T + 6.8; t += s.r(0.18, 0.45)) {
        const f = 1046.5 * semi(s.pick([0, 2, 4, 7, 9, 12, 14, 16]));
        const a = s.r(0.06, 0.13);
        s.partials(f, [[1, a, 1.2], [2.76, a * 0.3, 0.4]], t, s.pan(s.r(-0.85, 0.85), mix));
      }
      [24, 21, 19, 16, 14, 12, 9, 7].forEach((n, i) => s.pluck(523.25 * semi(n), T + 6.5 + i * 0.07, 1.2, s.pan(0.7 - i * 0.2, mix), 0.22, 0.6, 0.997));
    },
  },
  starFall: {
    dur: 1.0, variants: 3, level: 0.42, maxVoices: 4, reverb: 0.25,
    render(s) {
      const g = s.gain(0);
      g.gain.setValueAtTime(0.0001, T); g.gain.exponentialRampToValueAtTime(0.4, T + 0.2); g.gain.linearRampToValueAtTime(0, T + 0.24);
      const bp = s.filter('bandpass', 6000, 2, g);
      s.sweep(bp.frequency, T, 6000, 1200, 0.22);
      s.noise(T, 0.25, bp);
      const o = s.osc('sine', 2600, T, 0.24, s.gain(0.3, g));
      o.frequency.exponentialRampToValueAtTime(900, T + 0.22);
      const I = T + 0.2;
      const mix = wetBus(s, 1.5, 0.3);
      s.burst(I, 0.001, 0.15, 0.4, 'lowpass', 1500, 0.7, mix, 'pink');
      s.thump(I, 180, 70, 0.05, 0.12, 0.4, mix);
      s.partials(s.r(1500, 1900), [[1, 0.3, 0.7], [2.76, 0.1, 0.3], [5.4, 0.05, 0.15]], I, mix);
    },
  },

  // ── sample-only (ElevenLabs; silent if the files are missing) ──
  // ── Luffy ──
  rubberStretch: {
    // the arm leaving: a rubber twang that bends up as it stretches, a whip of air, a little creak
    dur: 0.42, variants: 4, level: 0.5, jitter: 0.6, maxVoices: 4, reverb: 0.1,
    render(s) {
      const f = s.r(150, 190);
      const g = s.vca(T, 0.004, 0.55, 0.3);
      const o = s.osc('sawtooth', f, T, 0.34, s.filter('lowpass', 1400, 4, g));
      o.frequency.exponentialRampToValueAtTime(f * 3.2, T + 0.16);
      s.osc('sine', 18, T, 0.34, s.gain(f * 0.12, o.frequency));
      const t2 = s.osc('triangle', f * 2, T, 0.3, s.vca(T, 0.004, 0.25, 0.26));
      t2.frequency.exponentialRampToValueAtTime(f * 6, T + 0.16);
      const bp = s.filter('bandpass', 900, 1.4, s.vca(T, 0.01, 0.5, 0.18));
      s.sweep(bp.frequency, T, 700, 4200, 0.16);
      s.noise(T, 0.2, bp, 'pink');
      s.crackle(T + 0.02, 0.12, 5, 0.15, s.out, 1200, 3500, 1.2);
    },
  },
  rubberSnap: {
    // the arm coming home: a falling boing with a slap
    dur: 0.3, variants: 3, level: 0.34, jitter: 0.8, maxVoices: 3, dedupe: 0.05,
    render(s) {
      const f = s.r(420, 520);
      const o = s.osc('triangle', f, T, 0.24, s.vca(T, 0.002, 0.5, 0.2));
      o.frequency.exponentialRampToValueAtTime(f * 0.35, T + 0.18);
      s.osc('sine', 22, T, 0.24, s.gain(f * 0.08, o.frequency));
      s.burst(T, 0.0005, 0.02, 0.45, 'bandpass', 2200, 1.2);
      s.thump(T, 180, 90, 0.04, 0.06, 0.3);
    },
  },
  pistolHit: {
    // a meaty punch: knuckle crack, a body thud and a rubbery wobble
    dur: 0.4, variants: 4, level: 0.62, jitter: 0.7, maxVoices: 4, dedupe: 0.03, reverb: 0.12,
    render(s) {
      s.burst(T, 0.0004, 0.012, 0.9, 'highpass', 2500, 0.8);
      s.burst(T, 0.001, 0.06, 0.7, 'lowpass', 1800, 0.8, s.out, 'pink');
      s.thump(T, 150, 48, 0.08, 0.22, 1, s.shaper(2.2, s.out));
      const o = s.osc('sine', 240, T + 0.01, 0.2, s.vca(T + 0.01, 0.003, 0.2, 0.16));
      o.frequency.exponentialRampToValueAtTime(110, T + 0.16);
      s.osc('sine', 26, T, 0.2, s.gain(30, o.frequency));
    },
  },
  dawnHit: {
    // Gear Fifth's giant fist: a cartoon-sized boom with a bright bell-like top and a cloud whoosh
    dur: 1.2, variants: 2, level: 0.85, maxVoices: 3, reverb: 0.3, dedupe: 0.04,
    render(s) {
      const mix = wetBus(s, 1.4, 0.3);
      s.thump(T, 120, 36, 0.18, 0.7, 1, s.shaper(3, mix));
      s.burst(T, 0.001, 0.25, 0.8, 'lowpass', 2600, 0.7, mix, 'pink');
      s.burst(T, 0.0004, 0.01, 0.8, 'highpass', 4000, 0.8, mix);
      s.partials(s.r(880, 990), [[1, 0.18, 0.6], [2.01, 0.1, 0.4], [3.02, 0.05, 0.25]], T + 0.01, mix);
      const bp = s.filter('bandpass', 1800, 0.9, s.vca(T + 0.03, 0.02, 0.35, 0.6, mix));
      s.sweep(bp.frequency, T + 0.03, 1800, 300, 0.6);
      s.noise(T + 0.03, 0.7, bp, 'pink');
    },
  },
  rocketLaunch: {
    // the slingshot lets go: a deep rubber thwang into a rushing whoosh
    dur: 1.0, level: 0.7, reverb: 0.15, maxVoices: 2,
    render(s) {
      const o = s.osc('sawtooth', 90, T, 0.5, s.filter('lowpass', 900, 5, s.vca(T, 0.003, 0.6, 0.45)));
      o.frequency.exponentialRampToValueAtTime(260, T + 0.06); o.frequency.exponentialRampToValueAtTime(70, T + 0.45);
      s.osc('sine', 14, T, 0.5, s.gain(25, o.frequency));
      s.thump(T, 110, 50, 0.06, 0.2, 0.7);
      const wg = s.gain(0);
      s.swell(wg.gain, T, 0.1, 0.55, 0.5);
      const bp = s.filter('bandpass', 600, 1.2, wg);
      s.sweep(bp.frequency, T, 600, 2400, 0.5);
      s.noise(T, 0.75, bp, 'pink');
    },
  },
  rocketHit: {
    dur: 1.2, level: 0.9, reverb: 0.2, maxVoices: 2, dedupe: 0.05,
    render(s) {
      const mix = wetBus(s, 1.2, 0.25);
      s.thump(T, 130, 40, 0.12, 0.55, 1, s.shaper(3, mix));
      s.burst(T, 0.0005, 0.04, 0.9, 'bandpass', 1600, 0.8, mix);
      s.burst(T, 0.001, 0.2, 0.6, 'lowpass', 2000, 0.7, mix, 'pink');
      const o = s.osc('triangle', 520, T + 0.03, 0.45, s.vca(T + 0.03, 0.003, 0.3, 0.4, mix));
      o.frequency.exponentialRampToValueAtTime(140, T + 0.4);
      s.osc('sine', 9, T, 0.45, s.gain(50, o.frequency));
    },
  },
  gearDrum: {
    // the Drums of Liberation: a two-stroke heartbeat on deep festival drums
    dur: 0.9, variants: 2, level: 0.7, bus: 'ult', maxVoices: 3, reverb: 0.35, dedupe: 0.12, occlude: false,
    render(s) {
      const mix = wetBus(s, 1.6, 0.35);
      for (const [dt, a] of [[0, 1], [0.17, 0.75]] as const) {
        const t = T + dt;
        s.thump(t, 105, 52, 0.1, 0.42, a, s.shaper(1.6, mix));
        s.burst(t, 0.001, 0.05, 0.35 * a, 'bandpass', 380, 1.2, mix, 'pink');
        s.burst(t, 0.0005, 0.01, 0.25 * a, 'highpass', 3000, 0.7, mix);
      }
    },
  },
  gearAwaken: {
    // the heart speeds up under a rising choir of air; it peaks into the burst at ~1.05 s
    dur: 1.3, level: 0.7, bus: 'ult', stereo: true, occlude: false,
    render(s) {
      const mix = wetBus(s, 2, 0.35);
      const sw = s.gain(0);
      s.swell(sw.gain, T, 1.0, 0.5, 0.05);
      for (const f of [220, 277.2, 329.6, 440]) {
        const o = s.osc('sawtooth', f, T, 1.1, s.filter('lowpass', 1800, 1, sw));
        o.frequency.exponentialRampToValueAtTime(f * 1.5, T + 1.05);
      }
      const bp = s.filter('bandpass', 500, 1, s.vca(T, 0.9, 0.4, 0.15, mix));
      s.sweep(bp.frequency, T, 500, 5000, 1.05);
      s.noise(T, 1.1, bp, 'pink');
      sw.connect(mix);
    },
  },
  gearBurst: {
    // awakening: a huge soft boom, bright shimmer, laughter-like warble of bells, clouds rushing out
    dur: 2.4, level: 0.95, bus: 'ult', stereo: true, reverb: 0.3, occlude: false,
    render(s) {
      const mix = wetBus(s, 2.4, 0.4);
      s.thump(T, 140, 32, 0.3, 1.1, 1, s.shaper(2.5, mix));
      s.burst(T, 0.002, 0.6, 0.7, 'lowpass', 3000, 0.6, mix, 'pink');
      for (let i = 0; i < 7; i++) {
        const t = T + 0.05 + i * 0.07;
        s.partials(523.25 * semi([0, 4, 7, 12, 16, 19, 24][i]), [[1, 0.2, 0.9], [2.01, 0.08, 0.5]], t, mix);
      }
      const wg = s.gain(0);
      s.swell(wg.gain, T, 0.05, 0.5, 1.4);
      const bp = s.filter('bandpass', 3000, 0.8, wg);
      s.sweep(bp.frequency, T, 3000, 400, 1.4);
      s.noise(T, 1.6, bp, 'pink');
      wg.connect(mix);
    },
  },
  gearEnd: {
    // the transformation burns out: a hiss of steam and a deflating wobble
    dur: 1.2, level: 0.5, reverb: 0.2,
    render(s) {
      const hp = s.filter('highpass', 2500, 0.7, s.vca(T, 0.02, 0.4, 0.9));
      s.noise(T, 1, hp, 'white');
      const o = s.osc('triangle', 300, T, 0.8, s.vca(T, 0.01, 0.3, 0.7));
      o.frequency.exponentialRampToValueAtTime(90, T + 0.75);
      s.osc('sine', 11, T, 0.8, s.gain(30, o.frequency));
    },
  },
  engineHigh: { dur: 3, level: 0.32, loop: true, reverb: 0.05, sampleOnly: true },
  skid: { dur: 2, level: 0.26, loop: true, reverb: 0.05, sampleOnly: true },
  gravityCollapse: { dur: 1.1, level: 0.75, reverb: 0.25, sampleOnly: true },
  ambStudy: { dur: 30, level: 0.2, loop: true, reverb: 0, sampleOnly: true, bus: 'amb' },

  // ── the Assembly Hall (menu stage) ──
  hallAmb: { dur: 30, level: 0.2, loop: true, reverb: 0, sampleOnly: true, bus: 'amb' },
  stageSwap: { dur: 1.5, level: 0.32, reverb: 0.3, sampleOnly: true, bus: 'ui', dedupe: 0.25 },

  // ── the room (v0.14 "Surround Sound"): placed emitters around the giant study ──
  fireLoop: { dur: 22, level: 0.42, loop: true, reverb: 0.2, sampleOnly: true, bus: 'amb', ref: 45, rolloff: 0.03, occlude: false },
  windowLoop: { dur: 22, level: 0.3, loop: true, reverb: 0.15, sampleOnly: true, bus: 'amb', ref: 50, rolloff: 0.025, occlude: false },
  watchTick: { dur: 0.4, level: 0.3, reverb: 0.3, sampleOnly: true, bus: 'amb', ref: 3, rolloff: 0.16, dedupe: 0.2, jitter: 0.15, maxVoices: 2 },
  cradleClack: { dur: 0.3, level: 0.22, reverb: 0.3, sampleOnly: true, bus: 'amb', ref: 3, rolloff: 0.14, dedupe: 0.2, jitter: 0.25, maxVoices: 2 },
  metronome: { dur: 0.5, level: 0.32, reverb: 0.4, sampleOnly: true, bus: 'amb', ref: 5, rolloff: 0.1, dedupe: 0.2, jitter: 0.1, maxVoices: 2 },
  woodCreak: { dur: 2, level: 0.3, reverb: 0.7, sampleOnly: true, bus: 'amb', ref: 50, rolloff: 0.02, dedupe: 1, occlude: false },
  chainCreak: { dur: 2, level: 0.22, reverb: 0.6, sampleOnly: true, bus: 'amb', ref: 50, rolloff: 0.02, dedupe: 1, occlude: false },
  cityDistant: { dur: 6, level: 0.2, reverb: 0.3, sampleOnly: true, bus: 'amb', ref: 60, rolloff: 0.02, dedupe: 2, occlude: false },
  birdsWindow: { dur: 4, level: 0.18, reverb: 0.3, sampleOnly: true, bus: 'amb', ref: 60, rolloff: 0.02, dedupe: 2, occlude: false },
  fireSurge: { dur: 2, level: 0.32, reverb: 0.3, sampleOnly: true, bus: 'amb', ref: 45, rolloff: 0.03, dedupe: 3, occlude: false },
  // the desk answers big hits
  rattleChina: { dur: 1, level: 0.42, reverb: 0.25, sampleOnly: true, ref: 4, rolloff: 0.09, maxVoices: 3, dedupe: 0.04, jitter: 0.6 },
  rattleCoins: { dur: 1, level: 0.4, reverb: 0.25, sampleOnly: true, ref: 4, rolloff: 0.09, maxVoices: 3, dedupe: 0.04, jitter: 0.6 },
  rattleGlass: { dur: 1, level: 0.4, reverb: 0.25, sampleOnly: true, ref: 4, rolloff: 0.09, maxVoices: 3, dedupe: 0.04, jitter: 0.6 },
  rattleWood: { dur: 1, level: 0.42, reverb: 0.25, sampleOnly: true, ref: 4, rolloff: 0.09, maxVoices: 3, dedupe: 0.04, jitter: 0.6 },
  paperFlutter: { dur: 1.4, level: 0.34, reverb: 0.2, sampleOnly: true, ref: 4, rolloff: 0.09, maxVoices: 3, dedupe: 0.04, jitter: 0.5 },
  chandelierTinkle: { dur: 2.2, level: 0.32, reverb: 0.6, sampleOnly: true, bus: 'amb', ref: 60, rolloff: 0.02, dedupe: 0.8, occlude: false },
  deskThud: { dur: 1.7, level: 0.7, reverb: 0.5, sampleOnly: true, ref: 18, rolloff: 0.035, maxVoices: 2, dedupe: 0.15, occlude: false },
  // footsteps: each legend has their own shoes, each surface its own layer
  stepEinstein: { dur: 0.2, level: 0.34, reverb: 0.14, sampleOnly: true, jitter: 0.7, maxVoices: 10, dedupe: 0 },
  stepYeat: { dur: 0.4, level: 0.3, reverb: 0.14, sampleOnly: true, jitter: 0.7, maxVoices: 10, dedupe: 0 },
  stepVangogh: { dur: 0.2, level: 0.34, reverb: 0.14, sampleOnly: true, jitter: 0.7, maxVoices: 10, dedupe: 0 },
  stepPaper: { dur: 0.3, level: 0.3, reverb: 0.1, sampleOnly: true, jitter: 0.8, maxVoices: 8, dedupe: 0 },
  stepMetal: { dur: 0.4, level: 0.22, reverb: 0.18, sampleOnly: true, jitter: 0.8, maxVoices: 8, dedupe: 0 },
  stepLeather: { dur: 0.3, level: 0.3, reverb: 0.1, sampleOnly: true, jitter: 0.8, maxVoices: 8, dedupe: 0 },
  stepStone: { dur: 0.3, level: 0.26, reverb: 0.16, sampleOnly: true, jitter: 0.8, maxVoices: 8, dedupe: 0 },
  // feedback you feel
  hitHeavy: { dur: 0.6, level: 0.36, sampleOnly: true, bus: 'ui', maxVoices: 2, dedupe: 0.06, jitter: 0.5 },
  killDrop: { dur: 1.6, level: 0.42, sampleOnly: true, bus: 'ui', maxVoices: 2, dedupe: 0.1 },
  assist: { dur: 0.8, level: 0.3, sampleOnly: true, bus: 'ui', dedupe: 0.3 },
  heartbeat: { dur: 6, level: 0.5, loop: true, sampleOnly: true, bus: 'ui' },
  lowHealth: { dur: 1.5, level: 0.4, sampleOnly: true, bus: 'ui', dedupe: 2 },
  ultAlly: { dur: 1.8, level: 0.5, reverb: 0.25, sampleOnly: true, bus: 'ult', dedupe: 0.4, occlude: false },
  ultEnemy: { dur: 2, level: 0.58, reverb: 0.25, sampleOnly: true, bus: 'ult', dedupe: 0.4, occlude: false },
  finalTick: { dur: 0.5, level: 0.55, reverb: 0.5, sampleOnly: true, bus: 'ui', dedupe: 0.5 },
  slowmo: { dur: 2.3, level: 0.6, reverb: 0.3, sampleOnly: true, bus: 'ult', dedupe: 1 },
  matchPointSting: { dur: 2.2, level: 0.45, reverb: 0.2, sampleOnly: true, bus: 'ui', dedupe: 2 },
  // Tonka: exhaust pops on the lift and the shifter between gears
  backfire: { dur: 0.9, level: 0.55, reverb: 0.3, sampleOnly: true, ref: 6, rolloff: 0.06, maxVoices: 3, dedupe: 0.12, jitter: 0.8 },
  gearShift: { dur: 0.45, level: 0.32, reverb: 0.15, sampleOnly: true, ref: 4, rolloff: 0.08, maxVoices: 2, dedupe: 0.1, jitter: 0.5 },
} satisfies Record<string, Recipe>;

// Specials carry across the whole arena and are never ducked by the moment they create.
for (const k of ['emcCharge', 'emcBlast', 'gravityCollapse', 'bellSummon', 'bigBell', 'bellWhistle', 'bellDrop', 'starry', 'starFall', 'staticCharge', 'staticBlast'] as const) {
  Object.assign(RECIPES[k], { bus: 'ult', ref: 18, rolloff: 0.035 });
}

export type Sfx = keyof typeof RECIPES;

/** Bake order: what you hear first is ready first. */
export const BAKE_ORDER: Sfx[] = [
  'ui', 'uiHover', 'uiTab', 'uiBack', 'lockIn', 'denied', 'countdown', 'go', 'hit', 'crit', 'kill', 'hurt', 'step', 'stepGrass', 'jump', 'land', 'comm',
  'photon', 'photonHit', 'bell', 'bellHit', 'paint', 'splat', 'gravityThrow', 'seedToss', 'gravity', 'tonka', 'engineLoop', 'crash', 'ram',
  'bloom', 'heal', 'pickup', 'respawn', 'death', 'ultReady', 'emcCharge', 'emcBlast', 'bellSummon', 'bellWhistle', 'bigBell', 'bellDrop',
  'starry', 'starFall', 'victory', 'defeat',
  'blitzJab', 'blitzPunchHit', 'blitzUppercut', 'grabLaunch', 'grabReel', 'grabHit', 'staticCharge', 'staticBlast', 'staticZap', 'stepBlitz',
];

function hashName(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

function finish(buf: AudioBuffer) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; } }
  const k = peak > 1e-5 ? 0.89 / peak : 1;
  const fade = Math.min(buf.length, Math.floor(buf.sampleRate * 0.02));
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
    for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
  }
  return buf;
}

export async function renderRecipe(name: Sfx, v: number, sr: number): Promise<AudioBuffer> {
  const r: Recipe = RECIPES[name];
  if (r.raw) {
    const chans = r.raw(sr, v);
    const b = new AudioBuffer({ length: chans[0].length, sampleRate: sr, numberOfChannels: chans.length });
    chans.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    let peak = 0;
    for (const c of chans) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
    if (peak > 1e-5) for (let i = 0; i < b.numberOfChannels; i++) { const d = b.getChannelData(i); for (let j = 0; j < d.length; j++) d[j] *= 0.89 / peak; }
    return b;
  }
  const ch = r.stereo ? 2 : 1;
  const oc = new OfflineAudioContext(ch, Math.ceil(r.dur * sr), sr);
  const s = new Synth(oc, r.dur, hashName(name) + v * 101, !!r.stereo);
  r.render!(s, v);
  return finish(await oc.startRendering());
}
