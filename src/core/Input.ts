/** Keyboard + mouse with pointer lock. Edge-triggered "pressed" sets are cleared each frame. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  lmb = false;
  rmb = false;
  lmbPressed = false;
  rmbPressed = false;
  locked = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  private el: HTMLElement;

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
      // Clamp absurd spikes some browsers emit when pointer lock engages.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
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
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.lmb = this.rmb = false; }
      this.onLockChange?.(this.locked);
    });
  }

  private norm(e: KeyboardEvent) { return e.code; }

  lock() {
    if (this.locked) return;
    const p = this.el.requestPointerLock?.({ unadjustedMovement: true } as any) as unknown as Promise<void> | undefined;
    // Some browsers reject unadjustedMovement; fall back to standard lock.
    if (p && typeof p.catch === 'function') p.catch(() => this.el.requestPointerLock());
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
  }
}
