/** Dev tool: measures foot skating (world-space speed of feet that are on the ground). node dev/slide.mjs [hero] */
import { open } from './shots.mjs';
const hero = process.argv[2] ?? 'einstein';
const { browser, page } = await open();
await page.evaluate((h) => window.rv.load(h), hero);
const cases = { idle: {}, fwd6: { fwd: 6 }, fwd3: { fwd: 3 }, walk1_5: { fwd: 1.5 }, back6: { fwd: -6 }, left6: { side: -6 }, right6: { side: 6 }, diagFR: { fwd: 4.24, side: 4.24 }, diagBL: { fwd: -4.24, side: -4.24 }, turnIdle: { turn: 1.5 }, turnRun: { fwd: 6, turn: 1.5 } };
for (const [name, set] of Object.entries(cases)) {
  const r = await page.evaluate(([set]) => {
    const rv = window.rv;
    rv.set({ fwd: 0, side: 0, turn: 0, ...set });
    rv.step(1 / 60, 60);
    let prev = rv.feet(), sum = 0, n = 0, max = 0, minY = 9, maxY = -9, air = 0, tot = 0;
    for (let i = 0; i < 180; i++) {
      rv.step(1 / 60);
      const f = rv.feet();
      for (const k of ['L', 'R']) {
        tot++;
        minY = Math.min(minY, f[k][1], f['t' + k][1]); maxY = Math.max(maxY, f[k][1]);
        if (f['t' + k][1] < 0.04 && prev['t' + k][1] < 0.04) { const v = Math.hypot(f['t' + k][0] - prev['t' + k][0], f['t' + k][2] - prev['t' + k][2]) * 60; sum += v; n++; max = Math.max(max, v); } else air++;
      }
      prev = f;
    }
    return { slide: n ? sum / n : 0, max, ground: n / tot, minY, maxY };
  }, [set]);
  console.log(name.padEnd(9), `stance slide avg ${r.slide.toFixed(2)} m/s  max ${r.max.toFixed(2)}  on-ground ${(r.ground * 100).toFixed(0)}%  ankle/toe minY ${r.minY.toFixed(3)} maxY ${r.maxY.toFixed(2)}`);
}
await browser.close();
