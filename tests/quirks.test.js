import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { state, fixture, sample, world } from './runtime.js';
import { Item } from './fakes.js';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@minecraft/server') {
    return { url: new URL('./runtime.js', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
await import('../quirk_pack/scripts/main.js');

test('Bloodcurdle needs sword damage, an active mark on the same target and a sneaking follow-up', () => {
  const { player, inv } = fixture();
  const effects = [];
  player.getHeadLocation = () => player.location;
  const target = id => ({
    id, isValid: true,
    getHeadLocation: () => ({ x: 1, y: 64, z: 1 }),
    getComponent: () => ({ currentValue: 20 }),
    addEffect: (...args) => { effects.push([id, ...args]); return {}; },
  });
  const first = target('first');
  const second = target('second');
  const hurt = (victim, cause = 'entityAttack') => state.after.entityHurt({
    hurtEntity: victim, damage: 1, damageSource: { cause, damagingEntity: player },
  });

  hurt(first);
  inv.setItem(0, new Item('chesthistory:stain_sword'));
  player.isSneaking = true;
  hurt(first, 'projectile');
  hurt(first);
  assert.equal(effects.length, 0);
  hurt(second);
  sample(200);
  hurt(second);
  assert.equal(effects.length, 0);

  hurt(second);
  assert.deepEqual(effects, [['second', 'slowness', 80, { amplifier: 9, showParticles: true }]]);
  hurt(first);
  hurt(first);
  assert.equal(effects.length, 1);
  sample(300);
  hurt(first);
  hurt(first);
  assert.equal(effects.length, 2);
});

function arena() {
  const { player, inv } = fixture();
  player.id = `caster-${state.tick}`;
  const events = [];
  const visuals = [];
  const makeTarget = (id, x, z) => {
    const health = {
      effectiveMax: 20, currentValue: 20,
      setCurrentValue(value) { this.currentValue = value; return true; },
    };
    return {
      id, isValid: true, typeId: 'minecraft:zombie', location: { x, y: 0, z },
      getHeadLocation() { return { ...this.location, y: 1.6 }; },
      getComponent: key => key === 'minecraft:health' ? health : undefined,
      addEffect: (effect, ticks, { amplifier }) => {
        events.push([id, effect, ticks, amplifier]);
        return {};
      },
      applyDamage: (amount, { cause }) => events.push([id, cause, amount]),
      setOnFire: seconds => events.push([id, 'burn', seconds]),
      applyKnockback: () => events.push([id, 'knockback']),
    };
  };
  const self = makeTarget('self', 0, 0);
  const components = player.getComponent;
  Object.assign(player, {
    location: self.location,
    getHeadLocation: self.getHeadLocation,
    getViewDirection: () => ({ x: 1, y: 0, z: 0 }),
    getComponent: key => key === 'minecraft:health' ? self.getComponent(key) : components(key),
    addEffect: self.addEffect,
    applyKnockback: self.applyKnockback,
    applyImpulse: vector => events.push(['self', 'impulse', vector]),
    getEntitiesFromViewDirection: () => [],
  });
  const targets = [makeTarget('front', 3, 0), makeTarget('back', -3, 0)];
  Object.assign(player.dimension, {
    getEntities: () => targets,
    getBlockFromRay: () => undefined,
    spawnParticle: (name, position) => visuals.push({ name, position }),
  });
  const press = (source = player, button = 'Sneak', newButtonState = 'Pressed') =>
    state.after.playerButtonInput({ player: source, button, newButtonState });
  const equip = id => inv.setItem(0, new Item(`mha:${id}`));
  return { player, targets, events, visuals, equip, press };
}

test('One For All and muscle augmentation trigger on sneak press with separate cooldowns', () => {
  const { events, equip, press } = arena();
  equip('one_for_all');
  press(undefined, 'Jump');
  press(undefined, 'Sneak', 'Released');
  assert.equal(events.length, 0);
  press();
  press();
  assert.deepEqual(events, [
    ['self', 'strength', 160, 1], ['self', 'speed', 160, 1], ['self', 'jump_boost', 160, 1],
  ]);

  equip('muscle_augmentation');
  press();
  assert.deepEqual(events.slice(3), [
    ['self', 'strength', 200, 2], ['self', 'resistance', 200, 1], ['self', 'slowness', 200, 0],
  ]);
  sample(360);
  equip('one_for_all');
  press();
  assert.equal(events.length, 9);
});

test('Explosion and Blueflame hit in front while Electrification hits in both directions', () => {
  const { player, targets, events, equip, press } = arena();
  equip('explosion');
  press();
  assert.deepEqual(events, [['front', 'knockback'], ['front', 'entityExplosion', 7], ['self', 'knockback']]);

  events.length = 0;
  equip('blueflame');
  press();
  assert.deepEqual(events, [['front', 'burn', 6], ['front', 'fire', 8]]);

  events.length = 0;
  equip('electrification');
  player.dimension.getBlockFromRay = () => ({});
  press();
  assert.deepEqual(events, []);
  player.dimension.getBlockFromRay = () => undefined;
  const otherPlayer = { ...targets[1], typeId: 'minecraft:player', getGameMode: () => 'Survival' };
  targets[1] = otherPlayer;
  world.gameRules.pvp = false;
  press();
  assert.deepEqual(events, [['front', 'weakness', 60, 0], ['front', 'magic', 5]]);
  world.gameRules.pvp = true;
  events.length = 0;
  sample(200);
  press();
  assert.deepEqual(events, [
    ['front', 'weakness', 60, 0], ['front', 'magic', 5], ['back', 'weakness', 60, 0], ['back', 'magic', 5],
  ]);
});

test('Half-Cold Half-Hot switches by gaze and Overhaul can heal or attack', () => {
  const { player, targets, events, equip, press } = arena();
  equip('half_cold_half_hot');
  press();
  assert.deepEqual(events, [['front', 'burn', 4], ['front', 'fire', 5]]);
  sample(180);
  player.getViewDirection = () => ({ x: 0.8, y: -0.6, z: 0 });
  events.length = 0;
  press();
  assert.deepEqual(events, [['front', 'slowness', 80, 2], ['front', 'magic', 3]]);

  equip('overhaul');
  const health = player.getComponent('minecraft:health');
  health.currentValue = 16;
  press();
  assert.equal(health.currentValue, 20);
  sample(200);
  player.getEntitiesFromViewDirection = () => [{ entity: targets[0], distance: 3 }];
  press();
  assert.deepEqual(events.at(-1), ['front', 'magic', 10]);
});

test('All For One temporarily copies the held power and Erasure blocks activations', () => {
  const { player, targets, events, equip, press } = arena();
  const partner = {
    ...targets[0], id: `partner-${state.tick}`, typeId: 'minecraft:player', selectedSlotIndex: 0,
    getGameMode: () => 'Survival', onScreenDisplay: { setActionBar() {} },
    getComponent: id => id === 'minecraft:inventory'
      ? { container: { getItem: () => new Item('mha:one_for_all') } }
      : targets[0].getComponent(id),
  };
  player.getEntitiesFromViewDirection = () => [{ entity: partner, distance: 3 }];
  equip('all_for_one');
  press();
  assert.equal(events.length, 0);
  press();
  assert.equal(events.length, 3);

  equip('erasure');
  press();
  press(partner);
  assert.equal(events.length, 3);
  sample(120);
  press(partner);
  assert.equal(events.length, 6);

  sample(780);
  equip('all_for_one');
  player.getEntitiesFromViewDirection = () => [];
  press();
  assert.equal(events.length, 6);
});

test('a copied Bloodcurdle is triggered with the copy item and shares the sword cooldown', () => {
  const { player, targets, events, equip, press } = arena();
  const target = targets[1];
  const sword = new Item('chesthistory:stain_sword');
  const partner = {
    ...targets[0], id: 'swordsman', typeId: 'minecraft:player', selectedSlotIndex: 0,
    getGameMode: () => 'Survival',
    getComponent: id => id === 'minecraft:inventory'
      ? { container: { getItem: () => sword } }
      : targets[0].getComponent(id),
  };
  player.getEntitiesFromViewDirection = () => [{ entity: partner, distance: 3 }];
  const hit = () => state.after.entityHurt({
    hurtEntity: target, damage: 1, damageSource: { cause: 'entityAttack', damagingEntity: player },
  });

  equip('all_for_one');
  press();
  hit();
  player.isSneaking = true;
  hit();
  assert.deepEqual(events, [['back', 'slowness', 80, 9]]);
  player.getComponent('minecraft:inventory').container.setItem(0, sword);
  hit();
  hit();
  assert.equal(events.length, 1);
});

for (const [item, expected] of [
  ['detroit_smash', ['front', 'magic', 12]],
  ['stun_grenade', ['front', 'blindness', 50, 0]],
  ['discharge_1300000', ['self', 'slowness', 80, 1]],
  ['delaware_air_force', ['front', 'magic', 6]],
  ['ap_shot', ['front', 'entityExplosion', 9]],
  ['howitzer_impact', ['back', 'entityExplosion', 11]],
  ['ice_wall', ['front', 'slowness', 100, 4]],
  ['flashfreeze_heatwave', ['front', 'fire', 10]],
  ['target_shock', ['front', 'weakness', 100, 1]],
  ['jet_burn', ['front', 'fire', 10]],
  ['hell_spider', ['front', 'burn', 8]],
  ['air_cannon', ['front', 'knockback']],
  ['rivet_stab', ['front', 'slowness', 60, 3]],
  ['muscle_rush', ['self', 'knockback']],
]) {
  test(`technique item ${item} applies its effect and uses a cooldown`, () => {
    const { player, targets, events, equip, press } = arena();
    player.getEntitiesFromViewDirection = () => [{ entity: targets[0], distance: 3 }];
    equip(item);
    press();
    assert.ok(events.some(event => JSON.stringify(event) === JSON.stringify(expected)));
    const count = events.length;
    press();
    assert.equal(events.length, count);
  });
}

test('Reconstruction heals and grants resistance without affecting the target', () => {
  const { player, events, equip, press } = arena();
  const health = player.getComponent('minecraft:health');
  health.currentValue = 6;
  equip('reconstruction');
  press();
  assert.equal(health.currentValue, 16);
  assert.deepEqual(events, [['self', 'resistance', 100, 0]]);
});

test('Erasure Sweep blocks only players in its visible forward area and wears off', () => {
  const { player, targets, events, equip, press } = arena();
  for (const entity of targets) {
    const getComponent = entity.getComponent;
    Object.assign(entity, {
      id: `${entity.id}-${state.tick}`, typeId: 'minecraft:player', selectedSlotIndex: 0,
      getGameMode: () => 'Survival', onScreenDisplay: { setActionBar() {} },
      getComponent: id => id === 'minecraft:inventory'
        ? { container: { getItem: () => new Item('mha:one_for_all') } }
        : getComponent(id),
    });
  }
  equip('erasure_sweep');
  press();
  press(targets[0]);
  assert.equal(events.length, 0);
  press(targets[1]);
  assert.equal(events.length, 3);
  sample(60);
  press(targets[0]);
  assert.equal(events.length, 6);
});

test('Blood Pursuit needs a fresh sword mark and consumes the shared cooldown', () => {
  const { player, targets, events, equip, press } = arena();
  const sword = new Item('chesthistory:stain_sword');
  const inventory = player.getComponent('minecraft:inventory').container;
  player.getEntitiesFromViewDirection = () => [{ entity: targets[0], distance: 3 }];
  const hit = () => state.after.entityHurt({
    hurtEntity: targets[0], damage: 1, damageSource: { cause: 'entityAttack', damagingEntity: player },
  });
  equip('blood_pursuit');
  press();
  assert.equal(events.length, 0);
  inventory.setItem(0, sword);
  hit();
  equip('blood_pursuit');
  press();
  assert.deepEqual(events, [['front', 'slowness', 80, 9]]);
  inventory.setItem(0, sword);
  hit();
  player.isSneaking = true;
  hit();
  assert.equal(events.length, 1);
});

test('Manchester Smash requires an airborne player and hits only level or lower targets', () => {
  const { player, targets, events, visuals, equip, press } = arena();
  equip('manchester_smash');
  player.isOnGround = true;
  press();
  assert.equal(events.length + visuals.length, 0);
  player.isOnGround = false;
  targets[1].location.y = 4;
  press();
  assert.deepEqual(events, [
    ['self', 'impulse', { x: 0, y: -1.2, z: 0 }], ['front', 'knockback'], ['front', 'magic', 10],
  ]);
  assert.equal(visuals.filter(effect => effect.name === 'mha:drive').length, 12);
});

test('Impact Recoil returns damage once without reflecting spell damage or unapproved PvP', () => {
  const { player, targets, events, visuals, equip, press } = arena();
  const impact = (attacker, cause = 'entityAttack') => state.after.entityHurt({
    hurtEntity: player, damage: 15, damageSource: { cause, damagingEntity: attacker },
  });
  equip('impact_recoil');
  press();
  assert.ok(visuals.some(effect => effect.name === 'mha:void'));
  impact(targets[0], 'magic');
  assert.equal(events.length, 0);
  const rival = { ...targets[0], typeId: 'minecraft:player', getGameMode: () => 'Survival' };
  world.gameRules.pvp = false;
  impact(rival);
  assert.equal(events.length, 0);
  world.gameRules.pvp = true;
  impact(rival);
  impact(rival);
  assert.deepEqual(events, [['front', 'magic', 12]]);
});

test('Flame lanes emit finite, bounded custom particles and a missing visual cannot stop the attack', () => {
  const { player, events, visuals, equip, press } = arena();
  equip('hell_spider');
  press();
  assert.equal(visuals.length, 12);
  assert.ok(visuals.every(({ name, position }) =>
    name === 'mha:flame' && Object.values(position).every(Number.isFinite) && position.x <= 10));
  assert.ok(visuals.some(({ position }) => position.z < 0));
  assert.ok(visuals.some(({ position }) => position.z > 0));

  player.dimension.spawnParticle = () => { throw new Error('chunk unloaded'); };
  equip('blueflame');
  press();
  assert.deepEqual(events.at(-1), ['front', 'fire', 8]);
});
