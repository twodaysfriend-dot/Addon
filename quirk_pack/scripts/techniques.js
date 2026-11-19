import { EntityDamageCause } from '@minecraft/server';
import { buff, canAffect, forwardTargets, hurt, nearbyTargets, targetInSight } from './powers.js';
import { burst, iceWall, trace, wave } from './effects.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('@minecraft/server').Entity} Entity */

/** @param {Player} player @param {number} range */
function aim(player, range) {
  return targetInSight(player, range, target => canAffect(player, target));
}

/** @param {Player} player @param {Entity} target @param {number} force @param {number} lift */
function push(player, target, force, lift) {
  const x = target.location.x - player.location.x;
  const z = target.location.z - player.location.z;
  const length = Math.hypot(x, z) || 1;
  target.applyKnockback({ x: force * x / length, z: force * z / length }, lift);
}

/** @param {Player} player @param {Entity} target @param {number} amount @param {number} seconds */
function burnBlue(player, target, amount, seconds) {
  target.setOnFire(seconds);
  hurt(player, target, amount, EntityDamageCause.fire);
}

/** @type {Map<string, import('./powers.js').Power>} */
export const techniques = new Map([
  ['mha:manchester_smash', {
    name: '맨체스터 스매시', cooldown: 320,
    run(player) {
      if (player.isOnGround) return false;
      player.applyImpulse({ x: 0, y: -1.2, z: 0 });
      burst(player, 'drive', 2.8);
      for (const target of nearbyTargets(player, 5)) {
        if (target.location.y > player.location.y) continue;
        push(player, target, 1.4, 0.25);
        hurt(player, target, 10);
      }
      return true;
    },
  }],
  ['mha:stun_grenade', {
    name: '스턴 그레네이드', cooldown: 280,
    run(player) {
      const targets = forwardTargets(player, 7, 0.6);
      if (!targets.length) return false;
      wave(player, 'spark', 5, 1.6);
      for (const target of targets) {
        target.addEffect('blindness', 50, { amplifier: 0 });
        target.addEffect('slowness', 45, { amplifier: 1 });
      }
      return true;
    },
  }],
  ['mha:discharge_1300000', {
    name: '무차별 방전 130만 볼트', cooldown: 400,
    run(player) {
      const targets = nearbyTargets(player, 7);
      if (!targets.length) return false;
      burst(player, 'volt', 5.7);
      for (const target of targets) {
        target.addEffect('weakness', 100, { amplifier: 1 });
        hurt(player, target, 9);
      }
      buff(player, 'slowness', 4, 1);
      buff(player, 'weakness', 4, 1);
      return true;
    },
  }],
  ['mha:detroit_smash', {
    name: '디트로이트 스매시', cooldown: 240,
    run(player) {
      const target = aim(player, 5);
      if (!target) return false;
      trace(player, 'drive', target);
      push(player, target, 2.2, 0.55);
      hurt(player, target, 12);
      return true;
    },
  }],
  ['mha:delaware_air_force', {
    name: '델라웨어 스매시 에어포스', cooldown: 160,
    run(player) {
      const target = aim(player, 24);
      if (!target) return false;
      trace(player, 'spark', target);
      push(player, target, 1.5, 0.25);
      hurt(player, target, 6);
      return true;
    },
  }],
  ['mha:ap_shot', {
    name: 'AP 샷', cooldown: 160,
    run(player) {
      const target = aim(player, 20);
      if (!target) return false;
      trace(player, 'burst', target);
      hurt(player, target, 9, EntityDamageCause.entityExplosion);
      return true;
    },
  }],
  ['mha:howitzer_impact', {
    name: '하우저 임팩트', cooldown: 360,
    run(player) {
      burst(player, 'burst', 5.5);
      for (const target of nearbyTargets(player, 7)) {
        push(player, target, 2.4, 0.65);
        hurt(player, target, 11, EntityDamageCause.entityExplosion);
      }
      player.applyKnockback({ x: 0, z: 0 }, 0.6);
      return true;
    },
  }],
  ['mha:ice_wall', {
    name: '천천빙벽', cooldown: 240,
    run(player) {
      const targets = forwardTargets(player, 10, 0.6);
      if (!iceWall(player)) return false;
      for (const target of targets) {
        target.addEffect('slowness', 100, { amplifier: 4 });
        hurt(player, target, 4);
      }
      return true;
    },
  }],
  ['mha:flashfreeze_heatwave', {
    name: '플래시프리즈 히트웨이브', cooldown: 320,
    run(player) {
      const targets = forwardTargets(player, 12);
      if (targets.length) {
        wave(player, 'frost', 4, 1.6);
        wave(player, 'burst', 10, 1.4);
      }
      for (const target of targets) {
        push(player, target, 1.8, 0.4);
        target.setOnFire(4);
        hurt(player, target, 10, EntityDamageCause.fire);
      }
      return targets.length > 0;
    },
  }],
  ['mha:target_shock', {
    name: '표적 방전', cooldown: 160,
    run(player) {
      const target = aim(player, 18);
      if (!target) return false;
      trace(player, 'volt', target);
      target.addEffect('weakness', 100, { amplifier: 1 });
      hurt(player, target, 7);
      return true;
    },
  }],
  ['mha:jet_burn', {
    name: '제트 번', cooldown: 240,
    run(player) {
      const target = aim(player, 18);
      if (!target) return false;
      push(player, target, 1.5, 0.25);
      trace(player, 'flame', target);
      burnBlue(player, target, 10, 6);
      return true;
    },
  }],
  ['mha:hell_spider', {
    name: '헬 스파이더', cooldown: 320,
    run(player) {
      const targets = forwardTargets(player, 12, 0.5);
      if (targets.length) wave(player, 'flame', 10, 1.9);
      for (const target of targets) burnBlue(player, target, 6, 8);
      return targets.length > 0;
    },
  }],
  ['mha:air_cannon', {
    name: '에어 캐논', cooldown: 240,
    run(player) {
      const targets = forwardTargets(player, 16, 0.85);
      if (targets.length) wave(player, 'void', 12, 0.7);
      for (const target of targets) {
        push(player, target, 3, 0.6);
        hurt(player, target, 8);
      }
      return targets.length > 0;
    },
  }],
  ['mha:rivet_stab', {
    name: '리벳 스탭', cooldown: 200,
    run(player) {
      const target = aim(player, 14);
      if (!target) return false;
      trace(player, 'void', target);
      target.addEffect('slowness', 60, { amplifier: 3 });
      hurt(player, target, 8);
      return true;
    },
  }],
  ['mha:reconstruction', {
    name: '재구축', cooldown: 360,
    run(player) {
      const health = player.getComponent('minecraft:health');
      if (!health || health.currentValue >= health.effectiveMax) return false;
      if (!health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + 10))) return false;
      buff(player, 'resistance', 5, 0);
      return true;
    },
  }],
  ['mha:muscle_rush', {
    name: '근섬유 돌진', cooldown: 300,
    run(player) {
      const look = player.getViewDirection();
      const length = Math.hypot(look.x, look.z);
      if (length < 0.01) return false;
      const target = aim(player, 5);
      player.applyKnockback({ x: 1.7 * look.x / length, z: 1.7 * look.z / length }, 0.18);
      if (target) {
        push(player, target, 2, 0.35);
        hurt(player, target, 9);
      }
      return true;
    },
  }],
]);
