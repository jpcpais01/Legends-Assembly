import type { HeroDef } from '../game/types';
import { portraits } from './portraits';
import { esc, splitName } from './uikit';

const TIPS = [
  'Headshots deal 50% bonus damage. The gold hit marker tells you that you found one.',
  'Damage, healing and eliminations all charge your special. It glows when ready.',
  'Hold Tab in a match to see every player.',
  'Hold V to swing the camera round and see your legend from the front.',
  'Health pads restore 150 HP and come back after 12 seconds.',
  'A tie when time runs out goes to sudden-death overtime.',
  'Open a party from Home and send the link: friends join with one click.',
];

/**
 * The opening screen: a cinematic logo reveal over turning gold rays, the roster assembling along the bottom
 * (dark silhouettes that light up once their portraits are painted), real load stages with a percentage, and
 * rotating tips. Pure DOM + CSS so it shows instantly and costs nothing once the game starts.
 */
export class BootScreen {
  private bar: HTMLElement;
  private hint: HTMLElement;
  private pct: HTMLElement;
  private tip: HTMLElement;
  private roster: HTMLElement;
  private tipT = 0;
  private tipI = Math.floor(Math.random() * TIPS.length);
  private shown = 0;
  private raf = 0;

  constructor(readonly el: HTMLElement, heroes: HeroDef[], version: string) {
    this.bar = el.querySelector('.bar i') as HTMLElement;
    this.hint = el.querySelector('.hint') as HTMLElement;
    this.pct = el.querySelector('.bt-pct') as HTMLElement;
    this.tip = el.querySelector('.bt-tip') as HTMLElement;
    this.roster = el.querySelector('.bt-roster') as HTMLElement;
    (el.querySelector('.bt-ver') as HTMLElement).textContent = `v${version}`;
    this.roster.style.setProperty('--n', String(heroes.length));
    this.roster.innerHTML = heroes.map((h, i) => `<div class="bt-card" data-h="${h.id}" style="--hc:${h.color};--i:${i}">
      <span class="bt-av"><img alt=""></span><b>${esc(splitName(h.name)[1])}</b></div>`).join('');
    this.nextTip();
    this.tipT = window.setInterval(() => this.nextTip(), 4200);
  }

  private nextTip() {
    this.tip.classList.remove('in');
    void this.tip.offsetWidth;
    this.tip.textContent = TIPS[this.tipI++ % TIPS.length];
    this.tip.classList.add('in');
  }

  /** Eases the percentage readout toward the bar so it counts up rather than jumping. */
  progress(p: number, label: string) {
    this.bar.style.width = `${p}%`;
    this.hint.textContent = label;
    cancelAnimationFrame(this.raf);
    const from = this.shown, t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 500);
      this.shown = Math.round(from + (p - from) * (1 - (1 - k) ** 3));
      this.pct.firstChild!.textContent = String(this.shown);
      if (k < 1) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Portraits are painted: the roster lights up one by one. */
  revealRoster() {
    this.roster.querySelectorAll<HTMLElement>('.bt-card').forEach((c) => {
      const src = portraits[c.dataset.h as keyof typeof portraits];
      if (src) (c.querySelector('img') as HTMLImageElement).src = src;
      c.classList.add('lit');
    });
  }

  /** Everything is loaded: the bar flares and the call to action pulses. */
  ready(label: string) {
    this.progress(100, label);
    this.el.classList.add('ready');
    this.hint.classList.add('pulse');
  }

  /** The player pressed a key: a gold sweep and the screen lifts away into the menu. */
  leave() {
    clearInterval(this.tipT);
    this.el.classList.add('fade');
    setTimeout(() => this.el.remove(), 1000);
  }
}
