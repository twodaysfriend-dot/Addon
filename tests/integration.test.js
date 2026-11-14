import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { state, fixture, interact, entries } from './runtime.js';
import { Item } from './fakes.js';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (['@minecraft/server', '@minecraft/server-ui'].includes(specifier)) {
    return { url: new URL('./runtime.js', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
await import('../behavior_pack/scripts/main.js');

test('actual interaction handler cancels vanilla UI, transfers selected amount and persists actor/time/item', async () => {
  const { player, chest, inv, blocks } = fixture();
  state.answers.push({ selection: 1 }, { selection: 0 }, { formValues: [4] }, { canceled: true });
  const event = await interact(player, blocks[0]);
  assert.equal(event.cancel, true);
  assert.equal(chest.total('minecraft:diamond'), 4);
  assert.equal(inv.total('minecraft:diamond'), 6);
  assert.deepEqual(entries().map(e => [e.action, e.status]), [['deposit', 'complete']]);
  assert.equal(entries()[0].player, '플레이어');
  assert.equal(entries()[0].amount, 4);
  assert.equal(entries()[0].item.type, 'minecraft:diamond');
  assert.ok(Number.isFinite(Date.parse(entries()[0].time)));
});

test('withdrawal handler records and moves items from chest to player', async () => {
  const { player, chest, inv, blocks } = fixture();
  chest.setItem(8, new Item('minecraft:emerald', 7));
  state.answers.push({ selection: 0 }, { selection: 0 }, { formValues: [3] }, { canceled: true });
  await interact(player, blocks[0]);
  assert.equal(chest.total('minecraft:emerald'), 4);
  assert.equal(inv.total('minecraft:emerald'), 3);
  assert.equal(entries()[0].action, 'withdraw');
  assert.equal(entries()[0].amount, 3);
});

test('failure to persist intent prevents any item movement', async () => {
  const { player, chest, inv, blocks } = fixture();
  state.failPending = true;
  state.answers.push({ selection: 1 }, { selection: 0 }, { formValues: [4] });
  await interact(player, blocks[0]);
  assert.equal(chest.total('minecraft:diamond'), 0);
  assert.equal(inv.total('minecraft:diamond'), 10);
  assert.equal(entries().length, 0);
  assert.ok(player.messages.some(message => message.includes('storage full')));
});

test('completion save failure retains pending evidence and warns that movement occurred', async () => {
  const { player, chest, blocks } = fixture();
  state.failCompletion = true;
  state.answers.push({ selection: 1 }, { selection: 0 }, { formValues: [2] }, { canceled: true });
  await interact(player, blocks[0]);
  assert.equal(chest.total('minecraft:diamond'), 2);
  assert.equal(entries()[0].status, 'pending');
  assert.ok(player.messages.some(message => message.includes('완료 기록 저장에 실패')));
});

test('non-admin inspecting with a stick cannot read logs', async () => {
  const { player, blocks } = fixture();
  player.isSneaking = true;
  const event = await interact(player, blocks[0], { itemStack: new Item('minecraft:stick') });
  assert.equal(event.cancel, true);
  assert.equal(state.forms.length, 0);
  assert.ok(player.messages.some(message => message.includes('관리자만')));
});

test('admin can query persisted history using sneak + stick', async () => {
  const { player, blocks } = fixture();
  state.answers.push({ selection: 1 }, { selection: 0 }, { formValues: [2] }, { canceled: true });
  await interact(player, blocks[0]);
  player.tags.add('chestlog.admin');
  player.isSneaking = true;
  await interact(player, blocks[0], { itemStack: new Item('minecraft:stick') });
  assert.match(state.forms.at(-1).heading, /상자 기록/);
  assert.match(state.forms.at(-1).heading, /플레이어별/);
  assert.ok(state.forms.at(-1).buttons.some(button => button.includes('플레이어')));
});

test('walking out of reach while a form is open blocks transfer', async () => {
  const { player, chest, inv, blocks } = fixture();
  state.answers.push({ selection: 1 }, { selection: 0 }, () => {
    player.location.x = 100;
    return { formValues: [2] };
  });
  await interact(player, blocks[0]);
  assert.equal(chest.total('minecraft:diamond'), 0);
  assert.equal(inv.total('minecraft:diamond'), 10);
});

test('double chest uses the same journal from either half', async () => {
  const { player, blocks } = fixture({ double: true });
  state.answers.push({ selection: 1 }, { selection: 0 }, { formValues: [2] }, { canceled: true });
  await interact(player, blocks[1]);
  state.answers.push({ selection: 1 }, { selection: 0 }, { formValues: [2] }, { canceled: true });
  await interact(player, blocks[0]);
  assert.equal(state.properties.size, 1);
  const journal = JSON.parse([...state.properties.values()][0]);
  assert.equal(journal.positions.length, 2);
  assert.equal(journal.entries.length, 2);
});

test('sneaking with a block keeps vanilla placement available', async () => {
  const { player, blocks } = fixture();
  player.isSneaking = true;
  const event = await interact(player, blocks[0], { itemStack: new Item('minecraft:chest') });
  assert.equal(event.cancel, false);
  assert.equal(state.forms.length, 0);
});

test('another addon cancelling the event does not open a chest here', async () => {
  const { player, blocks } = fixture();
  await interact(player, blocks[0], { cancel: true });
  assert.equal(state.forms.length, 0);
});

test('opening and closing a chest without moving items saves no log or player group', async () => {
  const { player, blocks } = fixture();
  await interact(player, blocks[0]);
  assert.equal(entries().length, 0);
  assert.equal(state.properties.size, 0);
});

test('cancelled quantity selection does not create a log', async () => {
  const { player, chest, blocks } = fixture();
  state.answers.push({ selection: 1 }, { selection: 0 }, { canceled: true }, { canceled: true });
  await interact(player, blocks[0]);
  assert.equal(entries().length, 0);
  assert.equal(chest.total('minecraft:diamond'), 0);
});

test('grouped history selects a player then displays only that player’s transfers', async () => {
  const { player, blocks } = fixture();
  state.answers.push({ selection: 1 }, { selection: 0 }, { formValues: [2] }, { canceled: true });
  await interact(player, blocks[0]);
  const originalId = player.id;
  player.id = 'p2'; player.name = '다른사람';
  state.answers.push({ selection: 1 }, { selection: 0 }, { formValues: [1] }, { canceled: true });
  await interact(player, blocks[0]);
  player.id = originalId; player.name = '플레이어';
  player.tags.add('chestlog.admin'); player.isSneaking = true;
  state.answers.push({ selection: 0 }, { canceled: true }, { canceled: true });
  await interact(player, blocks[0], { itemStack: new Item('minecraft:stick') });
  const detail = state.forms.find(form => form.heading.startsWith('다른사람 '));
  assert.ok(detail);
  assert.match(detail.text, /다른사람 · 넣음/);
  assert.doesNotMatch(detail.text, /플레이어 · 넣음/);
  assert.match(detail.text, /minecraft:diamond/);
  assert.match(detail.text, /KST/);
});

test('old open-only history is hidden after upgrade', async () => {
  const { player, blocks } = fixture();
  state.properties.set('chestlog:overworld_0_64_0', JSON.stringify({
    version: 1, dimension: player.dimension.id, positions: [blocks[0].location], dropped: 0,
    entries: [{ action: 'open', status: 'complete', player: '예전사람', playerId: 'old', time: '2026-11-14T00:00:00.000Z' }],
  }));
  player.tags.add('chestlog.admin'); player.isSneaking = true;
  await interact(player, blocks[0], { itemStack: new Item('minecraft:stick') });
  assert.match(state.forms.at(-1).text, /플레이어 0명/);
  assert.ok(!state.forms.at(-1).buttons.some(text => text.includes('예전사람')));
});

function place(player, block) { state.after.playerPlaceBlock({ player, block }); }
function breaking(player, block) {
  const event = { player, block, cancel: false };
  state.before.playerBreakBlock(event);
  while (state.scheduled.length) state.scheduled.shift()();
  return event;
}

test('placer can break their own chest; another player cannot, including creative mode', () => {
  const { player, blocks } = fixture();
  place(player, blocks[0]);
  assert.equal(breaking(player, blocks[0]).cancel, false);
  const stranger = { ...player, id: 'stranger', name: '다른사람', getGameMode: () => 'Creative' };
  assert.equal(breaking(stranger, blocks[0]).cancel, true);
  assert.ok(stranger.messages.some(message => message.includes('소유자와 관리자만')));
});

test('owner identity persists in world storage and compares ID rather than display name', () => {
  const { player, blocks } = fixture();
  place(player, blocks[0]);
  // Round-trip the entire persisted property map; no in-memory owner cache exists.
  const saved = JSON.parse(JSON.stringify([...state.properties]));
  state.properties.clear();
  for (const [key, value] of saved) state.properties.set(key, value);
  assert.equal(breaking({ ...player, name: '새이름' }, blocks[0]).cancel, false);
  assert.equal(breaking({ ...player, id: 'impostor' }, blocks[0]).cancel, true);
});

test('unregistered legacy chests cannot be claimed by opening, and only admins may break them', async () => {
  const { player, blocks } = fixture();
  await interact(player, blocks[0]);
  assert.equal(breaking(player, blocks[0]).cancel, true);
  player.tags.add('chestlog.admin');
  assert.equal(breaking(player, blocks[0]).cancel, false);
});

test('admin may break someone else’s chest without changing ownership', () => {
  const { player, blocks } = fixture();
  place(player, blocks[0]);
  const admin = { ...player, id: 'admin', tags: new Set(['chestlog.admin']) };
  assert.equal(breaking(admin, blocks[0]).cancel, false);
  assert.equal(breaking(player, blocks[0]).cancel, false);
});

test('mixed-owner double chest is protected through both halves, even against either owner', () => {
  const { player, blocks } = fixture({ double: true });
  const other = { ...player, id: 'other', name: '다른사람' };
  place(player, blocks[0]); place(other, blocks[1]);
  for (const user of [player, other]) {
    assert.equal(breaking(user, blocks[0]).cancel, true);
    assert.equal(breaking(user, blocks[1]).cancel, true);
  }
  player.tags.add('chestlog.admin');
  assert.equal(breaking(player, blocks[1]).cancel, false);
});

test('same-owner double chest may be broken through either half', () => {
  const { player, blocks } = fixture({ double: true });
  for (const block of blocks) place(player, block);
  assert.equal(breaking(player, blocks[0]).cancel, false);
  assert.equal(breaking(player, blocks[1]).cancel, false);
});

test('actual break clears ownership; re-placement assigns the new installer', () => {
  const { player, blocks } = fixture();
  place(player, blocks[0]);
  state.after.playerBreakBlock({ block: blocks[0], brokenBlockPermutation: { type: { id: 'minecraft:chest' } } });
  assert.equal(breaking(player, blocks[0]).cancel, true);
  const other = { ...player, id: 'new', name: '새설치자' };
  place(other, blocks[0]);
  assert.equal(breaking(other, blocks[0]).cancel, false);
  assert.equal(breaking(player, blocks[0]).cancel, true);
});

test('explosion filters out every chest half but still affects other blocks', () => {
  const { blocks } = fixture({ double: true });
  const stone = { typeId: 'minecraft:stone' };
  const trapped = { typeId: 'minecraft:trapped_chest' };
  const event = { cancel: false, getImpactedBlocks: () => [...blocks, stone, trapped],
    setImpactedBlocks(blocks) { this.result = blocks; } };
  state.before.explosion(event);
  assert.equal(event.cancel, false);
  assert.deepEqual(event.result, [stone]);
});

test('unreadable explosion list cancels the explosion rather than destroying a chest', () => {
  fixture();
  const event = { cancel: false, getImpactedBlocks() { throw new Error('unavailable'); } };
  state.before.explosion(event);
  assert.equal(event.cancel, true);
});

test('administrator can assign an unknown double chest’s owner with confirmation', async () => {
  const { player, blocks } = fixture({ double: true });
  player.tags.add('chestlog.admin');
  state.answers.push({ selection: 4 }, { selection: 0 }, { selection: 0 }, { canceled: true });
  await interact(player, blocks[0]);
  player.tags.delete('chestlog.admin');
  assert.equal(breaking(player, blocks[0]).cancel, false);
  assert.equal(breaking(player, blocks[1]).cancel, false);
  assert.equal(entries().length, 0, 'ownership management should not create item logs');
});

test('revoked admin permission cannot finish an owner assignment', async () => {
  const { player, blocks } = fixture();
  player.tags.add('chestlog.admin');
  state.answers.push({ selection: 4 }, { selection: 0 }, () => {
    player.tags.clear(); return { selection: 0 };
  });
  await interact(player, blocks[0]);
  assert.equal(breaking(player, blocks[0]).cancel, true);
});

test('piston movement invalidates source and destination owner records instead of reusing stale owners', () => {
  const { player, blocks } = fixture({ double: true });
  for (const block of blocks) place(player, block);
  state.after.pistonActivate({
    block: { dimension: player.dimension, permutation: { getState: () => 5 } },
    piston: { getAttachedBlocksLocations: () => [blocks[0].location] },
  });
  assert.equal(breaking(player, blocks[0]).cancel, true);
  assert.equal(breaking(player, blocks[1]).cancel, true);
});
