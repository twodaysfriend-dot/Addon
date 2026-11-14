/** Pure transaction and journal logic, also exercised by Node tests. */
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

/** @typedef {{ slot: number, before: ItemStack | undefined, after: ItemStack | undefined }} Write */
/** @typedef {{ source: Container, destination: Container, sourceWrite: Write, writes: Write[], amount: number }} Plan */

/** Build the entire move before changing either inventory. No awaits between planning and commit.
 * @param {Container} source @param {Container} destination @param {number} slot
 * @param {ItemStack} expected @param {number} amount @returns {Plan}
 */
export function planTransfer(source, destination, slot, expected, amount) {
  if (source === destination) throw new Error('같은 보관함으로 이동할 수 없습니다.');
  if (!Number.isInteger(amount) || amount < 1) throw new Error('수량이 올바르지 않습니다.');
  const current = source.getItem(slot);
  if (!current || fingerprint(current) !== fingerprint(expected) || current.amount < amount) {
    throw new Error('아이템이 변경되었습니다. 목록을 다시 열어 주세요.');
  }
  let remaining = amount;
  /** @type {Write[]} */
  const writes = [];
  // Fill matching stacks before empty slots, preserving metadata by cloning.
  for (const emptyPass of [false, true]) {
    for (let i = 0; i < destination.size && remaining > 0; i++) {
      const before = destination.getItem(i);
      if (emptyPass ? before !== undefined : !before || !before.isStackableWith(current)) continue;
      const capacity = before ? current.maxAmount - before.amount : current.maxAmount;
      const count = Math.min(capacity, remaining);
      if (count <= 0) continue;
      const after = (before ?? current).clone();
      after.amount = (before?.amount ?? 0) + count;
      writes.push({ slot: i, before, after });
      remaining -= count;
    }
  }
  if (remaining) throw new Error('받는 쪽의 공간이 부족합니다. 수량을 줄여 주세요.');
  const after = current.amount === amount ? undefined : current.clone();
  if (after) after.amount -= amount;
  return { source, destination, sourceWrite: { slot, before: current, after }, writes, amount };
}

/** @param {Plan} plan */
export function applyTransfer(plan) {
  /** @type {{container: Container, write: Write}[]} */
  const attempted = [];
  try {
    for (const write of plan.writes) {
      attempted.push({ container: plan.destination, write });
      plan.destination.setItem(write.slot, write.after);
    }
    attempted.push({ container: plan.source, write: plan.sourceWrite });
    plan.source.setItem(plan.sourceWrite.slot, plan.sourceWrite.after);
  } catch (error) {
    let restored = true;
    for (const { container, write } of attempted.reverse()) {
      try { container.setItem(write.slot, write.before); } catch { restored = false; }
    }
    if (!restored) throw new Error('복구 실패: 상자와 인벤토리를 관리자가 확인해야 합니다.', { cause: error });
    throw new Error('아이템 이동 실패. 변경 내용을 복구했습니다.', { cause: error });
  }
}

/** @typedef {{time: string, player: string, playerId: string, action: 'open' | 'deposit' | 'withdraw', status: 'complete' | 'pending' | 'failed' | 'uncertain', amount?: number, item?: ReturnType<typeof describeItem>}} Entry */
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
