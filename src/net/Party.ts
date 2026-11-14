import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { HeroId } from '../game/types';
import { MODE_INFO, type Mode } from '../game/Game';
import { PATCH_NOTES } from '../data/patchNotes';

/**
 * Party transport: WebRTC data channels, peer to peer. The host's browser is the server (bots, health, score);
 * friends join with a 5-letter code or an invite link. Signaling uses the free PeerJS broker, and PeerJS's TURN
 * relay covers networks that can't connect directly, so nothing needs an account or a server of ours.
 */

export type Diff = 'easy' | 'normal' | 'hard';
export type ArenaKind = 'study' | 'museum';
export type Phase = 'lobby' | 'select' | 'map' | 'loading' | 'match';

export interface Member { id: string; name: string; team: number; hero: HeroId; ready: boolean; host: boolean }
export interface PartyState { code: string; mode: Mode; diff: Diff; phase: Phase; arena: ArenaKind | null; members: Member[] }

/** Anything on the wire: lobby traffic plus the match messages NetMatch defines. */
export type Msg = { t: string; [k: string]: unknown };

const VERSION = PATCH_NOTES[0].version;
const ID_PREFIX = 'legends-assembly-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const HEARTBEAT = 1000;
const TIMEOUT = 15000;

function newCode() {
  let c = '';
  const r = crypto.getRandomValues(new Uint32Array(5));
  for (let i = 0; i < 5; i++) c += ALPHABET[r[i] % ALPHABET.length];
  return c;
}

/** Clean up what people paste: a full invite link, lowercase, spaces. */
export function parseCode(text: string) {
  const m = /[?&#]join=([A-Za-z0-9]+)/.exec(text);
  const raw = (m ? m[1] : text).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.length === 5 ? raw : null;
}

export function inviteLink(code: string) {
  return `${location.origin}${location.pathname}?join=${code}`;
}

/** Dev/testing: `?peer=localhost:9000` points at a self-hosted PeerServer (`npx peerjs --port 9000`). */
function peerOptions(): PeerOptions {
  const ice: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  ];
  const dev = new URLSearchParams(location.search).get('peer');
  if (dev) {
    const [host, port] = dev.split(':');
    return { host, port: Number(port) || 9000, path: '/', secure: false, config: { iceServers: [] }, debug: 1 };
  }
  return { config: { iceServers: ice }, debug: 1 };
}

interface Link { id: string; r: DataConnection | null; u: DataConnection | null; seen: number }

export class Party {
  readonly role: 'host' | 'guest';
  readonly code: string;
  selfId = '';
  state: PartyState;
  /** Lobby state changed (members, picks, mode, phase). */
  onState: ((s: PartyState) => void) | null = null;
  /** Any other message. `from` is the sender's member id (guests only ever hear from the host). */
  onMsg: ((m: Msg, from: string) => void) | null = null;
  /** Someone left (host side): their member id. */
  onLeft: ((id: string, name: string) => void) | null = null;
  /** The party is gone for us (host left, kicked, network). */
  onClose: ((why: string) => void) | null = null;
  private peer: Peer;
  private links = new Map<string, Link>();
  private hb = 0;
  private closed = false;

  private constructor(role: 'host' | 'guest', code: string, peer: Peer, state: PartyState) {
    this.role = role; this.code = code; this.peer = peer; this.state = state;
    this.selfId = peer.id;
    this.hb = window.setInterval(() => this.heartbeat(), HEARTBEAT);
    peer.on('disconnected', () => { if (!this.closed) peer.reconnect(); });
  }

  get isHost() { return this.role === 'host'; }
  get me() { return this.state.members.find((m) => m.id === this.selfId) ?? null; }
  get size() { return MODE_INFO[this.state.mode].size; }

  // ───────────────────────── setup ─────────────────────────

