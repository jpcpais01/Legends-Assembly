/**
 * Dev tool: boots the real game in headless Chromium and screenshots the menus and the in-match HUD.
 *   npm run dev            (in another shell)
 *   node dev/ui-shots.mjs <outDir> [width] [height] [pages...]
 * pages: home select legends settings learn news hud results pause (default: all)
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.NODE_TOOLS ?? '/opt/node-tools/')('playwright');

const [out = 'shots', W = '1600', H = '900', ...want] = process.argv.slice(2);
const pages = want.length ? want : ['home', 'select', 'settings', 'hud', 'results'];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text().slice(0, 200)); });
await page.addInitScript(() => {
  const k = 'legends-assembly:settings:v1';
  const s = JSON.parse(localStorage.getItem(k) || '{}');
  localStorage.setItem(k, JSON.stringify({ ...s, quality: 'low', dynamicResolution: false,  }));
});
page.setDefaultTimeout(180000);
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => document.querySelector('#boot .hint')?.classList.contains('pulse'), null, { timeout: 240000 });
await page.keyboard.press('Space');
// SwiftShader renders a frame in seconds: throttle rAF so screenshots can grab the page between frames
await page.evaluate(() => { window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 700); window.__snapCam = true; });
await page.waitForTimeout(1500);
if (process.env.STAGE_HIDE) await page.evaluate((names) => { const st = window.__legends.stage; st.__hide = names; }, process.env.STAGE_HIDE.split(','));
if (process.env.EVAL) await page.evaluate(process.env.EVAL);
const L = '__legends';
const snap = async (name, wait = 900) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}-${W}x${H}.png` }); console.log('shot', name); };
for (const p of pages) {
  if (['home', 'select', 'legends', 'settings', 'learn', 'news'].includes(p)) {
    await page.evaluate(([L, p]) => window[L].menu.go(p, true), [L, p]);
    await snap(p, 1600);
  } else if (p === 'hud') {
    // the arena is far too slow under SwiftShader: hide the 3D view and check the HUD over a neutral backdrop
    await page.evaluate((L) => { window[L].startMatch('3v3', 'einstein'); const c = document.querySelector('canvas'); c.style.visibility = 'hidden'; document.body.style.background = 'radial-gradient(80% 80% at 50% 40%, #5b6a7c, #20262f)'; window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 50); window[L].renderer.render = () => {}; }, L);
    await page.waitForTimeout(800);
    await page.evaluate((L) => { const l = window[L]; l.menu.pause(false); l.game.paused = false; }, L);
    await snap('hud-intro', 1200);
    await page.evaluate((L) => {
      const l = window[L]; const g = l.game; const me = g.local;
      me.hp = me.maxHp * 0.62; me.ult = 0.74; me.secondaryCd = 4.2;
      const foe = g.heroes.find((h) => h.team !== me.team);
      l.hud.kill(me, foe, [], 'primary');
      l.hud.kill(foe, g.heroes.find((h) => h.team === me.team && h !== me), [], 'ult');
      l.hud.hitmarker(true, false, 40);
      l.hud.damageNumber(foe.pos.clone().setY(foe.pos.y + 2), 48, true, false, 1);
    }, L);
    await snap('hud', 120);
    await page.evaluate((L) => { const l = window[L]; const me = l.game.local; me.ult = 1; me.hp = me.maxHp * 0.25; l.hud.callout({ kind: 'multi', count: 3, title: 'Triple Elimination', sub: 'Three in a row', tags: ['Headshot'], streak: 4, tier: 3 }); }, L);
    await snap('hud-ready', 700);
  } else if (p === 'results') {
    await page.evaluate((L) => { const l = window[L]; const g = l.game; g.winner = g.local.team; l.menu.results(g, () => {}, () => {}); }, L);
    await snap('results', 2400);
  } else if (p === 'pause') {
    await page.evaluate((L) => window[L].menu.pause(true), L);
    await snap('pause', 900);
  }
}
await browser.close();
