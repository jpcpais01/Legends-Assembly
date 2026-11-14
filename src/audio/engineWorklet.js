/* global sampleRate, registerProcessor, AudioWorkletProcessor */
/**
 * A live V8, synthesized sample by sample (AudioWorklet), so the Tonka's engine follows the
 * truck exactly: every rpm, every gear change, every throttle lift.
 *
 * Model (a small physical sketch of a real engine):
 * - A crankshaft turns at `rpm`. A four-stroke V8 fires 8 times per 720 degrees, in the
 *   cross-plane firing order 1-8-4-3-6-5-7-2. Each bank therefore fires at uneven intervals,
 *   which is where the V8's lumpy burble comes from.
 * - Each firing is a short pressure pulse with cycle-to-cycle variation (more at low load,
 *   like a lumpy cam), scaled by `load` (throttle) and by a fixed per-cylinder imbalance.
 * - Each bank's pulses ring down its own exhaust pipe (a feedback delay line: a waveguide with
 *   a damping filter), slightly different lengths left and right.
 * - The two pipes meet in a muffler (low resonant body + a tailpipe resonance) and are
 *   driven into a soft clipper for growl. Intake roar is filtered noise that opens with
 *   throttle; a faint valvetrain tick sits on top.
 */
const ORDER_BANK = [0, 1, 1, 0, 1, 0, 0, 1]; // cylinders 1,8,4,3,6,5,7,2 → left/right bank
const IMBALANCE = [1.0, 0.93, 1.06, 0.97, 1.04, 0.9, 1.08, 0.95];

class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  set(type, f, q, gainDb = 0) {
    const w = (2 * Math.PI * Math.min(f, sampleRate * 0.45)) / sampleRate, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else { // peaking
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

class Pipe {
  constructor(meters) {
    this.buf = new Float32Array(4096);
    this.w = 0;
    this.len = Math.max(8, Math.round(((2 * meters) / 343) * sampleRate));
    this.lp = 0;
  }
  run(x, fb, damp) {
    const n = this.buf.length;
    const r = (this.w - this.len + n) % n;
    const back = this.buf[r];
    this.lp += (back - this.lp) * damp;
    const y = x + fb * this.lp;
    this.buf[this.w] = y;
    this.w = (this.w + 1) % n;
    return y;
  }
}

class V8Processor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 900, minValue: 300, maxValue: 9000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.phase = 0; // crank degrees in the 720° cycle
    this.next = 0; // index of the next firing
    this.ex = [[0, 0], [0, 0]]; // per-bank pulse shaper state
    this.pipes = [new Pipe(1.55), new Pipe(1.72)];
    this.body = new Biquad().set('peak', 85, 1.1, 9);
    this.body2 = new Biquad().set('peak', 210, 1.6, 4);
    this.tail = new Biquad().set('lp', 1900, 0.7);
    this.hp = new Biquad().set('hp', 32, 0.7);
    this.intake = new Biquad().set('bp', 700, 1.2);
    this.tick = new Biquad().set('bp', 5200, 2.5);
    this.seed = 22222;
    this.lastRpm = -1;
    this.dc = 0;
    this.out = 0;
    this.misfire = 0;
  }

  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }

  process(_in, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const rpm = params.rpm[0], load = params.load[0], gain = params.gain[0];
    if (Math.abs(rpm - this.lastRpm) > 40) {
      this.lastRpm = rpm;
      this.intake.set('bp', 500 + rpm * 0.12, 1.1);
    }
    const dPhase = (rpm / 60) * 360 / sampleRate;
    // pulse width shrinks a little as revs climb; lumpy at low load, smooth at full throttle
    const k1 = Math.exp(-1 / (sampleRate * (0.0016 - Math.min(0.0006, rpm * 0.0000001))));
    const k2 = Math.exp(-1 / (sampleRate * 0.0007));
    const jitter = 0.38 - load * 0.26;
    const fb = 0.62 - (rpm / 9000) * 0.12;
    const drive = 1.4 + load * 2.2;
    const intakeAmt = load * (rpm / 6500) * 0.11;
    for (let i = 0; i < out.length; i++) {
      this.phase += dPhase;
      if (this.phase >= 720) { this.phase -= 720; this.next = 0; }
      let trigL = 0, trigR = 0;
      while (this.next < 8 && this.phase >= this.next * 90) {
        const cyl = this.next;
        let a = (0.28 + load * 0.72) * IMBALANCE[cyl] * (1 + (this.rnd() - 0.5) * 2 * jitter);
        // throttle off: the odd skipped or weak firing (overrun burble)
        if (load < 0.15 && this.rnd() < 0.12) a *= 0.15;
        if (ORDER_BANK[cyl]) trigR += a; else trigL += a;
        this.next++;
      }
      let sum = 0;
      for (let b = 0; b < 2; b++) {
        const e = this.ex[b];
        e[0] = e[0] * k1 + (b ? trigR : trigL);
        e[1] = e[1] * k2 + e[0] * (1 - k2);
        // the pressure pulse carries a little combustion noise
        const p = e[1] * (1 + (this.rnd() - 0.5) * (0.22 + load * 0.3));
        sum += this.pipes[b].run(p, fb, 0.28 + load * 0.12);
      }
      let y = this.body.run(sum);
      y = this.body2.run(y);
      y = this.tail.run(y);
      const n = this.rnd() * 2 - 1;
      y += this.intake.run(n) * intakeAmt * 1.4;
      // valvetrain: a faint tick at twice the firing rate
      y += this.tick.run(n) * 0.02 * (0.3 + rpm / 7000);
      y = this.hp.run(y);
      y = Math.tanh(y * drive * 0.9) / Math.tanh(drive * 0.9);
      out[i] = y * 0.55 * gain;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

registerProcessor('v8-engine', V8Processor);
