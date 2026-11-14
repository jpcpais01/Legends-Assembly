/** node dev/compare.mjs out.png body|face|hands url1 url2 ...   (vite dev server on :5173) */
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.NODE_TOOLS ?? '/opt/node-tools/')('playwright');
const [out, view, ...urls] = process.argv.slice(2);
const clip = process.env.CLIP !== undefined ? +process.env.CLIP : null;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 420 * urls.length, height: view === 'body' ? 640 : 460 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text().slice(0, 300)); });
page.setDefaultTimeout(600000);
await page.goto('http://localhost:5173/dev/compare.html');
await page.waitForFunction(() => !!window.cmp);
await page.evaluate(([u, v, c]) => window.cmp.show(u, v, c), [urls, view, clip]);
await page.screenshot({ path: out });
await browser.close();
console.log('->', out);
