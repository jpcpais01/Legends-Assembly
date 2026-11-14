import { HEROES } from '../heroes';
import type { HeroId } from '../game/types';
import { MODE_INFO, type Mode } from '../game/Game';
import { portraits } from './portraits';
import { esc, splitName } from './uikit';
import { arenaInfo } from './Menu';
import type { ArenaKind } from '../net/Party';

export interface LoadSeat { name: string; hero: HeroId; me?: boolean; bot?: boolean }

const TIPS = [
  'Headshots deal 50% bonus damage. The gold hit marker tells you you found one.',
  'Health pads restore 150 HP and come back after 12 seconds.',
  'Damage, healing and eliminations all charge your special.',
  'A tie when time runs out goes to sudden-death overtime.',
  'Gravity Well pulls enemies together. Follow it with something big.',
  'Tonka turns wide. Line up the ram before you transform.',
  'Allies inside The Starry Night are healed, so pull the fight into the dome.',
];

/**
 * The versus screen while an arena loads in place: the map art drifting behind both lineups, a progress bar,
 * and (online) who the match is still waiting for.
 */
export class Loading {
  private el: HTMLElement | null = null;

  show(o: { arena: ArenaKind; mode: Mode; teams: [LoadSeat[], LoadSeat[]]; online?: boolean }) {
    this.hide(true);
    const a = arenaInfo(o.arena);
    const info = MODE_INFO[o.mode];
    const seat = (s: LoadSeat, i: number) => {
      const d = HEROES[s.hero];
      const [, last] = splitName(d.name);
      return `<div class="ld-seat${s.me ? ' me' : ''}" style="--hc:${d.color};--i:${i}">
        <span class="ld-av"><img src="${portraits[s.hero] ?? ''}" alt=""></span>
        <b>${esc(s.name)}</b><small>${s.bot ? 'Bot · ' : ''}${last}</small></div>`;
    };
    const el = document.createElement('div');
    el.className = 'loading';
    el.style.setProperty('--mc', a.c);
    el.innerHTML = `
      <div class="ld-bg"><img src="/maps/${o.arena}.webp" alt=""></div>
      <div class="ld-shade"></div>
      <header class="ld-head">
        <small><span class="chip">${o.mode}</span>${info.label}${o.online ? ' · Online' : ''} · First to ${info.target}</small>
        <h1>${a.name}</h1>
        <p>${a.kicker}</p>
      </header>
      <div class="ld-teams">
        <div class="ld-team ally">${o.teams[0].map(seat).join('')}</div>
        <div class="ld-vs">VS</div>
        <div class="ld-team enemy">${o.teams[1].map(seat).join('')}</div>
      </div>
      <footer class="ld-foot">
        <p class="ld-tip">${TIPS[Math.floor(Math.random() * TIPS.length)]}</p>
        <div class="ld-bar"><i></i></div>
        <span class="ld-label">Loading</span>
      </footer>`;
    document.getElementById('ui')!.appendChild(el);
    this.el = el;
    requestAnimationFrame(() => el.classList.add('show'));
  }

  progress(p: number, label?: string) {
    if (!this.el) return;
    (this.el.querySelector('.ld-bar i') as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, p))})`;
    if (label) (this.el.querySelector('.ld-label') as HTMLElement).textContent = label;
  }

  get visible() { return !!this.el; }

  hide(now = false) {
    const el = this.el;
    if (!el) return;
    this.el = null;
    if (now) { el.remove(); return; }
    el.classList.add('out');
    setTimeout(() => el.remove(), 700);
  }
}
