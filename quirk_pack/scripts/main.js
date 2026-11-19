import { ButtonState, EntityDamageCause, GameMode, InputButton, system, world } from '@minecraft/server';
import { bloodcurdle, BLOODCURDLE_COOLDOWN, expireMarks, hasBloodMark, paralyze } from './bloodcurdle.js';
import { ALL_FOR_ONE, canAffect, forwardTargets, heldItemId, hurt, isPlayer, powers, SWORD, targetInSight } from './powers.js';
import { techniques } from './techniques.js';
import { aura, trace } from './effects.js';

const BLOOD_PURSUIT = 'mha:blood_pursuit';
const COPY_TICKS = 900;

/** @typedef {import('@minecraft/server').Player} Player */
/** @type {Map<string, number>} */
const erasedUntil = new Map();
/** @type {Map<string, number>} */
const recoilUntil = new Map();
/** @type {Map<string, { item: string, expires: number }>} */
const copies = new Map();
/** @type {Map<string, number>} */
const cooldowns = new Map();

/** @param {Player} player @param {string} message */
function notify(player, message) {
  player.onScreenDisplay.setActionBar(message);
}

/** @param {Player} player */
function blocked(player) {
  return !player.isValid || player.getGameMode() === GameMode.Spectator ||
    (erasedUntil.get(player.id) ?? 0) > system.currentTick;
}

/** @param {string} playerId */
function copiedItem(playerId) {
  const copy = copies.get(playerId);
  return copy && copy.expires > system.currentTick ? copy.item : undefined;
}

/** @param {Player} target @param {number} seconds */
function erase(target, seconds) {
  const end = system.currentTick + seconds * 20;
  const current = erasedUntil.get(target.id) ?? 0;
  if (current >= end) return;
  erasedUntil.set(target.id, end);
  notify(target, `§c말소: ${seconds}초 동안 개성을 발동할 수 없습니다.`);
}

/** @type {Map<string, import('./powers.js').Power>} */
const specialTechniques = new Map([
  ['mha:impact_recoil', {
    name: '충격 반전', cooldown: 360,
    run(player) {
      recoilUntil.set(player.id, system.currentTick + 100);
      aura(player, 'void');
      return true;
    },
  }],
  ['mha:erasure', {
    name: '말소', cooldown: 280,
    run(player) {
      const target = targetInSight(player, 16, entity => isPlayer(entity) && canAffect(player, entity));
      if (!target || !isPlayer(target)) return false;
      erase(target, 6);
      return true;
    },
  }],
  ['mha:erasure_sweep', {
    name: '시야 말소', cooldown: 360,
    run(player) {
      const targets = forwardTargets(player, 8, 0.55).filter(isPlayer);
      for (const target of targets) erase(target, 3);
      return targets.length > 0;
    },
  }],
  [BLOOD_PURSUIT, {
    name: '응혈 추적', cooldown: BLOODCURDLE_COOLDOWN,
    run(player) {
      const now = system.currentTick;
      const target = targetInSight(player, 8, entity => canAffect(player, entity) && hasBloodMark(player, entity, now));
      if (!target || !paralyze(player, target)) return false;
      trace(player, 'blood', target);
      return true;
    },
  }],
]);

/** @param {string} item */
function getPower(item) {
  return specialTechniques.get(item) ?? techniques.get(item) ?? powers.get(item);
}

/** @param {string} item */
function powerName(item) {
  if (item === SWORD) return '응혈';
  return getPower(item)?.name;
}

world.afterEvents.playerButtonInput.subscribe(({ player, button, newButtonState }) => {
  if (button !== InputButton.Sneak || newButtonState !== ButtonState.Pressed || blocked(player)) return;
  const held = heldItemId(player);
  if (!held || held === SWORD) return;

  let item = held;
  const now = system.currentTick;
  if (held === ALL_FOR_ONE) {
    const copy = copiedItem(player.id);
    if (!copy) {
      const target = targetInSight(player, 12, entity => entity.id !== player.id && entity.isValid &&
        isPlayer(entity) && entity.getGameMode() !== GameMode.Spectator);
      const source = target && isPlayer(target) ? heldItemId(target) : undefined;
      const name = source && powerName(source);
      if (!source || !name) {
        notify(player, '§7복제할 개성 아이템을 든 플레이어를 바라보세요.');
        return;
      }
      copies.set(player.id, { item: source, expires: now + COPY_TICKS });
      aura(player, 'void');
      notify(player, `§d올포원: ${name} 복제 (45초)`);
      return;
    }
    if (copy === SWORD) {
      notify(player, '§d올포원: 이 아이템을 든 채 공격하고 웅크려 다시 베세요.');
      return;
    }
    item = copy;
  }

  const power = getPower(item);
  if (!power) return;
  const key = `${player.id}/${item === BLOOD_PURSUIT ? SWORD : item}`;
  const remaining = (cooldowns.get(key) ?? 0) - now;
  if (remaining > 0) {
    notify(player, `§7재사용 대기시간 ${Math.ceil(remaining / 20)}초`);
    return;
  }

  if (!power.run(player)) {
    notify(player, '§7범위 안에 대상이 있거나 기술의 조건을 충족해야 합니다.');
    return;
  }
  cooldowns.set(key, now + power.cooldown);
  notify(player, `§a${power.name} 발동`);
});

world.afterEvents.entityHurt.subscribe(({ hurtEntity, damage, damageSource }) => {
  const attacker = damageSource.damagingEntity;
  if (damageSource.cause !== EntityDamageCause.entityAttack || damage <= 0 || !attacker?.isValid) return;

  const now = system.currentTick;
  if (hurtEntity.isValid && isPlayer(hurtEntity) && (recoilUntil.get(hurtEntity.id) ?? 0) > now &&
      !blocked(hurtEntity) && (hurtEntity.getComponent('minecraft:health')?.currentValue ?? 0) > 0 &&
      canAffect(hurtEntity, attacker)) {
    recoilUntil.delete(hurtEntity.id);
    trace(hurtEntity, 'void', attacker);
    hurt(hurtEntity, attacker, Math.min(12, damage));
  }

  if (!attacker.isValid || !isPlayer(attacker) || blocked(attacker) || !canAffect(attacker, hurtEntity)) return;
  const held = heldItemId(attacker);
  if (held !== SWORD && (held !== ALL_FOR_ONE || copiedItem(attacker.id) !== SWORD)) return;

  const key = `${attacker.id}/${SWORD}`;
  if (!bloodcurdle(attacker, hurtEntity, now, (cooldowns.get(key) ?? 0) <= now)) return;
  cooldowns.set(key, now + BLOODCURDLE_COOLDOWN);
  trace(attacker, 'blood', hurtEntity);
  notify(attacker, '§c응혈 발동: 대상의 이동 속도가 4초 동안 크게 감소합니다.');
});

system.runInterval(() => {
  const now = system.currentTick;
  for (const timers of [cooldowns, erasedUntil, recoilUntil]) {
    for (const [id, end] of timers) {
      if (end <= now) timers.delete(id);
    }
  }
  for (const [id, copy] of copies) {
    if (copy.expires <= now) copies.delete(id);
  }
  expireMarks(now);
}, 200);
