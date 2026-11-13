/**
 * Fullscreen + keyboard lock helpers. Everything is feature-detected: iOS Safari and
 * installed PWAs that already run standalone simply skip what they can't do.
 */
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
type KbNav = Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void } };

const doc = document as FsDoc;

export function isFullscreen(): boolean {
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

/** True when the app already fills the screen without the Fullscreen API (installed PWA). */
export function isStandalone(): boolean {
  try { return matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches; } catch { return false; }
}

export function canFullscreen(): boolean {
  const el = document.documentElement as FsEl;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen) && (document.fullscreenEnabled ?? true);
}

/**
 * Must be called from inside a user gesture (click / keydown). Resolves once the browser
 * has settled, never rejects. Locks Escape while fullscreen so a tap of Esc opens our pause
 * menu instead of throwing the player out of fullscreen (holding Esc still exits).
 */
export function enterFullscreen(): Promise<void> {
  if (isFullscreen() || !canFullscreen()) { lockKeys(); return Promise.resolve(); }
  const el = document.documentElement as FsEl;
  try {
    const p = el.requestFullscreen
      ? el.requestFullscreen({ navigationUI: 'hide' })
      : (el.webkitRequestFullscreen?.(), undefined);
    return Promise.resolve(p).then(lockKeys, () => undefined);
  } catch {
    return Promise.resolve();
  }
}

export function exitFullscreen() {
  unlockKeys();
  if (!isFullscreen()) return;
  try {
    if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => undefined);
    else doc.webkitExitFullscreen?.();
  } catch { /* ignore */ }
}

function lockKeys() {
  const kb = (navigator as KbNav).keyboard;
  if (!kb?.lock || !isFullscreen()) return;
  kb.lock(['Escape']).catch(() => undefined);
}

function unlockKeys() {
  try { (navigator as KbNav).keyboard?.unlock?.(); } catch { /* ignore */ }
}
