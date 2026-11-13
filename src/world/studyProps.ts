import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { clean } from './studyDesk';

/**
 * Hand-built desk props for the Giant's Study, modelled at real size in centimeters and scaled up to the
 * desk (1 cm = U meters). Every prop is a list of parts sharing a dozen materials, so the arena bakes
 * them into a handful of merged draw calls.
 *
 * Colored parts (pencil paint, book cloth, wax, ink...) use vertex colors on two shared materials
 * (matte and lacquered) instead of one material each.
 */
export const U = 0.7;

export interface Part { geo: THREE.BufferGeometry; mat: THREE.Material; collide?: boolean }

export interface PropMaterials {
  paint: THREE.MeshStandardMaterial;
  gloss: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  porcelain: THREE.MeshStandardMaterial;
  pages: THREE.MeshStandardMaterial;
  cards: THREE.MeshStandardMaterial;
  feather: THREE.MeshStandardMaterial;
  flame: THREE.MeshBasicMaterial;
  decal: THREE.MeshStandardMaterial;
  /** Materials that should not cast shadows. */
  noShadow: Set<THREE.Material>;
}

// ── canvas helpers ────────────────────────────────────────────────────────────────────────────────

function canvas(w: number, h: number) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  return { cv, c: cv.getContext('2d')! };
}
function tex(cv: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
const HAND = (px: number, weight = '') => `italic ${weight} ${px}px "Segoe Script", "Bradley Hand", "Snell Roundhand", "Apple Chancery", "URW Chancery L", "Z003", cursive`;
const SERIF = (px: number) => `${px}px Georgia, "Times New Roman", serif`;

/** Aged paper: base tone, fibers, mottling and a darker rim. */
function paperBase(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tone: string, rnd: () => number, age = 1) {
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = tone; c.fillRect(x, y, w, h);
  for (let k = 0; k < (w * h) / 900; k++) {
    c.fillStyle = `rgba(${110 + rnd() * 60},${80 + rnd() * 40},${40 + rnd() * 30},${0.03 * age * rnd()})`;
    const r = 6 + rnd() * 60;
    c.beginPath(); c.arc(x + rnd() * w, y + rnd() * h, r, 0, 7); c.fill();
  }
  for (let k = 0; k < (w * h) / 300; k++) {
    c.fillStyle = `rgba(90,70,40,${0.05 + rnd() * 0.06})`;
    c.fillRect(x + rnd() * w, y + rnd() * h, 1 + rnd() * 5, 1);
  }
  const g = c.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.35, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(100,60,20,${0.28 * age})`);
  c.fillStyle = g; c.fillRect(x, y, w, h);
  c.restore();
}

/** Handwritten line with per-word jitter. */
function hand(c: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color: string, rnd: () => number, rot = 0) {
  c.save();
  c.translate(x, y); c.rotate(rot + (rnd() - 0.5) * 0.02);
  c.font = HAND(px);
  c.fillStyle = color;
  let cx = 0;
  for (const word of text.split(' ')) {
    c.save();
    c.translate(cx, (rnd() - 0.5) * px * 0.08);
    c.rotate((rnd() - 0.5) * 0.04);
    c.fillText(word, 0, 0);
    c.restore();
    cx += c.measureText(word + ' ').width;
  }
  c.restore();
  return cx;
}

function inkStroke(c: CanvasRenderingContext2D, color: string, width: number, pts: [number, number][]) {
  c.save(); c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); c.restore();
}

/** Three letter-size pages side by side: Einstein's relativity notes, Vincent's letter to Theo, Yeat's session sheet. */
const PW = 1280, PH = 1810;
function makePages() {
  const { cv, c } = canvas(PW * 3, PH);
  const rnd = mulberry32(42);
  const ink = '#18203f', sepia = '#4a2a12', pencil = 'rgba(60,60,70,0.85)';

  // ── page 0: relativity notes
  paperBase(c, 0, 0, PW, PH, '#f1e8d4', rnd);
  c.strokeStyle = 'rgba(80,110,170,0.22)'; c.lineWidth = 2;
  for (let y = 200; y < PH - 60; y += 64) { c.beginPath(); c.moveTo(60, y); c.lineTo(PW - 60, y); c.stroke(); }
  c.strokeStyle = 'rgba(190,60,60,0.35)'; c.beginPath(); c.moveTo(150, 0); c.lineTo(150, PH); c.stroke();
  hand(c, 'Zur Elektrodynamik bewegter Körper', 180, 150, 60, ink, rnd, -0.01);
  inkStroke(c, ink, 4, [[180, 172], [1000, 166]]);
  hand(c, 'ds² = −c²dt² + dx² + dy² + dz²', 190, 310, 56, ink, rnd);
  hand(c, 'γ = 1 / √(1 − v²/c²)', 190, 440, 60, ink, rnd);
  hand(c, "t' = γ (t − vx/c²)", 190, 560, 56, ink, rnd);
  hand(c, "x' = γ (x − vt)", 640, 560, 56, ink, rnd);
  // E = mc² circled, big
  hand(c, 'E = mc²', 330, 790, 150, ink, rnd, -0.05);
  c.save(); c.strokeStyle = ink; c.lineWidth = 6; c.beginPath(); c.ellipse(560, 740, 330, 120, -0.06, 0.2, Math.PI * 2.05); c.stroke(); c.restore();
  hand(c, '!!', 960, 700, 90, '#7a1c1c', rnd);
  hand(c, 'Rμν − ½ R gμν = (8πG / c⁴) Tμν', 180, 1010, 58, ink, rnd);
  hand(c, 'Λ ?', 1060, 1010, 58, '#7a1c1c', rnd);
  inkStroke(c, ink, 4, [[1040, 990], [1180, 960]]);
  // light cone sketch
  {
    const ox = 380, oy = 1380;
    inkStroke(c, pencil, 3, [[ox - 220, oy - 220], [ox + 220, oy + 220]]);
    inkStroke(c, pencil, 3, [[ox + 220, oy - 220], [ox - 220, oy + 220]]);
    c.save(); c.strokeStyle = pencil; c.lineWidth = 3;
    c.beginPath(); c.ellipse(ox, oy - 220, 220, 50, 0, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.ellipse(ox, oy + 220, 220, 50, 0, 0, Math.PI * 2); c.stroke();
    c.restore();
    inkStroke(c, ink, 3, [[ox, oy + 300], [ox, oy - 300]]);
    hand(c, 'ct', ox + 14, oy - 290, 44, ink, rnd);
    hand(c, 'Zukunft', ox + 240, oy - 230, 42, ink, rnd);
    hand(c, 'Vergangenheit', ox + 240, oy + 250, 42, ink, rnd);
  }
  // curved spacetime grid
  {
    const ox = 920, oy = 1420;
    c.save(); c.strokeStyle = 'rgba(30,40,80,0.75)'; c.lineWidth = 2.5;
    for (let i = -5; i <= 5; i++) {
      c.beginPath();
      for (let k = -5; k <= 5; k++) {
        const x = ox + k * 34, z = oy + i * 22;
        const d = Math.hypot(k * 34, i * 40);
        const sag = 120 * Math.exp(-(d * d) / 9000);
        k === -5 ? c.moveTo(x, z + sag) : c.lineTo(x, z + sag);
      }
      c.stroke();
      c.beginPath();
      for (let k = -5; k <= 5; k++) {
        const x = ox + i * 34, z = oy + k * 22;
        const d = Math.hypot(i * 34, k * 40);
        const sag = 120 * Math.exp(-(d * d) / 9000);
        k === -5 ? c.moveTo(x, z + sag) : c.lineTo(x, z + sag);
      }
      c.stroke();
    }
    c.fillStyle = ink; c.beginPath(); c.arc(ox, oy + 120, 22, 0, 7); c.fill();
    c.restore();
    hand(c, 'Masse krümmt den Raum', ox - 210, oy - 170, 44, ink, rnd);
  }
  hand(c, 'A.E.', PW - 260, PH - 90, 70, ink, rnd);
  // coffee ring on the corner
  c.save(); c.strokeStyle = 'rgba(110,60,20,0.32)'; c.lineWidth = 14; c.beginPath(); c.arc(PW - 230, 280, 150, 0, 7); c.stroke();
  c.strokeStyle = 'rgba(110,60,20,0.15)'; c.lineWidth = 30; c.beginPath(); c.arc(PW - 236, 284, 140, 0.4, 4); c.stroke(); c.restore();

  // ── page 1: Vincent to Theo, sunflower sketch and a swirling night doodle
  const X1 = PW;
  paperBase(c, X1, 0, PW, PH, '#ecdcb8', rnd, 1.5);
  hand(c, 'Arles, août 1888', X1 + 760, 140, 50, sepia, rnd);
  hand(c, 'Mon cher Théo,', X1 + 120, 260, 66, sepia, rnd);
  const lines = [
    'Je suis en train de peindre avec',
    "l'entrain d'un Marseillais mangeant",
    'la bouillabaisse : de grands tournesols.',
    'Le jaune, le jaune ! Toute la lumière',
    'du Midi tient dans une seule fleur.',
  ];
  lines.forEach((l, i) => hand(c, l, X1 + 120, 360 + i * 74, 52, sepia, rnd));
  // sunflower sketch
  {
    const ox = X1 + 420, oy = 1150;
    c.save(); c.strokeStyle = sepia; c.lineWidth = 4;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + rnd() * 0.1, r0 = 110, r1 = 230 + rnd() * 40;
      c.beginPath();
      c.moveTo(ox + Math.cos(a) * r0, oy + Math.sin(a) * r0);
      c.quadraticCurveTo(ox + Math.cos(a + 0.18) * (r1 * 0.75), oy + Math.sin(a + 0.18) * (r1 * 0.75), ox + Math.cos(a) * r1, oy + Math.sin(a) * r1);
      c.quadraticCurveTo(ox + Math.cos(a - 0.18) * (r1 * 0.75), oy + Math.sin(a - 0.18) * (r1 * 0.75), ox + Math.cos(a) * r0, oy + Math.sin(a) * r0);
      c.stroke();
    }
    c.fillStyle = 'rgba(74,42,18,0.85)';
    for (let i = 0; i < 260; i++) { const r = Math.sqrt(rnd()) * 100, a = rnd() * 7; c.beginPath(); c.arc(ox + Math.cos(a) * r, oy + Math.sin(a) * r, 3 + rnd() * 3, 0, 7); c.fill(); }
    inkStroke(c, sepia, 7, [[ox + 20, oy + 230], [ox + 60, oy + 420], [ox + 40, oy + 640]]);
    c.restore();
    // a dab of real chrome yellow
    c.fillStyle = 'rgba(230,170,20,0.55)';
    for (let i = 0; i < 40; i++) { const a = rnd() * 7, r = 150 + rnd() * 90; c.save(); c.translate(ox + Math.cos(a) * r, oy + Math.sin(a) * r); c.rotate(a); c.fillRect(-26, -8, 52, 16); c.restore(); }
  }
  // swirl doodle
  {
    const ox = X1 + 980, oy = 1050;
    c.save(); c.strokeStyle = 'rgba(30,50,110,0.7)'; c.lineWidth = 5;
    for (let s = 0; s < 3; s++) {
      c.beginPath();
      for (let t = 0; t < 60; t++) { const a = t * 0.32, r = 6 + t * 2.6; const x = ox + (s - 1) * 120 + Math.cos(a) * r, y = oy + s * 140 + Math.sin(a) * r * 0.7; t ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    }
    c.restore();
  }
  hand(c, 'Ton Vincent', X1 + 820, PH - 140, 64, sepia, rnd);

  // ── page 2: Yeat's session sheet on music manuscript paper
  paperBase(c, PW * 2, 0, PW, PH, '#f4f1ea', rnd, 0.6);
  c.save();
  c.translate(PW * 2, 0);
  c.strokeStyle = 'rgba(70,80,110,0.45)'; c.lineWidth = 2;
  for (let s = 0; s < 9; s++) for (let l = 0; l < 5; l++) { const y = 260 + s * 170 + l * 18; c.beginPath(); c.moveTo(90, y); c.lineTo(PW - 90, y); c.stroke(); }
  c.font = SERIF(34); c.fillStyle = 'rgba(70,80,110,0.7)'; c.fillText('Manuscript — 12 staves', 90, 80);
  const pen = '#111111';
  hand(c, 'BELL RING  (final final v7)', 110, 190, 64, pen, rnd, -0.02);
  for (let s = 0; s < 9; s++) {
    const base = 260 + s * 170;
    for (let n = 0; n < 12; n++) {
      if (rnd() < 0.2) continue;
      const x = 160 + n * 88 + rnd() * 10, y = base + Math.floor(rnd() * 9) * 9;
      c.save(); c.translate(x, y); c.rotate(-0.35); c.fillStyle = pen; c.beginPath(); c.ellipse(0, 0, 12, 8, 0, 0, 7); c.fill(); c.restore();
      inkStroke(c, pen, 3, [[x + 10, y], [x + 10, y - 62]]);
    }
  }
  hand(c, '808 +6dB', 860, 700, 56, '#b0121a', rnd, -0.08);
  hand(c, 'tonka intro → drop', 160, 1120, 56, '#b0121a', rnd, 0.03);
  // doodled bell
  {
    const ox = 930, oy = 1480;
    inkStroke(c, pen, 6, [[ox - 120, oy + 120], [ox - 95, oy - 10], [ox - 60, oy - 90], [ox, oy - 120], [ox + 60, oy - 90], [ox + 95, oy - 10], [ox + 120, oy + 120], [ox - 120, oy + 120]]);
    c.fillStyle = pen; c.beginPath(); c.arc(ox, oy + 140, 22, 0, 7); c.fill();
    inkStroke(c, pen, 5, [[ox, oy - 120], [ox, oy - 160]]);
    c.strokeStyle = pen; c.lineWidth = 3;
    for (const r of [180, 220, 260]) { c.beginPath(); c.arc(ox, oy, r, -0.6, 0.6); c.stroke(); c.beginPath(); c.arc(ox, oy, r, Math.PI - 0.6, Math.PI + 0.6); c.stroke(); }
  }
  hand(c, '2093', 150, PH - 110, 90, pen, rnd, -0.06);
  c.restore();
  return tex(cv);
}

/** Cards atlas regions, in canvas pixels [x, y, w, h]. */
const CA = 2048;
const R = {
  cardA: [0, 0, 1024, 614],
  cardB: [1024, 0, 1024, 614],
  envelope: [0, 640, 1024, 512],
  parchment: [1024, 640, 768, 512],
  scrollEnd: [1792, 640, 256, 256],
  maple: [1792, 900, 64, 64],
  ruler: [0, 1180, 2048, 205],
  pageEdge: [0, 1400, 2048, 256],
  cream: [0, 1680, 64, 64],
} as const;
type Region = readonly [number, number, number, number];

function makeCards() {
  const { cv, c } = canvas(CA, CA);
  const rnd = mulberry32(9);
  const ink = '#1a2350', sepia = '#4a2a12';
  // index cards
  for (const [i, r] of [R.cardA, R.cardB].entries()) {
    const [x, y, w, h] = r;
    paperBase(c, x, y, w, h, '#f6f2e6', rnd, 0.4);
    c.strokeStyle = 'rgba(70,120,190,0.45)'; c.lineWidth = 2;
    for (let ly = y + 150; ly < y + h - 20; ly += 52) { c.beginPath(); c.moveTo(x, ly); c.lineTo(x + w, ly); c.stroke(); }
    c.strokeStyle = 'rgba(200,60,60,0.6)'; c.beginPath(); c.moveTo(x, y + 100); c.lineTo(x + w, y + 100); c.stroke();
    if (i === 0) {
      hand(c, 'Lecture — Thursday', x + 40, y + 80, 52, ink, rnd);
      hand(c, '• light bends near mass', x + 40, y + 190, 44, ink, rnd);
      hand(c, '• clocks run slow in gravity', x + 40, y + 242, 44, ink, rnd);
      hand(c, '• ask Marcel about the tensor', x + 40, y + 294, 44, ink, rnd);
      hand(c, '• buy pipe tobacco', x + 40, y + 346, 44, '#7a1c1c', rnd);
    } else {
      hand(c, 'Theo van Gogh', x + 60, y + 80, 56, sepia, rnd);
      hand(c, 'Goupil & Cie', x + 80, y + 200, 46, sepia, rnd);
      hand(c, '19 Boulevard Montmartre', x + 80, y + 252, 46, sepia, rnd);
      hand(c, 'Paris', x + 80, y + 304, 46, sepia, rnd);
      // stamp
      c.fillStyle = '#b8312b'; c.fillRect(x + w - 190, y + 150, 130, 160);
      c.fillStyle = 'rgba(255,240,220,0.8)'; c.font = SERIF(30); c.fillText('25c', x + w - 160, y + 290);
      c.strokeStyle = 'rgba(30,30,30,0.6)'; c.lineWidth = 4; c.beginPath(); c.arc(x + w - 200, y + 220, 70, 0, 7); c.stroke();
    }
  }
  // envelope back with flap folds
  {
    const [x, y, w, h] = R.envelope;
    paperBase(c, x, y, w, h, '#e9dcc0', rnd, 0.8);
    c.strokeStyle = 'rgba(90,60,30,0.35)'; c.lineWidth = 4;
    inkStroke(c, 'rgba(90,60,30,0.35)', 4, [[x, y], [x + w / 2, y + h * 0.62], [x + w, y]]);
    inkStroke(c, 'rgba(90,60,30,0.25)', 3, [[x, y + h], [x + w * 0.42, y + h * 0.5]]);
    inkStroke(c, 'rgba(90,60,30,0.25)', 3, [[x + w, y + h], [x + w * 0.58, y + h * 0.5]]);
    hand(c, 'V.', x + w - 160, y + h - 60, 54, sepia, rnd);
  }
  // parchment map
  {
    const [x, y, w, h] = R.parchment;
    paperBase(c, x, y, w, h, '#d8c08e', rnd, 2);
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.strokeStyle = 'rgba(80,50,20,0.7)'; c.lineWidth = 3;
    for (let land = 0; land < 4; land++) {
      const cx = x + 80 + rnd() * (w - 160), cy = y + 80 + rnd() * (h - 160), r = 40 + rnd() * 70;
      c.beginPath();
      for (let a = 0; a <= 30; a++) { const t = (a / 30) * Math.PI * 2, rr = r * (0.6 + rnd() * 0.5); c.lineTo(cx + Math.cos(t) * rr * 1.4, cy + Math.sin(t) * rr); }
      c.fillStyle = 'rgba(140,110,60,0.4)'; c.fill(); c.stroke();
    }
    c.strokeStyle = 'rgba(80,50,20,0.25)'; c.lineWidth = 1.5;
    for (let i = 1; i < 12; i++) { c.beginPath(); c.moveTo(x + i * 64, y); c.lineTo(x + i * 64, y + h); c.stroke(); }
    for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo(x, y + i * 64); c.lineTo(x + w, y + i * 64); c.stroke(); }
    c.restore();
  }
  // scroll end: rolled spiral
  {
    const [x, y, w, h] = R.scrollEnd;
    c.fillStyle = '#5a4020'; c.fillRect(x, y, w, h);
    c.strokeStyle = '#d8c08e'; c.lineWidth = 7;
    c.beginPath();
    for (let t = 0; t < 140; t++) { const a = t * 0.28, r = 8 + t * 0.82; const px = x + w / 2 + Math.cos(a) * r, py = y + h / 2 + Math.sin(a) * r; t ? c.lineTo(px, py) : c.moveTo(px, py); }
    c.stroke();
  }
  // maple (ruler sides) + cream (page tops)
  { const [x, y, w, h] = R.maple; c.fillStyle = '#c9a16a'; c.fillRect(x, y, w, h); }
  { const [x, y, w, h] = R.cream; c.fillStyle = '#efe5cf'; c.fillRect(x, y, w, h); }
  // ruler: 30 cm with mm ticks
  {
    const [x, y, w, h] = R.ruler;
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#d9b47c'); g.addColorStop(1, '#c49860');
    c.fillStyle = g; c.fillRect(x, y, w, h);
    for (let k = 0; k < 60; k++) { c.fillStyle = `rgba(120,70,30,${0.05 + rnd() * 0.08})`; c.fillRect(x, y + rnd() * h, w, 1 + rnd() * 3); }
    const mm = (w - 40) / 305;
    c.fillStyle = '#20150c';
    for (let i = 0; i <= 300; i++) {
      const px = x + 30 + i * mm;
      const len = i % 10 === 0 ? 70 : i % 5 === 0 ? 46 : 28;
      c.fillRect(px - 1.2, y, 2.4, len);
    }
    c.font = SERIF(40); c.textAlign = 'center';
    for (let i = 0; i <= 30; i++) c.fillText(String(i), x + 30 + i * 10 * mm, y + 116);
    c.textAlign = 'left';
    c.font = SERIF(30); c.fillStyle = 'rgba(32,21,12,0.7)'; c.fillText('ZÜRICH  ·  No. 30', x + 900, y + 180);
  }
  // page edges: fine stacked page lines
  {
    const [x, y, w, h] = R.pageEdge;
    c.fillStyle = '#eadfc6'; c.fillRect(x, y, w, h);
    for (let ly = y; ly < y + h; ly += 2 + rnd() * 2) { c.fillStyle = `rgba(120,95,60,${0.15 + rnd() * 0.25})`; c.fillRect(x, ly, w, 1); }
    const g = c.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, 'rgba(120,80,40,0.25)'); g.addColorStop(0.1, 'rgba(0,0,0,0)'); g.addColorStop(0.9, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(120,80,40,0.25)');
    c.fillStyle = g; c.fillRect(x, y, w, h);
  }
  return tex(cv);
}

function makeFeather() {
  const { cv, c } = canvas(256, 1024);
  const rnd = mulberry32(3);
  c.clearRect(0, 0, 256, 1024);
  // vanes: many slightly curved barbs from the rachis outward and upward
  for (let y = 40; y < 900; y += 2.2) {
    const t = (y - 40) / 860;
    const width = Math.sin(Math.min(1, t * 1.15) * Math.PI) * 110 * (t < 0.15 ? t / 0.15 : 1) + 8;
    for (const side of [-1, 1]) {
      const wv = width * (side < 0 ? 0.75 : 1) * (0.92 + rnd() * 0.12);
      if (rnd() < 0.015 * (1 - t)) continue; // a few splits
      const shade = 225 + rnd() * 30;
      const tip = t < 0.12 ? 'rgba(70,45,25,0.95)' : `rgba(${shade},${shade - 8},${shade - 22},0.95)`;
      c.strokeStyle = tip; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(128, y); c.quadraticCurveTo(128 + side * wv * 0.6, y - 18, 128 + side * wv, y - 46); c.stroke();
    }
  }
  // downy base
  for (let i = 0; i < 160; i++) { c.strokeStyle = 'rgba(245,240,230,0.5)'; c.lineWidth = 1; const y = 900 + rnd() * 100; c.beginPath(); c.moveTo(128, y); c.lineTo(128 + (rnd() - 0.5) * 120, y - 10 - rnd() * 30); c.stroke(); }
  return tex(cv);
}

function makeDecals() {
  const { cv, c } = canvas(1024, 512);
  const rnd = mulberry32(5);
  // coffee ring
  c.save(); c.translate(256, 256);
  for (let i = 0; i < 4; i++) { c.strokeStyle = `rgba(60,25,8,${0.35 - i * 0.07})`; c.lineWidth = 6 + i * 6; c.beginPath(); c.arc((rnd() - 0.5) * 6, (rnd() - 0.5) * 6, 190 - i * 3, 0, 7); c.stroke(); }
  const g = c.createRadialGradient(0, 0, 40, 0, 0, 190); g.addColorStop(0, 'rgba(70,30,10,0.0)'); g.addColorStop(0.85, 'rgba(70,30,10,0.12)'); g.addColorStop(1, 'rgba(70,30,10,0)');
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, 195, 0, 7); c.fill();
  c.restore();
  // ink splat
  c.save(); c.translate(768, 256); c.fillStyle = 'rgba(8,10,28,0.92)';
  c.beginPath(); for (let a = 0; a <= 40; a++) { const t = (a / 40) * Math.PI * 2, r = 80 + rnd() * 50 + (a % 7 === 0 ? 60 : 0); c.lineTo(Math.cos(t) * r, Math.sin(t) * r); } c.fill();
  for (let i = 0; i < 30; i++) { const a = rnd() * 7, r = 150 + rnd() * 90; c.beginPath(); c.arc(Math.cos(a) * r, Math.sin(a) * r, 4 + rnd() * 14, 0, 7); c.fill(); }
  c.restore();
  const t = tex(cv);
  return t;
}

let cachedMats: PropMaterials | null = null;
export function propMaterials(): PropMaterials {
  if (cachedMats) return cachedMats;
  const pagesTex = makePages();
  const cardsTex = makeCards();
  const m: PropMaterials = {
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 }),
    gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, envMapIntensity: 1.4 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd2a650, metalness: 1, roughness: 0.27 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 1, roughness: 0.2 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xe8f2ff, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.2, depthWrite: false, envMapIntensity: 2.2 }),
    porcelain: new THREE.MeshStandardMaterial({ color: 0xf5f1e8, roughness: 0.14, envMapIntensity: 1.2 }),
    pages: new THREE.MeshStandardMaterial({ map: pagesTex, color: 0xd6cfc2, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    cards: new THREE.MeshStandardMaterial({ map: cardsTex, color: 0xdcd5c8, roughness: 0.82, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    feather: new THREE.MeshStandardMaterial({ map: makeFeather(), roughness: 0.8, alphaTest: 0.45, side: THREE.DoubleSide }),
    flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.4, 1.3), fog: false }),
    decal: new THREE.MeshStandardMaterial({ map: makeDecals(), roughness: 0.3, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    noShadow: new Set(),
  };
  m.noShadow.add(m.glass).add(m.flame).add(m.decal);
  cachedMats = m;
  return m;
}

// ── geometry helpers (all in centimeters until `cm()` scales to meters) ─────────────────────────────

const V2 = (r: number, y: number) => new THREE.Vector2(r, y);
const lathe = (pts: [number, number][], seg = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => V2(Math.max(r, 0.0001), y)), seg);

/** Bake a solid vertex color (or a function of position) into a geometry for the painted materials. */
function paint(g: THREE.BufferGeometry, col: THREE.ColorRepresentation | ((p: THREE.Vector3) => THREE.Color)) {
  clean(g);
  const pos = g.getAttribute('position');
  const arr = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (typeof col === 'function') c.copy(col(p.fromBufferAttribute(pos, i)));
    else c.set(col);
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Map a geometry's 0..1 uvs into an atlas region. */
function region(g: THREE.BufferGeometry, r: Region, W = CA, H = CA) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const [x, y, w, h] = r;
  const u0 = x / W, u1 = (x + w) / W, v0 = 1 - (y + h) / H, v1 = 1 - y / H;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

/** Flat-shade a low-poly shape (hex pencils, cut glass). */
function faceted(g: THREE.BufferGeometry) {
  const n = g.toNonIndexed(); n.computeVertexNormals(); return clean(n);
}

const cm = (g: THREE.BufferGeometry) => g.scale(U, U, U);

class Kit {
  parts: Part[] = [];
  constructor(public M: PropMaterials) {}
  add(geo: THREE.BufferGeometry, mat: THREE.Material, collide = true) {
    const keepColor = !!geo.getAttribute('color');
    const color = geo.getAttribute('color');
    clean(geo);
    if (keepColor) geo.setAttribute('color', color);
    this.parts.push({ geo: cm(geo), mat, collide });
    return this;
  }
}

// ── props ───────────────────────────────────────────────────────────────────────────────────────────

/** A letter-size sheet lying on the desk, gently wavy with one corner curling up. `page` picks the atlas page. */
export function paperSheet(M: PropMaterials, page: number, curlCorner = 0, layer = 0) {
  const k = new Kit(M);
  const w = 21.6, h = 27.9;
  const g = new THREE.PlaneGeometry(w, h, 18, 24).rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  const cx = (curlCorner & 1 ? 1 : -1) * w / 2, cz = (curlCorner & 2 ? 1 : -1) * h / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = 0.07 + layer * 0.04 + Math.sin(x * 0.35 + z * 0.12) * 0.03 + Math.sin(z * 0.27) * 0.04;
    const d = Math.hypot(x - cx, z - cz);
    if (d < 8) y += Math.pow((8 - d) / 8, 2.2) * 2.2;
    pos.setY(i, y);
  }
  g.computeVertexNormals();
  region(g, [page * PW, 0, PW, PH], PW * 3, PH);
  return k.add(g, M.pages, false).parts;
}

/** A little stack of ruled index cards. */
export function indexCards(M: PropMaterials) {
  const k = new Kit(M);
  const rnd = mulberry32(11);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.PlaneGeometry(12.7, 7.6, 6, 4).rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position');
    for (let j = 0; j < pos.count; j++) pos.setY(j, 0.08 + i * 0.05 + Math.sin(pos.getX(j) * 0.4) * 0.02);
    g.computeVertexNormals();
    g.rotateY((rnd() - 0.5) * 0.35).translate((rnd() - 0.5) * 1.2, 0, (rnd() - 0.5) * 1.2);
    region(g, i === 3 ? R.cardA : R.cardB);
    k.add(g, M.cards, false);
  }
  return k.parts;
}

/** Cut-glass inkwell on a brass tray, with a goose quill standing in it. */
export function inkwell(M: PropMaterials) {
  const k = new Kit(M);
  k.add(new THREE.BoxGeometry(10, 0.5, 10).translate(0, 0.25, 0), M.brass);
  k.add(faceted(lathe([[0, 0.5], [3.3, 0.5], [3.5, 0.8], [3.5, 4.6], [3.1, 5.2], [1.6, 5.8], [1.45, 6.0]], 8)), M.gloss);
  // tint the glass body: deep ink blue-black
  const body = k.parts[k.parts.length - 1].geo; paint(body, new THREE.Color(0.02, 0.035, 0.07));
  k.add(lathe([[1.4, 5.9], [1.75, 6.0], [1.75, 6.9], [1.55, 7.0], [1.2, 7.0], [1.2, 6.4]], 20), M.brass);
  k.add(paint(new THREE.CircleGeometry(1.2, 16).rotateX(-Math.PI / 2).translate(0, 6.5, 0), new THREE.Color(0.01, 0.012, 0.03)), M.gloss, false);
  // quill: rachis + bent vane, leaning back out of the ink
  const tilt = new THREE.Matrix4().makeRotationZ(0.42).premultiply(new THREE.Matrix4().makeRotationY(0.6)).premultiply(new THREE.Matrix4().makeTranslation(0, 5.0, 0));
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.6, 14, 0), new THREE.Vector3(2.4, 30, 0));
  k.add(paint(new THREE.TubeGeometry(curve, 24, 0.17, 6, false), new THREE.Color(0.85, 0.8, 0.68)).applyMatrix4(tilt), M.paint, false);
  const vane = new THREE.PlaneGeometry(6.4, 25, 1, 16).translate(0, 17.5, 0);
  const vp = vane.getAttribute('position');
  for (let i = 0; i < vp.count; i++) {
    const y = vp.getY(i), t = y / 30;
    const p = curve.getPoint(Math.min(1, t));
    vp.setX(i, vp.getX(i) + p.x);
    vp.setZ(i, Math.abs(vp.getX(i) - p.x) * 0.18 * Math.sin(t * 3)); // slight cup
  }
  vane.computeVertexNormals();
  k.add(vane.applyMatrix4(tilt), M.feather, false);
  return k.parts;
}

/** Lacquered fountain pen with a gold nib, clip and cap bands, lying on its side. */
export function fountainPen(M: PropMaterials, lacquer = new THREE.Color(0.012, 0.09, 0.05)) {
  const k = new Kit(M);
  const lie = new THREE.Matrix4().makeRotationZ(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(-7, 0.74, 0));
  const body = lathe([[0, 0], [0.5, 0.05], [0.72, 0.4], [0.73, 6.0], [0.66, 6.15], [0.64, 9.6], [0.6, 10.6], [0.5, 11.6], [0.42, 11.8], [0, 11.8]], 28);
  k.add(paint(body, lacquer).applyMatrix4(lie), M.gloss);
  for (const y of [5.75, 6.05]) k.add(new THREE.TorusGeometry(0.735, 0.06, 6, 28).rotateX(Math.PI / 2).translate(0, y, 0).applyMatrix4(lie), M.brass, false);
  k.add(new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI).scale(1, 0.4, 1).translate(0, 0.06, 0).applyMatrix4(lie), M.brass, false);
  k.add(new THREE.BoxGeometry(0.16, 4.6, 0.38).translate(-0.82, 2.8, 0).applyMatrix4(lie), M.brass, false);
  k.add(new THREE.SphereGeometry(0.22, 10, 6).translate(-0.86, 5.1, 0).applyMatrix4(lie), M.brass, false);
  k.add(new THREE.ConeGeometry(0.42, 2.4, 16).scale(1, 1, 0.38).translate(0, 13.0, 0).applyMatrix4(lie), M.brass, false);
  return k.parts;
}

/** Hexagonal pencil, sharpened, with a crimped ferrule and eraser. */
export function pencil(M: PropMaterials, paintColor: THREE.Color, len = 15.5) {
  const k = new Kit(M);
  const r = 0.38;
  const lie = new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(0, r * 0.866, 0));
  k.add(paint(faceted(new THREE.CylinderGeometry(r, r, len, 6)), paintColor).applyMatrix4(lie), M.gloss, false);
  const tipH = 2.4;
  k.add(paint(faceted(new THREE.CylinderGeometry(0.13, r, tipH, 6).translate(0, -len / 2 - tipH / 2, 0)), new THREE.Color(0.78, 0.6, 0.4)).applyMatrix4(lie), M.paint, false);
  k.add(paint(new THREE.ConeGeometry(0.13, 0.6, 8).rotateX(Math.PI).translate(0, -len / 2 - tipH - 0.3, 0), new THREE.Color(0.05, 0.05, 0.055)).applyMatrix4(lie), M.gloss, false);
  k.add(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 1.1, 18).translate(0, len / 2 + 0.55, 0).applyMatrix4(lie), M.steel, false);
  for (const y of [0.25, 0.85]) k.add(new THREE.TorusGeometry(r * 1.03, 0.05, 6, 18).rotateX(Math.PI / 2).translate(0, len / 2 + y, 0).applyMatrix4(lie), M.steel, false);
  k.add(paint(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.9, 18).translate(0, len / 2 + 1.55, 0), new THREE.Color(0.85, 0.42, 0.42)).applyMatrix4(lie), M.paint, false);
  return k.parts;
}

/** 30 cm maple ruler with printed mm scale. */
export function ruler(M: PropMaterials) {
  const k = new Kit(M);
  const g = new THREE.BoxGeometry(30.5, 0.28, 3.2).translate(0, 0.14, 0);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute, n = g.getAttribute('normal');
  const [x, y, w, h] = R.ruler, [mx, my, mw, mh] = R.maple;
  for (let i = 0; i < uv.count; i++) {
    if (n.getY(i) > 0.5) uv.setXY(i, (x + uv.getX(i) * w) / CA, 1 - (y + (1 - uv.getY(i)) * h) / CA);
    else uv.setXY(i, (mx + mw / 2) / CA, 1 - (my + mh / 2) / CA);
  }
  return k.add(g, M.cards, false).parts;
}

/** Brass magnifying glass lying flat, ebony handle. */
export function magnifier(M: PropMaterials) {
  const k = new Kit(M);
  const R0 = 3.8;
  k.add(new THREE.TorusGeometry(R0, 0.36, 12, 56).rotateX(Math.PI / 2).translate(0, 0.42, 0), M.brass);
  k.add(new THREE.CylinderGeometry(R0 - 0.05, R0 - 0.05, 0.32, 48).translate(0, 0.42, 0), M.glass, false);
  const lie = new THREE.Matrix4().makeRotationZ(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(R0 + 0.2, 0.62, 0));
  k.add(new THREE.CylinderGeometry(0.5, 0.62, 1.4, 16).translate(0, 0.7, 0).applyMatrix4(lie), M.brass);
  k.add(paint(lathe([[0, 1.4], [0.62, 1.4], [0.72, 2.0], [0.78, 7.5], [0.66, 10.2], [0.5, 10.8], [0, 10.9]], 18), new THREE.Color(0.03, 0.018, 0.012)).applyMatrix4(lie), M.gloss);
  return k.parts;
}

/** Brass chamberstick with a dripping candle and a live flame. */
export function candle(M: PropMaterials) {
  const k = new Kit(M);
  k.add(lathe([[0, 0], [5.6, 0], [6.1, 0.35], [6.25, 1.05], [5.95, 1.15], [5.4, 0.62], [1.9, 0.55], [1.9, 2.6], [2.4, 3.0], [2.4, 3.4], [1.95, 3.4], [1.95, 3.1], [0, 3.1]], 32), M.brass);
  k.add(new THREE.TorusGeometry(1.4, 0.3, 8, 20, Math.PI * 1.3).rotateZ(-Math.PI * 0.65).translate(6.4, 1.6, 0), M.brass);
  const wax = new THREE.Color(0.93, 0.88, 0.76);
  k.add(paint(lathe([[0, 3.1], [1.8, 3.1], [1.8, 12.4], [1.65, 12.9], [1.25, 12.7], [0.4, 12.5], [0, 12.55]], 24), wax), M.paint);
  const rnd = mulberry32(21);
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2, len = 1.5 + rnd() * 3.5;
    k.add(paint(new THREE.CapsuleGeometry(0.3, len, 4, 8).translate(0, 12.6 - len / 2, 0).applyMatrix4(new THREE.Matrix4().makeTranslation(Math.cos(a) * 1.78, 0, Math.sin(a) * 1.78)), wax), M.paint, false);
  }
  k.add(paint(new THREE.CylinderGeometry(0.07, 0.08, 0.9, 6).translate(0, 12.9, 0), new THREE.Color(0.05, 0.04, 0.03)), M.paint, false);
  k.add(lathe([[0, 13.1], [0.36, 13.45], [0.44, 13.9], [0.32, 14.7], [0, 15.7]], 12), M.flame, false);
  return k.parts;
}

/** Just a wick and flame, sitting at y = 0 (for the Meshy candle). */
export function flame(M: PropMaterials) {
  const k = new Kit(M);
  k.add(paint(new THREE.CylinderGeometry(0.07, 0.08, 0.9, 6).translate(0, 0.2, 0), new THREE.Color(0.05, 0.04, 0.03)), M.paint, false);
  k.add(lathe([[0, 0.4], [0.36, 0.75], [0.44, 1.2], [0.32, 2.0], [0, 3.0]], 12), M.flame, false);
  return k.parts;
}

/** Cloth-bound hardcover: boards, rounded spine with gilt bands, and a page block with real page edges. */
export function hardcover(M: PropMaterials, cloth: THREE.Color, L = 24, W = 16, H = 3.2) {
  const k = new Kit(M);
  const t = 0.26;
  k.add(paint(new THREE.BoxGeometry(L, t, W).translate(0, t / 2, 0.15), cloth), M.paint);
  k.add(paint(new THREE.BoxGeometry(L, t, W).translate(0, H - t / 2, 0.15), cloth), M.paint);
  const sp = new THREE.CylinderGeometry(H / 2, H / 2, L, 16, 1, true, Math.PI / 2, Math.PI).rotateZ(Math.PI / 2).translate(0, H / 2, -W / 2 + 0.15);
  k.add(paint(sp, cloth), M.paint);
  for (const x of [-L * 0.36, -L * 0.3, L * 0.3, L * 0.36]) {
    k.add(new THREE.CylinderGeometry(H / 2 + 0.03, H / 2 + 0.03, 0.35, 16, 1, true, Math.PI / 2, Math.PI).rotateZ(Math.PI / 2).translate(x, H / 2, -W / 2 + 0.15), M.brass, false);
  }
  const block = new THREE.BoxGeometry(L - 0.6, H - t * 2, W - 0.5).translate(0, H / 2, 0.15);
  const uv = block.getAttribute('uv') as THREE.BufferAttribute, n = block.getAttribute('normal');
  const [x, y, w, h] = R.pageEdge, [cx, cy, cw, ch] = R.cream;
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, (cx + cw / 2) / CA, 1 - (cy + ch / 2) / CA);
    else uv.setXY(i, (x + uv.getX(i) * w) / CA, 1 - (y + (1 - uv.getY(i)) * h * 0.25) / CA);
  }
  k.add(block, M.cards);
  return k.parts;
}

/** Porcelain teacup and saucer with gold rims and tea inside. */
export function teacup(M: PropMaterials) {
  const k = new Kit(M);
  k.add(lathe([[0, 0], [3.5, 0], [3.7, 0.25], [3.3, 0.4], [6.5, 0.9], [7.6, 1.6], [7.7, 1.78], [7.35, 1.7], [6.2, 1.05], [3.8, 0.78], [0, 0.72]], 40), M.porcelain);
  const y0 = 0.75;
  k.add(lathe([[0, y0], [2.2, y0], [2.4, y0 + 0.4], [2.1, y0 + 0.6], [2.6, y0 + 1.0], [3.6, y0 + 2.5], [4.3, y0 + 4.5], [4.6, y0 + 6.2], [4.65, y0 + 6.5], [4.35, y0 + 6.42], [4.02, y0 + 4.5], [3.2, y0 + 2.4], [0, y0 + 1.4]], 40), M.porcelain);
  k.add(new THREE.TorusGeometry(4.55, 0.09, 6, 48).rotateX(Math.PI / 2).translate(0, y0 + 6.45, 0), M.brass, false);
  k.add(new THREE.TorusGeometry(7.62, 0.08, 6, 56).rotateX(Math.PI / 2).translate(0, 1.72, 0), M.brass, false);
  k.add(paint(new THREE.CircleGeometry(4.15, 32).rotateX(-Math.PI / 2).translate(0, y0 + 5.3, 0), new THREE.Color(0.16, 0.06, 0.018)), M.gloss, false);
  k.add(new THREE.TorusGeometry(1.75, 0.38, 10, 20, Math.PI * 1.25).rotateZ(-Math.PI * 0.625).translate(4.55, y0 + 3.7, 0), M.porcelain);
  return k.parts;
}

/** Round wire spectacles, folded. */
export function spectacles(M: PropMaterials) {
  const k = new Kit(M);
  for (const sx of [-1, 1]) {
    k.add(new THREE.TorusGeometry(2.1, 0.12, 8, 40).rotateX(Math.PI / 2).translate(sx * 2.55, 0.14, 0), M.brass, false);
    k.add(new THREE.CylinderGeometry(2.05, 2.05, 0.14, 32).translate(sx * 2.55, 0.14, 0), M.glass, false);
    k.add(new THREE.CylinderGeometry(0.09, 0.09, 11.5, 6).rotateZ(Math.PI / 2).rotateY(sx * 0.06).translate(-sx * 0.6, 0.45 + (sx > 0 ? 0.2 : 0), 1.9), M.brass, false);
  }
  k.add(new THREE.TorusGeometry(0.42, 0.1, 6, 12, Math.PI).translate(0, 0.3, 0).rotateX(-0.2), M.brass, false);
  return k.parts;
}

/** A small stack of brass and silver coins, plus strays. */
export function coins(M: PropMaterials) {
  const k = new Kit(M);
  const coin = lathe([[0, 0], [1.12, 0], [1.2, 0.05], [1.2, 0.17], [1.12, 0.22], [1.0, 0.22], [0.96, 0.18], [0, 0.18]], 32);
  const rnd = mulberry32(31);
  for (let i = 0; i < 8; i++) k.add(coin.clone().translate((rnd() - 0.5) * 0.25, i * 0.22, (rnd() - 0.5) * 0.25), i % 3 === 2 ? M.steel : M.brass);
  for (const [x, z, s] of [[3.2, 1.0, 1.0], [-2.4, 2.6, 0.85], [1.8, -2.9, 1.1]]) k.add(coin.clone().scale(s, 1, s).translate(x, 0, z), z > 0 ? M.brass : M.steel, false);
  return k.parts;
}

/** Envelope (back side up) sealed with red wax. */
export function envelope(M: PropMaterials) {
  const k = new Kit(M);
  const g = new THREE.PlaneGeometry(22, 11, 4, 2).rotateX(-Math.PI / 2).translate(0, 0.1, 0);
  region(g, R.envelope);
  k.add(g, M.cards, false);
  const red = new THREE.Color(0.42, 0.03, 0.03);
  k.add(paint(lathe([[0, 0.1], [1.6, 0.1], [1.78, 0.25], [1.62, 0.48], [1.3, 0.55], [1.24, 0.48], [0, 0.48]], 28), red).translate(0, 0, 0.9), M.gloss, false);
  k.add(paint(new THREE.TorusGeometry(0.9, 0.07, 6, 28).rotateX(Math.PI / 2).translate(0, 0.5, 0.9), red), M.gloss, false);
  return k.parts;
}

/** Steel gem paper clip. */
export function paperClip(M: PropMaterials) {
  const k = new Kit(M);
  const pts: THREE.Vector3[] = [];
  const line = (x0: number, z0: number, x1: number, z1: number) => { for (let i = 0; i <= 3; i++) pts.push(new THREE.Vector3(x0 + (x1 - x0) * i / 3, 0, z0 + (z1 - z0) * i / 3)); };
  const arc = (cx: number, cz: number, r: number, a0: number, a1: number) => { for (let i = 1; i < 10; i++) { const a = a0 + (a1 - a0) * i / 10; pts.push(new THREE.Vector3(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r)); } };
  line(2.3, 0, 0.55, 0); arc(0.55, 0.2, 0.2, -Math.PI / 2, -Math.PI * 1.5);
  line(0.55, 0.4, 2.85, 0.4); arc(2.85, 0.05, 0.35, Math.PI / 2, -Math.PI / 2);
  line(2.85, -0.3, 0.35, -0.3); arc(0.35, 0.15, 0.45, -Math.PI / 2, -Math.PI * 1.5);
  line(0.35, 0.6, 2.0, 0.6);
  const clean2 = pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 1e-3);
  const curve = new THREE.CatmullRomCurve3(clean2, false, 'centripetal');
  k.add(new THREE.TubeGeometry(curve, 140, 0.055, 6, false).translate(-1.6, 0.06, 0), M.steel, false);
  return k.parts;
}

/** Glazed jar of paintbrushes, bristles still loaded with color. */
export function brushJar(M: PropMaterials) {
  const k = new Kit(M);
  const glaze = new THREE.Color(0.04, 0.1, 0.36);
  k.add(paint(lathe([[0, 0], [3.5, 0], [3.9, 0.3], [4.0, 1.0], [3.85, 8.8], [4.3, 9.4], [4.25, 9.9], [3.7, 9.95], [3.5, 9.4], [3.45, 1.9], [0, 1.8]], 36), (p) => {
    const t = p.y / 10;
    return new THREE.Color().copy(glaze).lerp(new THREE.Color(0.55, 0.42, 0.28), t < 0.1 ? 1 - t * 10 : 0);
  }), M.gloss);
  const rnd = mulberry32(13);
  const handles = [new THREE.Color(0.5, 0.06, 0.04), new THREE.Color(0.02, 0.02, 0.02), new THREE.Color(0.55, 0.38, 0.2), new THREE.Color(0.05, 0.22, 0.1), new THREE.Color(0.5, 0.06, 0.04), new THREE.Color(0.55, 0.38, 0.2)];
  const paints = [new THREE.Color(0.95, 0.68, 0.05), new THREE.Color(0.05, 0.2, 0.7), new THREE.Color(0.9, 0.35, 0.05), new THREE.Color(0.95, 0.85, 0.2), new THREE.Color(0.1, 0.45, 0.35), new THREE.Color(0.9, 0.9, 0.85)];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd() * 0.4;
    const lean = 0.12 + rnd() * 0.14;
    const L = 14 + rnd() * 5;
    const m = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)), lean).premultiply(new THREE.Matrix4().makeTranslation(Math.cos(a) * 1.4, 1.9, Math.sin(a) * 1.4));
    k.add(paint(lathe([[0, 0], [0.18, 0.2], [0.26, 3], [0.33, L * 0.6], [0.42, L - 0.2], [0, L]], 10), handles[i]).applyMatrix4(m), M.gloss, false);
    k.add(new THREE.CylinderGeometry(0.44, 0.4, 2.0, 12).translate(0, L + 1, 0).applyMatrix4(m), M.steel, false);
    const tip = paints[i];
    k.add(paint(lathe([[0, L + 2], [0.48, L + 2], [0.55, L + 3.0], [0.35, L + 4.4], [0, L + 5.0]], 12), (p) => new THREE.Color(0.12, 0.08, 0.05).lerp(tip, THREE.MathUtils.smoothstep(p.y, L + 2.8, L + 4.2))).applyMatrix4(m), M.paint, false);
  }
  return k.parts;
}

/** Rolled parchment map tied with a red ribbon. */
export function scroll(M: PropMaterials) {
  const k = new Kit(M);
  const r = 2.0, L = 30;
  const g = new THREE.CylinderGeometry(r, r, L, 28, 1, false);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const groups = g.groups;
  const [px, py, pw, ph] = R.parchment, [ex, ey, ew, eh] = R.scrollEnd;
  for (const grp of groups) {
    for (let j = grp.start; j < grp.start + grp.count; j++) {
      const i = g.index!.getX(j);
      const u = uv.getX(i), v = uv.getY(i);
      if (grp.materialIndex === 0) uv.setXY(i, (px + u * pw) / CA, 1 - (py + (1 - v) * ph) / CA);
      else uv.setXY(i, (ex + u * ew) / CA, 1 - (ey + (1 - v) * eh) / CA);
    }
  }
  g.clearGroups();
  k.add(g.rotateZ(Math.PI / 2).translate(0, r, 0), M.cards);
  for (const x of [-6, 6]) k.add(paint(new THREE.TorusGeometry(r + 0.05, 0.22, 6, 28).rotateY(Math.PI / 2).translate(x, r, 0), new THREE.Color(0.45, 0.04, 0.05)), M.paint, false);
  return k.parts;
}

/** Turned-wood hourglass with sand mid-fall. */
export function hourglass(M: PropMaterials) {
  const k = new Kit(M);
  const wood = new THREE.Color(0.2, 0.09, 0.04);
  const disc = lathe([[0, 0], [4.2, 0], [4.4, 0.45], [4.2, 0.95], [0, 0.95]], 32);
  k.add(paint(disc.clone(), wood), M.gloss);
  k.add(paint(disc.clone().scale(1, -1, 1).translate(0, 15.0, 0), wood), M.gloss);
  const post = lathe([[0, 0.95], [0.5, 0.95], [0.35, 2], [0.55, 4], [0.3, 7.5], [0.55, 11], [0.35, 13], [0.5, 14.05], [0, 14.05]], 10);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.3; k.add(paint(post.clone().translate(Math.cos(a) * 3.35, 0, Math.sin(a) * 3.35), wood), M.gloss); }
  const sand = new THREE.Color(0.78, 0.6, 0.34);
  k.add(paint(lathe([[0, 4.1], [1.6, 3.4], [2.5, 2.4], [2.6, 1.9], [1.0, 1.0], [0, 0.98]], 24), sand), M.paint, false);
  k.add(paint(lathe([[0, 7.55], [0.35, 7.55], [2.2, 8.75], [2.72, 10.4], [0, 10.4]], 24), sand), M.paint, false);
  k.add(paint(new THREE.CylinderGeometry(0.06, 0.06, 3.5, 5).translate(0, 5.8, 0), sand), M.paint, false);
  k.add(lathe([[0.6, 0.95], [2.6, 2.0], [2.9, 4], [2.2, 6.3], [0.35, 7.5], [2.2, 8.7], [2.9, 11], [2.6, 13], [0.6, 14.05]], 32), M.glass);
  return k.parts;
}

/**
 * Real glass and sand for the Meshy hourglass, whose painted glass shell scripts/strip-hourglass-glass.mjs cuts out.
 * Profiles are measured from that model; output is in the template's space (1 tall, feet on y = 0).
 */
export function hourglassGlass(): Part[] {
  const H = 0.9487, Y0 = -0.4739; // the stripped model's height and floor
  const fit = (g: THREE.BufferGeometry) => clean(g.translate(0, -Y0, 0).scale(1 / H, 1 / H, 1 / H));
  const half: [number, number][] = [[0.125, -0.358], [0.127, -0.33], [0.136, -0.3], [0.157, -0.26], [0.166, -0.215], [0.161, -0.175], [0.139, -0.14], [0.115, -0.1], [0.081, -0.07], [0.048, -0.04], [0.031, -0.015], [0.027, 0]];
  const bulb = [...half, ...half.slice(0, -1).reverse().map(([r, y]) => [r, -y] as [number, number])];
  sandMat ??= new THREE.MeshStandardMaterial({ color: new THREE.Color(0.4, 0.22, 0.08), roughness: 0.95 });
  // thinner than the shared glass so the sand reads through it: clear, with just a rim of reflection
  bulbMat ??= new THREE.MeshStandardMaterial({ color: 0xf2f6ff, roughness: 0.02, transparent: true, opacity: 0.07, depthWrite: false, envMapIntensity: 1.4 });
  return [
    // the bottom heap, the last of the top chamber (dipping where it drains) and the falling thread
    { geo: fit(lathe([[0, -0.356], [0.118, -0.356], [0.124, -0.3], [0.146, -0.26], [0.155, -0.222], [0.09, -0.19], [0.025, -0.153], [0, -0.15]], 32)), mat: sandMat, collide: false },
    { geo: fit(lathe([[0, 0.004], [0.022, 0.01], [0.042, 0.036], [0.074, 0.065], [0.106, 0.1], [0.132, 0.136], [0.148, 0.168], [0.07, 0.158], [0, 0.146]], 32)), mat: sandMat, collide: false },
    { geo: fit(new THREE.CylinderGeometry(0.0035, 0.0035, 0.15, 6).translate(0, -0.075, 0)), mat: sandMat, collide: false },
    { geo: fit(lathe(bulb, 48)), mat: bulbMat, collide: false },
  ];
}
let sandMat: THREE.MeshStandardMaterial | undefined, bulbMat: THREE.MeshStandardMaterial | undefined;

/** Ground decals: a coffee ring and an ink splatter. kind 0 = ring, 1 = ink. Size in cm. */
export function decal(M: PropMaterials, kind: 0 | 1, size: number) {
  const k = new Kit(M);
  const g = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2).translate(0, 0.03, 0);
  region(g, [kind * 512, 0, 512, 512], 1024, 512);
  return k.add(g, M.decal, false).parts;
}
