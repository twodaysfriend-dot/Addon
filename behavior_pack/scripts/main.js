import './bloodcurdle.js';
import { world, system, GameMode } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
import { ADMIN_TAG, PREFIX, MAX_CHESTS, groupByPlayer, appendEntry, koreaTime } from './core.js';

import { ChestWatcher } from './watcher.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('@minecraft/server').Vector3} Vector3 */
/** @typedef {import('./core.js').Journal} Journal */
/** @typedef {import('./core.js').Entry} Entry */
/** @typedef {{dimension: string, position: Vector3, type: string}} Target */
/** @typedef {ReturnType<typeof resolve>} Resolved */
const active = new Set();
const CHESTS = new Set(['minecraft:chest', 'minecraft:trapped_chest']);

/** @param {Player} player @param {string} message */
function tell(player, message) {
  try { player.sendMessage(`§6[상자 기록]§r ${message}`); } catch { /* disconnected */ }
}
/** @param {Vector3} p */
function coordinates(p) { return `${p.x}, ${p.y}, ${p.z}`; }
/** @param {string} dimension @param {Vector3} p */
function keyFor(dimension, p) { return `${PREFIX}${dimension.replace('minecraft:', '')}_${p.x}_${p.y}_${p.z}`; }

/** Revalidate range and topology before administrative operations.
 * @param {Player} player @param {Target} target
 */
function resolve(player, target) {
  if (!player.isValid || player.getGameMode() === GameMode.Spectator) throw new Error('이 상태에서는 상자를 이용할 수 없습니다.');
  const p = player.location;
  if (player.dimension.id !== target.dimension ||
      Math.hypot(p.x - target.position.x - 0.5, p.y - target.position.y - 0.5, p.z - target.position.z - 0.5) > 8) {
    throw new Error('상자 가까이에서 다시 이용해 주세요.');
  }
  return resolveChest(target);
}

/** @param {Target} target */
function resolveChest(target) {
  const dimension = world.getDimension(target.dimension);
  const block = dimension.getBlock(target.position);
  if (!block || block.typeId !== target.type || !CHESTS.has(block.typeId)) throw new Error('상자가 없어졌거나 변경되었습니다.');
  const container = block.getComponent('minecraft:inventory')?.container;
  if (!container || ![27, 54].includes(container.size)) throw new Error('지원하지 않는 상자 구조입니다.');
  const positions = [{ ...block.location }];
  if (container.size === 54) {
    const facing = block.permutation.getState('minecraft:cardinal_direction') ?? block.permutation.getState('facing_direction');
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const neighbor = dimension.getBlock({ x: block.location.x + dx, y: block.location.y, z: block.location.z + dz });
      if (!neighbor || neighbor.typeId !== block.typeId) continue;
      const otherFacing = neighbor.permutation.getState('minecraft:cardinal_direction') ?? neighbor.permutation.getState('facing_direction');
      const perpendicular = facing === 'north' || facing === 'south' || facing === 2 || facing === 3 ? dz === 0 : dx === 0;
      if (facing === otherFacing && perpendicular && neighbor.getComponent('minecraft:inventory')?.container?.size === 54) {
        positions.push({ ...neighbor.location });
      }
    }
    if (positions.length !== 2) throw new Error('큰 상자 연결을 확인할 수 없습니다. 다시 시도해 주세요.');
  }
  positions.sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);
  return { container, dimension: target.dimension, positions, key: keyFor(target.dimension, positions[0]) };
}

/** @param {string} key @returns {Journal | undefined} */
function load(key) {
  const raw = world.getDynamicProperty(key);
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') throw new Error('기록 저장소의 형식이 잘못되었습니다.');
  const journal = JSON.parse(raw);
  if (journal.version !== 1 || !Array.isArray(journal.entries) || !Array.isArray(journal.positions)) {
    throw new Error('기록 저장소를 읽을 수 없습니다. 관리자에게 알려 주세요.');
  }
  return journal;
}
/** @param {Resolved} chest @returns {Journal} */
function journalFor(chest) {
  const found = load(chest.key);
  if (found) return found;
  if (world.getDynamicPropertyIds().filter(id => id.startsWith(PREFIX)).length >= MAX_CHESTS) {
    throw new Error('기록 상자 한도(1024개)에 도달했습니다. 새 상자의 기록을 저장할 수 없습니다. 바닐라 이용은 유지됩니다.');
  }
  return { version: 1, dimension: chest.dimension, positions: chest.positions, dropped: 0, entries: [] };
}
/** Batch a sample into one world-property write, keeping vanilla inventory untouched.
 * @param {Resolved} chest @param {Entry[]} entries
 */
