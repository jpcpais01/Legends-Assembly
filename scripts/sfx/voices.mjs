// Record every hero voice line and the extra announcer lines with ElevenLabs text to speech.
// Usage: ELEVENLABS_API_KEY=... node --experimental-strip-types scripts/sfx/voices.mjs [hero|announcer ...]
//   (behind the cloud proxy also set NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt)
//
// Lines come from src/audio/voicelines.ts. Raw takes are cached in sfx-src/voice/ (git-ignored),
// so re-running only records new or changed lines. Output: src/assets/voice/<hero>/<id>.ogg and
// src/assets/announcer/<name>.ogg (Vite fingerprints them, so changed takes never hit a stale cache).
// A take is rejected when its spoken length is far from what the word count predicts (the voice
// read the direction out loud, rambled or cut off) and re-recorded, up to 4 times.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VOICES, ANNOUNCER_EXTRA, spoken } from '../../src/audio/voicelines.ts';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('ELEVENLABS_API_KEY is not set'); process.exit(1); }
const ANNOUNCER_VOICE = 'nPczCjzI2devNBz1zQrb';
const only = process.argv.slice(2);
const SR = 48000;

const jobs = [];
for (const [hero, v] of Object.entries(VOICES)) {
  if (only.length && !only.includes(hero)) continue;
  const add = (id, text) => jobs.push({ out: `src/assets/voice/${hero}/${id}.ogg`, text, tts: v.tts });
  for (const lines of Object.values(v.lines)) for (const l of lines) add(l.id, l.text);
  for (const lines of Object.values(v.rival)) for (const l of lines) add(l.id, l.text);
  for (const b of v.banter) add(b.id, b.text);
  // replies: the partner answers in its own voice
  for (const [other, ov] of Object.entries(VOICES)) for (const b of ov.banter) if (b.vs === hero) add(`reply_${other}`, b.reply);
}
if (!only.length || only.includes('announcer')) {
  for (const a of ANNOUNCER_EXTRA) jobs.push({ out: `src/assets/announcer/${a.name}.ogg`, text: a.text, tts: { voice: ANNOUNCER_VOICE, direction: '', stability: 0.5, style: 0.6 }, ann: true });
}

function decode(file) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

/** Trim silence, short fades, loudness to -14 dBFS active RMS with a -1 dBFS peak cap. */
function processSpeech(d) {
  let peak = 0;
  for (const v of d) peak = Math.max(peak, Math.abs(v));
  if (peak < 1e-4) throw new Error('silent take');
  const blk = SR / 1000, n = Math.ceil(d.length / blk), e = new Float32Array(n);
  for (let i = 0; i < d.length; i++) { const b = (i / blk) | 0; const a = Math.abs(d[i]); if (a > e[b]) e[b] = a; }
  const on = e.findIndex((v) => v > peak * 0.05);
  let off = e.length - 1; while (off > on && e[off] < peak * 0.004) off--;
  const out = d.slice(Math.max(0, (on - 25) * blk), Math.min(d.length, (off + 1) * blk));
  const fi = Math.min(96, out.length), fo = Math.min(Math.round(SR * 0.04), out.length);
  for (let i = 0; i < fi; i++) out[i] *= i / fi;
  for (let i = 0; i < fo; i++) out[out.length - 1 - i] *= i / fo;
  let sum = 0, cnt = 0;
  for (const v of out) if (Math.abs(v) > peak * 0.03) { sum += v * v; cnt++; }
  const k = Math.min(0.2 / Math.sqrt(sum / Math.max(1, cnt)), 0.89 / peak);
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

function encode(d, file) {
  mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-c:a', 'libopus', '-b:a', '48k', '-vbr', 'on', '-application', 'voip', file], { input: Buffer.from(d.buffer) });
}

/** Expected spoken seconds for a line: generous, since performances vary. */
function window(text) {
  const words = spoken(text).split(/\s+/).filter(Boolean).length;
  return [Math.max(0.35, words * 0.16), 1.6 + words * 0.62];
}

async function tts(job) {
  const body = {
    text: job.tts.direction ? `${job.tts.direction} ${job.text}` : job.text,
    model_id: 'eleven_v3',
    voice_settings: { stability: job.tts.stability, similarity_boost: 0.8, style: job.tts.style },
  };
  for (let a = 0; a < 5; a++) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${job.tts.voice}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const msg = await res.text();
    if (res.status === 401 || res.status === 400 || res.status === 404) throw new Error(`${res.status} ${msg}`);
    console.warn('retry', job.out, res.status, msg.slice(0, 160));
    await new Promise((r) => setTimeout(r, 2500 * (a + 1)));
  }
  throw new Error('gave up ' + job.out);
}

const report = [];
async function run(job) {
  const hash = createHash('md5').update(JSON.stringify([job.text, job.tts])).digest('hex').slice(0, 10);
  const rawBase = `sfx-src/voice/${job.out.replace(/^src\/assets\//, '').replace(/\.ogg$/, '')}-${hash}`;
  const [lo, hi] = window(job.text);
  let best = null;
  for (let take = 1; take <= 4; take++) {
    const raw = `${rawBase}-t${take}.mp3`;
    if (!existsSync(raw)) {
      mkdirSync(raw.slice(0, raw.lastIndexOf('/')), { recursive: true });
      writeFileSync(raw, await tts(job));
    }
    const d = processSpeech(decode(raw));
    const len = d.length / SR;
    const miss = len < lo ? lo - len : len > hi ? len - hi : 0;
    if (!best || miss < best.miss) best = { d, len, miss, take };
    if (miss === 0) break;
  }
  encode(best.d, job.out);
  report.push(`${job.out.padEnd(52)} ${best.len.toFixed(2)}s take ${best.take}${best.miss ? `  (off by ${best.miss.toFixed(2)}s)` : ''}`);
}

let i = 0;
await Promise.all(Array.from({ length: 3 }, async () => { while (i < jobs.length) { const j = jobs[i++]; try { await run(j); } catch (e) { report.push(`FAILED ${j.out}: ${e.message}`); } } }));
console.log(report.sort().join('\n'));
console.log('lines', jobs.length);
