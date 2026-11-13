import { open, sheet } from './shots.mjs';
const out = process.argv[2];
const { browser, page } = await open();
for (const hero of (process.argv[3] ?? 'einstein,yeat,vangogh').split(',')) {
  await sheet(page, { hero, cols: 4, w: 560, h: 700, steps: [
    { dur: 1 / 60, set: { restPose: true, skel: true }, every: 1 / 60, cam: ['front', 'side'] },
    { dur: 1 / 60, set: { skel: false, weights: 'all' }, every: 1 / 60, cam: ['front', 'back'] },
  ] }, `${out}/rest_${hero}.jpg`);
}
await browser.close();
