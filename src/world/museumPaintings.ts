import * as THREE from 'three';
import { mulberry32 } from '../core/math';

/**
 * The museum's collection, painted in code at load: eight 512² canvases in one 2048x1024 atlas (one texture, one
 * material, one draw for every painting in the hall). Brushwork is thousands of short strokes steered by flow fields,
 * so they read as paintings up close and as color and light from across the hall.
 */
export const PAINTINGS = ['starry', 'sunflowers', 'wheatfield', 'relativity', 'bell', 'seascape', 'ruins', 'grid'] as const;
export type PaintingId = (typeof PAINTINGS)[number];
const S = 512;

type Ctx = CanvasRenderingContext2D;
type Rnd = () => number;

function stroke(c: Ctx, x: number, y: number, a: number, len: number, w: number, col: string) {
  c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x - Math.cos(a) * len / 2, y - Math.sin(a) * len / 2); c.lineTo(x + Math.cos(a) * len / 2, y + Math.sin(a) * len / 2); c.stroke();
}
const hsl = (h: number, s: number, l: number) => `hsl(${h},${s}%,${l}%)`;

/** A swirling night over a village, stars wrapped in halos, a cypress like a dark flame (after Van Gogh). */
function starry(c: Ctx, r: Rnd) {
  c.fillStyle = '#122a5c'; c.fillRect(0, 0, S, S);
  const vort = [[300, 150, 1], [170, 110, -1], [420, 90, 1]];
  const stars = [[80, 60, 18], [205, 45, 14], [330, 60, 16], [460, 170, 22], [250, 200, 12], [120, 190, 15], [455, 40, 30]];
  for (let i = 0; i < 5200; i++) {
    const x = r() * S, y = r() * S * 0.72;
    let a = 0.15 + Math.sin(x * 0.012) * 0.3;
    for (const [vx, vy, s] of vort) { const dx = x - vx, dy = y - vy, d = Math.hypot(dx, dy); if (d < 110) a = Math.atan2(dy, dx) + (Math.PI / 2) * s; }
    let col = hsl(215 + r() * 20, 55 + r() * 25, 22 + r() * 30);
    for (const [sx, sy, sr] of stars) { const d = Math.hypot(x - sx, y - sy); if (d < sr * 2.2) { a = Math.atan2(y - sy, x - sx) + Math.PI / 2; col = d < sr ? hsl(48 + r() * 10, 90, 62 + r() * 20) : hsl(195 + r() * 20, 60, 55 + r() * 20); } }
    stroke(c, x, y, a, 7 + r() * 9, 3 + r() * 2.5, col);
  }
  // moon
  c.fillStyle = '#ffd34a'; c.beginPath(); c.arc(455, 40, 16, 0, 7); c.fill();
  c.fillStyle = '#122a5c'; c.beginPath(); c.arc(462, 34, 12, 0, 7); c.fill();
  // hills + village
  for (let i = 0; i < 1800; i++) {
    const x = r() * S, y = S * 0.62 + r() * S * 0.38;
    stroke(c, x, y, 0.1 + (r() - 0.5) * 0.5, 8 + r() * 8, 3, hsl(205 + r() * 30, 45, 14 + r() * 18));
  }
  for (let i = 0; i < 26; i++) {
    const x = 160 + i * 13 + r() * 6, w = 9 + r() * 6, h = 8 + r() * 10, y = S * 0.74 - h + r() * 8;
    c.fillStyle = hsl(210, 30, 18 + r() * 10); c.fillRect(x, y, w, h);
    if (r() < 0.6) { c.fillStyle = '#f7d75a'; c.fillRect(x + w * 0.3, y + h * 0.4, 3, 3); }
  }
  c.fillStyle = '#1b2733'; c.fillRect(300, 300, 5, 50); c.beginPath(); c.moveTo(296, 300); c.lineTo(302, 262); c.lineTo(309, 300); c.fill(); // steeple
  // cypress
  for (let i = 0; i < 1400; i++) {
    const t = r(), y = 90 + t * 420, half = 34 * Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.5) * (1 - t * 0.2);
    const x = 70 + Math.sin(t * 12 + r()) * 6 + (r() - 0.5) * half * 2;
    stroke(c, x, y, -Math.PI / 2 + (r() - 0.5) * 0.9, 10 + r() * 12, 3.5, hsl(110 + r() * 40, 40, 6 + r() * 14));
  }
}

