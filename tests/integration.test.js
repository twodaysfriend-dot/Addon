import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { state, fixture, interact, entries, hit, holdStick, sample, drain } from './runtime.js';
import { Item } from './fakes.js';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (['@minecraft/server', '@minecraft/server-ui'].includes(specifier)) {
    return { url: new URL('./runtime.js', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
await import('../behavior_pack/scripts/main.js');

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
  const { player, inv, blocks } = fixture({ double: true });
  player.tags.add('chestlog.admin');
  holdStick(player, inv);
  state.answers.push({ selection: 4 }, { selection: 0 }, { selection: 0 }, { canceled: true });
  await hit(player, blocks[0]);
  player.tags.delete('chestlog.admin');
  assert.equal(breaking(player, blocks[0]).cancel, false);
  assert.equal(breaking(player, blocks[1]).cancel, false);
  assert.equal(entries().length, 0, 'ownership management should not create item logs');
});

test('revoked admin permission cannot finish an owner assignment', async () => {
  const { player, inv, blocks } = fixture();
  player.tags.add('chestlog.admin');
  holdStick(player, inv);
  state.answers.push({ selection: 4 }, { selection: 0 }, () => {
    player.tags.clear(); return { selection: 0 };
  });
  await hit(player, blocks[0]);
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

test('normal right-click never cancels vanilla access or opens custom forms, including for admins', async () => {
  const { player, blocks } = fixture();
  for (const admin of [false, true]) {
    if (admin) player.tags.add('chestlog.admin');
    assert.equal((await interact(player, blocks[0])).cancel, false);
  }
  assert.equal(state.forms.length, 0);
  sample();
  assert.equal(entries().length, 0);
});

test('sneak + stick right-click also never opens an inspector', async () => {
  const { player, inv, blocks } = fixture();
  player.tags.add('chestlog.admin'); holdStick(player, inv);
  assert.equal((await interact(player, blocks[0], { itemStack: inv.getItem(1) })).cancel, false);
  assert.equal(state.forms.length, 0);
});

test('inspection requires admin, sneaking, stick AND left-click', async () => {
  const { player, inv, blocks } = fixture();
  await hit(player, blocks[0]);
  holdStick(player, inv);
  await hit(player, blocks[0]); // no admin
  player.tags.add('chestlog.admin'); player.isSneaking = false;
  await hit(player, blocks[0]);
  player.isSneaking = true; player.selectedSlotIndex = 0;
  await hit(player, blocks[0]); // diamond
  assert.equal(state.forms.length, 0);
  player.selectedSlotIndex = 1;
  await hit(player, blocks[0]);
  assert.match(state.forms[0].heading, /플레이어별/);
});

test('admin inspection cancels instant creative breaking and repeated hits are deduplicated', async () => {
  const { player, inv, blocks } = fixture();
  player.tags.add('chestlog.admin'); holdStick(player, inv);
  player.getGameMode = () => 'Creative';
  assert.equal(breaking(player, blocks[0]).cancel, true);
  await hit(player, blocks[0]);
  await drain();
  assert.equal(state.forms.length, 1);
  await hit(player, blocks[0]);
  assert.equal(state.forms.length, 1);
});

test('vanilla deposit is observed as a player inference without altering inventories', async () => {
  const { player, inv, chest, blocks } = fixture();
  await interact(player, blocks[0]);
  // The game, not the addon, performs this transfer.
  chest.setItem(0, new Item('minecraft:diamond', 4));
  inv.setItem(0, new Item('minecraft:diamond', 6));
  sample();
  assert.equal(chest.total('minecraft:diamond'), 4);
  assert.equal(inv.total('minecraft:diamond'), 6);
  assert.equal(entries().length, 1);
  assert.equal(entries()[0].action, 'deposit');
  assert.equal(entries()[0].amount, 4);
  assert.equal(entries()[0].playerId, player.id);
  assert.equal(entries()[0].attribution, 'inferred');
  sample();
  assert.equal(entries().length, 1, 'unchanged samples must not duplicate the record');
});

test('vanilla withdrawal is observed with matching inventory gain', async () => {
  const { player, inv, chest, blocks } = fixture();
  chest.setItem(0, new Item('minecraft:emerald', 8));
  await interact(player, blocks[0]);
  chest.setItem(0, new Item('minecraft:emerald', 3));
  inv.setItem(2, new Item('minecraft:emerald', 5));
  sample();
  assert.equal(entries()[0].action, 'withdraw');
  assert.equal(entries()[0].amount, 5);
  assert.equal(entries()[0].playerId, player.id);
});

test('hopper-like change without a matching player delta is unassigned', async () => {
  const { player, chest, blocks } = fixture();
  await interact(player, blocks[0]);
  chest.setItem(0, new Item('minecraft:iron_ingot', 1));
  sample();
  assert.equal(entries()[0].attribution, 'unattributed');
  assert.equal(entries()[0].playerId, '');
});

test('simultaneous same-item transfers are not attributed to either player', async () => {
  const { player, inv, chest, blocks } = fixture();
  const secondInv = new (inv.constructor)(36, { 0: new Item('minecraft:diamond', 10) });
  const other = { ...player, id: 'p2', name: '다른사람', getComponent: () => ({ container: secondInv }) };
  state.players.push(other);
  await interact(player, blocks[0]);
  await interact(other, blocks[0]);
  chest.setItem(0, new Item('minecraft:diamond', 8));
  inv.setItem(0, new Item('minecraft:diamond', 6));
  secondInv.setItem(0, new Item('minecraft:diamond', 6));
  sample();
  assert.equal(entries()[0].attribution, 'unattributed');
  assert.equal(entries()[0].amount, 8);
});

test('slot rearrangements and opening without moving items produce no log', async () => {
  const { player, chest, blocks } = fixture();
  chest.setItem(0, new Item('minecraft:diamond', 5));
  await interact(player, blocks[0]); sample();
  chest.setItem(0, undefined); chest.setItem(10, new Item('minecraft:diamond', 5));
  sample();
  assert.equal(entries().length, 0);
});

test('save failure leaves vanilla access intact and retries without duplicate entries', async () => {
  const { player, inv, chest, blocks } = fixture();
  await interact(player, blocks[0]);
  chest.setItem(0, new Item('minecraft:diamond', 2)); inv.setItem(0, new Item('minecraft:diamond', 8));
  state.failCompletion = true; sample();
  assert.equal(entries().length, 0);
  assert.equal(chest.total('minecraft:diamond'), 2);
  state.failCompletion = false; sample(); sample();
  assert.equal(entries().length, 1);
  assert.equal(entries()[0].amount, 2);
});

test('destroying a watched chest does not manufacture a withdrawal', async () => {
  const { player, chest, blocks } = fixture();
  chest.setItem(0, new Item('minecraft:diamond', 5));
  await interact(player, blocks[0]);
  state.after.playerBreakBlock({ block: blocks[0], brokenBlockPermutation: { type: { id: 'minecraft:chest' } } });
  chest.setItem(0, undefined); sample();
  assert.equal(entries().length, 0);
});

test('sessions expire and leaving players do not remain attribution candidates', async () => {
  const { player, chest, blocks } = fixture();
  await interact(player, blocks[0]);
  sample(6001);
  chest.setItem(0, new Item('minecraft:diamond', 2)); sample();
  assert.equal(entries().length, 0);
  await interact(player, blocks[0]);
  state.after.playerLeave({ playerId: player.id });
  chest.setItem(0, new Item('minecraft:diamond', 3)); sample();
  assert.equal(entries().length, 0);
});

test('inspector displays player-grouped inferred records with an explicit uncertainty label', async () => {
  const { player, inv, chest, blocks } = fixture();
  await interact(player, blocks[0]);
  chest.setItem(0, new Item('minecraft:diamond', 2)); inv.setItem(0, new Item('minecraft:diamond', 8)); sample();
  player.tags.add('chestlog.admin'); holdStick(player, inv);
  state.answers.push({ selection: 0 }, { canceled: true }, { canceled: true });
  await hit(player, blocks[0]);
  const detail = state.forms.find(form => form.heading.startsWith('플레이어 '));
  assert.ok(detail);
  assert.match(detail.text, /행위자 추정/);
  assert.match(detail.text, /minecraft:diamond/);
  assert.match(detail.text, /KST/);
});

test('inspection of either double-chest half resolves the same history', async () => {
  const { player, inv, chest, blocks } = fixture({ double: true });
  await interact(player, blocks[1]);
  chest.setItem(40, new Item('minecraft:diamond', 2)); inv.setItem(0, new Item('minecraft:diamond', 8)); sample();
  assert.equal([...state.properties.keys()].filter(key => key.startsWith('chestlog:')).length, 1);
  player.tags.add('chestlog.admin'); holdStick(player, inv);
  await hit(player, blocks[0]);
  assert.ok(state.forms[0].buttons.some(text => text.includes('플레이어')));
});

test('replacing a chest at the same coordinates resets the observer without manufacturing transfers', async () => {
  const { player, chest, blocks } = fixture();
  chest.setItem(0, new Item('minecraft:diamond', 5));
  await interact(player, blocks[0]);
  chest.setItem(0, undefined);
  state.after.playerPlaceBlock({ player, block: blocks[0] });
  sample();
  assert.equal(entries().length, 0);
});

test('switching between chests within one sampling interval does not assign a shared inventory delta', async () => {
  const { player, inv, chest, blocks } = fixture();
  const otherContainer = new (inv.constructor)(27);
  const otherBlock = { ...blocks[0], location: { x: 3, y: 64, z: 0 }, getComponent: () => ({ container: otherContainer }) };
  blocks.push(otherBlock);
  await interact(player, blocks[0]);
  chest.setItem(0, new Item('minecraft:diamond', 2)); inv.setItem(0, new Item('minecraft:diamond', 8));
  await interact(player, otherBlock);
  otherContainer.setItem(0, new Item('minecraft:diamond', 1)); inv.setItem(0, new Item('minecraft:diamond', 7));
  sample();
  assert.ok(entries().length > 0);
  assert.ok(entries().every(entry => entry.attribution === 'unattributed'));
});
