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
  assert.deepEqual(entries().map(e => [e.action, e.status]), [['open', 'complete'], ['deposit', 'complete']]);
  assert.equal(entries()[1].player, '플레이어');
  assert.equal(entries()[1].amount, 4);
  assert.equal(entries()[1].item.type, 'minecraft:diamond');
  assert.ok(Number.isFinite(Date.parse(entries()[1].time)));
});

test('withdrawal handler records and moves items from chest to player', async () => {
  const { player, chest, inv, blocks } = fixture();
  chest.setItem(8, new Item('minecraft:emerald', 7));
  state.answers.push({ selection: 0 }, { selection: 0 }, { formValues: [3] }, { canceled: true });
  await interact(player, blocks[0]);
  assert.equal(chest.total('minecraft:emerald'), 4);
  assert.equal(inv.total('minecraft:emerald'), 3);
  assert.equal(entries()[1].action, 'withdraw');
  assert.equal(entries()[1].amount, 3);
});

test('failure to persist intent prevents any item movement', async () => {
  const { player, chest, inv, blocks } = fixture();
  state.failPending = true;
  state.answers.push({ selection: 1 }, { selection: 0 }, { formValues: [4] });
  await interact(player, blocks[0]);
  assert.equal(chest.total('minecraft:diamond'), 0);
  assert.equal(inv.total('minecraft:diamond'), 10);
  assert.equal(entries().length, 1);
  assert.ok(player.messages.some(message => message.includes('storage full')));
});

test('completion save failure retains pending evidence and warns that movement occurred', async () => {
  const { player, chest, blocks } = fixture();
  state.failCompletion = true;
  state.answers.push({ selection: 1 }, { selection: 0 }, { formValues: [2] }, { canceled: true });
  await interact(player, blocks[0]);
  assert.equal(chest.total('minecraft:diamond'), 2);
  assert.equal(entries()[1].status, 'pending');
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
  await interact(player, blocks[0]);
  player.tags.add('chestlog.admin');
  player.isSneaking = true;
  await interact(player, blocks[0], { itemStack: new Item('minecraft:stick') });
  assert.match(state.forms.at(-1).heading, /상자 기록/);
  assert.match(state.forms.at(-1).text, /플레이어/);
  assert.match(state.forms.at(-1).text, /KST/);
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
  await interact(player, blocks[1]);
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
