import type { Point } from './rules';
import type { CrowdResult } from './crowd';
import type { HitFeedback } from './feedback';
import type { PlayerStats } from './stats';

export interface ArenaFixture {
  seed?: string;
  player?: Point;
  health?: number;
  stats?: Partial<PlayerStats>;
  enemies?: (Point & { health?: number })[];
  bullets?: { position: Point; velocity: Point }[];
  spawns?: { tick: number; position: Point }[];
  input?: Point[];
}

export type ArenaEvent =
  | { type: 'spawn' | 'shot'; tick: number; id: number }
  | { type: 'kill'; tick: number; id: number; bulletId: number }
  | { type: 'damage'; tick: number; health: number };

export interface ArenaSnapshot {
  round: number;
  tick: number;
  health: number;
  kills: number;
  stats: PlayerStats;
  playerRadius: number;
  player: Point;
  enemies: (Point & { id: number; health: number })[];
  bullets: (Point & { id: number })[];
  events: ArenaEvent[];
}

export interface ArenaTest {
  configure(fixture: ArenaFixture): void;
  advanceFrame(deltaMs: number): void;
  setPaused(paused: boolean): void;
  snapshot(): ArenaSnapshot;
  crowd(): CrowdResult & { elapsedMs: number; maxBodyRenderErrorPx: number };
  feedback(): ReturnType<HitFeedback['snapshot']>;
}

declare global {
  interface Window {
    __arenaTest?: ArenaTest;
  }
}
