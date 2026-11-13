/**
 * Dev tool: renders animation contact sheets from the rig viewer in headless Chromium.
 *   npm run dev            (in another shell)
 *   node dev/shots.mjs out.jpg '{"hero":"einstein","cam":"front","cols":6,"steps":[{"dur":1,"set":{"fwd":6},"every":0.1}]}'
 * Each step sets animation state (fwd/side speeds, turn rate, attack, jump...), runs `dur` seconds and
 * captures a frame every `every` seconds from camera `cam` (front, back, side, q, face, top, game...).
 */
import { createRequire } from 'node:module';
import sharp from 'sharp';

// playwright is not a project dependency: use a global install (NODE_TOOLS points at its node_modules parent)
const { chromium } = createRequire(process.env.NODE_TOOLS ?? '/opt/node-tools/')('playwright');

export async function open(port = 5173) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${port}/dev/rigview.html`);
  await page.waitForFunction(() => !!window.rv, null, { timeout: 60000 });
  return { browser, page };
}

export async function sheet(page, sc, out) {
  if (sc.hero) await page.evaluate((h) => window.rv.load(h), sc.hero);
  const shots = await page.evaluate((s) => window.rv.run(s), sc);
  const w = sc.w ?? 480, h = sc.h ?? 600, cols = sc.cols ?? Math.min(shots.length, 6), rows = Math.ceil(shots.length / cols);
  const scale = sc.scale ?? 1, tw = Math.round(w * scale), th = Math.round(h * scale);
  const tiles = await Promise.all(shots.map(async (d, i) => ({
    input: await sharp(Buffer.from(d.split(',')[1], 'base64')).resize(tw, th).toBuffer(), left: (i % cols) * tw, top: Math.floor(i / cols) * th,
  })));
  await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#222' } }).composite(tiles).jpeg({ quality: 88 }).toFile(out);
  return shots.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { browser, page } = await open();
  const n = await sheet(page, JSON.parse(process.argv[3]), process.argv[2]);
  console.log(`${n} frames -> ${process.argv[2]}`);
  await browser.close();
}
