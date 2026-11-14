import { Inventory, Item } from './fakes.js';
export const state = { properties: new Map(), scheduled: [], forms: [], answers: [], handler: null, failPending: false, failCompletion: false, before: {}, after: {}, players: [] };
export const world = {
  beforeEvents: {
    playerInteractWithBlock: { subscribe(handler) { state.handler = handler; } },
    playerBreakBlock: { subscribe(handler) { state.before.playerBreakBlock = handler; } },
    explosion: { subscribe(handler) { state.before.explosion = handler; } },
  },
  afterEvents: Object.fromEntries(['playerPlaceBlock', 'playerBreakBlock', 'pistonActivate'].map(name =>
    [name, { subscribe(handler) { state.after[name] = handler; } }])),
  getAllPlayers: () => state.players,
  getDynamicProperty: key => state.properties.get(key),
  getDynamicPropertyIds: () => [...state.properties.keys()],
  setDynamicProperty(key, value) {
    if (value === undefined) { state.properties.delete(key); return; }
    const journal = JSON.parse(value);
    const last = journal.entries?.at(-1);
    if (state.failPending && last?.status === 'pending') throw new Error('storage full');
    if (state.failCompletion && last?.status === 'complete') throw new Error('save interrupted');
    state.properties.set(key, value);
  },
};
export const system = { run(callback) { state.scheduled.push(callback); } };
export const GameMode = { Spectator: 'Spectator' };
export const BlockTypes = { get(type) { return ['minecraft:chest', 'minecraft:stone'].includes(type) ? { id: type } : undefined; } };

class Form {
  constructor() { this.buttons = []; }
  title(value) { this.heading = value; return this; }
  body(value) { this.text = value; return this; }
  button(value) { this.buttons.push(value); return this; }
  slider() { return this; }
  submitButton() { return this; }
  async show(player) {
    state.forms.push(this);
    const response = state.answers.shift();
    return typeof response === 'function' ? response(this, player) : response ?? { canceled: true };
  }
}
export class ActionFormData extends Form {}
export class ModalFormData extends Form {}

export function fixture({ double = false } = {}) {
  state.properties.clear();
  state.scheduled.length = state.forms.length = state.answers.length = 0;
  state.failPending = state.failCompletion = false;
  const chest = new Inventory(double ? 54 : 27);
  const inv = new Inventory(36, { 0: new Item('minecraft:diamond', 10) });
  const positions = double ? [{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }] : [{ x: 0, y: 64, z: 0 }];
  const dimension = { id: 'minecraft:overworld', getBlock(pos) { return blocks.find(b => b.location.x === pos.x && b.location.y === pos.y && b.location.z === pos.z); } };
  const blocks = positions.map(position => ({
    typeId: 'minecraft:chest', location: position, dimension,
    permutation: { getState(name) { return name === 'minecraft:cardinal_direction' ? 'north' : undefined; } },
    getComponent() { return { container: chest }; },
  }));
  const player = {
    id: 'p1', name: '플레이어', isValid: true, isSneaking: false,
    location: { x: 0.5, y: 64, z: 1.5 }, dimension, tags: new Set(), messages: [],
    getGameMode() { return 'Survival'; },
    hasTag(tag) { return this.tags.has(tag); },
    getComponent() { return { container: inv }; },
    sendMessage(message) { this.messages.push(message); },
  };
  state.players = [player];
  return { player, chest, inv, blocks };
}
export async function interact(player, block, extra = {}) {
  const event = { player, block, cancel: false, isFirstEvent: true, ...extra };
  state.handler(event);
  while (state.scheduled.length) state.scheduled.shift()();
  // Drain promise chains from form.show, transaction handling and the session finally.
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
  return event;
}
export const entries = () => [...state.properties.values()].flatMap(raw => JSON.parse(raw).entries ?? []);
