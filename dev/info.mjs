import { open } from './shots.mjs';
const { browser, page } = await open();
for (const hero of (process.argv[2] ?? 'einstein').split(',')) {
  await page.evaluate((h) => window.rv.load(h), hero);
  const r = await page.evaluate(() => window.rv.info());
  console.log(hero, JSON.stringify(r));
}
await browser.close();
