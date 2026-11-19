import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { state, fixture, sample } from './runtime.js';
import { Item } from './fakes.js';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@minecraft/server') {
    return { url: new URL('./runtime.js', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
await import('../quirk_pack/scripts/bloodcurdle.js');

test('Bloodcurdle needs sword damage, an active mark on the same target and a sneaking follow-up', () => {
  const { player, inv } = fixture();
  const effects = [];
  const target = id => ({
    id, isValid: true,
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
