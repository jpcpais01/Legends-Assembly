/**
 * Offline synthesis toolkit. Every sound in the game is designed here as a little
 * WebAudio graph, rendered ONCE into an AudioBuffer (OfflineAudioContext) when audio
 * unlocks, and then played back as a cheap buffer source. That lets each sound be as
 * rich as we like (dozens of layers, baked reverb, Karplus-Strong plucks) while the
 * runtime cost of firing it stays at a single node chain.
 */

export type NoiseKind = 'white' | 'pink' | 'brown';

const NOISE_SECONDS = 3;
let noiseCache: { sr: number; bufs: Record<NoiseKind, AudioBuffer> } | null = null;
const irCache = new Map<string, AudioBuffer>();

/** Small deterministic PRNG so baked variants are stable between sessions. */
export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseBuffers(sr: number) {
  if (noiseCache && noiseCache.sr === sr) return noiseCache.bufs;
  const len = Math.floor(sr * NOISE_SECONDS);
  const rnd = mulberry(1337);
  const mk = () => new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 1 });
  const white = mk(), pink = mk(), brown = mk();
  const w = white.getChannelData(0), p = pink.getChannelData(0), b = brown.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < len; i++) {
    const x = rnd() * 2 - 1;
    w[i] = x;
    // Paul Kellet's refined pink filter
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
    br = (br + 0.02 * x) / 1.02;
    b[i] = br * 3.5;
  }
  noiseCache = { sr, bufs: { white, pink, brown } };
  return noiseCache.bufs;
}

/**
 * Procedural stereo impulse response: sparse early reflections, then a dense tail that
 * darkens as it decays (high frequencies die first, like a real room).
 */
export function impulseResponse(sr: number, seconds: number, decay = 3, bright = 0.6, seed = 7) {
  const key = `${sr}|${seconds}|${decay}|${bright}|${seed}`;
  const hit = irCache.get(key);
  if (hit) return hit;
  const len = Math.floor(sr * seconds);
  const ir = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 2 });
  const rnd = mulberry(seed);
  const pre = Math.floor(sr * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const k = (i - pre) / (len - pre);
      const env = Math.pow(1 - k, decay);
      const coef = 0.04 + bright * (1 - k) * 0.9;
      lp += ((rnd() * 2 - 1) - lp) * coef;
      d[i] = lp * env * (1 + bright);
    }
    // early reflections
    for (let r = 0; r < 9; r++) {
      const at = pre + Math.floor(sr * (0.006 + rnd() * 0.07));
      if (at < len) d[at] += (rnd() < 0.5 ? -1 : 1) * (0.6 - r * 0.05);
    }
  }
  // normalize energy
  let e = 0;
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) e += d[i] * d[i]; }
  const g = 1 / Math.sqrt(e / 2 + 1e-9) * 0.9;
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] *= g; }
  irCache.set(key, ir);
  return ir;
}

let shaperCurves = new Map<number, Float32Array<ArrayBuffer>>();
function shaperCurve(drive: number) {
  const k = Math.round(drive * 100);
  let c = shaperCurves.get(k);
  if (!c) {
    c = new Float32Array(2048);
    const norm = Math.tanh(drive);
    for (let i = 0; i < 2048; i++) { const x = (i / 2047) * 2 - 1; c[i] = Math.tanh(x * drive) / norm; }
    shaperCurves.set(k, c);
    if (shaperCurves.size > 64) shaperCurves = new Map();
  }
  return c;
}

export class Synth {
  readonly c: OfflineAudioContext;
  /** Final node of this render: everything ends up here. */
  readonly out: GainNode;
  readonly sr: number;
  readonly dur: number;
  readonly rnd: () => number;
  readonly stereo: boolean;

  constructor(c: OfflineAudioContext, dur: number, seed: number, stereo: boolean) {
    this.c = c;
    this.sr = c.sampleRate;
    this.dur = dur;
    this.stereo = stereo;
    this.rnd = mulberry(seed * 7919 + 17);
    this.out = c.createGain();
    this.out.connect(c.destination);
  }

  r(a: number, b: number) { return a + (b - a) * this.rnd(); }
  pick<T>(arr: T[]) { return arr[Math.floor(this.rnd() * arr.length)]; }

  gain(v = 1, dest: AudioNode | AudioParam = this.out) {
    const g = this.c.createGain();
    g.gain.value = v;
    if (dest instanceof AudioParam) g.connect(dest); else g.connect(dest);
    return g;
  }

