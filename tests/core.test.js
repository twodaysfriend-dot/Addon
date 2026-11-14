import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotContainer, diffSnapshots, inferActor, appendEntry, utf8Length, MAX_BYTES, MAX_EVENTS, koreaTime } from '../behavior_pack/scripts/core.js';
import { Item, Inventory } from './fakes.js';

const item = (amount, options) => new Item('minecraft:diamond', amount, options);
const journal = () => ({ version: 1, dimension: 'minecraft:overworld', positions: [{ x: 0, y: 64, z: 0 }], dropped: 0, entries: [] });
const entry = () => ({ time: '2026-11-14T00:00:00.000Z', player: '테스트', playerId: 'p1', action: 'open', status: 'complete' });

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

test('history groups completed transfers by stable player ID; opens and errors are excluded', async () => {
  const { groupByPlayer } = await import('../behavior_pack/scripts/core.js');
  const transfer = { ...entry(), action: 'deposit', amount: 2, item: { type: 'minecraft:diamond' } };
  const records = [
    transfer,
    { ...transfer, time: '2026-11-14T00:00:02.000Z', player: '바뀐닉네임', action: 'withdraw' },
    { ...transfer, playerId: 'p2', player: '다른사람' },
    entry(),
    { ...transfer, status: 'pending' },
    { ...transfer, status: 'failed' },
    { ...transfer, amount: 0 },
  ];
  const grouped = groupByPlayer(records);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].id, 'p1');
  assert.equal(grouped[0].name, '바뀐닉네임');
  assert.equal(grouped[0].deposits, 1);
  assert.equal(grouped[0].withdrawals, 1);
  assert.equal(grouped[0].entries.length, 2);
  assert.equal(records.length, 7);
});

test('moving items between slots creates no net inventory change', () => {
  const container = new Inventory(27, { 0: item(10), 1: item(15) });
  const before = snapshotContainer(container);
  container.setItem(0, undefined); container.setItem(1, item(25));
  assert.equal(diffSnapshots(before, snapshotContainer(container)).size, 0);
});

test('net changes preserve exact custom item identity', () => {
  const container = new Inventory(27, { 0: item(10, { name: '보상' }) });
  const before = snapshotContainer(container);
  container.setItem(0, item(6, { name: '보상' }));
  container.setItem(1, item(3));
  const changes = [...diffSnapshots(before, snapshotContainer(container)).values()];
  assert.deepEqual(changes.map(c => [c.item.name, c.amount]), [['보상', -4], ['', 3]]);
});

test('actor inference requires a single exact inverse delta from an interacting player', () => {
  const stack = new Inventory(1, { 0: item(4) });
  const values = snapshotContainer(stack);
  const key = values.keys().next().value;
  const delta = new Map([[key, { ...values.get(key), amount: -4 }]]);
  const person = { id: 'p1', name: '후보', interacted: true, delta };
  assert.equal(inferActor(key, 4, [person]).id, 'p1');
  assert.equal(inferActor(key, 4, [{ ...person, interacted: false }]), undefined);
  assert.equal(inferActor(key, 5, [person]), undefined);
  assert.equal(inferActor(key, 4, [person, { ...person, id: 'p2' }]), undefined);
  assert.equal(inferActor(key, 4, [person, { ...person, id: 'p2', delta: undefined }]), undefined);
});

test('unattributed chest changes do not appear as a named player group', async () => {
  const { groupByPlayer } = await import('../behavior_pack/scripts/core.js');
  assert.deepEqual(groupByPlayer([{ ...entry(), action: 'deposit', amount: 1, item: { type: 'minecraft:diamond' }, attribution: 'unattributed' }]), []);
});
