export const BLOODCURDLE_COOLDOWN = 300;
const MARK_TICKS = 200;
const EFFECT_TICKS = 80;

/** @typedef {import('@minecraft/server').Entity} Entity */
/** @type {Map<string, { targetId: string, expires: number }>} */
const marks = new Map();

/** @param {Entity} attacker @param {Entity} target @param {number} now */
export function hasBloodMark(attacker, target, now) {
  const mark = marks.get(attacker.id);
  return mark?.targetId === target.id && mark.expires > now;
}

/** @param {Entity} attacker @param {Entity} target */
export function paralyze(attacker, target) {
  if (!target.addEffect('slowness', EFFECT_TICKS, { amplifier: 9, showParticles: true })) return false;
  marks.delete(attacker.id);
  return true;
}

/** @param {Entity} attacker @param {Entity} target @param {number} now @param {boolean} ready */
export function bloodcurdle(attacker, target, now, ready) {
  if (!attacker.isSneaking || !hasBloodMark(attacker, target, now)) {
    marks.set(attacker.id, { targetId: target.id, expires: now + MARK_TICKS });
    return false;
  }
  return ready && paralyze(attacker, target);
}

/** @param {number} now */
export function expireMarks(now) {
  for (const [id, mark] of marks) {
    if (mark.expires <= now) marks.delete(id);
  }
}
