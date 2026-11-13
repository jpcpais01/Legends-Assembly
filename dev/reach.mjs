/** Dev tool: hand reach (in arm lengths, from the shoulder) through an attack. node dev/reach.mjs hero kind [side] */
import { open } from './shots.mjs';
const [hero = 'einstein', kind = 'flick', side = '1'] = process.argv.slice(2);
const { browser, page } = await open();
await page.evaluate((h) => window.rv.load(h), hero);
const r = await page.evaluate(({ kind, side }) => {
  const rv = window.rv, out = [];
  rv.step(1 / 60, 40);
  const b0 = rv.bones(), S = side > 0 ? 'R' : 'L';
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const A = d(b0['shoulder' + S], b0['elbow' + S]) + d(b0['elbow' + S], b0['hand' + S]);
  rv.set({ attack: 1, attackKind: kind, attackSide: side });
  for (let i = 0; i < 36; i++) {
    rv.step(1 / 60, 1);
    const b = rv.bones(), s = b['shoulder' + S], h = b['hand' + S];
    out.push([((i + 1) / 60).toFixed(3), ((h[0] - s[0]) / A).toFixed(2), ((h[1] - s[1]) / A).toFixed(2), ((h[2] - s[2]) / A).toFixed(2), (d(h, s) / A).toFixed(2)].join(' '));
  }
  return out;
}, { kind, side: +side });
console.log('t x y z reach\n' + r.join('\n'));
await browser.close();