  static async host(name: string, hero: HeroId, mode: Mode, diff: Diff): Promise<Party> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = newCode();
      try {
        const peer = await openPeer(ID_PREFIX + code);
        const party = new Party('host', code, peer, {
          code, mode, diff, phase: 'lobby', arena: null,
          members: [{ id: peer.id, name, team: 0, hero, ready: false, host: true }],
        });
        peer.on('connection', (c) => party.accept(c));
        peer.on('error', (e) => { if ((e as { type?: string }).type === 'network') party.onClose?.('Lost the connection to the party service'); });
        return party;
      } catch (e) {
        if ((e as { type?: string }).type !== 'unavailable-id') throw e;
      }
    }
    throw new Error('Could not open a party, try again');
  }

  static async join(code: string, name: string, hero: HeroId): Promise<Party> {
    const peer = await openPeer();
    const hostId = ID_PREFIX + code;
    return new Promise<Party>((resolve, reject) => {
      let done = false;
      const fail = (why: string) => { if (done) return; done = true; clearTimeout(timer); peer.destroy(); reject(new Error(why)); };
      const timer = window.setTimeout(() => fail('The party did not answer. Check the code and try again'), 15000);
      peer.on('error', (e) => {
        const t = (e as { type?: string }).type;
        fail(t === 'peer-unavailable' ? `No party with code ${code}` : 'Could not reach the party');
      });
      const r = peer.connect(hostId, { label: 'r', reliable: true, serialization: 'json', metadata: { name, hero, ver: VERSION } });
      const u = peer.connect(hostId, { label: 'u', reliable: false, serialization: 'json' });
      r.on('data', (d) => {
        const m = d as Msg;
        if (done) return;
        if (m.t === 'reject') return fail(String(m.why));
        if (m.t !== 'lobby') return;
        done = true;
        clearTimeout(timer);
        const party = new Party('guest', code, peer, m.s as PartyState);
        const link: Link = { id: hostId, r, u, seen: performance.now() };
        party.links.set(hostId, link);
        party.wire(link, r);
        party.wire(link, u);
        r.on('close', () => party.lost('The host closed the party'));
        resolve(party);
      });
      r.on('error', () => fail('Could not reach the party'));
    });
  }

  // ───────────────────────── host: members ─────────────────────────

  private accept(c: DataConnection) {
    const id = c.peer;
    let link = this.links.get(id);
    if (!link) { link = { id, r: null, u: null, seen: performance.now() }; this.links.set(id, link); }
    if (c.label === 'u') { link.u = c; c.on('open', () => this.wire(link!, c)); return; }
    link.r = c;
    c.on('open', () => {
      const meta = (c.metadata ?? {}) as { name?: string; hero?: HeroId; ver?: string };
      const reject = (why: string) => { c.send({ t: 'reject', why }); setTimeout(() => c.close(), 400); this.links.delete(id); };
      if (meta.ver !== VERSION) return reject(`Different game version (host ${VERSION}). Both of you: refresh the page`);
      if (this.state.phase !== 'lobby' && this.state.phase !== 'select') return reject('That party is already in a match. Try again when it ends');
      const team = this.openTeam();
      if (team < 0) return reject('That party is full');
      const name = String(meta.name ?? 'Player').slice(0, 16) || 'Player';
      this.state.members.push({ id, name, team, hero: meta.hero ?? 'einstein', ready: false, host: false });
      this.wire(link!, c);
      c.on('close', () => this.drop(id));
      this.pushState();
    });
  }

  /** Friends join the host's side while it has room (they can switch to face you), else the other one; -1 = full. */
  private openTeam() {
    const n = [0, 1].map((t) => this.state.members.filter((m) => m.team === t).length);
    const t = this.state.members.find((m) => m.host)?.team ?? 0;
    return n[t] < this.size ? t : n[1 - t] < this.size ? 1 - t : -1;
  }

  private wire(link: Link, c: DataConnection) {
    c.on('data', (d) => {
      link.seen = performance.now();
      const m = d as Msg;
      if (m.t === 'hb') return;
      if (this.isHost) this.hostReceive(link.id, m);
      else if (m.t === 'lobby') { this.state = m.s as PartyState; this.onState?.(this.state); }
      else if (m.t === 'kick') this.lost(String(m.why ?? 'You were removed from the party'));
      else this.onMsg?.(m, link.id);
    });
  }

  private hostReceive(from: string, m: Msg) {
    const mem = this.state.members.find((x) => x.id === from);
    if (!mem) return;
    if (m.t === 'set') {
      if (typeof m.hero === 'string') { mem.hero = m.hero as HeroId; }
      if (typeof m.ready === 'boolean') mem.ready = m.ready;
      if (typeof m.team === 'number') this.trySetTeam(mem, m.team);
      this.pushState();
      return;
    }
    this.onMsg?.(m, from);
  }

  private trySetTeam(mem: Member, team: number) {
    if (team !== 0 && team !== 1 || team === mem.team) return false;
    if (this.state.members.filter((x) => x.team === team).length >= this.size) return false;
    mem.team = team;
    mem.ready = false;
    return true;
  }

  private drop(id: string) {
    const i = this.state.members.findIndex((m) => m.id === id);
    const link = this.links.get(id);
    this.links.delete(id);
    link?.r?.close(); link?.u?.close();
    if (i < 0) return;
    const [m] = this.state.members.splice(i, 1);
    this.onLeft?.(id, m.name);
    this.pushState();
  }

  pushState() {
    if (!this.isHost) return;
    this.broadcast({ t: 'lobby', s: this.state });
    this.onState?.(this.state);
  }

  // ───────────────────────── changes (either side) ─────────────────────────

  /** Your own pick / ready / team. Hosts apply directly; guests ask the host. */
  setMine(p: { hero?: HeroId; ready?: boolean; team?: number }) {
    const me = this.me;
    if (!me) return;
    if (this.isHost) {
      if (p.hero) me.hero = p.hero;
      if (p.ready !== undefined) me.ready = p.ready;
      if (p.team !== undefined) this.trySetTeam(me, p.team);
      this.pushState();
    } else {
      // optimistic: show it right away, the host's copy follows
      if (p.hero) me.hero = p.hero;
      if (p.ready !== undefined) me.ready = p.ready;
      this.send({ t: 'set', ...p });
      this.onState?.(this.state);
    }
  }

  /** Host: a mode is only allowed if everyone still fits (players are rebalanced into the new size). */
  canMode(mode: Mode) { return this.state.members.length <= MODE_INFO[mode].size * 2; }
  setMode(mode: Mode) {
    if (!this.isHost || !this.canMode(mode)) return false;
    this.state.mode = mode;
    const size = MODE_INFO[mode].size;
    for (const t of [0, 1]) {
      const on = this.state.members.filter((m) => m.team === t);
      for (const m of on.slice(size)) m.team = 1 - t;
    }
    this.pushState();
    return true;
  }
  setDiff(d: Diff) { if (this.isHost) { this.state.diff = d; this.pushState(); } }
  setPhase(p: Phase, arena: ArenaKind | null = this.state.arena) {
    if (!this.isHost) return;
    this.state.phase = p;
    this.state.arena = arena;
    if (p === 'select' || p === 'lobby') for (const m of this.state.members) m.ready = false;
    this.pushState();
  }
  kick(id: string) {
    if (!this.isHost || id === this.selfId) return;
    this.sendTo(id, { t: 'kick', why: 'The host removed you from the party' });
    setTimeout(() => this.drop(id), 300);
  }

  // ───────────────────────── messaging ─────────────────────────

  /** Guest → host. */
  send(m: Msg, reliable = true) {
    for (const l of this.links.values()) this.put(l, m, reliable);
  }
  sendTo(id: string, m: Msg, reliable = true) {
    const l = this.links.get(id);
    if (l) this.put(l, m, reliable);
  }
  /** Host → every guest (optionally skipping one). */
  broadcast(m: Msg, reliable = true, except?: string) {
    for (const l of this.links.values()) if (l.id !== except && this.state.members.some((x) => x.id === l.id)) this.put(l, m, reliable);
  }
  private put(l: Link, m: Msg, reliable: boolean) {
    const c = (!reliable && l.u?.open ? l.u : l.r);
    if (c?.open) { try { c.send(m); } catch { /* channel closing */ } }
  }

  private lastBeat = 0;
  private heartbeat() {
    const now = performance.now();
    // we were the ones frozen (a long arena load, a background tab): don't blame everyone else for it
    if (this.lastBeat && now - this.lastBeat > 3000) for (const l of this.links.values()) l.seen = now;
    this.lastBeat = now;
    for (const l of [...this.links.values()]) {
      this.put(l, { t: 'hb' }, true);
      if (now - l.seen > TIMEOUT) {
        if (this.isHost) this.drop(l.id);
        else this.lost('Lost the connection to the host');
      }
    }
  }

  private lost(why: string) {
    if (this.closed) return;
    this.leave();
    this.onClose?.(why);
  }

  leave() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.hb);
    if (this.isHost) this.broadcast({ t: 'kick', why: 'The host closed the party' });
    setTimeout(() => {
      for (const l of this.links.values()) { l.r?.close(); l.u?.close(); }
      this.peer.destroy();
    }, 150);
  }
}

function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
    const timer = window.setTimeout(() => { peer.destroy(); reject(new Error('The party service did not answer. Check your connection')); }, 12000);
    peer.once('open', () => { clearTimeout(timer); resolve(peer); });
    peer.once('error', (e) => { clearTimeout(timer); peer.destroy(); reject(e); });
  });
}
