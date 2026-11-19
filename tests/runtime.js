import { Inventory, Item } from './fakes.js';
export const state = { properties: new Map(), scheduled: [], forms: [], answers: [], handler: null, failPending: false, failCompletion: false, before: {}, after: {}, players: [], tick: 0, intervals: [] };
export const world = {
  beforeEvents: {
    playerInteractWithBlock: { subscribe(handler) { state.handler = handler; } },
    playerBreakBlock: { subscribe(handler) { state.before.playerBreakBlock = handler; } },
    explosion: { subscribe(handler) { state.before.explosion = handler; } },
  },
  afterEvents: Object.fromEntries(['playerPlaceBlock', 'playerBreakBlock', 'pistonActivate', 'entityHitBlock', 'entityHurt', 'playerButtonInput', 'playerLeave'].map(name =>
    [name, { subscribe(handler) { state.after[name] = handler; } }])),
  gameRules: { pvp: true },
  getAllPlayers: () => state.players,
  getDimension: id => state.players.find(p => p.dimension.id === id)?.dimension,
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
export const system = {
  get currentTick() { return state.tick; },
  run(callback) { state.scheduled.push(callback); },
  runInterval(callback) { state.intervals.push(callback); },
};
export const EntityDamageCause = { entityAttack: 'entityAttack', entityExplosion: 'entityExplosion', magic: 'magic', fire: 'fire', projectile: 'projectile' };
export const ButtonState = { Pressed: 'Pressed', Released: 'Released' };
export const InputButton = { Sneak: 'Sneak', Jump: 'Jump' };
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
  for (const player of state.players) state.after.playerLeave?.({ playerId: player.id });
  state.tick += 100;
  world.gameRules.pvp = true;
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
    id: 'p1', name: '플레이어', typeId: 'minecraft:player', isValid: true, isSneaking: false, selectedSlotIndex: 0,
    location: { x: 0.5, y: 64, z: 1.5 }, dimension, tags: new Set(), messages: [],
    getGameMode() { return 'Survival'; },
    hasTag(tag) { return this.tags.has(tag); },
    getComponent() { return { container: inv }; },
    sendMessage(message) { this.messages.push(message); },
  };
  player.onScreenDisplay = { setActionBar: message => player.messages.push(message) };
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

export async function drain() {
  while (state.scheduled.length) state.scheduled.shift()();
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
}
export function sample(ticks = 5) {
  state.tick += ticks;
  for (const callback of state.intervals) callback();
}
export async function hit(player, block) {
  state.after.entityHitBlock({ damagingEntity: player, hitBlock: block });
  await drain();
}
export function holdStick(player, inventory) {
  inventory.setItem(1, new Item('minecraft:stick'));
  player.selectedSlotIndex = 1;
  player.isSneaking = true;
}