/** Sunflowers in an earthen jug against chrome yellow. */
function sunflowers(c: Ctx, r: Rnd) {
  for (let i = 0; i < 2400; i++) stroke(c, r() * S, r() * S, (r() - 0.5) * 0.6 + (i % 2) * 1.57, 9 + r() * 10, 5, hsl(46 + r() * 8, 80, 58 + r() * 14));
  for (let i = 0; i < 500; i++) stroke(c, r() * S, 380 + r() * 132, (r() - 0.5) * 0.3, 10 + r() * 12, 5, hsl(40 + r() * 8, 75, 40 + r() * 10));
  // jug
  c.fillStyle = '#c9862f'; c.beginPath(); c.ellipse(256, 410, 78, 90, 0, 0, 7); c.fill();
  for (let i = 0; i < 400; i++) { const a = r() * 7, d = Math.sqrt(r()); stroke(c, 256 + Math.cos(a) * d * 72, 410 + Math.sin(a) * d * 82, a + 1.57, 8, 3, hsl(30 + r() * 12, 65, 38 + r() * 18)); }
  c.fillStyle = '#3d4fa0'; c.fillRect(180, 392, 152, 7);
  const heads = [[180, 170, 46], [300, 140, 52], [390, 230, 40], [250, 260, 44], [120, 290, 38], [350, 330, 34], [220, 80, 30], [410, 110, 28]];
  for (const [hx, hy, hr] of heads) {
    c.strokeStyle = '#4f6b1f'; c.lineWidth = 5; c.beginPath(); c.moveTo(hx, hy); c.quadraticCurveTo((hx + 256) / 2 + 20, (hy + 330) / 2, 256, 330); c.stroke();
    for (let k = 0; k < 70; k++) { const a = (k / 70) * Math.PI * 2 + r() * 0.1, d = hr * (0.55 + r() * 0.5); stroke(c, hx + Math.cos(a) * d, hy + Math.sin(a) * d, a, hr * 0.45, 5, hsl(38 + r() * 14, 92, 46 + r() * 16)); }
    for (let k = 0; k < 90; k++) { const a = r() * 7, d = Math.sqrt(r()) * hr * 0.5; c.fillStyle = hsl(20 + r() * 15, 60, 14 + r() * 18); c.fillRect(hx + Math.cos(a) * d, hy + Math.sin(a) * d, 4, 4); }
  }
}

/** A wheatfield under a storm, crows lifting off, a path running nowhere. */
function wheatfield(c: Ctx, r: Rnd) {
  for (let i = 0; i < 2600; i++) { const x = r() * S, y = r() * S * 0.5; stroke(c, x, y, Math.sin(x * 0.02 + y * 0.03) * 0.8, 10 + r() * 10, 4.5, hsl(220 + r() * 15, 60, 18 + r() * 34)); }
  for (let i = 0; i < 3200; i++) { const x = r() * S, y = S * 0.45 + r() * S * 0.55; stroke(c, x, y, -1.2 + (r() - 0.5) * 1.0 + (x < S / 2 ? -0.3 : 0.3), 10 + r() * 12, 4, hsl(44 + r() * 12, 85, 42 + r() * 25)); }
  for (let i = 0; i < 700; i++) { const t = r(), x = S / 2 + (t - 0.5) * 60 * (1 - t) + (r() - 0.5) * 70 * (1 - t), y = S * 0.55 + t * S * 0.45; stroke(c, x, y, 1.4 + (r() - 0.5), 9, 4, hsl(18 + r() * 12, 55, 30 + r() * 18)); }
  for (let i = 0; i < 300; i++) { const x = r() * S, y = S * 0.62 + r() * S * 0.38; stroke(c, x, y, -1.4, 8, 4, hsl(110, 45, 22 + r() * 12)); }
  c.strokeStyle = '#0d0d10'; c.lineWidth = 4; c.lineCap = 'round';
  for (let i = 0; i < 22; i++) { const x = 60 + r() * 400, y = 60 + r() * 200, w = 7 + r() * 9; c.beginPath(); c.moveTo(x - w, y - w * 0.4); c.lineTo(x, y); c.lineTo(x + w, y - w * 0.4); c.stroke(); }
}

