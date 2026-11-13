// Turn the picked takes in sfx-src/ into game-ready Ogg Opus files plus a generated manifest.
// Usage: node scripts/sfx/build.mjs          (needs ffmpeg on PATH)
//
// Per take: decode → trim the silence ElevenLabs leaves before the transient → cut the tail
// at -54 dB with a short fade → loudness-match (active RMS → -17 dBFS, peak capped at -1 dBFS)
// → Opus (mono 64 kbps, stereo 96 kbps). Loops are left untrimmed so they stay seamless.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { SFX, PICKS, STEREO, ANNOUNCER } from './manifest.mjs';

const SR = 48000;
const OUT = 'public/audio/sfx';
const VOX = 'public/audio/announcer';
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
rmSync(VOX, { recursive: true, force: true }); mkdirSync(VOX, { recursive: true });

function decode(file, ch) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', String(ch), '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const n = all.length / ch;
  return Array.from({ length: ch }, (_, c) => { const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = all[i * ch + c]; return d; });
}

function encode(chans, file, kbps) {
  const ch = chans.length, n = chans[0].length;
  const inter = new Float32Array(n * ch);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) inter[i * ch + c] = chans[c][i];
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', String(ch), '-i', '-', '-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'on', '-application', 'audio', '-frame_duration', '10', file], { input: Buffer.from(inter.buffer) });
}

/** Envelope (max abs over both channels) in 1 ms blocks. */
function env(chans) {
  const blk = SR / 1000, n = Math.ceil(chans[0].length / blk), e = new Float32Array(n);
  for (const d of chans) for (let i = 0; i < d.length; i++) { const b = (i / blk) | 0; const a = Math.abs(d[i]); if (a > e[b]) e[b] = a; }
  return e;
}

function process(chans, { loop, speech }) {
  let peak = 0;
  for (const d of chans) for (const v of d) peak = Math.max(peak, Math.abs(v));
  if (peak < 1e-6) throw new Error('silent take');
  let a = 0, b = chans[0].length;
  if (!loop) {
    const e = env(chans), blk = SR / 1000;
    const on = e.findIndex((v) => v > peak * (speech ? 0.05 : 0.1));
    let off = e.length - 1; while (off > on && e[off] < peak * (loop ? 0 : speech ? 0.004 : 0.006)) off--;
    a = Math.max(0, (on - (speech ? 25 : 3)) * blk);
    b = Math.min(chans[0].length, (off + 1) * blk);
    chans = chans.map((d) => d.slice(a, b));
    const fi = Math.min(96, chans[0].length), fo = Math.min(Math.round(SR * (speech ? 0.04 : 0.02)), chans[0].length);
    for (const d of chans) {
      for (let i = 0; i < fi; i++) d[i] *= i / fi;
      for (let i = 0; i < fo; i++) d[d.length - 1 - i] *= i / fo;
    }
  }
  // loudness match on the active part of the sound
  let sum = 0, cnt = 0;
  for (const d of chans) for (const v of d) if (Math.abs(v) > peak * 0.03) { sum += v * v; cnt++; }
  const rms = Math.sqrt(sum / Math.max(1, cnt));
  const target = speech ? 0.2 : loop ? 0.1 : 0.141; // -14 / -20 / -17 dBFS
  const k = Math.min(target / rms, 0.89 / peak);
  for (const d of chans) for (let i = 0; i < d.length; i++) d[i] *= k;
  return { chans, len: chans[0].length / SR, gainDb: 20 * Math.log10(k) };
}

function peakTime(chans) { const e = env(chans); let m = 0; for (let i = 1; i < e.length; i++) if (e[i] > e[m]) m = i; return m / 1000; }

const files = {};
const meta = {};
let bytes = 0;
for (const [key, takes] of Object.entries(PICKS)) {
  const [name, variant] = key.split('.');
  const def = SFX.find((s) => s.name === name && (variant === undefined || s.variant === Number(variant)));
  if (!def) throw new Error('no manifest entry for ' + key);
  const st = STEREO.has(name);
  const list = files[name] ??= [];
  takes.forEach((t, i) => {
    const src = `sfx-src/${key}/take-${t}.mp3`;
    const { chans, len } = process(decode(src, st ? 2 : 1), { loop: !!def.loop });
    const out = `${name}-${variant ?? i}.ogg`;
    encode(chans, `${OUT}/${out}`, st ? 96 : 64);
    if (variant !== undefined) list[Number(variant)] = out; else list.push(out);
    if (name === 'gravityCollapse') meta.gravityCollapsePeak = +peakTime(chans).toFixed(3);
    console.log(out.padEnd(22), len.toFixed(2) + 's');
  });
}

// announcer: pick the take whose spoken length is closest to the median, breaking ties by energy
const vox = {};
for (const l of ANNOUNCER) {
  const dir = `sfx-src/announcer/${l.name}`;
  const takes = readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort().map((f) => {
    const p = process(decode(`${dir}/${f}`, 1), { speech: true });
    return { f, ...p };
  });
  const med = [...takes].sort((x, y) => x.len - y.len)[Math.floor(takes.length / 2)].len;
  const best = takes.map((t) => ({ t, score: Math.abs(t.len - med) / med })).sort((x, y) => x.score - y.score)[0].t;
  encode(best.chans, `${VOX}/${l.name}.ogg`, 64);
  vox[l.name] = `${l.name}.ogg`;
  console.log(`announcer ${l.name.padEnd(10)} ${best.f} ${best.len.toFixed(2)}s`);
}

for (const d of [OUT, VOX]) for (const f of readdirSync(d)) bytes += Number(execFileSync('stat', ['-c', '%s', `${d}/${f}`]).toString());
console.log(`total ${(bytes / 1024).toFixed(0)} KB`);

writeFileSync('src/audio/sampleManifest.ts', `// Generated by scripts/sfx/build.mjs. Do not edit by hand.
/** ElevenLabs-generated sound files per sound, in variant order (served from /audio/sfx/). */
export const SAMPLE_FILES: Record<string, string[]> = ${JSON.stringify(files, null, 2)};

/** Announcer lines (served from /audio/announcer/). */
export const ANNOUNCER_FILES: Record<string, string> = ${JSON.stringify(vox, null, 2)};

/** Seconds from the start of the gravity collapse sample to its implosion peak. */
export const GRAVITY_COLLAPSE_PEAK = ${meta.gravityCollapsePeak ?? 0.8};
`);
