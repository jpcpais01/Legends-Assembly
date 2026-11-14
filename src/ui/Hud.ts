import * as THREE from 'three';
import type { Game, Callout, AbilitySlot } from '../game/Game';
import type { Hero } from '../game/Hero';
import { portraits } from './portraits';
import { settings } from '../core/settings';
import { MODE_INFO } from '../game/Game';
import { esc, icon, ROLE_ICONS, UI, DomCache, mmss } from './uikit';

const RING = 2 * Math.PI * 44; // ult ring circumference (r = 44 in a 100 viewBox)
const DEATH_RING = 2 * Math.PI * 26;
const NUM_POOL = 28;

interface DmgNum { el: HTMLDivElement; pos: THREE.Vector3; t: number; vx: number; live: boolean; key: number; total: number; crit: boolean; size: number }
interface Plate { el: HTMLDivElement; bar: HTMLElement; hero: Hero; shown: boolean; frac: number }
interface Chip { el: HTMLElement; t: HTMLElement; hero: Hero; u: HTMLElement | null }

/**
 * In-match HUD. Everything is plain DOM over the canvas, with no backdrop blur (it would
 * re-read the 3D frame every frame). Per-frame writes go through DomCache so only values
 * that actually changed touch the DOM.
 */
export class Hud {
  root: HTMLDivElement;
  private g: Game;
  private els: Record<string, HTMLElement> = {};
  private c = new DomCache();
  private nums: DmgNum[] = [];
  private plates: Plate[] = [];
  private chips: Chip[] = [];
  private v = new THREE.Vector3();
  private lastHp = 0;
  private dirs: { el: HTMLElement; t: number; from: THREE.Vector3 }[] = [];
  private ultWasReady = false;
  private rmbWasCd = false;
  private scoreboardOn = false;
  private sbT = 0;
  private deathTotal = 5;
  private vig = 0;
  private healFlashT = 0;
  /** Crosshair bloom: grows when you fire or land hits, settles back. */
  private xKick = 0;
  private lastPrimaryCd = 0;
  private lastScore = [-1, -1];
  private healT = 0;
  private healing = false;