/** Spacetime bent around a mass, with the field equations chalked in a gilt-edged slate (the physicist's corner). */
function relativity(c: Ctx, r: Rnd) {
  const g = c.createRadialGradient(256, 256, 40, 256, 256, 380); g.addColorStop(0, '#1d2c33'); g.addColorStop(1, '#070b0e'); c.fillStyle = g; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 6000; i++) { c.fillStyle = `rgba(255,255,255,${r() * 0.035})`; c.fillRect(r() * S, r() * S, 2, 2); }
  // warped grid
  c.strokeStyle = 'rgba(140,220,255,0.55)'; c.lineWidth = 1.6;
  const warp = (x: number, y: number) => { const dx = x - 256, dy = y - 300, d2 = dx * dx + dy * dy; const k = 5200 / (d2 + 2600); return [x - dx * k * 0.5, y - dy * k * 0.5 + k * 40]; };
  for (let i = 0; i <= 16; i++) {
    c.beginPath(); for (let j = 0; j <= 64; j++) { const [x, y] = warp(i * 32, 140 + j * 5.6); j ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
    c.beginPath(); for (let j = 0; j <= 64; j++) { const [x, y] = warp(j * 8, 140 + i * 22.5); j ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
  }
  const sg = c.createRadialGradient(250, 320, 4, 256, 330, 46); sg.addColorStop(0, '#fff6d8'); sg.addColorStop(0.4, '#ffb43a'); sg.addColorStop(1, 'rgba(255,120,20,0)');
  c.fillStyle = sg; c.beginPath(); c.arc(256, 330, 46, 0, 7); c.fill();
  c.fillStyle = 'rgba(240,240,230,0.92)'; c.textAlign = 'center';
  c.font = 'italic 700 64px Georgia, serif'; c.fillText('E = mc²', 256, 92);
  c.font = 'italic 22px Georgia, serif'; c.fillText('Rμν − ½ R gμν = 8πG ⁄ c⁴ · Tμν', 256, 128);
  c.font = 'italic 16px Georgia, serif'; c.fillStyle = 'rgba(240,240,230,0.6)';
  c.fillText('ds² = −c²dt² + dx² + dy² + dz²', 140, 480); c.fillText('λ = h ⁄ p', 410, 470); c.fillText('Δt′ = γ Δt', 400, 500);
}

/** The Bell: an emerald bell hanging in a black-green dark, lit from within (the green room's altarpiece). */
function bell(c: Ctx, r: Rnd) {
  const g = c.createRadialGradient(256, 260, 10, 256, 260, 360); g.addColorStop(0, '#0f3a22'); g.addColorStop(0.5, '#05140c'); g.addColorStop(1, '#010302'); c.fillStyle = g; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) { const a = (i / 90) * Math.PI * 2; c.strokeStyle = `rgba(80,255,150,${0.03 + r() * 0.05})`; c.lineWidth = 2 + r() * 6; c.beginPath(); c.moveTo(256, 250); c.lineTo(256 + Math.cos(a) * 400, 250 + Math.sin(a) * 400); c.stroke(); }
  c.beginPath(); c.moveTo(256, 120); c.bezierCurveTo(196, 122, 186, 200, 176, 300); c.quadraticCurveTo(156, 330, 140, 350); c.lineTo(372, 350); c.quadraticCurveTo(356, 330, 336, 300); c.bezierCurveTo(326, 200, 316, 122, 256, 120);
  const bg = c.createLinearGradient(150, 0, 360, 0); bg.addColorStop(0, '#0a4a26'); bg.addColorStop(0.35, '#3dff95'); bg.addColorStop(0.55, '#b9ffd8'); bg.addColorStop(1, '#063018');
  c.fillStyle = bg; c.fill();
  c.strokeStyle = '#d8b04a'; c.lineWidth = 5; c.beginPath(); c.moveTo(150, 336); c.lineTo(362, 336); c.stroke(); c.beginPath(); c.moveTo(186, 230); c.lineTo(326, 230); c.stroke();
  c.fillStyle = '#d8b04a'; c.fillRect(246, 86, 20, 38); c.beginPath(); c.arc(256, 368, 14, 0, 7); c.fill();
  c.strokeStyle = 'rgba(216,176,74,0.8)'; c.lineWidth = 3; c.beginPath(); c.moveTo(256, 0); c.lineTo(256, 88); c.stroke();
  c.fillStyle = 'rgba(160,255,200,0.75)'; c.font = '700 20px Georgia, serif'; c.textAlign = 'center'; c.fillText('MMXCIII', 256, 470);
}

