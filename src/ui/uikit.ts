import type { Role } from '../game/types';

/** Shared UI building blocks: escaping, icons, the logo mark and small animation helpers. */

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const icon = (inner: string, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;

export const ROLE_ICONS: Record<Role, string> = {
  Duelist: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  Vanguard: '<path d="M12 2.8l7.8 2.9v5.9c0 4.6-3.3 8.3-7.8 9.6-4.5-1.3-7.8-5-7.8-9.6V5.7z"/><path d="M12 7v9M8.5 10.5h7" opacity=".7"/>',
  Strategist: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M12 7.5v9M7.5 12h9"/>',
};

export const UI = {
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9.5" r="2.5" opacity=".7"/><path d="M16.5 14.2c2.3.2 4 1.7 4.5 4.3" opacity=".7"/>',
  bot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4.5V8M9.5 13h.01M14.5 13h.01" stroke-width="2.6"/><path d="M2.5 13v2M21.5 13v2"/>',
  skull: '<path d="M12 3.5c-4.4 0-7.5 3-7.5 7 0 2.4 1.1 4 2.8 5v3h9.4v-3c1.7-1 2.8-2.6 2.8-5 0-4-3.1-7-7.5-7z"/><circle cx="9.2" cy="11" r="1.6" fill="currentColor"/><circle cx="14.8" cy="11" r="1.6" fill="currentColor"/><path d="M10.5 18.5v-2M13.5 18.5v-2"/>',
  swords: '<path d="M4 4l9.5 9.5M4 4v3.5M4 4h3.5M20 4l-9.5 9.5M20 4v3.5M20 4h-3.5"/><path d="M7 17l-3 3M17 17l3 3M9.5 14.5l-3.5 3.5M14.5 14.5l3.5 3.5"/>',
  heart: '<path d="M12 20s-7.5-4.5-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.5-7.5 10-7.5 10z"/>',
  bolt: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z" fill="currentColor" fill-opacity=".2"/><path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.4 3.6-8.3.5 1.8 1.6 2.8 2.6 3.3.1-2.8 1.3-5.3 3.4-7.3.2 3.3 3.4 5.6 3.4 10.6 0 4.6-2.6 7.9-6.5 7.9z"/>',
  trophy: '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.5a3 3 0 0 0 3 4M16.5 6h3a3 3 0 0 1-3 4M12 13.5V17M8.5 20h7M9.5 17h5"/>',
  chevL: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  chevR: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M10 6l-6 6 6 6M4.5 12H20"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  mouse: '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 3v6.5M6.5 9.5h11"/>',
  spark: '<path d="M12 3l1.8 5.6L19.5 10l-5.7 1.6L12 17.5l-1.8-5.9L4.5 10l5.7-1.4z" fill="currentColor" fill-opacity=".25"/><path d="M12 3l1.8 5.6L19.5 10l-5.7 1.6L12 17.5l-1.8-5.9L4.5 10l5.7-1.4z"/>',
  resume: '<path d="M8 5.5v13l10.5-6.5z"/>',
  exit: '<path d="M14 4.5h4.5v15H14M10 8l-4 4 4 4M6 12h9"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  map: '<path d="M3.5 6.5l5.5-2.5 6 2.5 5.5-2.5v13.5l-5.5 2.5-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20" opacity=".7"/>',
  arrowR: '<path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5"/>',
  heartPulse: '<path d="M12 20s-7.5-4.5-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.5-7.5 10-7.5 10z"/><path d="M6.5 12h3l1.5-2.5 2 5 1.5-2.5h3" opacity=".8"/>',
  book: '<path d="M4 5.5c2.5-1.3 5.5-1.3 8 .5 2.5-1.8 5.5-1.8 8-.5v13c-2.5-1.3-5.5-1.3-8 .5-2.5-1.8-5.5-1.8-8-.5z"/><path d="M12 6v13"/>',
};

let markSeq = 0;
/** The Legends Assembly crest: a gilded diamond around a rising "A" with a spark. */
export function logoMark(cls = 'mark') {
  const id = `lmg${markSeq++}`;
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff7dc"/><stop offset=".45" stop-color="#ffcf5a"/><stop offset="1" stop-color="#ff5a86"/></linearGradient></defs>
    <path d="M32 3.5 60.5 32 32 60.5 3.5 32Z" fill="rgba(255,207,90,.07)" stroke="url(#${id})" stroke-width="2.6"/>
    <path d="M32 11 53 32 32 53 11 32Z" fill="none" stroke="url(#${id})" stroke-width="1" opacity=".45"/>
    <path d="M21 42.5 32 18l11 24.5M25.6 34h12.8" fill="none" stroke="url(#${id})" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M32 6.5l1.4 3.6 3.6 1.4-3.6 1.4L32 16.5l-1.4-3.6-3.6-1.4 3.6-1.4z" fill="#fff7dc"/></svg>`;
}

/** Names that are one title, not a first and last name: they are never split ("Iron Man" stays "Iron Man"). */
const WHOLE_NAMES = new Set(['Iron Man']);
/** "Albert Einstein" → ["Albert", "Einstein"]; "Vincent van Gogh" → ["Vincent", "van Gogh"]; "Yeat" → ["", "Yeat"]. */
export function splitName(name: string): [string, string] {
  const parts = name.split(' ');
  if (parts.length === 1 || WHOLE_NAMES.has(name)) return ['', name];
  return [parts[0], parts.slice(1).join(' ')];
}

export const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Animate a number from 0 to `to` (ease-out). Cheap: one rAF loop, textContent only. */
export function countUp(el: HTMLElement, to: number, dur = 900, delay = 0, fmt = (n: number) => String(Math.round(n))) {
  const start = performance.now() + delay;
  el.textContent = fmt(0);
  const step = (now: number) => {
    const k = Math.min(1, Math.max(0, (now - start) / dur));
    el.textContent = fmt(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Write a style property / text only when it changed (keeps per-frame HUD updates from thrashing the DOM). */
export class DomCache {
  private last = new Map<string, string>();
  text(key: string, el: HTMLElement, v: string) {
    if (this.last.get(key) === v) return;
    this.last.set(key, v);
    el.textContent = v;
  }
  style(key: string, el: HTMLElement, prop: string, v: string) {
    if (this.last.get(key) === v) return;
    this.last.set(key, v);
    if (prop.startsWith('--')) el.style.setProperty(prop, v);
    else (el.style as unknown as Record<string, string>)[prop] = v;
  }
  cls(key: string, el: HTMLElement, name: string, on: boolean) {
    const v = on ? '1' : '0';
    if (this.last.get(key) === v) return;
    this.last.set(key, v);
    el.classList.toggle(name, on);
  }
  clear() { this.last.clear(); }
}