  constructor(parent: HTMLElement, g: Game) {
    this.g = g;
    const root = document.createElement('div');
    root.className = 'hud hidden';
    root.innerHTML = `
      <div class="vignette"></div>
      <div class="killflash"></div>
      <div class="hurtflash"></div>
      <div class="ult-edge"></div>
      <div class="dmgdir">${'<i></i>'.repeat(6)}</div>
      <div class="fps"></div>
      <div class="h-top">
        <div class="h-team ally"></div>
        <div class="h-score">
          <div class="hs-side ally"><i class="hs-bar"><s></s></i><b class="hs-n">0</b></div>
          <div class="hs-mid"><div class="hs-time">6:00</div><div class="hs-goal">First to 10</div></div>
          <div class="hs-side enemy"><b class="hs-n">0</b><i class="hs-bar"><s></s></i></div>
        </div>
        <div class="h-team enemy"></div>
      </div>
      <div class="feed"></div>
      <div class="crosshair"></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="elims"></div>
      <div class="announce"><div class="big"></div><div class="small"></div></div>
      <div class="callout">
        <div class="co-badge"><i class="co-ring"></i><i class="co-ring r2"></i><svg viewBox="0 0 100 100"><path class="co-hex" d="M50 4 91 27v46L50 96 9 73V27Z"/><path class="co-hex2" d="M50 13 83 32v36L50 87 17 68V32Z"/></svg><b class="co-n"></b></div>
        <div class="co-title"><b class="co-glow"></b><span></span></div>
        <div class="co-sub"></div>
        <div class="co-tags"></div>
        <div class="co-pips"></div>
      </div>
      <div class="intro"><small class="in-mode"></small><b class="in-title"></b><span class="in-goal"></span></div>
      <div class="vs"><div class="vs-side ally"></div><b class="vs-x">VS</b><div class="vs-side enemy"></div></div>
      <div class="cine"><i class="cb t"></i><i class="cb b"></i><div class="cine-t"><small></small><b></b><span></span></div></div>
      <div class="hud-warn"><span class="dg-av"><img alt=""></span><div><small>Enemy special</small><b></b></div></div>
      <div class="countdown"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44"/></svg><span></span></div>
      <div class="death hidden">
        <div class="dt-k">${icon(UI.skull)}Eliminated by</div>
        <div class="dt-card"><span class="dt-av"><img alt=""></span><div><b class="dt-n"></b><small class="dt-h"></small></div></div>
        <div class="dt-respawn"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" class="dt-bg"/><circle cx="30" cy="30" r="26" class="dt-rc" stroke-dasharray="${DEATH_RING}"/></svg><b class="dt-s">5</b></div>
        <small class="dt-l">Respawning</small>
      </div>
      <div class="vitals">
        <div class="v-av"><img alt=""><span class="v-role"></span></div>
        <div class="v-main">
          <div class="v-name"><b class="hname"></b><span class="v-title"></span></div>
          <div class="v-hp"><b class="hpv">250</b><small>/ <span class="hpm">250</span></small></div>
          <div class="hpbar"><i class="trail"></i><i class="ghost"></i><i class="fill"></i><i class="ticks"></i></div>
        </div>
      </div>
      <div class="abilities">
        <div class="slot s-lmb"><div class="sl-box"><span class="sl-ic"></span></div><kbd>LMB</kbd><span class="sl-n"></span></div>
        <div class="slot s-rmb"><div class="sl-box"><span class="sl-ic"></span><i class="cd"></i><b class="num"></b></div><kbd>RMB</kbd><span class="sl-n"></span></div>
        <div class="ult">
          <div class="u-core">
            <svg class="ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="u-rb"/><circle cx="50" cy="50" r="44" class="u-rc" stroke-dasharray="${RING}" stroke-dashoffset="${RING}"/><circle cx="50" cy="50" r="44" class="u-rt" stroke-dashoffset="-5.55"/></svg>
            <span class="u-ic"></span><b class="pct">0<small>%</small></b><span class="u-ready">Ready</span>
          </div>
          <div class="u-toast">Special ready</div>
          <kbd>SHIFT</kbd><span class="sl-n u-n"></span>
        </div>
      </div>
      <div class="nums"></div>
      <div class="plates"></div>
      <div class="scoreboard hidden"></div>`;
    parent.appendChild(root);
    this.root = root;
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    const map: Record<string, string> = {
      vignette: '.vignette', killflash: '.killflash', hurtflash: '.hurtflash', ultEdge: '.ult-edge', fps: '.fps', feed: '.feed', crosshair: '.crosshair', hitmarker: '.hitmarker',
      elims: '.elims', announce: '.announce', intro: '.intro', countdown: '.countdown', cdNum: '.countdown span',
      death: '.death', dtAv: '.dt-av img', dtN: '.dt-n', dtH: '.dt-h', dtS: '.dt-s', dtRc: '.dt-rc', dtCard: '.dt-card', dtK: '.dt-k',
      vitals: '.vitals', vAv: '.v-av img', vRole: '.v-role', hname: '.hname', hpv: '.hpv', hpm: '.hpm', hpbar: '.hpbar',
      fill: '.hpbar .fill', trail: '.hpbar .trail', ghost: '.hpbar .ghost', vTitle: '.v-title', uToast: '.u-toast',
      lmb: '.s-lmb', rmb: '.s-rmb', rmbCd: '.s-rmb .cd', rmbNum: '.s-rmb .num', ult: '.ult', ultRing: '.ult .u-rc', ultPct: '.ult .pct',
      teamA: '.h-team.ally', teamE: '.h-team.enemy', scoreA: '.hs-side.ally .hs-n', scoreE: '.hs-side.enemy .hs-n',
      barA: '.hs-side.ally .hs-bar s', barE: '.hs-side.enemy .hs-bar s', timer: '.hs-time', goal: '.hs-goal',
      nums: '.nums', plates: '.plates', scoreboard: '.scoreboard', cine: '.cine', danger: '.hud-warn',
    };
    for (const k in map) this.els[k] = q(map[k]);
    this.dirs = Array.from(root.querySelectorAll('.dmgdir i')).map((el) => ({ el: el as HTMLElement, t: 0, from: new THREE.Vector3() }));
    for (let i = 0; i < NUM_POOL; i++) {
      const el = document.createElement('div');
      el.className = 'dmgnum';
      el.style.opacity = '0';
      this.els.nums.appendChild(el);
      this.nums.push({ el, pos: new THREE.Vector3(), t: 0, vx: 0, live: false, key: -1, total: 0, crit: false, size: 1 });
    }
    window.addEventListener('keydown', (e) => { if (e.code === 'Tab' && this.g.state !== 'menu') { e.preventDefault(); this.scoreboardOn = true; this.sbT = 0; } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Tab') this.scoreboardOn = false; });
  }

  show(on: boolean) { this.root.classList.toggle('hidden', !on); }

  /** Called at match start to bind the local hero visuals. */
  setup() {
    const g = this.g;
    const h = g.local;
    const d = h.def;
    const a = d.abilities;
    this.c.clear();
    this.root.style.setProperty('--hc', d.color);
    this.root.style.setProperty('--ha', d.accent);
    (this.els.vAv as HTMLImageElement).src = portraits[d.id] ?? '';
    this.els.vRole.innerHTML = icon(ROLE_ICONS[d.role]);
    this.els.hname.textContent = d.name;
    this.els.vTitle.textContent = d.title;
    this.els.hpm.textContent = String(d.maxHp);
    this.els.hpbar.style.setProperty('--tick', `${(25 / d.maxHp) * 100}%`);
    (this.els.lmb.querySelector('.sl-ic') as HTMLElement).innerHTML = icon(a.primary.icon);
    (this.els.lmb.querySelector('.sl-n') as HTMLElement).textContent = a.primary.name;
    (this.els.rmb.querySelector('.sl-ic') as HTMLElement).innerHTML = icon(a.secondary.icon);
    (this.els.rmb.querySelector('.sl-n') as HTMLElement).textContent = a.secondary.name;
    (this.els.ult.querySelector('.u-ic') as HTMLElement).innerHTML = icon(a.ult.icon);
    (this.els.ult.querySelector('.u-n') as HTMLElement).textContent = a.ult.name;
    this.els.ult.classList.remove('ready');
    this.els.rmb.classList.remove('cooling', 'flash');
    // crosshair style per hero
    const ch = this.els.crosshair;
    ch.innerHTML = '<i class="dot"></i>';
    if (d.id === 'yeat' || d.id === 'blitzcrank') ch.insertAdjacentHTML('beforeend', '<i class="ring"></i>');
    else {
      const gap = d.id === 'einstein' ? 7 : 9;
      for (const [x, y, w, hh] of [[-gap - 8, -1, 8, 2], [gap, -1, 8, 2], [-1, gap, 2, 8]] as const) {
        ch.insertAdjacentHTML('beforeend', `<i class="arm" style="left:${x}px;top:${y}px;width:${w}px;height:${hh}px"></i>`);
      }
    }
    const info = MODE_INFO[g.config!.mode];
    this.els.goal.textContent = `First to ${info.target}`;
    // team chips (ally on the left, enemies on the right)
    this.chips = [];
    for (const [row, ally] of [[this.els.teamA, true], [this.els.teamE, false]] as const) {
      row.innerHTML = '';
      for (const x of g.heroes.filter((y) => (y.team === h.team) === ally)) {
        const el = document.createElement('div');
        el.className = 'chip-h' + (x.isLocal ? ' me' : '');
        el.style.setProperty('--hc', x.def.color);
        // allies show their special charge under the portrait, like a real squad HUD
        el.innerHTML = `<img src="${portraits[x.def.id] ?? ''}" alt=""><b></b>${ally && !x.isLocal ? '<i class="cu"><s></s></i>' : ''}`;
        row.appendChild(el);
        this.chips.push({ el, t: el.querySelector('b') as HTMLElement, hero: x, u: el.querySelector('.cu s') });
      }
    }
    // nameplates
    this.els.plates.innerHTML = '';
    this.plates = [];
    for (const hero of g.heroes) {
      if (hero.isLocal) continue;
      const el = document.createElement('div');
      el.className = 'plate ' + (hero.team === h.team ? 'ally' : 'enemy');
      el.innerHTML = `<div class="n">${esc(hero.name)}<small>${hero.def.name.split(' ').pop()}</small></div><div class="b"><i></i><s></s></div>`;
      el.style.display = 'none';
      this.els.plates.appendChild(el);
      this.plates.push({ el, bar: el.querySelector('i') as HTMLElement, hero, shown: false, frac: -1 });
    }
    this.els.feed.innerHTML = '';
    this.els.elims.innerHTML = '';
    for (const n of this.nums) { n.live = false; n.el.style.opacity = '0'; }
    this.lastHp = h.maxHp;
    this.ultWasReady = false;
    this.rmbWasCd = false;
    this.vig = 0;
    this.lastScore = [-1, -1];
    this.els.uToast.className = 'u-toast';
    // mode intro card plays over the countdown
    (this.els.intro.querySelector('.in-mode') as HTMLElement).textContent = g.net ? `${g.config!.mode} · online · ${g.config!.roster?.filter((r) => r.owner).length ?? 1} players` : `${g.config!.mode} · vs bots · ${g.config!.difficulty}`;
    (this.els.intro.querySelector('.in-title') as HTMLElement).textContent = info.label;
    (this.els.intro.querySelector('.in-goal') as HTMLElement).textContent = `First team to ${info.target} eliminations wins`;
    this.restart(this.els.intro, 'intro', 'show');
    // the lineup: both teams slide in from their side, the local legend first
    const vs = this.root.querySelector('.vs') as HTMLElement;
    for (const [sel, ally] of [['.vs-side.ally', true], ['.vs-side.enemy', false]] as const) {
      const list = g.heroes.filter((y) => (y.team === h.team) === ally).sort((a, b) => Number(b.isLocal) - Number(a.isLocal));
      (vs.querySelector(sel) as HTMLElement).innerHTML = list.map((x, i) => `<div class="vs-c${x.isLocal ? ' me' : ''}" style="--hc:${x.def.color};--i:${i}">
        <span class="vs-av"><img src="${portraits[x.def.id] ?? ''}" alt=""></span><b>${esc(x.name)}</b><small>${esc(x.def.name)}</small></div>`).join('');
    }
    vs.classList.toggle('many', g.heroes.length > 6);
    this.restart(vs, 'vs', 'show');
    this.root.classList.remove('outro');
    this.els.cine.className = 'cine';
    this.els.danger.className = 'hud-warn';
  }

  /** Your special: letterbox bars snap in with its name. An enemy special nearby: a danger warning. */
  ultCast(h: Hero, near: boolean) {
    const me = this.g.local;
    if (h === me) {
      this.cineText('', '', '', h.def.color); // the kit already announces its name center screen
      this.restart(this.els.cine, 'cine', 'beat');
      return;
    }
    if (!near || h.team === me.team) return;
    const d = this.els.danger;
    (d.querySelector('img') as HTMLImageElement).src = portraits[h.def.id] ?? '';
    (d.querySelector('b') as HTMLElement).textContent = h.def.abilities.ult.name;
    d.style.setProperty('--hc', h.def.color);
    this.restart(d, 'hud-warn', 'on');
  }

  /** End of match: letterbox the final-blow orbit and drop the gameplay HUD. */
  outro(title: string, sub: string) {
    this.root.classList.add('outro');
    this.cineText(this.g.config!.mode + ' · ' + MODE_INFO[this.g.config!.mode].label, title, sub, this.g.local.def.color);
    this.restart(this.els.cine, 'cine', 'hold');
  }

  private cineText(small: string, big: string, sub: string, color: string) {
    const c = this.els.cine;
    (c.querySelector('.cine-t small') as HTMLElement).textContent = small;
    (c.querySelector('.cine-t b') as HTMLElement).textContent = big;
    (c.querySelector('.cine-t span') as HTMLElement).textContent = sub;
    c.style.setProperty('--hc', color);
  }

  /** Restart a CSS animation by swapping its class (one forced style flush, only on events). */
  private restart(el: HTMLElement, base: string, extra: string) {
    el.className = base;
    void el.offsetWidth;
    el.className = `${base} ${extra}`;
  }

  damageNumber(pos: THREE.Vector3, amount: number, crit: boolean, heal: boolean, key = -1) {
    if (!settings.damageNumbers) return;
    // rapid hits on the same target stack into one growing number instead of a cloud of digits
    let n = !heal && key >= 0 ? this.nums.find((x) => x.live && x.key === key && x.t < 0.45 && !x.el.classList.contains('heal')) : undefined;
    if (n) {
      n.total += amount;
      n.crit = n.crit || crit;
      n.t = 0.04;
      n.pos.lerp(pos, 0.5);
    } else {
      n = this.nums.find((x) => !x.live);
      if (!n) n = this.nums.reduce((a, b) => (a.t > b.t ? a : b));
      n.live = true;
      n.t = 0;
      n.pos.copy(pos);
      n.vx = (Math.random() - 0.5) * 60;
      n.key = heal ? -1 : key;
      n.total = amount;
      n.crit = crit;
    }
    n.size = Math.min(1.7, 0.85 + Math.sqrt(n.total) * 0.045);
    n.el.className = 'dmgnum' + (n.crit ? ' crit' : '') + (heal ? ' heal' : '') + (n.total >= 100 ? ' big' : '');
    n.el.textContent = (heal ? '+' : '') + Math.round(n.total);
  }

  hitmarker(crit: boolean, kill: boolean, amount = 0) {
    this.els.hitmarker.style.setProperty('--hk', String(Math.min(1.8, 1 + amount / 160)));
    this.restart(this.els.hitmarker, 'hitmarker', 'on' + (kill ? ' kill' : crit ? ' crit' : ''));
    if (kill) this.restart(this.els.killflash, 'killflash', 'on');
    this.xKick = Math.min(1, this.xKick + (kill ? 1 : 0.35));
  }

  hurt(from: THREE.Vector3 | null, amount = 0) {
    if (amount >= 12) {
      this.els.hurtflash.style.setProperty('--hk', Math.min(1, amount / 90).toFixed(2));
      this.restart(this.els.hurtflash, 'hurtflash', 'on');
    }
    if (!from) return;
    let best = this.dirs[0];
    for (const d of this.dirs) if (d.t < best.t) best = d;
    best.t = 1.4;
    best.from.copy(from);
  }

  kill(killer: Hero | null, victim: Hero, assists: Hero[] = [], ab?: AbilitySlot) {
    const me = this.g.local;
    // kill feed
    const el = document.createElement('div');
    el.className = 'k' + (killer === me || victim === me || assists.includes(me) ? ' me' : '') + (ab === 'ult' ? ' kult' : '') + (killer && killer.team !== me.team ? ' foe' : '');
    const side = (h: Hero) => (h.team === me.team ? 'a' : 'e');
    const who = (h: Hero) => `<span class="kp ${side(h)}"><img src="${portraits[h.def.id] ?? ''}" alt=""><b>${esc(h.name)}</b></span>`;
    el.innerHTML = killer
      ? `${who(killer)}${assists.length ? `<small class="ka">+${assists.length}</small>` : ''}<span class="kab" style="--hc:${killer.def.color}">${icon(ab ? killer.def.abilities[ab].icon : UI.swords, 'kx')}</span>${who(victim)}`
      : `${icon(UI.skull, 'kx')}${who(victim)}`;
    this.els.feed.prepend(el);
    while (this.els.feed.children.length > 5) this.els.feed.lastElementChild!.remove();
    setTimeout(() => el.remove(), 7000);
    // personal elimination ticker under the crosshair
    if (killer === me && victim !== me) this.elim(`<span class="et">${icon(UI.skull)}<span>Eliminated</span></span><b><span>${esc(victim.name)}</span></b>`, '');
    else if (assists.includes(me)) this.elim(`<span class="et"><span>Assist</span></span><b><span>${esc(victim.name)}</span></b>`, 'as');
    if (victim === me) {
      this.deathTotal = Math.max(1, victim.respawnT);
      this.els.dtCard.style.display = killer ? '' : 'none';
      this.els.dtK.lastChild!.textContent = killer ? 'Eliminated by' : 'Eliminated';
      if (killer) {
        (this.els.dtAv as HTMLImageElement).src = portraits[killer.def.id] ?? '';
        this.els.dtN.textContent = killer.name;
        this.els.dtH.textContent = killer.def.name;
        this.els.dtCard.style.setProperty('--hc', killer.def.color);
      }
    }
  }

  private elim(html: string, cls: string) {
    const e = document.createElement('div');
    e.className = 'el ' + cls;
    e.innerHTML = html;
    this.els.elims.prepend(e);
    while (this.els.elims.children.length > 3) this.els.elims.lastElementChild!.remove();
    setTimeout(() => e.remove(), 2600);
  }

  announce(text: string, sub = '', tone: 'gold' | 'red' | 'blue' = 'gold') {
    // single eliminations and your own death have dedicated widgets (ticker, death card)
    if (text === 'ELIMINATED' || text === 'YOU WERE ELIMINATED') return;
    const a = this.els.announce;
    (a.querySelector('.big') as HTMLElement).textContent = text;
    (a.querySelector('.small') as HTMLElement).textContent = sub;
    this.restart(a, 'announce', 'show ' + tone);
  }

  private coTimer = 0;

  /** Kill-feat banner: a hex badge slams in, the title wipes on with a light sweep. */
  callout(c: Callout) {
    const root = this.root.querySelector('.callout') as HTMLElement;
    const BADGE: Partial<Record<Callout['kind'], string>> = { multi: `×${c.count}`, firstBlood: '1', shutdown: '✕', wiped: '!', revenge: '↺', ultDenied: '⊘', clutch: String(c.count), longshot: `${c.count}m` };
    const badge = BADGE[c.kind] ?? String(c.count);
    (root.querySelector('.co-n') as HTMLElement).textContent = badge;
    const title = root.querySelector('.co-title span') as HTMLElement;
    title.textContent = c.title;
    (root.querySelector('.co-glow') as HTMLElement).textContent = c.title;
    (root.querySelector('.co-sub') as HTMLElement).textContent = c.sub;
    (root.querySelector('.co-tags') as HTMLElement).innerHTML = c.tags.map((t) => `<i>+ ${esc(t)}</i>`).join('');
    const pips = Math.min(c.streak, 10);
    (root.querySelector('.co-pips') as HTMLElement).innerHTML = c.streak >= 2 ? Array.from({ length: pips }, (_, i) => `<i style="--i:${i}"></i>`).join('') + (c.streak > 10 ? `<b>+${c.streak - 10}</b>` : '') : '';
    this.restart(root, 'callout', `show k-${c.kind} t${c.tier}`);
    this.root.classList.add('co-on');
    clearTimeout(this.coTimer);
    this.coTimer = window.setTimeout(() => this.root.classList.remove('co-on'), 2900);
  }

  countdown(n: number) {
    this.els.cdNum.textContent = n === 0 ? 'Fight' : String(n);
    this.restart(this.els.countdown, 'countdown', 'pop' + (n === 0 ? ' go' : ''));
  }

  update(dt: number, camera: THREE.PerspectiveCamera, fps: number, drawCalls: number) {
    const g = this.g, h = g.local, c = this.c, E = this.els;
    if (!h) return;
    c.text('fps', E.fps, settings.showFps ? `${Math.round(fps)} FPS · ${drawCalls} draws` : '');
    c.style('hs', this.root, '--hs', String(settings.hudScale));
    c.style('xc', this.root, '--xc', settings.crosshairColor);

    // health
    const hpFrac = Math.max(0, Math.min(1, h.hp / h.maxHp));
    const fk = hpFrac.toFixed(3);
    // damage: the fill drops at once and a warm chunk drains after it; healing: a green ghost leads and the fill catches up
    c.style('hpf', E.fill, 'transform', `scaleX(${fk})`);
    c.style('hpg', E.ghost, 'transform', `scaleX(${fk})`);
    c.style('hpt', E.trail, 'transform', `scaleX(${fk})`);
    c.text('hpv', E.hpv, String(Math.ceil(h.hp)));
    c.cls('low', E.vitals, 'low', h.alive && hpFrac < 0.35);
    this.healFlashT -= dt;
    this.healT -= dt;
    if (h.hp > this.lastHp + 0.5) {
      this.healT = 0.45;
      if (this.healFlashT <= 0) { this.healFlashT = 0.5; this.restart(E.hpbar, 'hpbar', 'heal'); this.healing = false; }
    }
    if ((this.healT > 0) !== this.healing) { this.healing = this.healT > 0; E.hpbar.classList.toggle('healing', this.healing); }
    const hurtPulse = h.hp < this.lastHp - 0.5 ? 0.6 : 0;
    this.lastHp = h.hp;
    const lowV = h.alive ? Math.max(0, (0.4 - hpFrac) / 0.4) * 0.8 : 0;
    this.vig = Math.max(lowV, hurtPulse, this.vig - dt * 2);
    c.style('vig', E.vignette, 'opacity', this.vig.toFixed(2));

    // abilities
    const rmbCd = h.secondaryCd > 0;
    const rmbFrac = rmbCd ? h.secondaryCd / h.def.secondaryCd : 0;
    c.style('rmbp', E.rmbCd, '--p', `${Math.round(rmbFrac * 100)}%`);
    c.text('rmbn', E.rmbNum, rmbCd ? (h.secondaryCd < 1 ? h.secondaryCd.toFixed(1) : String(Math.ceil(h.secondaryCd))) : '');
    c.cls('rmbc', E.rmb, 'cooling', rmbCd);
    if (this.rmbWasCd && !rmbCd) this.restart(E.rmb, 'slot s-rmb', 'flash');
    this.rmbWasCd = rmbCd;
    c.cls('lmba', E.lmb, 'active', h.alive && h.input.primary);
    if (h.primaryCd > this.lastPrimaryCd + 0.01) this.xKick = Math.min(1, this.xKick + 0.5);
    this.lastPrimaryCd = h.primaryCd;
    this.xKick = Math.max(0, this.xKick - dt * 5);
    c.style('xk', E.crosshair, 'transform', `scale(${(1 + this.xKick * 0.35).toFixed(3)})`);
    c.style('ult', E.ultRing, 'strokeDashoffset', (RING * (1 - h.ult)).toFixed(1));
    c.text('ultp', E.ultPct.firstChild as unknown as HTMLElement, String(Math.floor(h.ult * 100)));
    const ready = h.ult >= 1;
    if (ready !== this.ultWasReady) {
      E.ult.classList.toggle('ready', ready);
      if (ready) { this.restart(E.ultEdge, 'ult-edge', 'pulse'); this.restart(E.uToast, 'u-toast', 'on'); }
      this.ultWasReady = ready;
    }
    c.cls('dead', this.root, 'is-dead', !h.alive);

    // score & time (ally always on the left)
    const info = MODE_INFO[g.config!.mode];
    const sa = g.score[h.team], se = g.score[1 - h.team];
    if (sa !== this.lastScore[0] || se !== this.lastScore[1]) {
      if (this.lastScore[0] >= 0) {
        if (sa !== this.lastScore[0]) this.restart(E.scoreA, 'hs-n', 'bump');
        if (se !== this.lastScore[1]) this.restart(E.scoreE, 'hs-n', 'bump');
      }
      this.lastScore = [sa, se];
    }
    c.text('sa', E.scoreA, String(sa));
    c.text('se', E.scoreE, String(se));
    c.style('ba', E.barA, 'transform', `scaleX(${Math.min(1, sa / info.target).toFixed(3)})`);
    c.style('be', E.barE, 'transform', `scaleX(${Math.min(1, se / info.target).toFixed(3)})`);
    const ot = g.matchTime <= 0;
    c.text('time', E.timer, ot ? 'Overtime' : mmss(Math.max(0, g.matchTime)));
    c.cls('ot', E.timer, 'ot', ot);
    c.cls('late', E.timer, 'late', !ot && g.matchTime < 30);
    for (let i = 0; i < this.chips.length; i++) {
      const ch = this.chips[i];
      c.cls('cd' + i, ch.el, 'dead', !ch.hero.alive);
      c.text('ct' + i, ch.t, ch.hero.alive ? '' : String(Math.max(0, Math.ceil(ch.hero.respawnT))));
      if (ch.u) {
        c.style('cu' + i, ch.u, 'transform', `scaleX(${(Math.floor(ch.hero.ult * 20) / 20).toFixed(2)})`);
        c.cls('cr' + i, ch.el, 'uready', ch.hero.alive && ch.hero.ult >= 1);
      }
    }

    // death card
    const showDeath = !h.alive && g.state !== 'ended';
    c.cls('death', E.death, 'hidden', !showDeath);
    if (showDeath) {
      c.text('dts', E.dtS, String(Math.max(0, Math.ceil(h.respawnT))));
      c.style('dtr', E.dtRc, 'strokeDashoffset', (DEATH_RING * Math.max(0, h.respawnT) / this.deathTotal).toFixed(1));
    }

    // damage direction
    const camYaw = g.camRig.yaw;
    for (const d of this.dirs) {
      if (d.t <= 0) continue;
      d.t = Math.max(0, d.t - dt);
      d.el.style.opacity = String(Math.min(1, d.t));
      const ang = Math.atan2(-(d.from.x - h.pos.x), -(d.from.z - h.pos.z));
      d.el.style.transform = `rotate(${camYaw - ang}rad)`;
    }

    // floating damage numbers (pooled)
    const W = window.innerWidth, H = window.innerHeight;
    for (const n of this.nums) {
      if (!n.live) continue;
      n.t += dt;
      if (n.t > 0.9) { n.live = false; n.el.style.opacity = '0'; continue; }
      this.v.copy(n.pos).project(camera);
      if (this.v.z > 1) { n.el.style.opacity = '0'; continue; }
      const x = (this.v.x * 0.5 + 0.5) * W + n.vx * n.t;
      const y = (-this.v.y * 0.5 + 0.5) * H - n.t * 70;
      const s = (n.t < 0.1 ? 1.6 - n.t * 6 : 1) * n.size;
      n.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${s.toFixed(2)})`;
      n.el.style.opacity = String(Math.min(1, (0.9 - n.t) * 4).toFixed(2));
    }

    // nameplates
    for (const p of this.plates) {
      const hero = p.hero;
      let vis = hero.alive;
      let dist = 0;
      if (vis) {
        this.v.set(hero.pos.x, hero.pos.y + 2.25, hero.pos.z);
        dist = this.v.distanceTo(camera.position);
        const enemy = hero.team !== h.team;
        if (enemy && (dist > 45 || !g.los(camera.position, this.v))) vis = false;
        else {
          this.v.project(camera);
          if (this.v.z > 1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) vis = false;
        }
      }
      if (vis !== p.shown) { p.el.style.display = vis ? '' : 'none'; p.shown = vis; }
      if (!vis) continue;
      const x = (this.v.x * 0.5 + 0.5) * W, y = (-this.v.y * 0.5 + 0.5) * H;
      const s = Math.max(0.55, Math.min(1, 14 / dist));
      p.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${s.toFixed(3)})`;
      const f = Math.round((hero.hp / hero.maxHp) * 200) / 200;
      if (f !== p.frac) { p.frac = f; p.bar.style.transform = `scaleX(${f})`; }
    }

    // scoreboard (refreshed a few times a second while held)
    const sbOn = this.scoreboardOn && g.state !== 'ended';
    c.cls('sb', E.scoreboard, 'hidden', !sbOn);
    if (sbOn) {
      this.sbT -= dt;
      if (this.sbT <= 0) { this.sbT = 0.25; E.scoreboard.innerHTML = scoreboardHtml(g); }
    }
  }
}

function scoreboardHtml(g: Game) {
  const me = g.local;
  const info = MODE_INFO[g.config!.mode];
  const team = (t: number) => {
    const ally = t === me.team;
    const rows = g.heroes.filter((x) => x.team === t).sort((a, b) => b.stats.kills - a.stats.kills || a.stats.deaths - b.stats.deaths);
    return `<div class="sb-team ${ally ? 'ally' : 'enemy'}">
      <div class="sb-th"><b>${ally ? 'Your team' : 'Enemy team'}</b><span>${g.score[t]}</span></div>
      <div class="sb-r sb-hd"><span></span><span>Player</span><span>E</span><span>D</span><span>A</span><span>Dmg</span><span>Heal</span></div>
      ${rows.map((x) => `<div class="sb-r${x.isLocal ? ' me' : ''}${x.alive ? '' : ' dead'}" style="--hc:${x.def.color}">
        <span class="sb-av"><img src="${portraits[x.def.id] ?? ''}" alt="">${x.alive ? '' : `<b>${Math.max(0, Math.ceil(x.respawnT))}</b>`}</span>
        <span class="sb-n"><b>${esc(x.name)}</b><small>${x.def.name}</small></span>
        <span class="sb-k">${x.stats.kills}</span><span>${x.stats.deaths}</span><span>${x.stats.assists}</span>
        <span>${Math.round(x.stats.damage)}</span><span>${Math.round(x.stats.healing)}</span></div>`).join('')}
    </div>`;
  };
  return `<div class="sb-head"><span class="chip">${g.config!.mode}</span><b>${info.label}</b><span class="sb-goal">First to ${info.target}</span>
    <span class="sb-time">${g.matchTime <= 0 ? 'Overtime' : mmss(Math.max(0, g.matchTime))}</span></div>
    ${team(me.team)}${team(1 - me.team)}`;
}
