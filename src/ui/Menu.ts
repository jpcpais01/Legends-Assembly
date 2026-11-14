import { HERO_LIST, HEROES } from '../heroes';
import type { HeroDef, HeroId, Role } from '../game/types';
import { MODE_INFO, rollLineup, fixLineup, type Mode, type Lineup } from '../game/Game';
import type { Game } from '../game/Game';
import type { Hero } from '../game/Hero';
import { portraits } from './portraits';
import { settings, saveSettings, type QualityLevel } from '../core/settings';
import { PATCH_NOTES } from '../data/patchNotes';
import { audio } from '../core/Audio';
import { esc, icon, ROLE_ICONS, UI, logoMark, splitName, countUp, mmss } from './uikit';
import { Party, parseCode, inviteLink, type ArenaKind, type Member } from '../net/Party';

const VERSION = PATCH_NOTES[0].version;
const MODES = Object.keys(MODE_INFO) as Mode[];
const DIFFS = ['easy', 'normal', 'hard'] as const;

export interface MenuHooks {
  /** Solo: the arena is picked, load it and play. */
  onStart(mode: Mode, hero: HeroId, lineup: Lineup | undefined, arena: ArenaKind): void;
  /** You joined, opened or left a party. */
  onParty(p: Party | null): void;
  /** Party host: everyone is locked in and the arena is picked. */
  onPartyStart(arena: ArenaKind): void;
  onPreviewHero(hero: HeroId): void;
  /** The Lock In moment itself (the stage flares). */
  onLockIn(hero: HeroId): void;
  onQualityChange(): void;
  onResume(): void;
  /** Fires on the Lock In click itself, while the browser still counts it as a user gesture. */
  /** Go fullscreen (from a user gesture); `lockMouse` also captures the cursor. */
  onEngage(lockMouse: boolean): void;
  onLeave(): void;
}

/** Where the menu wants the showcase camera. main.ts eases toward it every frame. */
export interface MenuCam { dist: number; side: number; look: number; height: number }
const CAMS: Record<'home' | 'select' | 'page', MenuCam> = {
  home: { dist: 6.1, side: 0, look: 1.62, height: 2.15 },
  select: { dist: 4.1, side: -0.05, look: 1.85, height: 1.95 },
  page: { dist: 7.4, side: 2.3, look: 1.95, height: 2.3 },
};
const ROLES: Role[] = ['Vanguard', 'Duelist', 'Strategist'];

export const ARENAS: { id: ArenaKind; name: string; kicker: string; desc: string; c: string }[] = [
  { id: 'study', name: "Giant's Study", kicker: 'Desk · Close quarters', desc: 'Shrunk down on a scholar’s desk. Fight between ink pots, pencils and a ticking pocket watch.', c: '#ffb45a' },
  { id: 'museum', name: 'Grand Museum', kicker: 'Marble halls · Long sightlines', desc: 'A sunlit rotunda of marble and gold. Statues for cover, galleries for flanks.', c: '#9fd2ff' },
];
export const arenaInfo = (id: ArenaKind) => ARENAS.find((a) => a.id === id) ?? ARENAS[0];

type Page = 'home' | 'legends' | 'learn' | 'news' | 'settings' | 'select' | 'map';
const TABS: { id: Page; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'legends', label: 'Legends' },
  { id: 'learn', label: 'Learn' },
  { id: 'news', label: 'News' },
  { id: 'settings', label: 'Settings' },
];

const MODE_COPY: Record<Mode, { desc: string; art: HeroId[]; c1: string; c2: string }> = {
  '1v1': { desc: 'Just you and one rival legend. Pure skill, nowhere to hide.', art: ['yeat'], c1: '#ff3d7f', c2: '#2a0718' },
  '2v2': { desc: 'Team up with one partner. Timing and combos decide every fight.', art: ['vangogh'], c1: '#ffb21a', c2: '#2b1a03' },
  '3v3': { desc: 'The classic. Three legends a side, and every role matters.', art: ['einstein'], c1: '#5cc8ff', c2: '#061f33' },
  '5v5': { desc: 'Ten legends, total chaos. Specials light up the sky every few seconds.', art: ['yeat', 'einstein', 'vangogh'], c1: '#a77bff', c2: '#150b33' },
};

const HERO_TIPS: Record<HeroId, string[]> = {
  einstein: [
    'Throw Gravity Well first, then fire E = mc² while enemies are pulled together.',
    'Photon Burst flies fast and straight. Track heads for 50% bonus damage.',
    'You are fragile. Fight from mid range and let your team take the front.',
  ],
  yeat: [
    'Bell Ring hits hardest up close. Use Tonka to crash into range.',
    'Tonka turns wide. Line up the ram before you transform.',
    'The Bell tracks for a moment. Cast it on enemies already busy fighting.',
  ],
  ironman: [
    'Hold jump in the air to hover on your jet boots. Shooting from above is hard to punish.',
    'Missile Swarm locks onto the enemy nearest your crosshair, so point first, then fire.',
    'Unibeam sweeps slowly. Fire it down a corridor or at a crowd, then drag it across them.',
  ],
  luffy: [
    'Gum-Gum Pistol reaches whatever you aim at, up to 21 m. It is fast, so track heads.',
    'Gum-Gum Rocket grabs walls as well as enemies. Use it to dive in or to escape.',
    'Gear Fifth refreshes your Rocket. Awaken next to a group: the blast shoves them away.',
  ],
  vangogh: [
    'Drop Sunflower Field where your team is fighting, not where they will be.',
    'Impasto Shot splashes. Aim at feet and walls to hit groups.',
    'Allies inside The Starry Night are healed, so pull fights into the dome.',
  ],
  mickey: [
    'Spud Shot lobs onto the crosshair. Aim at heads for a bonk, or at the floor in front of a group for the bounce.',
    'Portable Hole is an escape and an opener: pop out right under an enemy to bonk them into the air.',
    'Steamboat Willie runs straight down your crosshair. Line it up along a corridor full of enemies.',
  ],
  trex: [
    'Bites heal you. Stay in the brawl: every third swing is a tail sweep that clears everyone around you.',
    'Stampede into an enemy standing in front of a wall: the crash hits them again and stuns them longer.',
    'Extinction Event terrifies only what is in front of you. Face the crowd before you roar.',
  ],
  blitzcrank: [
    'A caught enemy primes your uppercut: grab, then punch once to launch them.',
    'Grab the enemy who is out of position, not the one in front of their team.',
    'Static Field silences. Pop it before their specials go off, not after.',
  ],
};

const QUALITY_COPY: Record<QualityLevel, string> = {
  low: 'Fastest. Lighter grass, simpler shadows.',
  medium: 'Balanced for most laptops.',
  high: 'Dense grass and soft shadows.',
  ultra: 'Everything maxed. For strong GPUs.',
};

const CROSSHAIR_COLORS = ['#ffffff', '#5dffa0', '#ffe14d', '#3fe0ff', '#ff4dd2', '#ff4d4d'];

