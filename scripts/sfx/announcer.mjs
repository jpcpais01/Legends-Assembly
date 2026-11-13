// Generate announcer takes with ElevenLabs text to speech (see manifest.mjs).
// Usage: ELEVENLABS_API_KEY=... node scripts/sfx/announcer.mjs [name ...]
import { mkdir, writeFile, access } from 'node:fs/promises';
import { ANNOUNCER, ANNOUNCER_VOICE, ANNOUNCER_TAKES } from './manifest.mjs';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('ELEVENLABS_API_KEY is not set'); process.exit(1); }
const only = process.argv.slice(2);
const jobs = [];
for (const l of ANNOUNCER) {
  if (only.length && !only.includes(l.name)) continue;
  for (let t = 1; t <= ANNOUNCER_TAKES; t++) jobs.push({ l, dir: `sfx-src/announcer/${l.name}`, file: `sfx-src/announcer/${l.name}/take-${t}.mp3` });
}
const exists = async (f) => { try { await access(f); return true; } catch { return false; } };
async function gen({ l, dir, file }) {
  if (await exists(file)) return;
  await mkdir(dir, { recursive: true });
  for (let a = 0; a < 4; a++) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ANNOUNCER_VOICE}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ text: l.text, model_id: 'eleven_v3', voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.6 } }),
    });
    if (res.ok) { await writeFile(file, Buffer.from(await res.arrayBuffer())); return; }
    const msg = await res.text();
    console.warn('retry', file, res.status, msg.slice(0, 200));
    if (res.status === 401 || res.status === 400) throw new Error(msg);
    await new Promise((r) => setTimeout(r, 2000 * (a + 1)));
  }
}
let i = 0;
await Promise.all(Array.from({ length: 3 }, async () => { while (i < jobs.length) await gen(jobs[i++]); }));
console.log('done', jobs.length);
