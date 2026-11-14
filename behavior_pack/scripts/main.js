import { world, system, BlockTypes, GameMode } from '@minecraft/server';
import { ActionFormData, ModalFormData } from '@minecraft/server-ui';
import { ADMIN_TAG, PREFIX, MAX_CHESTS, describeItem, fingerprint, planTransfer, applyTransfer, appendEntry, koreaTime } from './core.js';

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

/** Resolve again after every form response; never retain a stale Container across awaits.
 * @param {Player} player @param {Target} target
 */
function resolve(player, target) {
  if (!player.isValid || player.getGameMode() === GameMode.Spectator) throw new Error('이 상태에서는 상자를 이용할 수 없습니다.');
  const p = player.location;
  if (player.dimension.id !== target.dimension ||
      Math.hypot(p.x - target.position.x - 0.5, p.y - target.position.y - 0.5, p.z - target.position.z - 0.5) > 8) {
    throw new Error('상자 가까이에서 다시 이용해 주세요.');
  }
  const dimension = player.dimension;
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
    throw new Error('기록 상자 한도(1024개)에 도달했습니다. 새 상자 이용이 차단됩니다.');
  }
  return { version: 1, dimension: chest.dimension, positions: chest.positions, dropped: 0, entries: [] };
}
/** @param {Player} player @param {Entry['action']} action @returns {Entry} */
function newEntry(player, action) {
  return { time: new Date().toISOString(), player: player.name, playerId: player.id, action, status: 'complete' };
}
/** @param {Resolved} chest @param {Entry} entry */
function record(chest, entry) {
  const journal = appendEntry(journalFor(chest), entry);
  world.setDynamicProperty(chest.key, JSON.stringify(journal));
  return journal;
}
/** @param {Player} player */
function inventory(player) {
  const container = player.getComponent('minecraft:inventory')?.container;
  if (!container) throw new Error('인벤토리를 읽을 수 없습니다.');
  return container;
}
/** Remove formatting/control characters so item names cannot impersonate audit lines.
 * @param {string} value @param {number} [limit]
 */
function displayText(value, limit = 80) {
  return value.replace(/§./g, '').replace(/[\r\n\t\u0000-\u001f\u007f]/g, ' ').slice(0, limit);
}
/** @param {import('@minecraft/server').ItemStack} item */
function itemLabel(item) { return `${displayText(item.nameTag || item.typeId.replace('minecraft:', ''))} ×${item.amount}`; }

/** @param {Player} player @param {Target} target @param {string} expectedKey @param {'deposit'|'withdraw'} direction */
async function chooseItem(player, target, expectedKey, direction) {
  const chest = resolve(player, target);
  if (chest.key !== expectedKey) throw new Error('상자 연결이 변경되었습니다. 다시 열어 주세요.');
  const source = direction === 'deposit' ? inventory(player) : chest.container;
  const form = new ActionFormData().title(direction === 'deposit' ? '상자에 넣기' : '상자에서 가져가기');
  /** @type {{slot:number, item:import('@minecraft/server').ItemStack}[]} */
  const choices = [];
  for (let slot = 0; slot < source.size; slot++) {
    const item = source.getItem(slot);
    if (!item) continue;
    choices.push({ slot, item });
    form.button(`[${slot + 1}] ${itemLabel(item)}`);
  }
  if (!choices.length) { tell(player, '이동할 아이템이 없습니다.'); return; }
  form.body('아이템을 선택하세요. 변경된 아이템은 이동하지 않습니다.');
  const selected = await form.show(player);
  if (selected.canceled || selected.selection === undefined) return;
  const choice = choices[selected.selection];
  if (!choice) return;
  let amount = 1;
  if (choice.item.amount > 1) {
    const count = await new ModalFormData().title('이동 수량')
      .slider(itemLabel(choice.item), 1, choice.item.amount, { defaultValue: choice.item.amount, valueStep: 1 })
      .submitButton('이동 및 기록').show(player);
    if (count.canceled) return;
    amount = Number(count.formValues?.[0]);
  }
  const current = resolve(player, target);
  if (current.key !== expectedKey) throw new Error('상자 연결이 변경되었습니다. 다시 열어 주세요.');
  const playerInventory = inventory(player);
  const from = direction === 'deposit' ? playerInventory : current.container;
  const to = direction === 'deposit' ? current.container : playerInventory;
  // Everything below runs synchronously; concurrent form responses are revalidated in order.
  const plan = planTransfer(from, to, choice.slot, choice.item, amount);
  /** @type {Entry} */
  const entry = { ...newEntry(player, direction), item: describeItem(choice.item), amount, status: 'pending' };
  const journal = record(current, entry); // Persist intent first; if storage fails, move nothing.
  try {
    applyTransfer(plan);
  } catch (error) {
    entry.status = 'failed';
    // applyTransfer may report incomplete rollback; preserve that uncertainty in the audit.
    if (String(error).includes('복구 실패')) entry.status = 'uncertain';
    world.setDynamicProperty(current.key, JSON.stringify(journal));
    throw error;
  }
  entry.status = 'complete';
  try { world.setDynamicProperty(current.key, JSON.stringify(journal)); }
  catch (error) {
    tell(player, '§c아이템은 이동했지만 완료 기록 저장에 실패했습니다. 관리자가 미확정 기록을 확인해야 합니다.');
    console.error(`[ChestHistory] completion save failed: ${error}`);
    return;
  }
  tell(player, `${direction === 'deposit' ? '넣기' : '가져가기'} 완료: ${choice.item.typeId} ×${amount}`);
}

