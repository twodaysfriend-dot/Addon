/** Inventory observation and journal logic, also exercised by Node tests. */
/** @typedef {import('@minecraft/server').ItemStack} ItemStack */
/** @typedef {import('@minecraft/server').Container} Container */

export const ADMIN_TAG = 'chestlog.admin';
export const PREFIX = 'chestlog:';
export const MAX_CHESTS = 1024;
export const MAX_EVENTS = 120;
export const MAX_BYTES = 28000;

/** @param {string} value */
export function utf8Length(value) {
  let size = 0;
  for (const ch of value) {
    const n = /** @type {number} */ (ch.codePointAt(0));
    size += n <= 0x7f ? 1 : n <= 0x7ff ? 2 : n <= 0xffff ? 3 : 4;
  }
  return size;
}

/** @param {ItemStack} item */
export function describeItem(item) {
  const durability = item.getComponent('minecraft:durability');
  const enchantable = item.getComponent('minecraft:enchantable');
  return {
    type: item.typeId,
    name: item.nameTag ?? '',
    lore: item.getLore(),
    damage: durability?.damage ?? null,
    enchantments: enchantable?.getEnchantments().map(e => ({ id: e.type.id, level: e.level }))
      .sort((a, b) => a.id.localeCompare(b.id)) ?? [],
    properties: item.getDynamicPropertyIds().sort().map(id => [id, item.getDynamicProperty(id)]),
    canDestroy: item.getCanDestroy(),
    canPlaceOn: item.getCanPlaceOn(),
    tags: item.getTags().sort(),
  };
}

/** @param {ItemStack} item */
export function fingerprint(item) { return JSON.stringify(describeItem(item)); }

/** @typedef {{time: string, player: string, playerId: string, action: 'open' | 'deposit' | 'withdraw', status: 'complete' | 'pending' | 'failed' | 'uncertain', attribution?: 'inferred' | 'unattributed', candidates?: string[], amount?: number, item?: ReturnType<typeof describeItem>}} Entry */
/** @typedef {{version: number, dimension: string, positions: {x:number,y:number,z:number}[], dropped: number, entries: Entry[]}} Journal */
/** @param {Journal} journal @param {Entry} entry @returns {Journal} */
export function appendEntry(journal, entry) {
  const result = { ...journal, entries: [...journal.entries, entry] };
  while (result.entries.length > MAX_EVENTS || utf8Length(JSON.stringify(result)) > MAX_BYTES) {
    if (result.entries.length <= 1) throw new Error('아이템 정보가 너무 커서 기록할 수 없습니다.');
    result.entries.shift();
    result.dropped++;
  }
  return result;
}

/** @param {string} iso */
export function koreaTime(iso) {
  return new Date(Date.parse(iso) + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 19) + ' KST';
}

/** Only successful inventory changes belong in the normal player history.
 * @param {Entry[]} entries
 */
export function groupByPlayer(entries) {
  /** @type {Map<string, {id:string, name:string, entries:Entry[], deposits:number, withdrawals:number}>} */
  const groups = new Map();
  for (const entry of [...entries].sort((a, b) => b.time.localeCompare(a.time))) {
    if (entry.attribution === 'unattributed' || entry.status !== 'complete' || !['deposit', 'withdraw'].includes(entry.action) || !entry.item || !((entry.amount ?? 0) > 0)) continue;
    const id = entry.playerId || entry.player;
    let group = groups.get(id);
    if (!group) {
      group = { id, name: entry.player, entries: [], deposits: 0, withdrawals: 0 };
      groups.set(id, group);
    }
    group.entries.push(entry);
    if (entry.action === 'deposit') group.deposits++;
    else group.withdrawals++;
  }
  return [...groups.values()];
}

/** @typedef {{amount:number, item:ReturnType<typeof describeItem>}} Count */
/** @typedef {Map<string, Count>} Snapshot */
/** Count items by full metadata rather than slot, so rearranging items is not a transfer.
 * @param {Container} container @returns {Snapshot}
 */
export function snapshotContainer(container) {
  /** @type {Snapshot} */
  const result = new Map();
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (!item) continue;
    const data = describeItem(item);
    const key = JSON.stringify(data);
    const previous = result.get(key);
    result.set(key, { item: data, amount: (previous?.amount ?? 0) + item.amount });
  }
  return result;
}
/** @param {Snapshot} before @param {Snapshot} after @returns {Snapshot} */
export function diffSnapshots(before, after) {
  /** @type {Snapshot} */
  const changes = new Map();
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const amount = (after.get(key)?.amount ?? 0) - (before.get(key)?.amount ?? 0);
    if (amount) changes.set(key, { amount, item: /** @type {Count} */ (after.get(key) ?? before.get(key)).item });
  }
  return changes;
}
/** A unique balanced inventory delta is only evidence for an actor, never proof.
 * @param {string} key @param {number} amount
 * @param {{id:string, name:string, delta:Snapshot | undefined, interacted:boolean}[]} players
 */
export function inferActor(key, amount, players) {
  const matchingDirection = players.filter(p => (p.delta?.get(key)?.amount ?? 0) * amount < 0);
  const candidate = matchingDirection[0];
  if (players.every(p => p.delta !== undefined) && matchingDirection.length === 1 &&
      candidate.interacted && candidate.delta?.get(key)?.amount === -amount) return candidate;
  return undefined;
}
