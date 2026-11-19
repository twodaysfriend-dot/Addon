import { EntityDamageCause, GameMode, world } from '@minecraft/server';
import { aura, burst, wave } from './effects.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('@minecraft/server').Entity} Entity */

export const SWORD = 'chesthistory:stain_sword';
export const ALL_FOR_ONE = 'mha:all_for_one';

/** @param {Entity} entity @returns {entity is Player} */
export function isPlayer(entity) {
  return entity.typeId === 'minecraft:player';
}

/** @param {Player} player */
export function heldItemId(player) {
  return player.getComponent('minecraft:inventory')?.container?.getItem(player.selectedSlotIndex)?.typeId;
}

/** @param {Entity} entity */
function isLiving(entity) {
  return entity.isValid && (entity.getComponent('minecraft:health')?.currentValue ?? 0) > 0;
}

/** @param {Player} player @param {Entity} target */
export function canAffect(player, target) {
  return player.id !== target.id && isLiving(target) &&
    (!isPlayer(target) || (world.gameRules.pvp && target.getGameMode() !== GameMode.Spectator));
}

/** @param {Player} player @param {number} range @param {(entity: Entity) => boolean} matches */
export function targetInSight(player, range, matches) {
  return player.getEntitiesFromViewDirection({ maxDistance: range, ignoreBlockCollision: false })
    .filter(({ entity }) => matches(entity))
    .sort((a, b) => a.distance - b.distance)[0]?.entity;
}

/** @param {Player} player @param {number} range */
export function nearbyTargets(player, range) {
  const origin = player.getHeadLocation();
  return player.dimension.getEntities({ location: player.location, maxDistance: range }).filter(target => {
    if (!canAffect(player, target)) return false;
    const head = target.getHeadLocation();
    const x = head.x - origin.x;
    const y = head.y - origin.y;
    const z = head.z - origin.z;
    const distance = Math.hypot(x, y, z);
    return !distance || !player.dimension.getBlockFromRay(origin, {
      x: x / distance, y: y / distance, z: z / distance,
    }, { maxDistance: distance });
  });
}

/** @param {Player} player @param {number} range @param {number} [cone] */
export function forwardTargets(player, range, cone = 0.75) {
  const look = player.getViewDirection();
  const forward = Math.hypot(look.x, look.z);
  const origin = player.location;
  if (forward < 0.01) return [];
  return nearbyTargets(player, range).filter(({ location }) => {
    const x = location.x - origin.x;
    const z = location.z - origin.z;
    return x * look.x + z * look.z >= cone * forward * Math.hypot(x, z);
  });
}

/** @param {Player} player @param {Entity} target @param {number} amount @param {EntityDamageCause} cause */
export function hurt(player, target, amount, cause = EntityDamageCause.magic) {
  target.applyDamage(amount, { cause, damagingEntity: player });
}

/** @param {Player} player @param {string} name @param {number} seconds @param {number} amplifier */
export function buff(player, name, seconds, amplifier) {
  player.addEffect(name, seconds * 20, { amplifier });
}

/** @typedef {{ name: string, cooldown: number, run: (player: Player) => boolean }} Power */
/** @type {Map<string, Power>} */
export const powers = new Map([
  ['mha:one_for_all', {
    name: '원포올', cooldown: 360,
    run(player) {
      buff(player, 'strength', 8, 1);
      buff(player, 'speed', 8, 1);
      buff(player, 'jump_boost', 8, 1);
      aura(player, 'drive');
      return true;
    },
  }],
  ['mha:explosion', {
    name: '폭파', cooldown: 140,
    run(player) {
      const look = player.getViewDirection();
      for (const target of forwardTargets(player, 6)) {
        target.applyKnockback({ x: look.x * 1.4, z: look.z * 1.4 }, 0.45);
        hurt(player, target, 7, EntityDamageCause.entityExplosion);
      }
      player.applyKnockback({ x: -look.x * 0.8, z: -look.z * 0.8 }, 0.45);
      wave(player, 'burst', 5);
      return true;
    },
  }],
  ['mha:half_cold_half_hot', {
    name: '반랭반열', cooldown: 180,
    run(player) {
      const cold = player.getViewDirection().y < -0.35;
      const targets = forwardTargets(player, 8);
      if (!targets.length) return false;
      wave(player, cold ? 'frost' : 'burst', 7);
      for (const target of targets) {
        if (cold) target.addEffect('slowness', 80, { amplifier: 2 });
        else target.setOnFire(4);
        hurt(player, target, cold ? 3 : 5, cold ? EntityDamageCause.magic : EntityDamageCause.fire);
      }
      return true;
    },
  }],
  ['mha:electrification', {
    name: '대전', cooldown: 200,
    run(player) {
      const targets = nearbyTargets(player, 5);
      if (!targets.length) return false;
      burst(player, 'volt', 4);
      for (const target of targets) {
        target.addEffect('weakness', 60, { amplifier: 0 });
        hurt(player, target, 5);
      }
      return true;
    },
  }],
  ['mha:blueflame', {
    name: '창염', cooldown: 220,
    run(player) {
      const targets = forwardTargets(player, 10);
      if (!targets.length) return false;
      wave(player, 'flame', 8, 1.25);
      for (const target of targets) {
        target.setOnFire(6);
        hurt(player, target, 8, EntityDamageCause.fire);
      }
      return true;
    },
  }],
  ['mha:overhaul', {
    name: '오버홀', cooldown: 200,
    run(player) {
      const target = targetInSight(player, 4, entity => canAffect(player, entity));
      if (target) {
        hurt(player, target, 10);
        return true;
      }
      const health = player.getComponent('minecraft:health');
      return !!health && health.currentValue < health.effectiveMax &&
        health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + 6));
    },
  }],
  ['mha:muscle_augmentation', {
    name: '근육증강', cooldown: 400,
    run(player) {
      buff(player, 'strength', 10, 2);
      buff(player, 'resistance', 10, 1);
      buff(player, 'slowness', 10, 0);
      return true;
    },
  }],
]);
