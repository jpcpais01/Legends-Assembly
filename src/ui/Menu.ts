import { HERO_LIST, HEROES } from '../heroes';
import type { HeroDef, HeroId } from '../game/types';
import { MODE_INFO, type Mode } from '../game/Game';
import type { Game } from '../game/Game';
import type { Hero } from '../game/Hero';
import { portraits } from './portraits';
import { settings, saveSettings, type QualityLevel } from '../core/settings';
import { PATCH_NOTES } from '../data/patchNotes';
import { audio } from '../core/Audio';
import { esc, icon, ROLE_ICONS, UI, logoMark, splitName, countUp, mmss } from './uikit';

const VERSION = PATCH_NOTES[0].version;
const MODES = Object.keys(MODE_INFO) as Mode[];
const DIFFS = ['easy', 'normal', 'hard'] as const;

export interface MenuHooks {
  onStart(mode: Mode, hero: HeroId): void;
  onPreviewHero(hero: HeroId): void;
  onQualityChange(): void;
  onResume(): void;
  onLeave(): void;
}

/** Where the menu wants the showcase camera. main.ts eases toward it every frame. */
export interface MenuCam { dist: number; side: number; look: number; height: number }
const CAMS: Record<'home' | 'select' | 'page', MenuCam> = {
  home: { dist: 7.2, side: 1.55, look: 1.95, height: 2.35 },
  select: { dist: 4.7, side: 0.55, look: 1.4, height: 1.8 },
  page: { dist: 8.2, side: 2.75, look: 1.9, height: 2.3 },
};

const ARENAS = [['study', "Giant's Study"], ['ruins', 'Sunset Ruins']] as const;

