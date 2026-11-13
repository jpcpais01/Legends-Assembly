// Generate SFX candidates with the ElevenLabs Sound Effects API (see manifest.mjs).
// Usage: ELEVENLABS_API_KEY=... node scripts/sfx/generate.mjs [name ...]
import { mkdir, writeFile, access } from 'node:fs/promises';
import { SFX } from './manifest.mjs';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('ELEVENLABS_API_KEY is not set'); process.exit(1); }
const only = process.argv.slice(2);
const OUT = 'sfx-src';

const jobs = [];
for (const s of SFX) {
  if (only.length && !only.includes(s.name)) continue;
  const dir = `${OUT}/${s.name}${s.variant !== undefined ? '.' + s.variant : ''}`;
  for (let t = 1; t <= s.takes; t++) jobs.push({ s, dir, file: `${dir}/take-${t}.mp3` });
}

async function exists(f) { try { await access(f); return true; } catch { return false; } }

async function gen({ s, dir, file }) {
  if (await exists(file)) return;
  await mkdir(dir, { recursive: true });
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_192', {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ text: s.text, duration_seconds: s.dur, prompt_influence: s.inf ?? 0.5, loop: !!s.loop, model_id: 'eleven_text_to_sound_v2' }),
    });
    if (res.ok) { await writeFile(file, Buffer.from(await res.arrayBuffer())); console.log('ok', file); return; }
    const msg = await res.text();
    console.warn('retry', file, res.status, msg.slice(0, 200));
    if (res.status === 401 || res.status === 400) throw new Error(msg);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error('failed ' + file);
}

let i = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (i < jobs.length) await gen(jobs[i++]); }));
console.log('done', jobs.length);