function recordBatch(chest, entries) {
  let journal = journalFor(chest);
  for (const entry of entries) journal = appendEntry(journal, entry);
  world.setDynamicProperty(chest.key, JSON.stringify(journal));
}

/** Remove formatting/control characters so item names cannot impersonate audit lines.
 * @param {string} value @param {number} [limit]
 */
function displayText(value, limit = 80) {
  return value.replace(/§./g, '').replace(/[\r\n\t\u0000-\u001f\u007f]/g, ' ').slice(0, limit);
}
/** @param {Player} player */
function requireAdmin(player) {
  if (!player.hasTag(ADMIN_TAG)) throw new Error(`관리자만 조회할 수 있습니다. /tag <이름> add ${ADMIN_TAG}`);
}
/** @param {Entry} entry */
function formatEntry(entry) {
  const action = { open: '열람 요청', deposit: '넣음', withdraw: '가져감' }[entry.action];
  const state = { complete: '', pending: ' [미확정: 중단/저장 실패 가능]', failed: ' [실패·복구됨]', uncertain: ' [복구 미확정]' }[entry.status];
  const attribution = entry.attribution === 'inferred' ? ' [행위자 추정]' : entry.attribution === 'unattributed' ? ' [행위자 미확인]' : ' [이전 직접 처리]';
  return `${koreaTime(entry.time)}\n${displayText(entry.player)} · ${action}${state}${attribution}` +
    (entry.item ? `\n${entry.item.type}${entry.item.name ? ` (${displayText(entry.item.name)})` : ''} ×${entry.amount}` +
      (entry.item.damage !== null ? `\n손상도: ${entry.item.damage}` : '') +
      (entry.item.enchantments.length ? `\n인챈트: ${entry.item.enchantments.map(e => `${displayText(e.id)} ${e.level}`).join(', ')}` : '') : '');
}

/** @param {string[]} keys */
function readEntries(keys) {
  return keys.map(load).filter(/** @returns {j is Journal} */ j => j !== undefined)
    .flatMap(j => j.entries).sort((a, b) => b.time.localeCompare(a.time));
}

/** @param {Player} player @param {string[]} keys @param {string | undefined} playerId @param {boolean} [issues] */
async function entryHistory(player, keys, playerId, issues = false) {
  let page = 0;
  while (player.isValid) {
    requireAdmin(player);
    const all = readEntries(keys);
    const group = groupByPlayer(all).find(g => g.id === playerId);
    const entries = issues ? all.filter(e => e.action !== 'open' && (e.status !== 'complete' || e.attribution === 'unattributed')) : group?.entries ?? [];
    const pages = Math.max(1, Math.ceil(entries.length / 8));
    page = Math.min(page, pages - 1);
    const form = new ActionFormData().title(`${issues ? '미확인·오류' : displayText(group?.name ?? '플레이어')} ${page + 1}/${pages}`)
      .body(`기록 ${entries.length}건 · 한국 표준시(KST)\n` +
        (issues ? '관찰한 수량 변화입니다. 플레이어의 행위로 확정할 수 없습니다.\n\n' : '바닐라 기록의 행위자는 추정이며 자동 장치·동시 이용과 구분이 불완전합니다.\n\n') +
        (entries.slice(page * 8, page * 8 + 8).map(formatEntry).join('\n\n') || '기록이 없습니다.'))
      .button('이전 페이지').button('다음 페이지').button('뒤로');
    const result = await form.show(player);
    if (result.canceled || result.selection === 2) return;
    requireAdmin(player);
    if (result.selection === 0) page = Math.max(0, page - 1);
    if (result.selection === 1) page = Math.min(pages - 1, page + 1);
  }
}