type Page = 'home' | 'legends' | 'learn' | 'news' | 'settings' | 'select';
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
  vangogh: [
    'Drop Sunflower Field where your team is fighting, not where they will be.',
    'Impasto Shot splashes. Aim at feet and walls to hit groups.',
    'Allies inside The Starry Night are healed, so pull fights into the dome.',
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
  private clockTimer = 0;
  private overlay: HTMLElement | null = null;
  private pauseEl: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private resultsHandlers: { again: () => void; menu: () => void } | null = null;
  private g: Game | null = null;
  private settingsCat = 'graphics';

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
        <nav class="tabs"><kbd class="kq">Q</kbd>${TABS.map((t) => `<button class="tab" data-p="${t.id}">${t.label}</button>`).join('')}<kbd class="ke">E</kbd><i class="tab-ink"></i></nav>
        <div class="m-status">
          <div class="me"><span class="me-av"><img alt=""></span><div><b class="me-name"></b><small class="me-main"></small></div></div>
          <span class="m-sep"></span><time class="clock"></time>
        </div>
      </header>
      <main class="m-host"></main>
      <footer class="m-foot"><span class="m-ver">v${VERSION} · ${esc(PATCH_NOTES[0].title)}</span><span class="m-hints"></span></footer>`;
    parent.appendChild(this.root);
    this.pageHost = this.root.querySelector('.m-host') as HTMLElement;
    this.tabsEl = this.root.querySelector('.tabs') as HTMLElement;
    this.ink = this.root.querySelector('.tab-ink') as HTMLElement;
    this.hintsEl = this.root.querySelector('.m-hints') as HTMLElement;

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
    this.applyHeroTint();
    this.refreshProfile();
  }

  // ───────────────────────── visibility & navigation ─────────────────────────

  show(on: boolean) {
    this.visible = on;
    this.root.classList.toggle('hidden', !on);
    clearInterval(this.clockTimer);
    if (on) {
      this.locking = false;
      this.go('home', true);
      this.tickClock();
      this.clockTimer = window.setInterval(() => this.tickClock(), 15000);
    }
  }

  /** Kept for main.ts: closes in-game overlays (settings / learn). */
  closePanel() { this.closeOverlay(); }

  get lastMode() { return this.mode; }

  private tickClock() {
    (this.root.querySelector('.clock') as HTMLElement).textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

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
    this.tabsEl.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.classList.toggle('on', t.dataset.p === p));
    const el = document.createElement('section');
    el.className = `page pg-${p}`;
    this.pageHost.replaceChildren(el);
    if (p === 'home') this.renderHome(el);
    else if (p === 'legends' || p === 'select') this.renderSelect(el, p === 'select');
    else if (p === 'learn') this.renderLearn(el);
    else if (p === 'news') this.renderNews(el);
    else if (p === 'settings') this.renderSettings(el);
    this.renderHints();
    this.placeInk();
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
    if (p === 'home') html = h('Enter', 'Play') + h('← →', 'Mode') + h('Q E', 'Tabs');
    else if (p === 'select') html = h('Enter', 'Lock in') + h('A D', 'Legend') + h('Esc', 'Back');
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
    if (!this.visible || this.locking) return;
    const onButton = document.activeElement instanceof HTMLButtonElement;
    const p = this.page;
    if ((e.code === 'KeyQ' || e.code === 'KeyE') && p !== 'select') {
      const i = TABS.findIndex((x) => x.id === p);
      const n = TABS[(i + (e.code === 'KeyE' ? 1 : TABS.length - 1)) % TABS.length];
      audio.play('uiTab');
      this.go(n.id);
      return;
    }
    if (e.code === 'Escape') {
      if (p !== 'home') { audio.play('uiBack'); this.go('home'); }
      return;
    }
    const dir = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : 0;
    if (dir && p === 'home' && !e.code.startsWith('Key')) {
      const i = MODES.indexOf(this.mode);
      this.setMode(MODES[(i + dir + MODES.length) % MODES.length]);
      return;
    }
    if (dir && (p === 'select' || p === 'legends')) {
      const i = HERO_LIST.findIndex((h) => h.id === this.hero);
      this.setHero(HERO_LIST[(i + dir + HERO_LIST.length) % HERO_LIST.length].id);
      return;
    }
    if (e.code === 'Enter' && !onButton) {
      if (p === 'home') { audio.play('ui'); this.go('select'); }
      else if (p === 'select' || p === 'legends') this.lockIn();
    }
  }

  // ───────────────────────── home ─────────────────────────

  private renderHome(el: HTMLElement) {
    const note = PATCH_NOTES[0];
    const d = HEROES[this.hero];
    el.innerHTML = `
      <div class="tiles" role="listbox" aria-label="Game mode">${MODES.map((m) => this.tileHtml(m)).join('')}</div>
      <div class="home-main"></div>
      <div class="home-cards">
        <button class="card c-news" data-a="news" data-hover>
          <span class="card-k">${icon(UI.spark)}What's new</span>
          <b>v${note.version} · ${esc(note.title)}</b>
          <p>${note.sections[0].items[0]}</p>
        </button>
        <button class="card c-main" data-a="legends" data-hover>
          <span class="cm-av"><img src="${portraits[d.id] ?? ''}" alt=""></span>
          <span class="cm-tx"><span class="card-k">Your legend</span><b>${d.name}</b><small>${icon(ROLE_ICONS[d.role])}${d.role} · ${d.title}</small></span>
        </button>
        <button class="card c-learn" data-a="learn" data-hover>
          <span class="card-k">${icon(UI.book)}How to play</span>
          <b>Controls and tips</b>
          <span class="mini-keys"><kbd>LMB</kbd><kbd>RMB</kbd><kbd>SHIFT</kbd></span>
        </button>
      </div>
      <div class="spot"></div>`;
    el.querySelectorAll<HTMLButtonElement>('.tile').forEach((b) => {
      b.addEventListener('click', () => this.setMode(b.dataset.m as Mode));
    });
    el.querySelectorAll<HTMLButtonElement>('.card').forEach((b) => b.addEventListener('click', () => { audio.play('uiTab'); this.go(b.dataset.a as Page); }));
    this.renderHomeMain(el);
    this.renderSpot(el);
  }

  private tileHtml(m: Mode) {
    const c = MODE_COPY[m];
    const art = c.art.map((h, i) => `<img src="${portraits[h] ?? ''}" alt="" style="--i:${i};--n:${c.art.length}">`).join('');
    return `<button class="tile${m === this.mode ? ' on' : ''}" data-m="${m}" data-hover role="option" style="--c1:${c.c1};--c2:${c.c2}">
      <span class="t-art">${art}</span><span class="t-num">${m}</span><span class="t-name">${MODE_INFO[m].label}</span></button>`;
  }

  private setMode(m: Mode) {
    if (m === this.mode) return;
    audio.play('ui');
    this.mode = m;
    store('la:lastMode', m);
    const el = this.pageHost.querySelector('.pg-home') as HTMLElement | null;
    if (!el) return;
    el.querySelectorAll<HTMLElement>('.tile').forEach((t) => t.classList.toggle('on', t.dataset.m === m));
    this.renderHomeMain(el);
  }

  private renderHomeMain(el: HTMLElement) {
    const info = MODE_INFO[this.mode];
    const c = MODE_COPY[this.mode];
    const main = el.querySelector('.home-main') as HTMLElement;
    main.style.setProperty('--mc', c.c1);
    main.innerHTML = `
      <div class="eyebrow"><span class="chip">${this.mode}</span>Game mode · vs bots</div>
      <h1 class="mode-title">${info.label}</h1>
      <p class="mode-desc">${c.desc}</p>
      <div class="mode-meta">
        <span>${icon(UI.target)}First to ${info.target}</span>
        <span>${icon(UI.clock)}6 min, then overtime</span>
        <span>${icon(UI.users)}${info.size} per team</span>
      </div>
      <div class="home-cta">
        <button class="btn-play" data-hover>
          <span class="bp-ic">${icon(UI.play)}</span>
          <span class="bp-t"><b>Play</b><small>Choose your legend</small></span>
          <kbd>Enter</kbd>
        </button>
        <div class="diff-wrap"><small>${icon(UI.bot)}Bot skill</small>
          <div class="seg">${DIFFS.map((d) => `<button data-d="${d}" class="${settings.botDifficulty === d ? 'on' : ''}">${d}</button>`).join('')}</div>
        </div>
        <div class="diff-wrap"><small>${icon(UI.book)}Arena</small>
          <div class="seg">${ARENAS.map(([k, n]) => `<button data-arena="${k}" class="${settings.arena === k ? 'on' : ''}">${n}</button>`).join('')}</div>
        </div>
      </div>`;
    main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
    main.querySelector('.btn-play')!.addEventListener('click', () => { audio.play('ui'); this.go('select'); });
    this.bindDiff(main);
    main.querySelectorAll<HTMLButtonElement>('[data-arena]').forEach((b) => b.addEventListener('click', () => {
      if (settings.arena === b.dataset.arena) return;
      audio.play('ui');
      settings.arena = b.dataset.arena as typeof settings.arena;
      saveSettings(settings);
      location.reload(); // arenas are built at boot
    }));
  }

  private bindDiff(scope: HTMLElement) {
    scope.querySelectorAll<HTMLButtonElement>('.seg [data-d]').forEach((b) => b.addEventListener('click', () => {
      audio.play('ui');
      settings.botDifficulty = b.dataset.d as typeof settings.botDifficulty;
      saveSettings(settings);
      scope.querySelectorAll('.seg [data-d]').forEach((x) => x.classList.toggle('on', x === b));
    }));
  }

  private renderSpot(el: HTMLElement) {
    const spot = el.querySelector('.spot') as HTMLElement | null;
    if (!spot) return;
    const d = HEROES[this.hero];
    const [first, last] = splitName(d.name);
    spot.innerHTML = `<div class="spot-role">${icon(ROLE_ICONS[d.role])}${d.role} · ${d.title}</div>
      <h2>${first ? `<small>${first}</small>` : ''}${last}</h2><p>“${d.tagline}”</p>`;
  }

  // ───────────────────────── hero select ─────────────────────────

  private renderSelect(el: HTMLElement, forPlay: boolean) {
    const info = MODE_INFO[this.mode];
    el.classList.toggle('for-play', forPlay);
    el.innerHTML = `
      ${forPlay ? `<header class="sel-head">
        <button class="back" data-hover>${icon(UI.back)}<kbd>Esc</kbd></button>
        <div><small><span class="chip">${this.mode}</span>${info.label} · ${settings.botDifficulty} bots</small><h2>Choose your legend</h2></div>
      </header>` : ''}
      <div class="sel-info"></div>
      <div class="roster">
        <button class="r-arrow" data-dir="-1" aria-label="Previous legend">${icon(UI.chevL)}</button>
        ${HERO_LIST.map((h) => this.rosterCard(h)).join('')}
        <button class="r-arrow" data-dir="1" aria-label="Next legend">${icon(UI.chevR)}</button>
      </div>
      <button class="btn-lock" data-hover><span class="bl-t">${forPlay ? 'Lock in' : 'Play'}</span><small class="bl-s"></small><kbd>Enter</kbd></button>
      <div class="lock-fx"><i></i><b class="lock-name"></b><span>Locked in</span></div>`;
    el.querySelector('.back')?.addEventListener('click', () => { audio.play('uiBack'); this.go('home'); });
    el.querySelectorAll<HTMLButtonElement>('.rc').forEach((b) => b.addEventListener('click', () => this.setHero(b.dataset.h as HeroId)));
    el.querySelectorAll<HTMLButtonElement>('.r-arrow').forEach((b) => b.addEventListener('click', () => {
      const i = HERO_LIST.findIndex((h) => h.id === this.hero);
      const n = HERO_LIST.length;
      this.setHero(HERO_LIST[(i + Number(b.dataset.dir) + n) % n].id);
    }));
    el.querySelector('.btn-lock')!.addEventListener('click', () => this.lockIn());
    this.renderSelInfo(el);
  }

  private rosterCard(h: HeroDef) {
    const [, last] = splitName(h.name);
    return `<button class="rc${h.id === this.hero ? ' on' : ''}" data-h="${h.id}" data-hover style="--hc:${h.color}">
      <span class="rc-in"><img src="${portraits[h.id] ?? ''}" alt=""></span>
      <span class="rc-role">${icon(ROLE_ICONS[h.role])}</span>
      <span class="rc-name">${last}</span></button>`;
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
      el.querySelectorAll<HTMLElement>('.rc').forEach((c) => c.classList.toggle('on', c.dataset.h === id));
      this.renderSelInfo(el);
    }
    const home = this.pageHost.querySelector<HTMLElement>('.pg-home');
    if (home) this.renderSpot(home);
  }

  private renderSelInfo(el: HTMLElement) {
    const d = HEROES[this.hero];
    const r = d.ratings;
    const [first, last] = splitName(d.name);
    const bar = (label: string, v: number) => `<div class="sb"><small>${label}</small><i><b style="--w:${Math.round(v * 100)}%"></b></i></div>`;
    const pips = [0.34, 0.67, 1].map((t) => `<i class="${r.difficulty >= t - 0.12 ? 'on' : ''}"></i>`).join('');
    const a = d.abilities;
    const info = el.querySelector('.sel-info') as HTMLElement;
    info.innerHTML = `
      <div class="role-line">${icon(ROLE_ICONS[d.role])}<b>${d.role}</b><span>${d.title}</span></div>
      <h1 class="sel-name">${first ? `<small>${first}</small>` : ''}<span>${last}</span></h1>
      <p class="quote">“${d.tagline}”</p>
      <div class="sel-stats">
        <div class="hpc"><small>Health</small><b>${d.maxHp}</b></div>
        ${bar('Damage', r.damage)}${bar('Mobility', r.mobility)}${bar('Support', r.support)}
        <div class="dfc"><small>Difficulty</small><span class="pips">${pips}</span></div>
      </div>
      <div class="sel-abs">${[a.primary, a.secondary, a.ult].map((ab, i) => `
        <div class="ab${i === 2 ? ' is-ult' : ''}" style="--d:${i}">
          <div class="ab-ic">${icon(ab.icon)}</div>
          <div class="ab-tx"><div class="ab-h"><kbd>${ab.key}</kbd><b>${ab.name}</b></div><span class="ab-st">${ab.stat}</span><p>${ab.desc}</p></div>
        </div>`).join('')}</div>`;
    info.classList.remove('swap'); void info.offsetWidth; info.classList.add('swap');
    const sub = el.querySelector('.bl-s') as HTMLElement | null;
    if (sub) sub.textContent = el.classList.contains('for-play') ? `as ${d.name}` : `${this.mode} ${MODE_INFO[this.mode].label} as ${last}`;
  }

  private lockIn() {
    if (this.locking) return;
    const el = this.pageHost.querySelector<HTMLElement>('.pg-select, .pg-legends');
    if (!el) return;
    this.locking = true;
    audio.play('lockIn');
    store('la:lastHero', this.hero);
    store('la:lastMode', this.mode);
    (el.querySelector('.lock-name') as HTMLElement).textContent = splitName(HEROES[this.hero].name)[1];
    el.classList.add('locking');
    setTimeout(() => { this.hooks.onStart(this.mode, this.hero); }, 820);
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
          <div class="kb-visual">
            <div class="kb">
              <div class="kr">${key('Tab', 'w15 hot2')}${key('Q')}${key('W', 'hot')}${key('E')}${key('R')}</div>
              <div class="kr">${key('Caps', 'w18 dimk')}${key('A', 'hot')}${key('S', 'hot')}${key('D', 'hot')}${key('F')}</div>
              <div class="kr">${key('Shift', 'w22 hot3')}${key('Z')}${key('X')}${key('C')}${key('V')}</div>
              <div class="kr">${key('Esc', 'w15 hot2')}${key('Space', 'w40 hot')}</div>
            </div>
            <div class="mouse">
              <svg viewBox="0 0 80 120" aria-hidden="true"><path class="mb l" d="M40 8 C20 8 8 20 8 40 V48 H39 V8Z"/><path class="mb r" d="M41 8 C60 8 72 20 72 40 V48 H41Z"/><path class="mbody" d="M8 50 H72 V78 C72 100 58 112 40 112 C22 112 8 100 8 78Z"/><rect x="37" y="18" width="6" height="14" rx="3" class="wheel"/></svg>
              <span class="ml">LMB</span><span class="mr">RMB</span>
            </div>
          </div>
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
    const toggle = (k: 'dynamicResolution' | 'invertY' | 'showFps' | 'damageNumbers' | 'subtitles' | 'screenFx' | 'cameraShake') => `<button class="tgl${settings[k] ? ' on' : ''}" data-t="${k}" role="switch" aria-checked="${settings[k]}"><i></i></button>`;
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
        ${row('Invert mouse Y', 'Push forward to look down.', toggle('invertY'))}`;
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
      const k = b.dataset.t as 'dynamicResolution' | 'invertY' | 'showFps' | 'damageNumbers' | 'subtitles' | 'screenFx' | 'cameraShake';
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
        <div class="ps-tag">Match paused</div>
        <h2>Paused</h2>
        ${g && info ? `<div class="ps-match">
          <span class="chip">${g.config!.mode}</span><span>${info.label}</span>
          <span class="ps-score"><b class="b">${g.score[0]}</b><i>–</i><b class="r">${g.score[1]}</b></span>
          <span class="ps-time">${icon(UI.clock)}${g.matchTime <= 0 ? 'Overtime' : mmss(t)}</span>
        </div>` : ''}
        <nav class="ps-nav">
          <button class="pbtn primary" data-a="resume" data-hover>${icon(UI.resume)}Resume</button>
          <button class="pbtn" data-a="settings" data-hover>${icon(UI.gear)}Settings</button>
          <button class="pbtn" data-a="learn" data-hover>${icon(UI.book)}How to play</button>
          <button class="pbtn danger" data-a="leave" data-hover>${icon(UI.exit)}<span>Leave match</span></button>
        </nav>
        <p class="ps-hint">Click Resume to lock the mouse again</p>
      </aside>
      ${me ? this.pauseCard(me) : ''}`;
    el.querySelector('[data-a=resume]')!.addEventListener('click', () => { audio.play('ui'); this.hooks.onResume(); });
    el.querySelector('[data-a=settings]')!.addEventListener('click', () => { audio.play('ui'); this.openOverlay('settings'); });
    el.querySelector('[data-a=learn]')!.addEventListener('click', () => { audio.play('ui'); this.openOverlay('learn'); });
    const leave = el.querySelector('[data-a=leave]') as HTMLButtonElement;
    let armed = 0;
    leave.addEventListener('click', () => {
      if (armed) { clearTimeout(armed); audio.play('uiBack'); this.hooks.onLeave(); return; }
      audio.play('denied');
      leave.classList.add('armed');
      (leave.querySelector('span') as HTMLElement).textContent = 'Click again to leave';
      armed = window.setTimeout(() => { armed = 0; leave.classList.remove('armed'); (leave.querySelector('span') as HTMLElement).textContent = 'Leave match'; }, 2600);
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

  results(g: Game, onAgain: () => void, onMenu: () => void) {
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
    const [mFirst, mLast] = splitName(mvp.def.name);
    const el = document.createElement('div');
    el.className = `results ${win ? 'win' : 'lose'}`;
    el.style.setProperty('--hc', mvp.def.color);
    el.innerHTML = `
      <div class="res-banner">
        <i class="rb-line l"></i><i class="rb-line r"></i>
        <div class="rb-tag">${g.config!.mode} · ${info.label}</div>
        <h1 class="rb-word">${win ? 'Victory' : 'Defeat'}</h1>
        <div class="rb-score"><b class="mine">${myScore}</b><span>—</span><b class="theirs">${theirScore}</b></div>
      </div>
      <div class="res-body">
        <div class="res-mvp">
          <div class="rm-art"><img src="${portraits[mvp.def.id] ?? ''}" alt=""></div>
          <div class="rm-tx">
            <span class="rm-k">${icon(UI.trophy)}Match MVP</span>
            <b class="rm-p">${esc(mvp.name)}</b>
            <span class="rm-h">${mFirst ? mFirst + ' ' : ''}${mLast}</span>
            <span class="rm-s">${mvp.stats.kills} / ${mvp.stats.deaths} / ${mvp.stats.assists}</span>
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
        <button class="btn-play sm again" data-hover><span class="bp-ic">${icon(UI.play)}</span><span class="bp-t"><b>Play again</b><small>${info.label} as ${me.def.name}</small></span><kbd>Enter</kbd></button>
        <button class="gbtn change" data-hover>Change legend</button>
        <button class="gbtn menu" data-hover>Main menu</button>
      </div>`;
    const close = () => { el.remove(); this.resultsEl = null; this.resultsHandlers = null; };
    const again = () => { audio.play('lockIn'); close(); onAgain(); };
    const menu = () => { audio.play('uiBack'); close(); onMenu(); };
    el.querySelector('.again')!.addEventListener('click', again);
    el.querySelector('.menu')!.addEventListener('click', menu);
    el.querySelector('.change')!.addEventListener('click', () => { audio.play('ui'); close(); onMenu(); this.go('select'); });
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