/** Sunset over a calm sea, a ship in the haze (after the English romantics). */
function seascape(c: Ctx, r: Rnd) {
  const g = c.createLinearGradient(0, 0, 0, S); g.addColorStop(0, '#2b3a5c'); g.addColorStop(0.35, '#d98a4a'); g.addColorStop(0.55, '#ffd28a'); g.addColorStop(0.6, '#8a6a52'); g.addColorStop(1, '#2a2a33'); c.fillStyle = g; c.fillRect(0, 0, S, S);
  const sg = c.createRadialGradient(300, 270, 4, 300, 270, 200); sg.addColorStop(0, 'rgba(255,250,220,1)'); sg.addColorStop(0.2, 'rgba(255,220,140,0.7)'); sg.addColorStop(1, 'rgba(255,160,80,0)'); c.fillStyle = sg; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) { const y = r() * S * 0.55; c.fillStyle = `rgba(${200 + r() * 55},${150 + r() * 70},${110 + r() * 60},${0.04 + r() * 0.06})`; c.beginPath(); c.ellipse(r() * S, y, 30 + r() * 60, 4 + r() * 8, 0, 0, 7); c.fill(); }
  for (let i = 0; i < 1400; i++) { const y = S * 0.58 + Math.pow(r(), 1.5) * S * 0.42, x = r() * S; const near = Math.abs(x - 300) < 40 + (y - 300) * 0.5; c.fillStyle = near ? `rgba(255,${210 + r() * 40},150,${0.3 + r() * 0.4})` : `rgba(${40 + r() * 40},${50 + r() * 40},${70 + r() * 40},0.35)`; c.fillRect(x, y, 6 + r() * 16, 1.5 + r() * 2); }
  c.fillStyle = 'rgba(30,25,35,0.85)'; c.beginPath(); c.moveTo(120, 300); c.lineTo(190, 300); c.lineTo(180, 312); c.lineTo(130, 312); c.fill();
  c.fillRect(150, 230, 3, 70); c.fillRect(168, 240, 3, 60);
  c.fillStyle = 'rgba(50,45,55,0.6)'; c.beginPath(); c.moveTo(153, 234); c.lineTo(153, 290); c.lineTo(132, 286); c.fill(); c.beginPath(); c.moveTo(171, 244); c.lineTo(171, 292); c.lineTo(192, 288); c.fill();
}