/** @param {Player} player @param {string[]} keys @param {Target} [target] */
async function history(player, keys, target) {
  let page = 0;
  while (player.isValid) {
    requireAdmin(player);
    const all = readEntries(keys);
    const groups = groupByPlayer(all);
    const pages = Math.max(1, Math.ceil(groups.length / 12));
    page = Math.min(page, pages - 1);
    const visible = groups.slice(page * 12, page * 12 + 12);
    const dropped = keys.reduce((n, key) => n + (load(key)?.dropped ?? 0), 0);
    const form = new ActionFormData().title(`상자 기록 · 플레이어별 ${page + 1}/${pages}`)
      .body(`입출고한 플레이어 ${groups.length}명 · 보존 한도 삭제 ${dropped}건\n` +
        '플레이어를 선택하면 그 사람의 시간·아이템·수량을 볼 수 있습니다.\n' +
        '바닐라 관찰 기록의 행위자는 추정입니다. 열기만 한 경우는 기록하지 않습니다.');
    for (const group of visible) form.button(`${displayText(group.name)}\n넣기 ${group.deposits}회 · 가져가기 ${group.withdrawals}회`);
    form.button('이전').button('다음').button('미확인·오류 기록').button('전체 상자 기록');
    if (target) form.button('상자 소유자 지정');
    form.button('닫기');
    const result = await form.show(player);
    if (result.canceled || result.selection === undefined || result.selection === visible.length + (target ? 5 : 4)) return;
    requireAdmin(player);
    if (result.selection < visible.length) await entryHistory(player, keys, visible[result.selection].id);
    else if (result.selection === visible.length) page = Math.max(0, page - 1);
    else if (result.selection === visible.length + 1) page = Math.min(pages - 1, page + 1);
    else if (result.selection === visible.length + 2) await entryHistory(player, keys, undefined, true);
    else if (result.selection === visible.length + 3) await allHistory(player);
    else if (target && result.selection === visible.length + 4) await assignOwner(player, target, resolve(player, target).key);
  }
}

/** Include old single/double topology logs sharing a position, without copying or losing history.
 * @param {Resolved} chest
 */
function relatedKeys(chest) {
  return world.getDynamicPropertyIds().filter(id => {
    if (!id.startsWith(PREFIX)) return false;
    const j = load(id);
    return j?.dimension === chest.dimension && j.positions.some(a => chest.positions.some(b =>
      a.x === b.x && a.y === b.y && a.z === b.z));
  });
}

/** @param {Player} player */
async function allHistory(player) {
  let page = 0;
  while (player.isValid) {
    requireAdmin(player);
    const rows = world.getDynamicPropertyIds().filter(id => id.startsWith(PREFIX)).map(key => ({ key, journal: load(key) }))
      .filter(/** @returns {row is {key:string,journal:Journal}} */ row => row.journal !== undefined && row.journal.entries.some(e => e.action !== 'open'))
      .sort((a, b) => (b.journal.entries.at(-1)?.time ?? '').localeCompare(a.journal.entries.at(-1)?.time ?? ''));
    const pages = Math.max(1, Math.ceil(rows.length / 12));
    page = Math.min(page, pages - 1);
    const visible = rows.slice(page * 12, page * 12 + 12);
    const form = new ActionFormData().title(`전체 상자 ${page + 1}/${pages}`)
      .body('기록이 남은 상자 목록입니다. 철거한 상자의 기록도 조회됩니다.');
    for (const row of visible) form.button(`${row.journal.dimension}\n${row.journal.positions.map(coordinates).join(' / ')}`);
    form.button('이전').button('다음').button('닫기');
    const response = await form.show(player);
    if (response.canceled || response.selection === undefined || response.selection === visible.length + 2) return;
    requireAdmin(player);
    if (response.selection < visible.length) await history(player, [visible[response.selection].key]);
    else if (response.selection === visible.length) page = Math.max(0, page - 1);
    else page = Math.min(pages - 1, page + 1);
  }
}

const watcher = new ChestWatcher({
  readChest: resolveChest,
  players: () => world.getAllPlayers(),
  tick: () => system.currentTick,
  save: recordBatch,
  error: error => console.warn(`[ChestHistory] observation save failed; vanilla access unchanged: ${error}`),
});
system.runInterval(() => watcher.sample(), 5);

// Right-click is never cancelled and never opens a form. Only take a read-only baseline.
world.beforeEvents.playerInteractWithBlock.subscribe(event => {
  if (event.cancel || !event.isFirstEvent || !CHESTS.has(event.block.typeId) ||
      (event.player.isSneaking && event.itemStack)) return;
  try {
    watcher.observe(event.player, { dimension: event.block.dimension.id, position: { ...event.block.location }, type: event.block.typeId });
  } catch (error) { console.warn(`[ChestHistory] observation start failed; vanilla access unchanged: ${error}`); }
});