  /** Fast linear attack to `peak`, then a natural exponential decay that is ~silent by t + a + d. */
  env(p: AudioParam, t: number, a: number, peak: number, d: number) {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + Math.max(0.0006, a));
    p.setTargetAtTime(0, t + Math.max(0.0006, a), Math.max(0.002, d / 5));
  }

  /** Swell: slow exponential rise to `peak` at t + rise, then a quick cut over `release`. */
  swell(p: AudioParam, t: number, rise: number, peak: number, release = 0.04) {
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(peak, t + rise);
    p.linearRampToValueAtTime(0, t + rise + release);
  }

  /** Gain with an attack/decay envelope already scheduled. */
  vca(t: number, a: number, peak: number, d: number, dest: AudioNode = this.out) {
    const g = this.gain(0, dest);
    this.env(g.gain, t, a, peak, d);
    return g;
  }

  osc(type: OscillatorType, f: number, t: number, dur: number, dest: AudioNode, detune = 0) {
    const o = this.c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (detune) o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(Math.min(this.dur, t + dur + 0.02));
    return o;
  }

  sweep(p: AudioParam, t: number, from: number, to: number, dur: number, curve: 'exp' | 'lin' = 'exp') {
    p.setValueAtTime(from, t);
    if (curve === 'exp') p.exponentialRampToValueAtTime(Math.max(1e-4, to), t + dur);
    else p.linearRampToValueAtTime(to, t + dur);
  }

  noise(t: number, dur: number, dest: AudioNode, kind: NoiseKind = 'white', rate = 1) {
    const s = this.c.createBufferSource();
    s.buffer = noiseBuffers(this.sr)[kind];
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(dest);
    s.start(t, this.rnd() * (NOISE_SECONDS - 0.1));
    s.stop(Math.min(this.dur, t + dur + 0.02));
    return s;
  }

  filter(type: BiquadFilterType, f: number, q: number, dest: AudioNode) {
    const b = this.c.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    b.connect(dest);
    return b;
  }

  shaper(drive: number, dest: AudioNode) {
    const w = this.c.createWaveShaper();
    w.curve = shaperCurve(drive);
    w.oversample = '2x';
    w.connect(dest);
    return w;
  }

  pan(v: number, dest: AudioNode = this.out) {
    const p = this.c.createStereoPanner();
    p.pan.value = v;
    p.connect(dest);
    return p;
  }

  /** Feedback delay; returns its input. */
  delay(time: number, feedback: number, wet: number, dest: AudioNode = this.out, damp = 4000) {
    const input = this.c.createGain();
    const d = this.c.createDelay(Math.max(1, time + 0.1));
    d.delayTime.value = time;
    const fb = this.c.createGain(); fb.gain.value = feedback;
    const lp = this.c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = damp;
    input.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d);
    lp.connect(this.gain(wet, dest));
    return input;
  }

  /** Convolution reverb baked into the sound; returns its input (wet only). */
  reverb(seconds: number, wet: number, dest: AudioNode = this.out, decay = 3, bright = 0.6) {
    const input = this.c.createGain();
    const cv = this.c.createConvolver();
    cv.normalize = false;
    cv.buffer = impulseResponse(this.sr, seconds, decay, bright);
    input.connect(cv);
    cv.connect(this.gain(wet, dest));
    return input;
  }

  /** Two-operator FM voice. Index decays from `index` to `indexEnd` over the note. */
  fm(f: number, ratio: number, index: number, t: number, dur: number, dest: AudioNode, indexEnd = index * 0.05) {
    const car = this.osc('sine', f, t, dur, dest);
    const mod = this.c.createOscillator();
    mod.frequency.value = f * ratio;
    const mg = this.c.createGain();
    mg.gain.setValueAtTime(f * index, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(0.01, f * indexEnd), t + dur);
    mod.connect(mg).connect(car.frequency);
    mod.start(t);
    mod.stop(Math.min(this.dur, t + dur + 0.02));
    return car;
  }

  /** Inharmonic struck partials: [ratio, amp, decay]. `beat` adds a detuned twin per partial (bell warble). */
  partials(base: number, list: [number, number, number][], t: number, dest: AudioNode, beat = 0, attack = 0.0015) {
    for (const [ratio, amp, d] of list) {
      const g = this.vca(t, attack, amp, d, dest);
      this.osc('sine', base * ratio, t, d + 0.05, g, this.r(-3, 3));
      if (beat > 0) {
        const g2 = this.vca(t, attack, amp * 0.55, d * 0.9, dest);
        this.osc('sine', base * ratio * (1 + beat * (0.6 + this.rnd() * 0.8)), t, d + 0.05, g2);
      }
    }
  }

  /** Karplus-Strong plucked string, computed sample by sample. */
  pluck(f: number, t: number, dur: number, dest: AudioNode, amp = 0.5, bright = 0.5, decay = 0.996) {
    const n = Math.max(1, Math.floor(dur * this.sr));
    const data = new Float32Array(n);
    const N = Math.max(2, Math.round(this.sr / f));
    const ring = new Float32Array(N);
    let lp = 0;
    for (let i = 0; i < N; i++) { const x = this.rnd() * 2 - 1; lp += (x - lp) * (0.25 + bright * 0.75); ring[i] = lp; }
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const cur = ring[idx];
      const nxt = ring[(idx + 1) % N];
      data[i] = cur * amp;
      ring[idx] = decay * (cur * (0.5 + bright * 0.45) + nxt * (0.5 - bright * 0.45));
      idx = (idx + 1) % N;
    }
    // tiny fade-out so a cut never clicks
    const fade = Math.min(n, Math.floor(this.sr * 0.01));
    for (let i = 0; i < fade; i++) data[n - 1 - i] *= i / fade;
    return this.buffer([data], t, dest);
  }

  buffer(chans: Float32Array[], t: number, dest: AudioNode, rate = 1) {
    const b = new AudioBuffer({ length: chans[0].length, sampleRate: this.sr, numberOfChannels: chans.length });
    chans.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    const s = this.c.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    s.connect(dest);
    s.start(t);
    return s;
  }

  /** Pitched sine thump (kick / body). */
  thump(t: number, f0: number, f1: number, sweepT: number, decay: number, amp: number, dest: AudioNode = this.out) {
    const g = this.vca(t, 0.0015, amp, decay, dest);
    const o = this.osc('sine', f0, t, decay + 0.05, g);
    o.frequency.exponentialRampToValueAtTime(f1, t + sweepT);
    return o;
  }

  /** Band of filtered noise with an envelope. */
  burst(t: number, a: number, d: number, amp: number, type: BiquadFilterType, f: number, q: number, dest: AudioNode = this.out, kind: NoiseKind = 'white') {
    const g = this.vca(t, a, amp, d, dest);
    const fl = this.filter(type, f, q, g);
    this.noise(t, a + d + 0.02, fl, kind);
    return fl;
  }

  /** Granular crackle: many tiny high clicks with a density envelope. */
  crackle(t: number, dur: number, count: number, amp: number, dest: AudioNode, lo = 2500, hi = 9000, densityPow = 1.6) {
    for (let i = 0; i < count; i++) {
      const at = t + Math.pow(this.rnd(), densityPow) * dur;
      const k = 1 - (at - t) / dur;
      this.burst(at, 0.0005, this.r(0.004, 0.018), amp * (0.3 + 0.7 * k) * this.r(0.4, 1), 'bandpass', this.r(lo, hi), this.r(1, 5), dest);
    }
  }
}

