/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('@minecraft/server').Entity} Entity */
/** @typedef {import('@minecraft/server').Vector3} Vector3 */
/** @typedef {'blood' | 'drive' | 'burst' | 'frost' | 'volt' | 'flame' | 'void' | 'spark'} Theme */

/** @param {Player} player @param {Theme} theme @param {Vector3} position */
function emit(player, theme, position) {
  try {
    player.dimension.spawnParticle(`mha:${theme}`, position);
  } catch { /* A visual effect can fail outside loaded terrain. */ }
}

/** @param {Player} player */
function facing(player) {
  const look = player.getViewDirection();
  const distance = Math.hypot(look.x, look.z);
  return distance > 0.01 ? { x: look.x / distance, z: look.z / distance } : undefined;
}

/** @param {Player} player @param {Theme} theme @param {Entity} target */
export function trace(player, theme, target) {
  const start = player.getHeadLocation();
  const end = target.getHeadLocation();
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const horizontal = Math.hypot(dx, dz) || 1;
  const count = Math.min(10, Math.max(3, Math.ceil(horizontal)));
  for (let i = 1; i <= count; i++) {
    const fraction = i / count;
    const side = i % 2 ? 0.24 : -0.24;
    emit(player, theme, {
      x: start.x + dx * fraction - side * dz / horizontal,
      y: start.y - 0.35 + (end.y - start.y + 0.35) * fraction,
      z: start.z + dz * fraction + side * dx / horizontal,
    });
  }
  emit(player, theme, { ...end, y: end.y - 0.45 });
  emit(player, 'spark', end);
}

/** @param {Player} player @param {Theme} theme @param {number} radius */
export function burst(player, theme, radius) {
  const origin = player.location;
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    const distance = i % 2 ? radius : radius * 0.6;
    emit(player, theme, {
      x: origin.x + Math.cos(angle) * distance,
      y: origin.y + (i % 2 ? 0.35 : 1.1),
      z: origin.z + Math.sin(angle) * distance,
    });
  }
  emit(player, 'spark', { ...origin, y: origin.y + 1.5 });
}

/** @param {Player} player @param {Theme} theme */
export function aura(player, theme) {
  const origin = player.location;
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 3;
    emit(player, i % 3 ? theme : 'spark', {
      x: origin.x + Math.cos(angle) * 0.85,
      y: origin.y + 0.2 + i * 0.15,
      z: origin.z + Math.sin(angle) * 0.85,
    });
  }
}

/** @param {Player} player @param {Theme} theme @param {number} range @param {number} [spread] */
export function wave(player, theme, range, spread = 1) {
  const direction = facing(player);
  if (!direction) return;
  const origin = player.getHeadLocation();
  const { x, z } = direction;
  for (let step = 1; step <= 4; step++) {
    const distance = step * range / 4;
    for (const lane of [-1, 0, 1]) {
      const offset = lane * spread * step / 2;
      emit(player, theme, {
        x: origin.x + distance * x - offset * z,
        y: origin.y - 0.55 + Math.abs(lane) * 0.45,
        z: origin.z + distance * z + offset * x,
      });
    }
  }
}

/** @param {Player} player */
export function iceWall(player) {
  const direction = facing(player);
  if (!direction) return false;
  const origin = player.getHeadLocation();
  const { x, z } = direction;
  for (const offset of [-2, -1, 0, 1, 2]) {
    for (const height of [-1, 0, 1]) {
      emit(player, height === 1 ? 'spark' : 'frost', {
        x: origin.x + 3 * x + offset * z,
        y: origin.y + height - Math.abs(offset) * 0.18,
        z: origin.z + 3 * z - offset * x,
      });
    }
  }
  return true;
}