/** @param {Player} player @param {import('@minecraft/server').ItemStack} [held] */
function inspectGesture(player, held) {
  return player.hasTag(ADMIN_TAG) && player.isSneaking &&
    (held ?? player.getComponent('minecraft:inventory')?.container?.getItem(player.selectedSlotIndex))?.typeId === 'minecraft:stick';
}
const inspectCooldown = new Map();
/** @param {Player} player @param {import('@minecraft/server').Block} block */
function requestInspection(player, block) {
  if (active.has(player.id) || (inspectCooldown.get(player.id) ?? -Infinity) > system.currentTick) return;
  const target = { dimension: block.dimension.id, position: { ...block.location }, type: block.typeId };
  active.add(player.id);
  inspectCooldown.set(player.id, system.currentTick + 10);
  system.run(() => {
    (async () => {
      requireAdmin(player);
      const chest = resolve(player, target);
      await history(player, relatedKeys(chest), target);
    })().catch(error => tell(player, `§c${error instanceof Error ? error.message : String(error)}`))
      .finally(() => active.delete(player.id));
  });
}
world.afterEvents.entityHitBlock.subscribe(event => {
  if (event.damagingEntity.typeId !== 'minecraft:player' || !CHESTS.has(event.hitBlock.typeId)) return;
  const player = /** @type {Player} */ (event.damagingEntity);
  if (inspectGesture(player)) requestInspection(player, event.hitBlock);
});
world.afterEvents.playerLeave.subscribe(event => {
  inspectCooldown.delete(event.playerId);
  watcher.disconnect(event.playerId);
});

const OWNER_PREFIX = 'chestowner:';
/** @typedef {{id:string, name:string}} Owner */
/** @param {string} dimension @param {Vector3} position */
function ownerKey(dimension, position) { return keyFor(dimension, position).replace(PREFIX, OWNER_PREFIX); }
/** @param {string} dimension @param {Vector3} position @returns {Owner | undefined} */
function getOwner(dimension, position) {
  const raw = world.getDynamicProperty(ownerKey(dimension, position));
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') throw new Error('소유자 저장소 형식 오류');
  const data = JSON.parse(raw);
  if (typeof data.id !== 'string' || typeof data.name !== 'string') throw new Error('소유자 정보 오류');
  return data;
}
/** @param {Resolved} chest */
function ownerNames(chest) {
  return [...new Set(chest.positions.map(p => {
    try { return displayText(getOwner(chest.dimension, p)?.name ?? '미등록 (관리자만 파괴 가능)'); }
    catch { return '확인 실패 (관리자만 파괴 가능)'; }
  }))].join(' / ');
}

/** @param {Player} player @param {Target} target @param {string} expectedKey */
async function assignOwner(player, target, expectedKey) {
  requireAdmin(player);
  const players = world.getAllPlayers();
  const form = new ActionFormData().title('상자 소유자 지정')
    .body('현재 큰 상자의 양쪽을 포함해 소유자를 지정합니다. 온라인 플레이어를 선택하세요.');
  for (const candidate of players) form.button(displayText(candidate.name));
  form.button('취소');
  const response = await form.show(player);
  if (response.canceled || response.selection === undefined || response.selection >= players.length) return;
  requireAdmin(player);
  const chosen = players[response.selection];
  const chest = resolve(player, target);
  if (chest.key !== expectedKey) throw new Error('상자 연결이 변경되었습니다. 다시 열어 주세요.');
  const confirm = await new ActionFormData().title('소유자 변경 확인')
    .body(`${chest.positions.map(coordinates).join(' / ')}\n새 소유자: ${displayText(chosen.name)}`)
    .button('지정').button('취소').show(player);
  if (confirm.canceled || confirm.selection !== 0) return;
  requireAdmin(player);
  const current = resolve(player, target);
  if (current.key !== expectedKey) throw new Error('상자 연결이 변경되었습니다. 다시 열어 주세요.');
  const keys = current.positions.map(p => ownerKey(current.dimension, p));
  const before = keys.map(key => world.getDynamicProperty(key));
  try {
    for (const key of keys) world.setDynamicProperty(key, JSON.stringify({ id: chosen.id, name: chosen.name }));
  } catch (error) {
    for (let i = 0; i < keys.length; i++) {
      try { world.setDynamicProperty(keys[i], before[i]); } catch { /* unknown owner stays protected */ }
    }
    throw error;
  }
  tell(player, `상자 소유자를 ${displayText(chosen.name)}(으)로 지정했습니다.`);
}