const stored = <T extends string>(k: string) => { try { return localStorage.getItem(k) as T | null; } catch { return null; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export class Menu {
  root: HTMLDivElement;
  hero: HeroId = 'einstein';
  /** Showcase camera target for the current page. */
  cam: MenuCam = CAMS.home;
  private hooks: MenuHooks;
  private mode: Mode = '3v3';
  private page: Page = 'home';
  private pageHost: HTMLElement;
  private tabsEl: HTMLElement;
  private ink: HTMLElement;
  private hintsEl: HTMLElement;
  private visible = false;
  private locking = false;
  private overlay: HTMLElement | null = null;
  private pauseEl: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private resultsHandlers: { again: () => void; menu: () => void } | null = null;
  private g: Game | null = null;
  private settingsCat = 'graphics';
  /** Bot picks for the match being set up (rolled on hero select so the team panel can show them). */
  private lineup: Lineup | null = null;
  /** The friends party you're in (null = solo). */
  party: Party | null = null;
  private partyBusy = false;
  private toastEl: HTMLElement | null = null;
  private toastT = 0;

  constructor(parent: HTMLElement, hooks: MenuHooks) {
    this.hooks = hooks;
    const saved = stored<HeroId>('la:lastHero');
    if (saved && HEROES[saved]) this.hero = saved;
    const savedMode = stored<Mode>('la:lastMode');
    if (savedMode && MODE_INFO[savedMode]) this.mode = savedMode;

    this.root = document.createElement('div');
    this.root.className = 'menu hidden';
    this.root.innerHTML = `
      <div class="m-shade"></div>
      <header class="m-top">
        <div class="brand">${logoMark()}<div class="wm"><b>Legends</b><span>Assembly</span></div></div>
        <nav class="tabs">${TABS.map((t) => `<button class="tab" data-p="${t.id}">${t.label}</button>`).join('')}<i class="tab-ink"></i></nav>
        <div class="m-status">
          <div class="prof"><div><b class="me-name"></b><small class="me-main"></small></div><span class="me-av"><img alt=""></span></div>
        </div>
      </header>
      <main class="m-host"></main>
      <footer class="m-foot"><button class="m-ver" data-hover>${icon(UI.spark)}<b>What's new</b><span>v${VERSION} · ${esc(PATCH_NOTES[0].title)}</span></button><span class="m-hints"></span></footer>`;
    parent.appendChild(this.root);
    this.pageHost = this.root.querySelector('.m-host') as HTMLElement;
    this.tabsEl = this.root.querySelector('.tabs') as HTMLElement;
    this.ink = this.root.querySelector('.tab-ink') as HTMLElement;
    this.hintsEl = this.root.querySelector('.m-hints') as HTMLElement;
    this.root.querySelector('.m-ver')!.addEventListener('click', () => { audio.play('uiTab'); this.go('news'); });

    this.tabsEl.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => {
      b.addEventListener('mouseenter', () => audio.play('uiHover'));
      b.addEventListener('click', () => { if (this.page !== b.dataset.p) { audio.play('uiTab'); this.go(b.dataset.p as Page); } });
    });
    // Mouse clicks shouldn't leave sticky focus rings; keyboard focus still shows them.
    document.addEventListener('click', (e) => {
      if (e.detail > 0) (e.target as HTMLElement | null)?.closest?.('button')?.blur();
    }, true);
    document.addEventListener('mouseover', (e) => {
      const b = (e.target as HTMLElement | null)?.closest?.('[data-hover]');
      if (b && !b.contains(e.relatedTarget as Node | null)) audio.play('uiHover');
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('resize', () => this.placeInk());
    document.fonts?.ready.then(() => this.placeInk());
    this.applyHeroTint();
    this.refreshProfile();
  }

  // ───────────────────────── visibility & navigation ─────────────────────────

  show(on: boolean) {
    this.visible = on;
    this.root.classList.toggle('hidden', !on);
    if (on) {
      this.locking = false;
      this.go('home', true);
      this.partySync();
    }
  }

  /** Kept for main.ts: closes in-game overlays (settings / learn). */
  closePanel() { this.closeOverlay(); }

  get lastMode() { return this.mode; }

  private refreshProfile() {
    const d = HEROES[this.hero];
    (this.root.querySelector('.me-av img') as HTMLImageElement).src = portraits[d.id] ?? '';
    (this.root.querySelector('.me-name') as HTMLElement).textContent = settings.playerName;
    (this.root.querySelector('.me-main') as HTMLElement).textContent = `Main · ${d.name}`;
  }

  private applyHeroTint() {
    const d = HEROES[this.hero];
    this.root.style.setProperty('--hc', d.color);
    this.root.style.setProperty('--ha', d.accent);
  }

  private go(p: Page, force = false) {
    if (p === this.page && !force && this.pageHost.firstElementChild) return;
    this.page = p;
    this.root.dataset.page = p;
    this.cam = p === 'home' ? CAMS.home : p === 'select' || p === 'legends' ? CAMS.select : CAMS.page;
    if (p !== 'select' && p !== 'map') this.locking = false;
    this.tabsEl.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.classList.toggle('on', t.dataset.p === p));
    const el = document.createElement('section');
    el.className = `page pg-${p}`;
    this.pageHost.replaceChildren(el);
    if (p === 'home') this.renderHome(el);
    else if (p === 'legends' || p === 'select') this.renderSelect(el, p === 'select');
    else if (p === 'learn') this.renderLearn(el);
    else if (p === 'news') this.renderNews(el);
    else if (p === 'settings') this.renderSettings(el);
    else if (p === 'map') this.renderMap(el);
    this.renderHints();
    this.placeInk();
    if (p !== 'select' && p !== 'map') { this.revealTimers.forEach(clearTimeout); this.lineup = p === 'home' ? this.lineup : null; }
    // hook for menu music and ambience: listeners can follow which page is up and which legend is showcased
    window.dispatchEvent(new CustomEvent('la:menu', { detail: { page: p, hero: this.hero } }));
  }

  private placeInk() {
    requestAnimationFrame(() => {
      const on = this.tabsEl.querySelector<HTMLElement>('.tab.on');
      if (!on) { this.ink.style.opacity = '0'; return; }
      this.ink.style.opacity = '1';
      this.ink.style.width = `${on.offsetWidth}px`;
      this.ink.style.transform = `translateX(${on.offsetLeft}px)`;
    });
  }

  private renderHints() {
    const h = (k: string, t: string) => `<span><kbd>${k}</kbd>${t}</span>`;
    const p = this.page;
    let html = '';
    if (p === 'home') html = h('Enter', 'Play') + h('↑ ↓', 'Mode') + h('L', 'Legend') + h('Q E', 'Tabs');
    else if (p === 'select') html = h('Enter', 'Lock in') + h('A D', 'Legend') + h('Esc', 'Back');
    else if (p === 'map') html = h('A D', 'Arena') + h('Enter', 'Play') + h('Esc', 'Back');
    else if (p === 'legends') html = h('A D', 'Legend') + h('Enter', 'Play') + h('Q E', 'Tabs') + h('Esc', 'Home');
    else html = h('Q E', 'Tabs') + h('Esc', 'Home');
    this.hintsEl.innerHTML = html;
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text') {
      if (e.code === 'Escape' || e.code === 'Enter') t.blur();
      return;
    }
    if (this.overlay) {
      if (e.code === 'Escape') { e.preventDefault(); this.closeOverlay(); }
      return;
    }
    if (this.resultsEl && this.resultsHandlers && e.code === 'Enter') { this.resultsHandlers.again(); return; }
    if (!this.visible || (this.locking && this.page !== 'map')) return;
    const onButton = document.activeElement instanceof HTMLButtonElement;
    const p = this.page;
    if (p === 'map') { this.mapKey(e, onButton); return; }
    if ((e.code === 'KeyQ' || e.code === 'KeyE') && p !== 'select') {
      const i = TABS.findIndex((x) => x.id === p);
      const n = TABS[(i + (e.code === 'KeyE' ? 1 : TABS.length - 1)) % TABS.length];
      audio.play('uiTab');
      this.go(n.id);
      return;
    }
    if (e.code === 'Escape') {
      if (p === 'select' && this.party) { this.partyBack(); return; }
      if (p !== 'home') { audio.play('uiBack'); this.go('home'); }
      return;
    }
    const dir = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : 0;
    const vdir = e.code === 'ArrowUp' ? -1 : e.code === 'ArrowDown' ? 1 : 0;
    if ((vdir || (dir && !e.code.startsWith('Key'))) && p === 'home') {
      e.preventDefault();
      const i = MODES.indexOf(this.mode);
      this.setMode(MODES[(i + (vdir || dir) + MODES.length) % MODES.length]);
      return;
    }
    if (e.code === 'KeyL' && p === 'home') { audio.play('uiTab'); this.go('legends'); return; }
    if (dir && (p === 'select' || p === 'legends')) {
      const i = HERO_LIST.findIndex((h) => h.id === this.hero);
      this.setHero(HERO_LIST[(i + dir + HERO_LIST.length) % HERO_LIST.length].id);
      return;
    }
    if (e.code === 'Enter' && !onButton) {
      if (p === 'home') this.play();
      else if (p === 'select') this.lockIn();
      else if (p === 'legends') { audio.play('ui'); this.go('select'); }
    }
  }

  // ───────────────────────── home ─────────────────────────
  // Three anchored zones around the legend on the stage: game modes on the left, news top right,
  // match options + Play bottom right, and your legend's nameplate under the stage.

  private renderHome(el: HTMLElement) {
    const n = PATCH_NOTES[0];
    el.innerHTML = `
      <aside class="h-modes">
        <div class="sec-h"><b>Game modes</b><span>${this.party ? 'party · bots fill' : 'vs bots'}</span></div>
        <div class="modes" role="listbox" aria-label="Game mode">${MODES.map((m) => this.modeCard(m)).join('')}</div>
      </aside>
      <div class="h-side">
        <button class="h-news" data-hover>
          <span class="hn-k">${icon(UI.spark)}What's new <i>v${n.version}</i></span>
          <b>${esc(n.title)}</b>
          <small>${esc(n.sections[0]?.heading ?? '')}</small>
          <span class="hn-go">Patch notes ${icon(UI.arrowR)}</span>
        </button>
        <div class="h-party"></div>
      </div>
      <div class="h-legend"></div>
      <div class="h-play"></div>`;
    el.querySelectorAll<HTMLButtonElement>('.mcard').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.m as Mode)));
    el.querySelector('.h-news')!.addEventListener('click', () => { audio.play('uiTab'); this.go('news'); });
    this.renderHomePlay(el);
    this.renderSpot(el);
    this.renderParty(el);
  }

  /** Home → hero select. In a party only the host starts it, and it takes everyone along. */
  private play() {
    const p = this.party;
    if (p && !p.isHost) { audio.play('denied'); this.toast('The party host starts the match'); return; }
    audio.play('ui');
    if (p) p.setPhase('select');
    else this.go('select');
  }

  // ───────────────────────── party (play with friends) ─────────────────────────

  private renderParty(el: HTMLElement) {
    const box = el.querySelector('.h-party') as HTMLElement | null;
    if (!box) return;
    const p = this.party;
    el.classList.toggle('in-party', !!p);
    if (!p) {
      box.innerHTML = `
        <div class="pt-h">${icon(UI.users)}<b>Play with friends</b></div>
        <p class="pt-sub">Open a party, send the link, pick teams. Bots fill every empty seat.</p>
        <button class="pt-create" data-hover>${icon(UI.link)}<span>Create party</span></button>
        <form class="pt-join"><input class="txt" maxlength="40" placeholder="Party code" spellcheck="false" autocomplete="off" aria-label="Party code"><button data-hover>Join</button></form>`;
      box.querySelector('.pt-create')!.addEventListener('click', () => void this.hostParty());
      const form = box.querySelector('.pt-join') as HTMLFormElement;
      form.addEventListener('submit', (e) => { e.preventDefault(); void this.joinParty((form.querySelector('input') as HTMLInputElement).value); });
      return;
    }
    const st = p.state;
    const size = MODE_INFO[st.mode].size;
    const row = (m: Member) => `<div class="pm${m.id === p.selfId ? ' me' : ''}" style="--hc:${HEROES[m.hero].color}">
        <span class="pm-av"><img src="${portraits[m.hero] ?? ''}" alt=""></span>
        <span class="pm-tx"><b>${esc(m.name)}${m.host ? `<i title="Party host">${icon(UI.crown)}</i>` : ''}</b><small>${HEROES[m.hero].name}</small></span>
        <span class="pm-team t${m.team === (p.me?.team ?? 0) ? 'a' : 'e'}">${m.team === (p.me?.team ?? 0) ? 'Ally' : 'Enemy'}</span>
        ${p.isHost && m.id !== p.selfId ? `<button class="pm-kick" data-kick="${m.id}" title="Remove from party" aria-label="Remove ${esc(m.name)}">${icon(UI.close)}</button>` : ''}
      </div>`;
    box.innerHTML = `
      <div class="pt-h">${icon(UI.users)}<b>Party</b><span class="pt-n">${st.members.length} / ${size * 2}</span></div>
      <button class="pt-code" data-hover title="Copy invite link"><small>Code</small><b>${p.code}</b><span>${icon(UI.link)}Copy invite link</span></button>
      <div class="pt-list">${st.members.map(row).join('')}</div>
      <p class="pt-sub">${p.isHost ? `You host: pick the mode, then Play. ${size * 2 - st.members.length} bot${size * 2 - st.members.length === 1 ? '' : 's'} fill the rest.` : 'The host picks the mode and starts the match.'}</p>
      <button class="pt-leave" data-hover>${icon(UI.exit)}Leave party</button>`;
    box.querySelector('.pt-code')!.addEventListener('click', () => this.copyInvite());
    box.querySelector('.pt-leave')!.addEventListener('click', () => { audio.play('uiBack'); this.leaveParty(); });
    box.querySelectorAll<HTMLButtonElement>('[data-kick]').forEach((b) => b.addEventListener('click', () => { audio.play('uiBack'); p.kick(b.dataset.kick!); }));
  }

  private copyInvite() {
    const p = this.party;
    if (!p) return;
    const link = inviteLink(p.code);
    audio.play('ui');
    const done = () => this.toast(`Invite link copied. Code ${p.code}`);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, () => this.toast(link));
    else this.toast(link);
  }

  async hostParty() {
    if (this.party || this.partyBusy) return;
    this.partyBusy = true;
    audio.play('ui');
    this.toast('Opening a party…');
    try {
      this.attachParty(await Party.host(settings.playerName || 'Player', this.hero, this.mode, settings.botDifficulty));
      this.copyInvite();
    } catch (e) {
      this.toast((e as Error).message || 'Could not open a party', true);
    } finally { this.partyBusy = false; }
  }

  async joinParty(text: string) {
    if (this.partyBusy) return;
    const code = parseCode(text);
    if (!code) { audio.play('denied'); this.toast('Party codes are 5 letters, like K7QXP', true); return; }
    if (this.party) this.leaveParty(true);
    this.partyBusy = true;
    audio.play('ui');
    this.toast(`Joining party ${code}…`);
    try {
      this.attachParty(await Party.join(code, settings.playerName || 'Player', this.hero));
      audio.play('lockIn');
      this.toast(`Joined ${this.party!.state.members.find((m) => m.host)?.name ?? 'the'}'s party`);
    } catch (e) {
      this.toast((e as Error).message || 'Could not join that party', true);
    } finally { this.partyBusy = false; }
  }

  private attachParty(p: Party) {
    this.party = p;
    const names = new Set(p.state.members.map((m) => m.id));
    p.onState = (st) => {
      for (const m of st.members) if (!names.has(m.id)) { names.add(m.id); if (m.id !== p.selfId) { audio.play('uiTab'); this.toast(`${m.name} joined the party`); } }
      for (const id of [...names]) if (!st.members.some((m) => m.id === id)) names.delete(id);
      this.partySync();
    };
    p.onLeft = (_id, name) => this.toast(`${name} left the party`);
    p.onClose = (why) => { this.party = null; this.hooks.onParty(null); this.toast(why, true); if (this.visible) this.go('home', true); };
    this.hooks.onParty(p);
    this.partySync();
  }

  leaveParty(quiet = false) {
    const p = this.party;
    if (!p) return;
    p.onClose = null;
    p.leave();
    this.party = null;
    this.hooks.onParty(null);
    if (!quiet) this.toast(p.isHost ? 'Party closed' : 'You left the party');
    if (this.visible) this.go('home', true);
  }

  /** Follow the party: its mode and difficulty, which screen everyone is on, who picked what. */
  partySync() {
    const p = this.party;
    if (!p) return;
    const st = p.state;
    if (st.mode !== this.mode) { this.mode = st.mode; this.lineup = null; }
    if (st.diff !== settings.botDifficulty) settings.botDifficulty = st.diff;
    const me = p.me;
    if (me && me.hero !== this.hero && !p.isHost) { /* our pick is ours: the host's copy catches up */ }
    if (!this.visible) return;
    const want: Page | null = st.phase === 'select' ? 'select' : st.phase === 'map' ? 'map' : st.phase === 'lobby' && (this.page === 'select' || this.page === 'map') ? 'home' : null;
    if (want && want !== this.page) { this.locking = false; this.go(want); return; }
    const el = this.pageHost.firstElementChild as HTMLElement | null;
    if (!el) return;
    if (this.page === 'home') { this.renderParty(el); const tag = el.querySelector('.h-modes .sec-h span'); if (tag) tag.textContent = 'party · bots fill'; el.querySelectorAll<HTMLElement>('.mcard').forEach((t) => t.classList.toggle('on', t.dataset.m === this.mode)); this.renderHomePlay(el); }
    else if (this.page === 'select') this.renderPartyTeams(el);
    else if (this.page === 'map') this.renderMap(el);
    // the host moves everyone on once every player has locked in
    if (p.isHost && st.phase === 'select' && st.members.every((m) => m.ready)) setTimeout(() => { if (this.party === p && p.state.phase === 'select' && p.state.members.every((m) => m.ready)) p.setPhase('map'); }, 900);
  }

  private partyBack() {
    const p = this.party!;
    audio.play('uiBack');
    if (p.isHost) p.setPhase('lobby');
    else if (p.me?.ready) { p.setMine({ ready: false }); this.locking = false; this.renderPartyTeams(this.pageHost.firstElementChild as HTMLElement); }
    else this.toast('Only the host can leave hero select. Leave the party from Home');
  }

  toast(text: string, bad = false) {
    if (!this.toastEl) {
      this.toastEl = document.createElement('div');
      this.toastEl.className = 'm-toast';
      document.getElementById('ui')!.appendChild(this.toastEl);
    }
    const t = this.toastEl;
    t.textContent = text;
    t.classList.toggle('bad', bad);
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => t.classList.remove('show'), bad ? 5200 : 3200);
  }

  private modeCard(m: Mode) {
    const c = MODE_COPY[m];
    const info = MODE_INFO[m];
    const art = c.art.map((h, i) => `<img src="${portraits[h] ?? ''}" alt="" style="--i:${i};--n:${c.art.length}">`).join('');
    return `<button class="mcard${m === this.mode ? ' on' : ''}" data-m="${m}" data-hover role="option" style="--c1:${c.c1};--c2:${c.c2}">
      <span class="mc-art">${art}</span>
      <span class="mc-num">${m}</span>
      <span class="mc-tx"><b>${info.label}</b><small>First to ${info.target} · ${info.size} per team</small></span>
      <span class="mc-desc">${c.desc}</span>
    </button>`;
  }

  private setMode(m: Mode) {
    if (m === this.mode) return;
    const p = this.party;
    if (p && !p.isHost) { audio.play('denied'); this.toast('The party host picks the mode'); return; }
    if (p && !p.canMode(m)) { audio.play('denied'); this.toast(`Too many players for ${m}`); return; }
    audio.play('ui');
    if (p) p.setMode(m);
    this.mode = m;
    store('la:lastMode', m);
    this.lineup = null;
    const el = this.pageHost.querySelector('.pg-home') as HTMLElement | null;
    if (!el) return;
    el.querySelectorAll<HTMLElement>('.mcard').forEach((t) => t.classList.toggle('on', t.dataset.m === m));
    this.renderHomePlay(el);
  }

  private renderHomePlay(el: HTMLElement) {
    const info = MODE_INFO[this.mode];
    const c = MODE_COPY[this.mode];
    const main = el.querySelector('.h-play') as HTMLElement;
    main.style.setProperty('--mc', c.c1);
    const p = this.party;
    const guest = !!p && !p.isHost;
    const sub = p ? `Party · ${p.state.members.length} player${p.state.members.length > 1 ? 's' : ''}` : `${info.label} · ${settings.botDifficulty} bots`;
    main.innerHTML = `
      <div class="hp-opts">
        <div class="opt${guest ? ' ro' : ''}"><small>${icon(UI.bot)}Bot skill</small>
          <div class="seg">${DIFFS.map((d) => `<button data-d="${d}" class="${settings.botDifficulty === d ? 'on' : ''}">${d}</button>`).join('')}</div>
        </div>
      </div>
      <button class="btn-play${guest ? ' wait' : ''}" data-hover>
        <span class="bp-t"><b>${guest ? 'Waiting' : 'Play'}</b><small><span class="chip">${this.mode}</span>${guest ? 'The host starts the match' : sub}</small></span>
        <span class="bp-ic">${icon(guest ? UI.clock : UI.play)}</span>
        ${guest ? '' : '<kbd>Enter</kbd>'}
      </button>`;
    main.querySelector('.btn-play')!.addEventListener('click', () => this.play());
    if (guest) main.querySelectorAll<HTMLButtonElement>('.seg [data-d]').forEach((b) => b.addEventListener('click', () => { audio.play('denied'); this.toast('The party host picks the bot skill'); }));
    else this.bindDiff(main, () => { this.party?.setDiff(settings.botDifficulty); this.renderHomePlay(el); });
  }

  private bindDiff(scope: HTMLElement, after?: () => void) {
    scope.querySelectorAll<HTMLButtonElement>('.seg [data-d]').forEach((b) => b.addEventListener('click', () => {
      audio.play('ui');
      settings.botDifficulty = b.dataset.d as typeof settings.botDifficulty;
      saveSettings(settings);
      scope.querySelectorAll('.seg [data-d]').forEach((x) => x.classList.toggle('on', x === b));
      after?.();
    }));
  }

  /** Your legend's nameplate under the stage, with a shortcut to change it. */
  private renderSpot(el: HTMLElement) {
    const spot = el.querySelector('.h-legend') as HTMLElement | null;
    if (!spot) return;
    const d = HEROES[this.hero];
    const [first, last] = splitName(d.name);
    spot.innerHTML = `<div class="hl-role">${icon(ROLE_ICONS[d.role])}${d.role}<i></i>${d.title}</div>
      <h2>${first ? `<small>${first}</small>` : ''}${last}</h2>
      <button class="hl-change" data-hover><kbd>L</kbd>Change legend</button>`;
    spot.classList.remove('swap'); void spot.offsetWidth; spot.classList.add('swap');
    spot.querySelector('.hl-change')!.addEventListener('click', () => { audio.play('uiTab'); this.go('legends'); });
  }

  // ───────────────────────── hero select ─────────────────────────
  // Hero-shooter layout: your team down the left, the legend big on the stage in the middle, their kit on
  // the right, the roster grouped by role along the bottom and Lock In bottom right.

  private renderSelect(el: HTMLElement, forPlay: boolean) {
    const info = MODE_INFO[this.mode];
    const party = forPlay ? this.party : null;
    el.classList.toggle('for-play', forPlay);
    el.classList.toggle('in-party', !!party);
    if (forPlay && !party && !this.lineup) this.lineup = rollLineup(this.mode, this.hero);
    if (forPlay && !party && this.lineup) fixLineup(this.lineup, this.mode, this.hero);
    if (party && party.me && party.me.hero !== this.hero) party.setMine({ hero: this.hero });
    el.innerHTML = `
      <header class="sel-top">
        ${forPlay ? `<button class="back" data-hover>${icon(UI.back)}<kbd>Esc</kbd></button>` : ''}
        <div class="st-tx">
          <small>${forPlay ? `<span class="chip">${this.mode}</span>${info.label} · ${party ? `party of ${party.state.members.length} · ` : ''}${settings.botDifficulty} bots` : 'Roster'}</small>
          <h2>${forPlay ? 'Choose your legend' : 'Legends'}</h2>
        </div>
      </header>
      <aside class="sel-team">${party ? '' : forPlay ? this.teamHtml() : this.tipsHtml()}</aside>
      <aside class="sel-info"></aside>
      <div class="sel-bottom">
        <div class="roster" role="listbox" aria-label="Legends">${ROLES.map((r) => this.rosterGroup(r)).join('')}</div>
        <button class="btn-lock" data-hover><span class="bl-t">${forPlay ? 'Lock in' : 'Play'}</span><small class="bl-s"></small><kbd>Enter</kbd></button>
      </div>
      <div class="lock-fx"><i></i><i class="l2"></i><b class="lock-name"></b><span>${icon(UI.check)}Locked in</span></div>`;
    el.querySelector('.back')?.addEventListener('click', () => { if (this.party) this.partyBack(); else { audio.play('uiBack'); this.go('home'); } });
    el.querySelectorAll<HTMLButtonElement>('.rc[data-h]').forEach((b) => b.addEventListener('click', () => this.setHero(b.dataset.h as HeroId)));
    el.querySelectorAll<HTMLButtonElement>('.rc.locked').forEach((b) => b.addEventListener('click', () => audio.play('denied')));
    el.querySelector('.btn-lock')!.addEventListener('click', () => (forPlay ? this.lockIn() : (audio.play('ui'), this.go('select'))));
    this.renderSelInfo(el);
    if (party) this.renderPartyTeams(el);
    else if (forPlay) this.revealTeam(el);
  }

  /** Party hero select: both teams with every player's live pick, bots in the empty seats, a team switch. */
  private renderPartyTeams(el: HTMLElement) {
    const p = this.party;
    const box = el.querySelector('.sel-team') as HTMLElement | null;
    if (!p || !box || !el.classList.contains('for-play')) return;
    const st = p.state;
    const size = MODE_INFO[st.mode].size;
    const mine = p.me?.team ?? 0;
    const slot = (m: Member | null, i: number) => {
      if (!m) return `<div class="ts bot-seat" style="--i:${i}"><span class="ts-av">${icon(UI.bot)}</span><span class="ts-tx"><b>Bot</b><small><span class="ts-h">Picks at the start</span></small></span></div>`;
      const d = HEROES[m.id === p.selfId ? this.hero : m.hero];
      return `<div class="ts${m.id === p.selfId ? ' me' : ''}${m.ready ? ' rdy' : ' choosing'}" style="--hc:${d.color};--i:${i}">
        <span class="ts-av"><img src="${portraits[d.id] ?? ''}" alt=""></span>
        <span class="ts-tx"><b>${esc(m.name)}${m.host ? `<i class="ts-crown">${icon(UI.crown)}</i>` : ''}</b><small><span class="ts-h">${d.name}</span></small></span>
        <span class="ts-st">${m.ready ? icon(UI.check) : '<i class="ts-dots"><i></i><i></i><i></i></i>'}</span></div>`;
    };
    const team = (t: number) => {
      const on = st.members.filter((m) => m.team === t);
      return [...on.map((m, i) => slot(m, i)), ...Array.from({ length: Math.max(0, size - on.length) }, (_, i) => slot(null, on.length + i))].join('');
    };
    const full = st.members.filter((m) => m.team !== mine).length >= size;
    const waiting = st.members.filter((m) => !m.ready).length;
    box.innerHTML = `<div class="sec-h"><b>Your team</b><span>${st.mode}</span></div>
      <div class="ts-list">${team(mine)}</div>
      <div class="sec-h foe"><b>Enemy team</b><span>${st.members.filter((m) => m.team !== mine).length} player${st.members.filter((m) => m.team !== mine).length === 1 ? '' : 's'}</span></div>
      <div class="ts-list foe">${team(1 - mine)}</div>
      <button class="pt-swap" data-hover ${full || p.me?.ready ? 'disabled' : ''}>${icon(UI.swap)}${full ? 'Enemy team is full' : 'Switch team'}</button>`;
    box.querySelector('.pt-swap')?.addEventListener('click', () => { audio.play('ui'); p.setMine({ team: 1 - mine }); });
    const btn = el.querySelector('.btn-lock') as HTMLElement | null;
    const ready = !!p.me?.ready;
    el.classList.toggle('is-ready', ready);
    if (btn) {
      (btn.querySelector('.bl-t') as HTMLElement).textContent = ready ? 'Locked' : 'Lock in';
      (btn.querySelector('.bl-s') as HTMLElement).textContent = ready ? (waiting ? `Waiting for ${waiting} player${waiting > 1 ? 's' : ''} · Esc to change` : 'Everyone is in') : `as ${splitName(HEROES[this.hero].name)[1]}`;
    }
  }

  private rosterGroup(role: Role) {
    const list = HERO_LIST.filter((h) => h.role === role);
    return `<div class="rg" style="--n:${list.length + 1}">
      <div class="rg-h">${icon(ROLE_ICONS[role])}${role}</div>
      <div class="rg-row">${list.map((h) => this.rosterCard(h)).join('')}
        <button class="rc locked" aria-label="New ${role} coming soon"><span class="rc-in">${icon(UI.lock)}</span><span class="rc-name">Soon</span></button>
      </div></div>`;
  }

  private rosterCard(h: HeroDef) {
    const [, last] = splitName(h.name);
    return `<button class="rc${h.id === this.hero ? ' on' : ''}" data-h="${h.id}" data-hover role="option" style="--hc:${h.color}">
      <span class="rc-in"><img src="${portraits[h.id] ?? ''}" alt=""></span>
      <span class="rc-name">${last}</span></button>`;
  }

  private teamHtml() {
    const info = MODE_INFO[this.mode];
    const allies = this.lineup?.[0] ?? [];
    const me = HEROES[this.hero];
    const slot = (name: string, d: HeroDef, cls: string, i: number) => `<div class="ts ${cls}" data-i="${i}" style="--hc:${d.color};--i:${i}">
      <span class="ts-av"><img src="${portraits[d.id] ?? ''}" alt=""></span>
      <span class="ts-tx"><b>${esc(name)}</b><small><span class="ts-h">${d.name}</span><span class="ts-wait">Selecting<i>.</i><i>.</i><i>.</i></span></small></span>
      <span class="ts-st">${icon(UI.check)}</span></div>`;
    return `<div class="sec-h"><b>Your team</b><span>${this.mode}</span></div>
      <div class="ts-list">
        ${slot(settings.playerName || 'You', me, 'me', 0)}
        ${allies.map((a, i) => slot(a.name, HEROES[a.id], 'bot pending', i + 1)).join('')}
      </div>
      <div class="sel-foe">${icon(UI.users)}<span>Enemy team · ${info.size} legend${info.size > 1 ? 's' : ''}<small>Revealed when the match starts</small></span></div>`;
  }

  private tipsHtml() {
    const d = HEROES[this.hero];
    return `<div class="sec-h"><b>How to play</b><span>${splitName(d.name)[1]}</span></div>
      <div class="sel-tips">${HERO_TIPS[d.id].map((t, i) => `<p style="--i:${i}"><b>${i + 1}</b>${t}</p>`).join('')}</div>`;
  }

  private revealTimers: number[] = [];
  /** Bots "pick" one after another, like teammates locking in around you. */
  private revealTeam(el: HTMLElement) {
    this.revealTimers.forEach(clearTimeout);
    this.revealTimers = [];
    el.querySelectorAll<HTMLElement>('.ts.bot').forEach((s, i) => {
      this.revealTimers.push(window.setTimeout(() => {
        s.classList.remove('pending');
        s.classList.add('picked');
        audio.play('uiHover');
      }, 700 + i * 520 + Math.random() * 250));
    });
  }

  private setHero(id: HeroId) {
    if (id === this.hero) return;
    audio.play('ui');
    this.hero = id;
    store('la:lastHero', id);
    this.applyHeroTint();
    this.refreshProfile();
    this.hooks.onPreviewHero(id);
    const el = this.pageHost.querySelector<HTMLElement>('.pg-select, .pg-legends');
    if (el) {
      el.querySelectorAll<HTMLElement>('.rc[data-h]').forEach((c) => c.classList.toggle('on', c.dataset.h === id));
      this.renderSelInfo(el);
      if (el.classList.contains('for-play') && this.party) { this.party.setMine({ hero: id, ready: false }); this.locking = false; el.classList.remove('locking'); }
      else if (el.classList.contains('for-play')) this.updateTeam(el);
      else (el.querySelector('.sel-team') as HTMLElement).innerHTML = this.tipsHtml();
    }
    const home = this.pageHost.querySelector<HTMLElement>('.pg-home');
    if (home) this.renderSpot(home);
  }

  /** Your slot follows your pick; a bot that held the same legend swaps to another one. */
  private updateTeam(el: HTMLElement) {
    const d = HEROES[this.hero];
    const me = el.querySelector('.ts.me') as HTMLElement | null;
    if (me) {
      me.style.setProperty('--hc', d.color);
      (me.querySelector('img') as HTMLImageElement).src = portraits[d.id] ?? '';
      (me.querySelector('.ts-h') as HTMLElement).textContent = d.name;
      me.classList.remove('bump'); void me.offsetWidth; me.classList.add('bump');
    }
    if (!this.lineup) return;
    for (const i of fixLineup(this.lineup, this.mode, this.hero)) {
      const s = el.querySelector<HTMLElement>(`.ts.bot[data-i="${i + 1}"]`);
      const a = HEROES[this.lineup[0][i].id];
      if (!s) continue;
      s.style.setProperty('--hc', a.color);
      (s.querySelector('img') as HTMLImageElement).src = portraits[a.id] ?? '';
      (s.querySelector('.ts-h') as HTMLElement).textContent = a.name;
      s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump');
    }
  }

  private abSel = 0;
  private renderSelInfo(el: HTMLElement) {
    const d = HEROES[this.hero];
    const r = d.ratings;
    const [first, last] = splitName(d.name);
    const bar = (label: string, v: number) => `<div class="sb"><small>${label}</small><i><b style="--w:${Math.round(v * 100)}%"></b></i></div>`;
    const pips = [0.34, 0.67, 1].map((t) => `<i class="${r.difficulty >= t - 0.12 ? 'on' : ''}"></i>`).join('');
    const a = d.abilities;
    const abs = [a.primary, a.secondary, a.ult];
    const info = el.querySelector('.sel-info') as HTMLElement;
    info.innerHTML = `
      <div class="role-line">${icon(ROLE_ICONS[d.role])}<b>${d.role}</b><span>${d.title}</span></div>
      <h1 class="sel-name">${first ? `<small>${first}</small>` : ''}<span>${last}</span></h1>
      <p class="quote">“${d.tagline}”</p>
      <div class="sel-stats">
        <div class="hpc"><small>${icon(UI.heart)}Health</small><b>${d.maxHp}</b></div>
        ${bar('Damage', r.damage)}${bar('Mobility', r.mobility)}${bar('Support', r.support)}
        <div class="dfc"><small>Difficulty</small><span class="pips">${pips}</span></div>
      </div>
      <div class="ab-row">${abs.map((ab, i) => `<button class="abt${i === 2 ? ' is-ult' : ''}${i === this.abSel ? ' on' : ''}" data-a="${i}" data-hover style="--d:${i}">
        <span class="abt-ic">${icon(ab.icon)}</span><kbd>${ab.key}</kbd></button>`).join('')}</div>
      <div class="ab-detail"></div>`;
    const showAb = (i: number) => {
      this.abSel = i;
      const ab = abs[i];
      info.querySelectorAll('.abt').forEach((b, j) => b.classList.toggle('on', j === i));
      const det = info.querySelector('.ab-detail') as HTMLElement;
      det.innerHTML = `<div class="ad-h"><b>${ab.name}</b><span class="ad-k">${i === 0 ? 'Basic attack' : i === 1 ? 'Ability' : 'Special'}</span></div>
        <span class="ab-st">${ab.stat}</span><p>${ab.desc}</p>`;
      det.classList.toggle('ult', i === 2);
      det.classList.remove('swap'); void det.offsetWidth; det.classList.add('swap');
    };
    info.querySelectorAll<HTMLButtonElement>('.abt').forEach((b) => {
      const i = Number(b.dataset.a);
      b.addEventListener('mouseenter', () => { if (this.abSel !== i) showAb(i); });
      b.addEventListener('click', () => showAb(i));
    });
    showAb(this.abSel);
    info.classList.remove('swap'); void info.offsetWidth; info.classList.add('swap');
    const sub = el.querySelector('.bl-s') as HTMLElement | null;
    if (sub) sub.textContent = el.classList.contains('for-play') ? `as ${last}` : `Take ${last} into a match`;
    if (this.party && el.classList.contains('for-play')) this.renderPartyTeams(el);
  }

  private lockIn() {
    const el = this.pageHost.querySelector<HTMLElement>('.pg-select');
    if (!el) return;
    if (this.party) {
      if (this.party.me?.ready || this.locking) return;
      this.locking = true;
      audio.play('lockIn');
      audio.announce('assemble', 0);
      this.hooks.onLockIn(this.hero);
      store('la:lastHero', this.hero);
      (el.querySelector('.lock-name') as HTMLElement).textContent = splitName(HEROES[this.hero].name)[1];
      el.classList.add('locking');
      this.party.setMine({ hero: this.hero, ready: true });
      setTimeout(() => { el.classList.remove('locking'); this.locking = false; }, 1500);
      return;
    }
    if (this.locking) return;
    this.locking = true;
    audio.play('lockIn');
    audio.announce('assemble', 0);
    // fullscreen only: the arena picker still needs a visible cursor
    this.hooks.onEngage(false);
    this.hooks.onLockIn(this.hero);
    store('la:lastHero', this.hero);
    store('la:lastMode', this.mode);
    // anyone still "choosing" locks in with you
    el.querySelectorAll<HTMLElement>('.ts.bot.pending').forEach((s) => { s.classList.remove('pending'); s.classList.add('picked'); });
    this.revealTimers.forEach(clearTimeout);
    (el.querySelector('.lock-name') as HTMLElement).textContent = splitName(HEROES[this.hero].name)[1];
    el.classList.add('locking');
    // next: pick the arena (it loads after that, in place)
    setTimeout(() => { if (this.page === 'select') this.go('map'); }, 1250);
  }

  // ───────────────────────── arena pick ─────────────────────────
  // Comes after the lineup is set (solo and party): the arena then loads in place before the match.

  private mapSel: ArenaKind = (settings.arena as ArenaKind) ?? 'study';

  private renderMap(el: HTMLElement) {
    const p = this.party;
    const guest = !!p && !p.isHost;
    if (p?.state.arena) this.mapSel = p.state.arena;
    const info = MODE_INFO[this.mode];
    el.classList.toggle('guest', guest);
    el.innerHTML = `
      <header class="sel-top">
        ${guest ? '' : `<button class="back" data-hover>${icon(UI.back)}<kbd>Esc</kbd></button>`}
        <div class="st-tx">
          <small><span class="chip">${this.mode}</span>${info.label} · ${p ? `party of ${p.state.members.length}` : `${settings.botDifficulty} bots`}</small>
          <h2>${guest ? 'The host picks the arena' : 'Choose the arena'}</h2>
        </div>
      </header>
      <div class="maps" role="listbox" aria-label="Arena">${ARENAS.map((a, i) => `
        <button class="map-card${a.id === this.mapSel ? ' on' : ''}" data-a="${a.id}" data-hover role="option" style="--mc:${a.c};--i:${i}" ${guest ? 'tabindex="-1"' : ''}>
          <span class="mp-img"><img src="/maps/${a.id}.webp" alt="" draggable="false"></span>
          <span class="mp-tx"><small>${a.kicker}</small><b>${a.name}</b><p>${a.desc}</p></span>
          ${a.id === settings.arena ? '<span class="mp-ready">Loaded</span>' : ''}
        </button>`).join('')}
      </div>
      <div class="map-go">${guest ? `<span class="map-wait"><i class="ts-dots"><i></i><i></i><i></i></i>Waiting for ${esc(p!.state.members.find((m) => m.host)?.name ?? 'the host')}</span>`
        : `<button class="btn-lock" data-hover><span class="bl-t">Play</span><small class="bl-s"></small><kbd>Enter</kbd></button>`}</div>`;
    el.querySelector('.back')?.addEventListener('click', () => this.mapBack());
    el.querySelectorAll<HTMLButtonElement>('.map-card').forEach((b) => {
      b.addEventListener('click', () => { if (guest) return; if (this.mapSel === b.dataset.a) this.pickArena(); else this.selectMap(b.dataset.a as ArenaKind); });
      b.addEventListener('dblclick', () => { if (!guest) this.pickArena(); });
    });
    el.querySelector('.btn-lock')?.addEventListener('click', () => this.pickArena());
    this.selectMap(this.mapSel, true);
  }

  private selectMap(id: ArenaKind, quiet = false) {
    if (!quiet) audio.play('ui');
    this.mapSel = id;
    const el = this.pageHost.querySelector('.pg-map');
    el?.querySelectorAll<HTMLElement>('.map-card').forEach((c) => c.classList.toggle('on', c.dataset.a === id));
    const sub = el?.querySelector('.bl-s');
    if (sub) sub.textContent = arenaInfo(id).name;
  }

  private mapBack() {
    audio.play('uiBack');
    const p = this.party;
    if (p) { if (p.isHost) p.setPhase('select'); return; }
    this.locking = false;
    this.go('select');
  }

  private mapKey(e: KeyboardEvent, onButton: boolean) {
    const p = this.party;
    if (p && !p.isHost) return;
    if (e.code === 'Escape') { this.mapBack(); return; }
    const dir = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : 0;
    if (dir) { const i = ARENAS.findIndex((a) => a.id === this.mapSel); this.selectMap(ARENAS[(i + dir + ARENAS.length) % ARENAS.length].id); return; }
    if (e.code === 'Enter' && !onButton) this.pickArena();
  }

  private pickArena() {
    if (this.locking && this.page !== 'map') return;
    const el = this.pageHost.querySelector<HTMLElement>('.pg-map');
    if (!el || el.classList.contains('going')) return;
    el.classList.add('going');
    audio.play('lockIn');
    // the last menu click: capture the mouse now, while the browser still counts this as a
    // user gesture, so the match starts locked (the loading screen has nothing to click)
    this.hooks.onEngage(true);
    const arena = this.mapSel;
    if (this.party) { this.hooks.onPartyStart(arena); return; }
    const lineup = this.lineup ?? undefined;
    this.lineup = null;
    this.hooks.onStart(this.mode, this.hero, lineup, arena);
  }


  // ───────────────────────── learn ─────────────────────────

  private learnHtml() {
    const d = HEROES[this.hero];
    const key = (k: string, cls = '') => `<kbd class="kc ${cls}">${k}</kbd>`;
    const bind = (keys: string, what: string, sub: string) => `<div class="bind"><span class="bk">${keys}</span><span><b>${what}</b><small>${sub}</small></span></div>`;
    return `
      <div class="learn-wrap">
        <div class="glass learn-ctl">
          <h2 class="pg-h">Controls</h2>
          <div class="binds">
            ${bind(key('W') + key('A') + key('S') + key('D'), 'Move', 'Strafe, run and dodge')}
            ${bind(key('Space'), 'Jump', 'Hop over cover and projectiles')}
            ${bind(key('LMB'), 'Basic attack', 'Hold to keep firing')}
            ${bind(key('RMB'), 'Ability', 'Your signature move, on cooldown')}
            ${bind(key('Shift'), 'Special', 'Charges from damage, healing and eliminations')}
            ${bind(key('Tab'), 'Scoreboard', 'Hold to see every player')}
            ${bind(key('Esc'), 'Pause', 'Settings and leave match')}
          </div>
        </div>
        <div class="learn-side">
          <div class="glass tips">
            <h2 class="pg-h">Fundamentals</h2>
            <div class="tip">${icon(UI.target)}<p><b>Aim high.</b> Headshots deal 50% bonus damage and flash a gold hit marker.</p></div>
            <div class="tip">${icon(UI.bolt)}<p><b>Feed your special.</b> Damage, healing and eliminations all charge the SHIFT ring. It glows when ready.</p></div>
            <div class="tip">${icon(UI.heart)}<p><b>Stay topped up.</b> Health pads around the arena restore 150 HP and return after 12 seconds.</p></div>
            <div class="tip">${icon(UI.users)}<p><b>Fight together.</b> First team to the elimination target wins. A tie at time goes to sudden-death overtime.</p></div>
          </div>
          <div class="glass hero-tips" style="--hc:${d.color}">
            <div class="ht-head"><img src="${portraits[d.id] ?? ''}" alt=""><div><small>Playing as</small><b>${d.name}</b></div></div>
            ${HERO_TIPS[d.id].map((t) => `<p>${t}</p>`).join('')}
          </div>
        </div>
      </div>`;
  }

  private renderLearn(el: HTMLElement) { el.innerHTML = this.learnHtml(); }

  // ───────────────────────── news ─────────────────────────

  private renderNews(el: HTMLElement) {
    const date = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    el.innerHTML = `
      <div class="news-wrap">
        <aside class="news-list">
          <h2 class="pg-h">Patch notes</h2>
          ${PATCH_NOTES.map((n, i) => `<button class="ncard${i === 0 ? ' on' : ''}" data-i="${i}" data-hover>
            <small>v${n.version} · ${date(n.date)}</small><b>${esc(n.title)}</b>${i === 0 ? '<span class="new">New</span>' : ''}</button>`).join('')}
        </aside>
        <article class="glass news-read"></article>
      </div>`;
    const read = el.querySelector('.news-read') as HTMLElement;
    const show = (i: number) => {
      const n = PATCH_NOTES[i];
      read.innerHTML = `<div class="nr-head"><span class="chip">v${n.version}</span><time>${date(n.date)}</time></div>
        <h1>${esc(n.title)}</h1>
        ${n.sections.map((s) => `<h3>${s.heading}</h3><ul>${s.items.map((x) => `<li>${x}</li>`).join('')}</ul>`).join('')}`;
      read.scrollTop = 0;
      read.classList.remove('swap'); void read.offsetWidth; read.classList.add('swap');
    };
    el.querySelectorAll<HTMLButtonElement>('.ncard').forEach((b) => b.addEventListener('click', () => {
      audio.play('ui');
      el.querySelectorAll('.ncard').forEach((x) => x.classList.toggle('on', x === b));
      show(Number(b.dataset.i));
    }));
    show(0);
  }

  // ───────────────────────── settings ─────────────────────────

  private renderSettings(el: HTMLElement) {
    const cats: [string, string, string][] = [
      ['graphics', 'Graphics', UI.spark], ['controls', 'Controls', UI.mouse], ['audio', 'Audio', UI.bolt], ['interface', 'Interface', UI.target], ['profile', 'Profile', UI.users],
    ];
    el.innerHTML = `
      <div class="set-wrap">
        <aside class="set-nav">
          <h2 class="pg-h">Settings</h2>
          ${cats.map(([id, label, ic]) => `<button class="scat${id === this.settingsCat ? ' on' : ''}" data-c="${id}" data-hover>${icon(ic)}${label}</button>`).join('')}
          <p class="set-note">Changes save automatically.</p>
        </aside>
        <div class="glass set-body"></div>
      </div>`;
    el.querySelectorAll<HTMLButtonElement>('.scat').forEach((b) => b.addEventListener('click', () => {
      audio.play('ui');
      this.settingsCat = b.dataset.c!;
      el.querySelectorAll('.scat').forEach((x) => x.classList.toggle('on', x === b));
      this.renderSettingsBody(el);
    }));
    this.renderSettingsBody(el);
  }

  private renderSettingsBody(el: HTMLElement) {
    const body = el.querySelector('.set-body') as HTMLElement;
    const row = (label: string, desc: string, control: string) => `<div class="srow"><div class="sl"><b>${label}</b><small>${desc}</small></div><div class="sc">${control}</div></div>`;
    const toggle = (k: 'dynamicResolution' | 'invertY' | 'showFps' | 'damageNumbers' | 'subtitles' | 'screenFx' | 'cameraShake' | 'fullscreen') => `<button class="tgl${settings[k] ? ' on' : ''}" data-t="${k}" role="switch" aria-checked="${settings[k]}"><i></i></button>`;
    const slider = (k: SliderKey) => {
      const s = SLIDERS[k];
      const v = settings[k];
      return `<div class="rng"><input type="range" data-r="${k}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" style="--v:${((v - s.min) / (s.max - s.min)) * 100}%"><output>${s.fmt(v)}</output></div>`;
    };
    let html = '';
    const c = this.settingsCat;
    if (c === 'graphics') {
      html = `<h3>Graphics</h3>
        <div class="qgrid">${(['low', 'medium', 'high', 'ultra'] as QualityLevel[]).map((q) => `<button class="qcard${settings.quality === q ? ' on' : ''}" data-q="${q}" data-hover>
          <span class="qbars">${[0, 1, 2, 3].map((i) => `<i class="${i <= ['low', 'medium', 'high', 'ultra'].indexOf(q) ? 'on' : ''}"></i>`).join('')}</span>
          <b>${q}</b><small>${QUALITY_COPY[q]}</small></button>`).join('')}</div>
        ${row('Dynamic resolution', 'Lowers render scale briefly when the frame rate dips.', toggle('dynamicResolution'))}
        ${row('Show FPS', 'Frame rate and draw calls in the top left corner.', toggle('showFps'))}
        <p class="set-foot">Quality was picked for your GPU automatically. Grass, shadows and particle budgets scale with it; particle changes apply from the next match.</p>`;
    } else if (c === 'controls') {
      html = `<h3>Controls</h3>
        ${row('Mouse sensitivity', 'How fast the camera turns.', slider('sensitivity'))}
        ${row('Field of view', 'Wider shows more of the arena.', slider('fov'))}
        ${row('Invert mouse Y', 'Push forward to look down.', toggle('invertY'))}
        ${row('Fullscreen in matches', 'Fill the whole screen when a match starts. Esc opens the pause menu; hold Esc to leave fullscreen.', toggle('fullscreen'))}`;
    } else if (c === 'audio') {
      html = `<h3>Audio</h3>
        ${row('Master volume', 'Every sound in the game.', slider('volume'))}
        ${row('Music', 'The ambient score.', slider('music'))}
        ${row('Voice lines', 'What the legends say in a match.', slider('voice'))}
        ${row('Subtitles', 'Show voice lines as text above the HUD.', toggle('subtitles'))}`;
    } else if (c === 'interface') {
      html = `<h3>Interface</h3>
        ${row('HUD scale', 'Size of health, abilities and score.', slider('hudScale'))}
        ${row('Damage numbers', 'Floating numbers when you hit or heal.', toggle('damageNumbers'))}
        ${row('Screen effects', 'Shockwave ripples, warped space and color punches on big moments.', toggle('screenFx'))}
        ${row('Camera shake', 'Shake the camera on explosions and heavy hits.', toggle('cameraShake'))}
        ${row('Crosshair color', 'Pick what stands out best for you.', `<div class="swatches">${CROSSHAIR_COLORS.map((col) => `<button class="sw${settings.crosshairColor === col ? ' on' : ''}" data-col="${col}" style="--c:${col}" aria-label="Crosshair ${col}"></button>`).join('')}</div>`)}`;
    } else {
      html = `<h3>Profile</h3>
        ${row('Player name', 'Shown on the scoreboard and kill feed.', `<input class="txt" type="text" maxlength="16" spellcheck="false" value="${esc(settings.playerName)}" data-n="name">`)}
        ${row('Bot skill', 'How sharp the bots aim and play.', `<div class="seg">${DIFFS.map((d) => `<button data-d="${d}" class="${settings.botDifficulty === d ? 'on' : ''}">${d}</button>`).join('')}</div>`)}`;
    }
    body.innerHTML = html;
    body.classList.remove('swap'); void body.offsetWidth; body.classList.add('swap');

    body.querySelectorAll<HTMLButtonElement>('.qcard').forEach((b) => b.addEventListener('click', () => {
      audio.play('ui');
      settings.quality = b.dataset.q as QualityLevel;
      saveSettings(settings);
      body.querySelectorAll('.qcard').forEach((x) => x.classList.toggle('on', x === b));
      this.hooks.onQualityChange();
    }));
    body.querySelectorAll<HTMLButtonElement>('.tgl').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.t as 'dynamicResolution' | 'invertY' | 'showFps' | 'damageNumbers' | 'subtitles' | 'screenFx' | 'cameraShake' | 'fullscreen';
      settings[k] = !settings[k];
      b.classList.toggle('on', settings[k]);
      b.setAttribute('aria-checked', String(settings[k]));
      saveSettings(settings);
      audio.play('ui');
    }));
    body.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((r) => r.addEventListener('input', () => {
      const k = r.dataset.r as SliderKey;
      const s = SLIDERS[k];
      const v = parseFloat(r.value);
      settings[k] = v;
      r.style.setProperty('--v', `${((v - s.min) / (s.max - s.min)) * 100}%`);
      (r.nextElementSibling as HTMLElement).textContent = s.fmt(v);
      if (k === 'volume') audio.setVolume(v);
      if (k === 'music') audio.setMusic(v);
      if (k === 'voice') audio.setVoice(v);
      saveSettings(settings);
    }));
    body.querySelectorAll<HTMLButtonElement>('.sw').forEach((b) => b.addEventListener('click', () => {
      audio.play('ui');
      settings.crosshairColor = b.dataset.col!;
      saveSettings(settings);
      body.querySelectorAll('.sw').forEach((x) => x.classList.toggle('on', x === b));
    }));
    body.querySelector<HTMLInputElement>('[data-n=name]')?.addEventListener('input', (e) => {
      settings.playerName = (e.target as HTMLInputElement).value.slice(0, 16).trim() || 'Player';
      saveSettings(settings);
      this.refreshProfile();
    });
    this.bindDiff(body);
  }

  // ───────────────────────── in-match overlays ─────────────────────────

  private openOverlay(kind: 'settings' | 'learn') {
    this.closeOverlay();
    this.pauseEl?.remove(); this.pauseEl = null;
    const o = document.createElement('div');
    o.className = `panel overlay ov-${kind}`;
    o.style.setProperty('--hc', HEROES[this.g?.local?.def.id ?? this.hero].color);
    o.innerHTML = `<button class="ov-close" data-hover>${icon(UI.back)}<span>Back</span><kbd>Esc</kbd></button><section class="page pg-${kind}"></section>`;
    const pg = o.querySelector('.page') as HTMLElement;
    if (kind === 'settings') this.renderSettings(pg);
    else pg.innerHTML = this.learnHtml();
    o.querySelector('.ov-close')!.addEventListener('click', () => { audio.play('uiBack'); this.closeOverlay(); });
    document.getElementById('ui')!.appendChild(o);
    this.overlay = o;
  }

  private closeOverlay() {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    if (this.g && this.g.state !== 'menu' && this.g.state !== 'ended' && this.g.paused) this.pause(true);
  }

  /** Close the results screen (the party moved on without you). */
  closeResults() { this.resultsEl?.remove(); this.resultsEl = null; this.resultsHandlers = null; }

  /** Kept for API compatibility: opens settings as an in-match overlay. */
  openSettings() { this.openOverlay('settings'); }

  bindGame(g: Game) { this.g = g; }

  // ───────────────────────── pause ─────────────────────────

  pause(on: boolean, hooksOnly = false) {
    if (!on) {
      this.pauseEl?.remove(); this.pauseEl = null;
      if (this.overlay) { this.overlay.remove(); this.overlay = null; }
      return;
    }
    if (hooksOnly || this.overlay) return;
    this.pauseEl?.remove();
    const g = this.g;
    const me = g?.local;
    const el = document.createElement('div');
    el.className = 'pause';
    if (me) el.style.setProperty('--hc', me.def.color);
    const info = g?.config ? MODE_INFO[g.config.mode] : null;
    const t = g ? Math.max(0, g.matchTime) : 0;
    el.innerHTML = `
      <aside class="pause-side">
        <div class="ps-brand">${logoMark()}<span>Legends Assembly</span></div>
        <div class="ps-tag">${g?.net ? 'Online · the match keeps going' : 'Match paused'}</div>
        <h2>${g?.net ? 'Menu' : 'Paused'}</h2>
        ${g && info ? `<div class="ps-match">
          <span class="chip">${g.config!.mode}</span><span>${info.label}</span>
          <span class="ps-score"><b class="b">${g.score[0]}</b><i>–</i><b class="r">${g.score[1]}</b></span>
          <span class="ps-time">${icon(UI.clock)}${g.matchTime <= 0 ? 'Overtime' : mmss(t)}</span>
        </div>` : ''}
        <nav class="ps-nav">
          <button class="pbtn primary" data-a="resume" data-hover>${icon(UI.resume)}Resume</button>
          <button class="pbtn" data-a="settings" data-hover>${icon(UI.gear)}Settings</button>
          <button class="pbtn" data-a="learn" data-hover>${icon(UI.book)}How to play</button>
          <button class="pbtn danger" data-a="leave" data-hover>${icon(UI.exit)}<span>${g?.net ? (g.authority ? 'End match for everyone' : 'Leave party') : 'Leave match'}</span></button>
        </nav>
        <p class="ps-hint">Click anywhere on the arena to jump back in</p>
      </aside>
      ${me ? this.pauseCard(me) : ''}`;
    el.querySelector('[data-a=resume]')!.addEventListener('click', () => { audio.play('ui'); this.hooks.onResume(); });
    // Clicking the open arena (not the panels) resumes too, like any PC shooter.
    el.addEventListener('click', (e) => { if (e.target === el) { audio.play('ui'); this.hooks.onResume(); } });
    el.querySelector('[data-a=settings]')!.addEventListener('click', () => { audio.play('ui'); this.openOverlay('settings'); });
    el.querySelector('[data-a=learn]')!.addEventListener('click', () => { audio.play('ui'); this.openOverlay('learn'); });
    const leave = el.querySelector('[data-a=leave]') as HTMLButtonElement;
    let armed = 0;
    leave.addEventListener('click', () => {
      if (armed) { clearTimeout(armed); audio.play('uiBack'); this.hooks.onLeave(); return; }
      audio.play('denied');
      leave.classList.add('armed');
      (leave.querySelector('span') as HTMLElement).textContent = 'Click again to leave';
      const label = g?.net ? (g.authority ? 'End match for everyone' : 'Leave party') : 'Leave match';
      armed = window.setTimeout(() => { armed = 0; leave.classList.remove('armed'); (leave.querySelector('span') as HTMLElement).textContent = label; }, 2600);
    });
    document.getElementById('ui')!.appendChild(el);
    this.pauseEl = el;
  }

  private pauseCard(me: Hero) {
    const d = me.def;
    const s = me.stats;
    const [first, last] = splitName(d.name);
    const a = d.abilities;
    return `<div class="pause-card">
      <div class="pc-art"><img src="${portraits[d.id] ?? ''}" alt=""></div>
      <div class="pc-body">
        <div class="pc-role">${icon(ROLE_ICONS[d.role])}${d.role}</div>
        <h3>${first ? `<small>${first}</small>` : ''}${last}</h3>
        <div class="pc-stats">
          <div><b>${s.kills}</b><small>Elims</small></div>
          <div><b>${s.deaths}</b><small>Deaths</small></div>
          <div><b>${s.assists}</b><small>Assists</small></div>
          <div><b>${Math.round(s.damage)}</b><small>Damage</small></div>
          <div><b>${Math.round(s.healing)}</b><small>Healing</small></div>
        </div>
        <div class="pc-kit">${[a.primary, a.secondary, a.ult].map((ab) => `<div><span class="pk-ic">${icon(ab.icon)}</span><kbd>${ab.key}</kbd><b>${ab.name}</b></div>`).join('')}</div>
      </div>
    </div>`;
  }

  // ───────────────────────── results ─────────────────────────

  results(g: Game, onAgain: () => void, onMenu: () => void, party = false) {
    this.resultsEl?.remove();
    const me = g.local;
    const win = g.winner === me.team;
    const score = (h: Hero) => h.stats.kills * 3 + h.stats.assists + h.stats.damage / 200 + h.stats.healing / 200;
    const mvp = [...g.heroes].sort((a, b) => score(b) - score(a))[0];
    const info = MODE_INFO[g.config!.mode];
    const myScore = g.score[me.team], theirScore = g.score[1 - me.team];
    const row = (h: Hero) => `<div class="rr${h.isLocal ? ' me' : ''}${h === mvp ? ' mvp' : ''}" style="--hc:${h.def.color}">
        <span class="rr-av"><img src="${portraits[h.def.id] ?? ''}" alt=""></span>
        <span class="rr-n"><b>${esc(h.name)}</b><small>${h.def.name}</small></span>
        <span class="rr-k">${h.stats.kills}</span><span>${h.stats.deaths}</span><span>${h.stats.assists}</span>
        <span class="rr-d">${Math.round(h.stats.damage)}</span><span class="rr-h">${Math.round(h.stats.healing)}</span></div>`;
    const team = (t: number) => {
      const list = g.heroes.filter((h) => h.team === t).sort((a, b) => score(b) - score(a));
      const mine = t === me.team;
      return `<div class="rteam ${mine ? 'ally' : 'enemy'}">
        <div class="rt-h"><b>${mine ? 'Your team' : 'Enemy team'}</b><span>${g.score[t]}</span></div>
        <div class="rr rr-head"><span></span><span>Player</span><span>E</span><span>D</span><span>A</span><span>Dmg</span><span>Heal</span></div>
        ${list.map(row).join('')}</div>`;
    };
    // the Play of the Game takes the spotlight card when someone made one; otherwise the MVP does
    const potg = g.playOfGame;
    const star = potg?.hero ?? mvp;
    const [mFirst, mLast] = splitName(star.def.name);
    const el = document.createElement('div');
    el.className = `results ${win ? 'win' : 'lose'}`;
    el.style.setProperty('--hc', star.def.color);
    el.innerHTML = `
      <div class="res-banner">
        <i class="rb-line l"></i><i class="rb-line r"></i>
        <div class="rb-tag">${g.config!.mode} · ${info.label}</div>
        <h1 class="rb-word">${win ? 'Victory' : 'Defeat'}</h1>
        <div class="rb-score"><b class="mine">${myScore}</b><span>—</span><b class="theirs">${theirScore}</b></div>
      </div>
      <div class="res-body">
        <div class="res-mvp${potg ? ' potg' : ''}">
          <div class="rm-art"><img src="${portraits[star.def.id] ?? ''}" alt=""></div>
          <div class="rm-tx">
            <span class="rm-k">${icon(UI.trophy)}${potg ? 'Play of the Game' : 'Match MVP'}</span>
            <b class="rm-p">${esc(star.name)}</b>
            <span class="rm-h">${mFirst ? mFirst + ' ' : ''}${mLast}</span>
            <span class="rm-s">${potg ? esc(potg.title) : `${mvp.stats.kills} / ${mvp.stats.deaths} / ${mvp.stats.assists}`}</span>
          </div>
        </div>
        <div class="res-you">
          <div class="ry-h">Your match</div>
          <div class="ry-grid">
            <div><b data-n="${me.stats.kills}">0</b><small>Eliminations</small></div>
            <div><b data-n="${me.stats.assists}">0</b><small>Assists</small></div>
            <div><b data-n="${me.stats.deaths}">0</b><small>Deaths</small></div>
            <div><b data-n="${Math.round(me.stats.damage)}">0</b><small>Damage</small></div>
            <div><b data-n="${Math.round(me.stats.healing)}">0</b><small>Healing</small></div>
            <div><b data-n="${me.stats.bestStreak}">0</b><small>Best streak</small></div>
          </div>
        </div>
        <div class="res-teams">${team(me.team)}${team(1 - me.team)}</div>
      </div>
      <div class="res-actions">
        <button class="btn-play sm again" data-hover><span class="bp-ic">${icon(UI.play)}</span><span class="bp-t"><b>${party ? 'Back to party' : 'Play again'}</b><small>${party ? (this.party?.isHost ? 'Everyone picks again' : 'Pick your next legend') : `${info.label} as ${me.def.name}`}</small></span><kbd>Enter</kbd></button>
        ${party ? '' : '<button class="gbtn change" data-hover>Change legend</button>'}
        <button class="gbtn menu" data-hover>${party ? 'Leave party' : 'Main menu'}</button>
      </div>`;
    const close = () => { el.remove(); this.resultsEl = null; this.resultsHandlers = null; };
    const again = () => { audio.play('lockIn'); close(); onAgain(); };
    const menu = () => { audio.play('uiBack'); close(); onMenu(); };
    el.querySelector('.again')!.addEventListener('click', again);
    el.querySelector('.menu')!.addEventListener('click', menu);
    el.querySelector('.change')?.addEventListener('click', () => { audio.play('ui'); close(); onMenu(); this.go('select'); });
    document.getElementById('ui')!.appendChild(el);
    el.querySelectorAll<HTMLElement>('.ry-grid b').forEach((b, i) => countUp(b, Number(b.dataset.n), 900, 900 + i * 90));
    this.resultsEl = el;
    this.resultsHandlers = { again, menu };
  }
}

type SliderKey = 'sensitivity' | 'fov' | 'volume' | 'music' | 'voice' | 'hudScale';
const pct = (v: number) => `${Math.round(v * 100)}%`;
const SLIDERS: Record<SliderKey, { min: number; max: number; step: number; fmt: (v: number) => string }> = {
  sensitivity: { min: 0.2, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) },
  fov: { min: 65, max: 110, step: 1, fmt: (v) => `${Math.round(v)}°` },
  volume: { min: 0, max: 1, step: 0.01, fmt: pct },
  music: { min: 0, max: 1, step: 0.01, fmt: pct },
  voice: { min: 0, max: 1, step: 0.01, fmt: pct },
  hudScale: { min: 0.8, max: 1.25, step: 0.05, fmt: pct },
};
