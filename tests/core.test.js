import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTransfer, applyTransfer, appendEntry, utf8Length, MAX_BYTES, MAX_EVENTS, koreaTime } from '../behavior_pack/scripts/core.js';
import { Item, Inventory } from './fakes.js';

const item = (amount, options) => new Item('minecraft:diamond', amount, options);
const journal = () => ({ version: 1, dimension: 'minecraft:overworld', positions: [{ x: 0, y: 64, z: 0 }], dropped: 0, entries: [] });
const entry = () => ({ time: '2026-11-14T00:00:00.000Z', player: '테스트', playerId: 'p1', action: 'open', status: 'complete' });

test('partial deposit fills stacks first; exact item totals are conserved', () => {
  const from = new Inventory(2, { 0: item(40) });
  const to = new Inventory(3, { 0: item(60) });
  const plan = planTransfer(from, to, 0, from.getItem(0), 30);
  assert.equal(from.getItem(0).amount, 40, 'planning must not mutate inventories');
  applyTransfer(plan);
  assert.equal(from.getItem(0).amount, 10);
  assert.equal(to.getItem(0).amount, 64);
  assert.equal(to.getItem(1).amount, 26);
  assert.equal(from.total('minecraft:diamond') + to.total('minecraft:diamond'), 100);
});

test('full withdrawal clears source and preserves custom names, damage and enchantments', () => {
  const sword = new Item('minecraft:diamond_sword', 1, { max: 1, name: '용사의 검', damage: 19,
    enchantments: [{ type: { id: 'sharpness' }, level: 5 }] });
  const chest = new Inventory(27, { 7: sword });
  const player = new Inventory(36);
  applyTransfer(planTransfer(chest, player, 7, chest.getItem(7), 1));
  assert.equal(chest.getItem(7), undefined);
  assert.deepEqual(player.getItem(0), sword);
});

test('full destination fails without losing or dropping items', () => {
  const from = new Inventory(1, { 0: item(10) });
  const to = new Inventory(1, { 0: item(64) });
  assert.throws(() => planTransfer(from, to, 0, from.getItem(0), 1), /공간/);
  assert.equal(from.getItem(0).amount, 10);
  assert.equal(to.getItem(0).amount, 64);
});

test('same type with a different custom name occupies a separate stack', () => {
  const from = new Inventory(1, { 0: item(1, { name: '보상' }) });
  const to = new Inventory(2, { 0: item(5) });
  applyTransfer(planTransfer(from, to, 0, from.getItem(0), 1));
  assert.equal(to.getItem(0).amount, 5);
  assert.equal(to.getItem(1).nameTag, '보상');
});

test('stale selection from a second player cannot withdraw an already removed stack', () => {
  const chest = new Inventory(27, { 0: item(10) });
  const selectedByBoth = chest.getItem(0);
  const first = new Inventory(36), second = new Inventory(36);
  applyTransfer(planTransfer(chest, first, 0, selectedByBoth, 10));
  assert.throws(() => planTransfer(chest, second, 0, selectedByBoth, 10), /변경/);
  assert.equal(first.total('minecraft:diamond'), 10);
  assert.equal(second.total('minecraft:diamond'), 0);
});

test('a changed item name or equipment damage invalidates the previous selection', () => {
  const chest = new Inventory(1, { 0: item(5, { name: '처음' }) });
  const selected = chest.getItem(0);
  chest.setItem(0, item(5, { name: '바뀜' }));
  assert.throws(() => planTransfer(chest, new Inventory(1), 0, selected, 1), /변경/);
});

test('destination write failure rolls back earlier writes', () => {
  const from = new Inventory(1, { 0: item(10) });
  const to = new Inventory(2, { 0: item(60) });
  const plan = planTransfer(from, to, 0, from.getItem(0), 10);
  to.failOnce = 1;
  assert.throws(() => applyTransfer(plan), /복구했습니다/);
  assert.equal(from.total('minecraft:diamond'), 10);
  assert.equal(to.getItem(0).amount, 60);
  assert.equal(to.getItem(1), undefined);
});

test('source write failure restores all destination writes', () => {
  const from = new Inventory(1, { 0: item(10) });
  const to = new Inventory(2, { 0: item(60) });
  const plan = planTransfer(from, to, 0, from.getItem(0), 10);
  from.failOnce = 0;
  assert.throws(() => applyTransfer(plan), /복구했습니다/);
  assert.equal(from.total('minecraft:diamond'), 10);
  assert.equal(to.total('minecraft:diamond'), 60);
});

test('invalid quantities never modify either container', () => {
  const from = new Inventory(1, { 0: item(10) });
  const to = new Inventory(1);
  for (const amount of [0, -1, 0.5, NaN, Infinity, 11]) {
    assert.throws(() => planTransfer(from, to, 0, from.getItem(0), amount));
  }
  assert.equal(from.getItem(0).amount, 10);
  assert.equal(to.emptySlotsCount, 1);
});

test('ring retention reports discarded entries and never exceeds count or UTF-8 storage limit', () => {
  let current = journal();
  for (let i = 0; i < 200; i++) current = appendEntry(current, { ...entry(), player: '가나다🙂'.repeat(30) });
  assert.ok(current.entries.length <= MAX_EVENTS);
  assert.ok(utf8Length(JSON.stringify(current)) <= MAX_BYTES);
  assert.equal(current.entries.length + current.dropped, 200);
  assert.equal(utf8Length('a한🙂'), Buffer.byteLength('a한🙂'));
});

test('oversized entry is rejected; existing journal is unchanged', () => {
  const original = journal();
  assert.throws(() => appendEntry(original, { ...entry(), player: '한'.repeat(15000) }), /너무 커서/);
  assert.deepEqual(original, journal());
});

test('journal survives JSON persistence with item metadata and stable UTC/KST timestamps', () => {
  const record = { ...entry(), action: 'deposit', amount: 3, item: { type: 'minecraft:diamond', name: '보상' } };
  const saved = JSON.stringify(appendEntry(journal(), record));
  assert.deepEqual(JSON.parse(saved).entries[0], record);
  assert.equal(koreaTime(record.time), '2026-11-14 09:00:00 KST');
});