/** An arcadian landscape with a ruined temple and a domed city on the hill (a nod to this hall). */
function ruins(c: Ctx, r: Rnd) {
  const g = c.createLinearGradient(0, 0, 0, S); g.addColorStop(0, '#6f9fcf'); g.addColorStop(0.55, '#f2d9a8'); g.addColorStop(1, '#5a6a3a'); c.fillStyle = g; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(255,255,255,${r() * 0.12})`; c.beginPath(); c.ellipse(r() * S, r() * 200, 20 + r() * 40, 8 + r() * 14, 0, 0, 7); c.fill(); }
  c.fillStyle = '#8fa0a8'; c.beginPath(); c.moveTo(0, 300); for (let x = 0; x <= S; x += 16) c.lineTo(x, 270 + Math.sin(x * 0.02) * 20 + r() * 6); c.lineTo(S, 340); c.lineTo(0, 340); c.fill();
  c.fillStyle = '#c9b48a'; c.beginPath(); c.arc(380, 262, 22, Math.PI, 0); c.fill(); c.fillRect(352, 262, 56, 22); for (let i = 0; i < 6; i++) c.fillRect(330 + i * 18, 270 + (i % 2) * 6, 12, 16);
  c.fillStyle = '#4c5a2c'; c.fillRect(0, 330, S, 182);
  for (let i = 0; i < 1500; i++) stroke(c, r() * S, 330 + r() * 182, -1.3 + r() * 0.6, 6 + r() * 8, 3, hsl(80 + r() * 30, 35, 18 + r() * 20));
  c.fillStyle = '#e8dcc0';
  for (let i = 0; i < 5; i++) { const x = 90 + i * 34, h = i === 3 ? 70 : 150 - i * 6; c.fillRect(x, 400 - h, 16, h); c.fillRect(x - 3, 400 - h, 22, 7); }
  c.fillRect(84, 244, 112, 14); c.fillRect(80, 400, 190, 12);
  c.fillStyle = 'rgba(70,60,40,0.4)'; for (let i = 0; i < 5; i++) c.fillRect(102 + i * 34, 256, 4, 140);
  c.fillStyle = '#26361a'; for (let k = 0; k < 2; k++) { const x = k ? 470 : 30; for (let i = 0; i < 260; i++) { const a = r() * 7, d = Math.sqrt(r()) * 60; c.globalAlpha = 0.6; c.beginPath(); c.arc(x + Math.cos(a) * d * 0.8, 200 + Math.sin(a) * d * 1.4, 6 + r() * 6, 0, 7); c.fill(); } c.globalAlpha = 1; c.fillRect(x - 4, 260, 8, 150); }
}

/** Composition in primaries (the modern wing's loan). */
function grid(c: Ctx, r: Rnd) {
  c.fillStyle = '#f1ece0'; c.fillRect(0, 0, S, S);
  const xs = [0, 110, 330, 420, S], ys = [0, 150, 300, 380, S];
  const fills: [number, number, string][] = [[1, 0, '#c8241c'], [0, 2, '#1d3f9c'], [3, 3, '#f2c418'], [2, 1, '#f1ece0'], [0, 3, '#f2c418'], [3, 0, '#151515']];
  for (const [i, j, col] of fills) { c.fillStyle = col; c.fillRect(xs[i], ys[j], xs[i + 1] - xs[i], ys[j + 1] - ys[j]); }
  c.fillStyle = '#111';
  for (const x of xs.slice(1, -1)) c.fillRect(x - 6, 0, 12, S);
  for (const y of ys.slice(1, -1)) c.fillRect(0, y - 6, S, 12);
  for (let i = 0; i < 3000; i++) { c.fillStyle = `rgba(0,0,0,${r() * 0.03})`; c.fillRect(r() * S, r() * S, 3, 1); }
}

const PAINTERS: Record<PaintingId, (c: Ctx, r: Rnd) => void> = { starry, sunflowers, wheatfield, relativity, bell, seascape, ruins, grid };

/** Paint the whole collection into one atlas (4 x 2). Canvas weave, varnish and a little age go over every painting. */
export function paintCollection() {
  const cv = document.createElement('canvas'); cv.width = S * 4; cv.height = S * 2;
  const c = cv.getContext('2d')!;
  const rnd = mulberry32(2093);
  PAINTINGS.forEach((id, i) => {
    c.save();
    c.translate((i % 4) * S, Math.floor(i / 4) * S);
    c.beginPath(); c.rect(0, 0, S, S); c.clip();
    PAINTERS[id](c, rnd);
    // canvas weave + warm varnish + darkened edges
    for (let y = 0; y < S; y += 3) { c.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.02})`; c.fillRect(0, y, S, 1); }
    for (let x = 0; x < S; x += 3) { c.fillStyle = `rgba(255,255,255,${0.015 + rnd() * 0.015})`; c.fillRect(x, 0, 1, S); }
    c.fillStyle = 'rgba(120,80,20,0.07)'; c.fillRect(0, 0, S, S);
    const v = c.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(20,10,0,0.35)');
    c.fillStyle = v; c.fillRect(0, 0, S, S);
    c.restore();
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** UV rectangle of a painting in the atlas (u0, v0, u1, v1), with a hair of inset against bleeding. */
export function paintingUV(id: PaintingId) {
  const i = PAINTINGS.indexOf(id), e = 2 / (S * 4);
  const u0 = (i % 4) / 4, v1 = 1 - Math.floor(i / 4) / 2;
  return [u0 + e, v1 - 0.5 + e * 2, u0 + 0.25 - e, v1 - e * 2] as const;
}
