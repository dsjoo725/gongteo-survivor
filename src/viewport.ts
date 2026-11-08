import { ARENA, type ArenaSize } from './rules';

// Preserve the original arena area where possible. Keep a 360-unit short side
// on narrow screens so bodies and the crowd solver still have room to move.
export function arenaViewport(width: number, height: number): ArenaSize & { zoom: number } {
  const zoom = Math.min(Math.sqrt(width * height / (ARENA.width * ARENA.height)), width / 360, height / 360);
  return { width: width / zoom, height: height / zoom, zoom };
}
