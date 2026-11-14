/**
 * Dev tool: screenshots every legend on the menu stage (hero select framing) plus a face close-up.
 *   npx vite --port 5173   (in another shell)
 *   node dev/menu-heroes.mjs <outDir> [page=select] [heroes,comma,separated]
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.NODE_TOOLS ?? '/opt/node-tools/')('playwright');
const [out = 'shots', pg = 'select', list = 'einstein,yeat,vangogh,blitzcrank,luffy,ironman,mickey'] = process.argv.slice(2);
const W = 1280, H = 720;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript((q) => {
  const k = 'legends-assembly:settings:v1';
  const s = JSON.parse(localStorage.getItem(k) || '{}');
  localStorage.setItem(k, JSON.stringify({ ...s, quality: q, dynamicResolution: false }));
}, process.env.Q ?? 'medium');
page.setDefaultTimeout(300000);
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => document.querySelector('#boot .hint')?.classList.contains('pulse'), null, { timeout: 300000 });
await page.keyboard.press('Space');
await page.evaluate(() => { window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 400); window.__snapCam = true; });
await page.waitForTimeout(1500);
for (const h of list.split(',')) {
  await page.evaluate(([h, pg]) => { const m = window.__legends.menu; m.setHero(h); m.go(pg, true); }, [h, pg]);
  await page.waitForFunction(() => { const s = window.__legends.game?.showcase; return s && s.spawnT > 2.5; }, null, { timeout: 300000 }).catch(() => console.log('no game handle; waiting'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${pg}-${h}.png` });
  const box = await page.evaluate(() => {
    const L = window.__legends; const s = L.game.showcase; const cam = L.renderer.camera;
    const p = s.pos.clone(); p.y += 1.62; p.project(cam);
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
  }).catch(() => null);
  if (box) await page.screenshot({ path: `${out}/${pg}-${h}-face.png`, clip: { x: Math.max(0, box.x - 130), y: Math.max(0, box.y - 120), width: 260, height: 260 } });
  console.log('shot', h, box);
}
await browser.close();
