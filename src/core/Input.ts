/** Keyboard + mouse with pointer lock. Edge-triggered "pressed" sets are cleared each frame. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  lmb = false;
  rmb = false;
  lmbPressed = false;
  /** Mouse wheel notches this frame (+1 = scrolled down / toward you). */
  wheel = 0;
  private wheelAcc = 0;
  rmbPressed = false;
  locked = false;
  /** True when the browser gave us raw (unaccelerated) mouse input. */
  rawInput = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  /** The browser refused the lock (no user gesture, or re-locking too soon after Esc). */
  onLockError: (() => void) | null = null;
  private el: HTMLElement;
  private lockedAt = 0;
  private settleEvents = 0;
  private avgMove = 0;
  private pending: Promise<void> | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = this.norm(e);
      if (!this.down.has(k)) this.pressed.add(k);
      this.down.add(k);
      if (this.locked && (k === 'Tab' || k === 'Space' || k === 'ShiftLeft' || k === 'ShiftRight')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.down.delete(this.norm(e)); });
    window.addEventListener('blur', () => { this.down.clear(); this.lmb = this.rmb = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      // The first events after the lock engages often carry the jump from wherever the
      // cursor was to the lock point (and Windows Chrome sends junk for ~1 frame).
      if (this.settleEvents > 0 || performance.now() - this.lockedAt < 70) { this.settleEvents--; return; }
      const mag = Math.abs(dx) + Math.abs(dy);
      // Drop single-event teleports: far beyond anything a hand can do in one event and
      // way out of line with the recent motion. Real fast flicks build up over several
      // events, so the running average lets them through.
      if (mag > 180 && mag > 9 * (this.avgMove + 8)) return;
      this.avgMove += (mag - this.avgMove) * 0.25;
      this.mouseDX += dx;
      this.mouseDY += dy;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.lmb = true; this.lmbPressed = true; }
      if (e.button === 2) { this.rmb = true; this.rmbPressed = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      // trackpads send many small deltas: count a notch per ~50 px, mice send one per click
      this.wheelAcc += e.deltaMode === 0 ? e.deltaY / 50 : e.deltaY;
      const n = Math.trunc(this.wheelAcc);
      if (n) { this.wheel += Math.sign(n); this.wheelAcc = 0; }
    }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.el;
      if (this.locked) { this.lockedAt = performance.now(); this.settleEvents = 2; this.avgMove = 0; }
      else { this.lmb = this.rmb = false; this.down.clear(); }
      this.mouseDX = this.mouseDY = 0;
      if (was !== this.locked) this.onLockChange?.(this.locked);
    });
    // Promise-based browsers report errors through lock(); this covers the legacy API.
    document.addEventListener('pointerlockerror', () => { if (!this.pending) this.onLockError?.(); });
  }

  private norm(e: KeyboardEvent) { return e.code; }

  /**
   * Call from a user gesture. Asks for raw mouse input first (no OS acceleration, which is
   * what makes turning feel "floaty" or inconsistent), and falls back to a normal lock where
   * that isn't supported. Failures surface through onLockError instead of silently leaving
   * the cursor free in a live match.
   */
  lock() {
    if (this.locked || this.pending || !this.el.requestPointerLock) return;
    let p: Promise<void> | undefined;
    try {
      p = this.el.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions) as unknown as Promise<void> | undefined;
    } catch { p = undefined; }
    if (!p || typeof p.then !== 'function') { this.rawInput = false; return; } // legacy: result comes via events
    this.pending = p.then(
      () => { this.rawInput = true; },
      (err: DOMException) => {
        if (this.locked) return;
        // NotSupportedError = no raw input on this platform: retry plain. Anything else
        // (e.g. re-locking too soon after Esc) needs a fresh click.
        if (err?.name === 'NotSupportedError' || (err?.name === 'NotAllowedError' && /unadjusted/i.test(err.message))) {
          this.rawInput = false;
          const q = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
          return q && typeof q.then === 'function' ? q.catch(() => { if (!this.locked) this.onLockError?.(); }) : undefined;
        }
        this.onLockError?.();
      },
    ).finally(() => { this.pending = null; });
  }

  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  isDown(code: string) { return this.down.has(code); }
  wasPressed(code: string) { return this.pressed.has(code); }
  get shift() { return this.down.has('ShiftLeft') || this.down.has('ShiftRight'); }
  get shiftPressed() { return this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight'); }

  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.lmbPressed = false;
    this.rmbPressed = false;
    this.wheel = 0;
  }
}