export const semi = (n: number) => Math.pow(2, n / 12);

export type RoomPreset = 'study' | 'ruins';

/**
 * A room you can hear. Built from the space itself rather than a generic hall:
 * - study: a huge wood-panelled library. Dense early reflections off the desk and the near
 *   walls, a warm tail (wood and books eat the highs fast, the lows ring longer), ~2.3 s.
 * - ruins: open air between broken stone walls. A few distinct slap echoes off far walls,
 *   then a short, thin, bright diffuse tail, ~1.4 s.
 * Frequency-dependent decay comes from splitting the noise into a low and a high band with
 * their own decay times.
 */
export function roomImpulse(sr: number, preset: RoomPreset) {
  const study = preset === 'study';
  const seconds = study ? 2.6 : 1.8;
  const len = Math.floor(sr * seconds);
  const ir = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 2 });
  const rnd = mulberry(study ? 31 : 57);
  const pre = Math.floor(sr * (study ? 0.014 : 0.02));
  const rtLow = study ? 2.3 : 1.2, rtHigh = study ? 1.0 : 0.9;
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0, lp2 = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const n = rnd() * 2 - 1;
      lp += (n - lp) * 0.08; // low band
      lp2 += (lp - lp2) * 0.5;
      const hi = n - lp;
      // -60 dB at rt: exp(-6.9 t / rt)
      const eL = Math.exp((-6.9 * t) / rtLow), eH = Math.exp((-6.9 * t) / rtHigh);
      // the diffuse field builds up over the first ~60 ms instead of starting at full density
      const build = Math.min(1, t / (study ? 0.06 : 0.09));
      d[i] = (lp2 * 1.6 * eL + hi * (study ? 0.35 : 0.6) * eH) * build * (study ? 1 : 0.55);
    }
    // early reflections: desk, near walls, bookshelves (study) / far ruined walls (ruins)
    const taps = study
      ? [[0.007, 0.8], [0.013, 0.62], [0.019, 0.55], [0.027, 0.48], [0.034, 0.4], [0.046, 0.36], [0.058, 0.3], [0.071, 0.26], [0.089, 0.2]]
      : [[0.011, 0.5], [0.062, 0.42], [0.118, 0.34], [0.181, 0.24], [0.263, 0.14]];
    for (const [at0, g] of taps) {
      const at = pre + Math.floor(sr * (at0 + (rnd() - 0.5) * 0.004 + ch * 0.0013));
      const w = Math.floor(sr * (study ? 0.0009 : 0.0016));
      for (let k = 0; k < w && at + k < len; k++) d[at + k] += (rnd() < 0.5 ? -1 : 1) * g * (1 - k / w);
    }
  }
  let e = 0;
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) e += d[i] * d[i]; }
  const g = (1 / Math.sqrt(e / 2 + 1e-9)) * 0.9;
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] *= g; }
  return ir;
}
