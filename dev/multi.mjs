/** Dev tool: several scenarios into one sheet. node dev/multi.mjs out.jpg hero '<json array of {set, cam, dur, every, pre}>' [cols] [scale] */
import { open } from './shots.mjs';
import sharp from 'sharp';
const [out, hero, json, cols = '8', scale = '0.42'] = process.argv.slice(2);
const { browser, page } = await open();
await page.evaluate((h) => window.rv.load(h), hero);
const shots = [];
for (const sc of JSON.parse(json)) {
  const r = await page.evaluate((sc) => {
    const rv = window.rv;
    rv.set({ fwd: 0, side: 0, turn: 0, pitch: 0, cast: 0, levitate: 0, dead: false, clip: null, ...(sc.reset ?? {}) });
    rv.step(1 / 60, 30);
    return rv.run({ steps: [...(sc.steps ?? []), { dur: sc.pre ?? 0.6, set: sc.set }, { dur: sc.dur ?? 0.8, set: sc.set2, every: sc.every ?? 0.1, cam: sc.cam ?? 'side' }] });
  }, sc);
  shots.push(...r);
}
const w = Math.round(480 * +scale), h = Math.round(600 * +scale), C = +cols, rows = Math.ceil(shots.length / C);
const tiles = await Promise.all(shots.map(async (d, i) => ({ input: await sharp(Buffer.from(d.split(',')[1], 'base64')).resize(w, h).toBuffer(), left: (i % C) * w, top: Math.floor(i / C) * h })));
await sharp({ create: { width: C * w, height: rows * h, channels: 3, background: '#222' } }).composite(tiles).jpeg({ quality: 86 }).toFile(out);
console.log(shots.length, 'frames ->', out);
await browser.close();
