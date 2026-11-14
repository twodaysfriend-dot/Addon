import { snapshotContainer, diffSnapshots, inferActor } from './core.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('./core.js').Snapshot} Snapshot */
/** @typedef {import('./core.js').Entry} Entry */
/** @typedef {{dimension:string, position:import('@minecraft/server').Vector3, type:string}} Target */
/** @typedef {{container:import('@minecraft/server').Container, dimension:string, positions:import('@minecraft/server').Vector3[], key:string}} Chest */
/** @typedef {{target:Target, chest:Chest, before:Snapshot, players:Map<string,Snapshot>, viewers:Map<string,number>, boundary:boolean, warned:boolean}} Watch */
export const WATCH_TICKS = 6000; // Five minutes from the most recent interaction; no close event exists.
export const MAX_WATCHES = 128;

export class ChestWatcher {
  /** @param {{readChest:(target:Target)=>Chest, players:()=>Player[], tick:()=>number, save:(chest:Chest, entries:Entry[])=>void, error:(error:unknown)=>void}} io */
  constructor(io) {
    this.io = io;
    /** @type {Map<string,Watch>} */
    this.watches = new Map();
    /** @type {Map<string,string>} */
    this.latestChest = new Map();
  }
  /** @param {Player} player @param {Chest} chest */
  near(player, chest) {
    return player.isValid && player.dimension.id === chest.dimension && chest.positions.some(p =>
      Math.hypot(player.location.x - p.x - 0.5, player.location.y - p.y - 0.5, player.location.z - p.z - 0.5) <= 8);
  }
  /** @param {Player} player @returns {Snapshot} */
  inventory(player) {
    const container = player.getComponent('minecraft:inventory')?.container;
    if (!container) throw new Error('플레이어 인벤토리를 관찰할 수 없습니다.');
    return snapshotContainer(container);
  }
  /** Called read-only before vanilla interaction so the initial state precedes a transfer.
   * @param {Player} player @param {Target} target
   */
  observe(player, target) {
    const chest = this.io.readChest(target);
    const previousKey = this.latestChest.get(player.id);
    if (previousKey && previousKey !== chest.key) {
      const previous = this.watches.get(previousKey);
      if (previous) { previous.boundary = true; previous.viewers.delete(player.id); }
    }
    this.latestChest.set(player.id, chest.key);
    let watch = this.watches.get(chest.key);
    if (!watch) {
      if (this.watches.size >= MAX_WATCHES) this.remove(this.watches.keys().next().value);
      const players = new Map();
      for (const p of this.io.players()) {
        if (!this.near(p, chest)) continue;
        try { players.set(p.id, this.inventory(p)); } catch { /* missing baseline means unknown actor */ }
      }
      watch = { target, chest, before: snapshotContainer(chest.container), players, viewers: new Map(), boundary: false, warned: false };
      this.watches.set(chest.key, watch);
    } else if (!watch.viewers.has(player.id)) watch.boundary = true;
    if (previousKey && previousKey !== chest.key) watch.boundary = true;
    watch.viewers.set(player.id, this.io.tick() + WATCH_TICKS);
  }
  /** @param {string} id */
  disconnect(id) {
    this.latestChest.delete(id);
    for (const [key, watch] of this.watches) {
      watch.viewers.delete(id);
      watch.players.delete(id);
      if (!watch.viewers.size) this.remove(key);
    }
  }
  /** @param {string | undefined} key */
  remove(key) {
    if (!key) return;
    this.watches.delete(key);
    for (const [id, last] of this.latestChest) if (last === key) this.latestChest.delete(id);
  }
  /** @param {string} dimension @param {import('@minecraft/server').Vector3} position */
  invalidate(dimension, position) {
    for (const [key, watch] of this.watches) {
      if (watch.chest.dimension === dimension && watch.chest.positions.some(p =>
        p.x === position.x && p.y === position.y && p.z === position.z)) this.remove(key);
    }
  }
  sample() {
    const online = this.io.players();
    const now = this.io.tick();
    // Reuse player snapshots across chests in this sampling pass.
    /** @type {Map<string,Snapshot | undefined>} */
    const inventoryCache = new Map();
    for (const [key, watch] of this.watches) {
      for (const [id, expiry] of watch.viewers) {
        if (expiry <= now || !online.some(p => p.id === id && this.near(p, watch.chest))) watch.viewers.delete(id);
      }
      if (!watch.viewers.size) { this.remove(key); continue; }
      let chest;
      try { chest = this.io.readChest(watch.target); }
      catch { this.remove(key); continue; } // Destruction/unload is not an item withdrawal.
      if (chest.key !== key || JSON.stringify(chest.positions) !== JSON.stringify(watch.chest.positions)) { this.remove(key); continue; }
      try {
        const after = snapshotContainer(chest.container);
        const changes = diffSnapshots(watch.before, after);
        const nearby = online.filter(p => this.near(p, chest));
        const players = nearby.map(p => {
          if (!inventoryCache.has(p.id)) {
            try { inventoryCache.set(p.id, this.inventory(p)); } catch { inventoryCache.set(p.id, undefined); }
          }
          const current = inventoryCache.get(p.id);
          const before = watch.players.get(p.id);
          return { id: p.id, name: p.name, delta: current && before ? diffSnapshots(before, current) : undefined,
            interacted: watch.viewers.has(p.id) && this.latestChest.get(p.id) === key };
        });
        /** @type {Entry[]} */
        const entries = [];
        for (const [itemKey, change] of changes) {
          const actor = watch.boundary ? undefined : inferActor(itemKey, change.amount, players);
          entries.push({ time: new Date().toISOString(), playerId: actor?.id ?? '', player: actor?.name ?? '행위자 미확인',
            action: change.amount > 0 ? 'deposit' : 'withdraw', amount: Math.abs(change.amount), item: change.item,
            status: 'complete', attribution: actor ? 'inferred' : 'unattributed',
            candidates: players.filter(p => p.interacted).map(p => p.name).slice(0, 16) });
        }
        if (entries.length) this.io.save(chest, entries);
        watch.before = after;
        watch.players = new Map(nearby.flatMap(p => {
          const value = inventoryCache.get(p.id);
          return value ? [[p.id, value]] : [];
        }));
        watch.boundary = false;
        watch.warned = false;
      } catch (error) {
        // Keep baselines for a later retry; never mutate/cancel vanilla inventory operations.
        if (!watch.warned) this.io.error(error);
        watch.warned = true;
      }
    }
  }
}
