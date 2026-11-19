import { EntityDamageCause, system, world } from '@minecraft/server';

const SWORD = 'chesthistory:stain_sword';
const MARK_TICKS = 200;
const EFFECT_TICKS = 80;
const COOLDOWN_TICKS = 300;

/** @type {Map<string, { targetId: string, expires: number }>} */
const marks = new Map();
/** @type {Map<string, number>} */
const cooldowns = new Map();

world.afterEvents.entityHurt.subscribe(({ hurtEntity, damage, damageSource }) => {
  const attacker = damageSource.damagingEntity;
  if (damageSource.cause !== EntityDamageCause.entityAttack ||
      damage <= 0 || !attacker?.isValid || attacker.typeId !== 'minecraft:player' ||
      !hurtEntity.isValid || hurtEntity.id === attacker.id ||
      (hurtEntity.getComponent('minecraft:health')?.currentValue ?? 0) <= 0) return;

  const player = /** @type {import('@minecraft/server').Player} */ (attacker);
  const heldItem = player.getComponent('minecraft:inventory')?.container?.getItem(player.selectedSlotIndex);
  if (heldItem?.typeId !== SWORD) return;

  const now = system.currentTick;
  const mark = marks.get(attacker.id);
  if (!attacker.isSneaking || mark?.targetId !== hurtEntity.id || mark.expires <= now) {
    marks.set(attacker.id, { targetId: hurtEntity.id, expires: now + MARK_TICKS });
    return;
  }
  if ((cooldowns.get(attacker.id) ?? 0) > now) return;

  const effect = hurtEntity.addEffect('slowness', EFFECT_TICKS, { amplifier: 9, showParticles: true });
  if (!effect) return;
  marks.delete(attacker.id);
  cooldowns.set(attacker.id, now + COOLDOWN_TICKS);
  player.sendMessage('§c[응혈]§r 발동! 대상의 이동이 4초 동안 크게 느려집니다.');
});

system.runInterval(() => {
  const now = system.currentTick;
  for (const [id, mark] of marks) {
    if (mark.expires <= now) marks.delete(id);
  }
  for (const [id, expires] of cooldowns) {
    if (expires <= now) cooldowns.delete(id);
  }
}, 200);