/** @param {Player} player */
function requireAdmin(player) {
  if (!player.hasTag(ADMIN_TAG)) throw new Error(`관리자만 조회할 수 있습니다. /tag <이름> add ${ADMIN_TAG}`);
}
/** @param {Entry} entry */
function formatEntry(entry) {
  const action = { open: '열람 요청', deposit: '넣음', withdraw: '가져감' }[entry.action];
  const state = { complete: '', pending: ' [미확정: 중단/저장 실패 가능]', failed: ' [실패·복구됨]', uncertain: ' [복구 미확정]' }[entry.status];
  return `${koreaTime(entry.time)}\n${displayText(entry.player)} · ${action}${state}` +
    (entry.item ? `\n${entry.item.type}${entry.item.name ? ` (${displayText(entry.item.name)})` : ''} ×${entry.amount}` +
      (entry.item.damage !== null ? `\n손상도: ${entry.item.damage}` : '') +
      (entry.item.enchantments.length ? `\n인챈트: ${entry.item.enchantments.map(e => `${displayText(e.id)} ${e.level}`).join(', ')}` : '') : '');
}

/** @param {Player} player @param {string[]} keys */
async function history(player, keys) {
  let page = 0;
  while (player.isValid) {
    requireAdmin(player);
    const journals = keys.map(load).filter(/** @returns {j is Journal} */ j => j !== undefined);
    const entries = journals.flatMap(j => j.entries).sort((a, b) => b.time.localeCompare(a.time));
    const pages = Math.max(1, Math.ceil(entries.length / 8));
    page = Math.min(page, pages - 1);
    const dropped = journals.reduce((n, j) => n + j.dropped, 0);
    const form = new ActionFormData().title(`상자 기록 ${page + 1}/${pages}`)
      .body(`최근 기록 ${entries.length}건 / 보존 한도로 삭제 ${dropped}건\n시간: 한국 표준시(KST)\n` +
        '미확정 기록은 실제 이동을 확정할 수 없습니다.\n\n' +
        (entries.slice(page * 8, page * 8 + 8).map(formatEntry).join('\n\n') || '기록이 없습니다.'))
      .button('이전 페이지').button('다음 페이지').button('닫기');
    const result = await form.show(player);
    if (result.canceled || result.selection === 2) return;
    requireAdmin(player);
    if (result.selection === 0) page = Math.max(0, page - 1);
    if (result.selection === 1) page = Math.min(pages - 1, page + 1);
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
      .filter(/** @returns {row is {key:string,journal:Journal}} */ row => row.journal !== undefined)
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

/** @param {Player} player @param {Target} target @param {boolean} inspect */
async function openChest(player, target, inspect) {
  let chest = resolve(player, target);
  const initialKey = chest.key;
  if (inspect) { requireAdmin(player); await history(player, relatedKeys(chest)); return; }
  record(chest, newEntry(player, 'open'));
  while (player.isValid) {
    chest = resolve(player, target);
    if (chest.key !== initialKey) throw new Error('상자 연결이 변경되었습니다. 다시 열어 주세요.');
    const form = new ActionFormData().title('상자 보관함')
      .body(`${chest.dimension} · ${chest.positions.map(coordinates).join(' / ')}\n` +
        `사용 중인 칸: ${chest.container.size - chest.container.emptySlotsCount}/${chest.container.size}\n` +
        '넣기·가져가기는 플레이어와 수량을 기록합니다.\n기본 상자 화면 대신 이 화면을 사용합니다.')
      .button('상자에서 가져가기 / 내용 보기').button('내 인벤토리에서 넣기');
    const admin = player.hasTag(ADMIN_TAG);
    if (admin) form.button('이 상자 기록 조회').button('전체 상자 기록 목록');
    form.button('닫기');
    const response = await form.show(player);
    if (response.canceled || response.selection === undefined || response.selection === (admin ? 4 : 2)) return;
    if (response.selection === 0) await chooseItem(player, target, initialKey, 'withdraw');
    else if (response.selection === 1) await chooseItem(player, target, initialKey, 'deposit');
    else if (admin && response.selection === 2) await history(player, relatedKeys(resolve(player, target)));
    else if (admin && response.selection === 3) await allHistory(player);
  }
}

world.beforeEvents.playerInteractWithBlock.subscribe(event => {
  if (event.cancel || !CHESTS.has(event.block.typeId)) return;
  // Sneak + a placeable block retains vanilla placement, for building double chests.
  // Sneaking suppresses vanilla container opening for this path.
  if (event.player.isSneaking && event.itemStack && BlockTypes.get(event.itemStack.typeId)) return;
  event.cancel = true;
  if (!event.isFirstEvent || active.has(event.player.id)) return;
  const player = event.player;
  const target = { dimension: event.block.dimension.id, position: { ...event.block.location }, type: event.block.typeId };
  const inspect = player.isSneaking && event.itemStack?.typeId === 'minecraft:stick';
  active.add(player.id);
  system.run(() => {
    openChest(player, target, inspect).catch(error => {
      tell(player, `§c${error instanceof Error ? error.message : String(error)}`);
      console.warn(`[ChestHistory] ${error}`);
    }).finally(() => active.delete(player.id));
  });
});