// Ownership is registered on placement, never on first opening (which would allow claims).
world.afterEvents.playerPlaceBlock.subscribe(event => {
  if (!CHESTS.has(event.block.typeId)) return;
  watcher.invalidate(event.block.dimension.id, event.block.location);
  try {
    world.setDynamicProperty(ownerKey(event.block.dimension.id, event.block.location),
      JSON.stringify({ id: event.player.id, name: event.player.name }));
  } catch (error) {
    // An unregistered chest is still protected: only admins can break it.
    tell(event.player, '§c소유자 기록에 실패했습니다. 관리자에게 소유자 지정을 요청하세요.');
    console.error(`[ChestHistory] ownership save failed: ${error}`);
  }
});

world.beforeEvents.playerBreakBlock.subscribe(event => {
  if (event.cancel || !CHESTS.has(event.block.typeId)) return;
  if (inspectGesture(event.player, event.itemStack)) {
    event.cancel = true; // Including instant creative breaks: inspection must never destroy the chest.
    requestInspection(event.player, event.block);
    return;
  }
  if (event.player.hasTag(ADMIN_TAG)) return;
  let allowed = false;
  try {
    const chest = resolve(event.player, { dimension: event.block.dimension.id, position: event.block.location, type: event.block.typeId });
    // A mixed-owner or unknown half of a double chest must not be broken through the other half.
    allowed = chest.positions.every(p => getOwner(chest.dimension, p)?.id === event.player.id);
  } catch { /* unreadable ownership and topology fail closed */ }
  if (!allowed) {
    event.cancel = true;
    system.run(() => tell(event.player, '§c소유자와 관리자만 상자를 부술 수 있습니다. 미등록·혼합 소유 상자는 관리자에게 문의하세요.'));
  }
});

world.afterEvents.playerBreakBlock.subscribe(event => {
  if (!CHESTS.has(event.brokenBlockPermutation.type.id)) return;
  watcher.invalidate(event.block.dimension.id, event.block.location);
  try { world.setDynamicProperty(ownerKey(event.block.dimension.id, event.block.location), undefined); }
  catch (error) { console.error(`[ChestHistory] ownership cleanup failed: ${error}`); }
});

world.beforeEvents.explosion.subscribe(event => {
  if (event.cancel) return;
  try {
    const blocks = event.getImpactedBlocks();
    event.setImpactedBlocks(blocks.filter(block => !CHESTS.has(block.typeId)));
  } catch (error) {
    // If the impacted list cannot be inspected, cancel rather than risk chest destruction.
    event.cancel = true;
    console.warn(`[ChestHistory] explosion inspection failed; canceled: ${error}`);
  }
});

// The stable API cannot cancel piston movement. Invalidate ownership at both old/new
// positions instead of accidentally granting another chest's owner permission there.
world.afterEvents.pistonActivate.subscribe(event => {
  try {
    const facing = event.block.permutation.getState('facing_direction');
    const directions = [{x:0,y:-1,z:0}, {x:0,y:1,z:0}, {x:0,y:0,z:-1}, {x:0,y:0,z:1}, {x:-1,y:0,z:0}, {x:1,y:0,z:0}];
    const direction = typeof facing === 'number' ? directions[facing] : undefined;
    if (!direction) throw new Error('피스톤 방향을 확인할 수 없습니다.');
    for (const position of event.piston.getAttachedBlocksLocations()) {
      for (const sign of [-1, 0, 1]) {
        const p = { x: position.x + sign * direction.x, y: position.y + sign * direction.y, z: position.z + sign * direction.z };
        watcher.invalidate(event.block.dimension.id, p);
        const key = ownerKey(event.block.dimension.id, p);
        if (world.getDynamicProperty(key) !== undefined) world.setDynamicProperty(key, undefined);
      }
    }
  } catch (error) { console.error(`[ChestHistory] piston ownership invalidation failed: ${error}`); }
});
