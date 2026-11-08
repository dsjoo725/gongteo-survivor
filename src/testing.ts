import type { Point, ArenaSize } from './rules';
import type { CrowdResult } from './crowd';
import type { HitFeedback } from './feedback';
import type { PlayerStats } from './stats';
import type { EnemyState } from './enemies';
import type { ActorRef, CombatCommand, CombatEvent, AttackSnapshot } from './combat';
import type { StatModifier } from './stats';
import type { Progression, UpgradeId } from './progression';
import type { ArenaPresentation } from './presentation';

export type EnemyFixture = Point & { health?: number; stats?: Partial<PlayerStats> };

export interface ArenaFixture {
  bounds?: ArenaSize;
  seed?: string;
  player?: Point;
  health?: number;
  stats?: Partial<PlayerStats>;
  enemies?: EnemyFixture[];
  bullets?: { position: Point; velocity: Point }[];
  spawns?: { tick: number; position: EnemyFixture }[];
  input?: Point[];
  progression?: boolean;
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
  enemies: (Point & Pick<EnemyState, 'id' | 'stats' | 'health' | 'recoilUntilTick'> & { radius: number; bodyRadius: number })[];
  bullets: (Point & { id: number; attack: AttackSnapshot; remaining: number })[];
  events: ArenaEvent[];
  combatEvents: CombatEvent[];
  progression: ReturnType<Progression['snapshot']>;
  awaitingGrowthInput: boolean;
}

export interface ArenaTest {
  view(): ArenaSize & { zoom: number };
  configure(fixture: ArenaFixture): void;
  advanceFrame(deltaMs: number): void;
  setPaused(paused: boolean): void;
  snapshot(): ArenaSnapshot;
  crowd(): CrowdResult & { elapsedMs: number; maxBodyRenderErrorPx: number };
  feedback(): ReturnType<HitFeedback['snapshot']>;
  presentation(): { phase: string; actors: ReturnType<ArenaPresentation['snapshot']>; objects: number };
  setBaseStats(target: ActorRef, patch: Partial<PlayerStats>): void;
  upsertModifier(target: ActorRef, modifier: StatModifier): void;
  removeModifier(target: ActorRef, id: string): void;
  enqueue(command: CombatCommand): void;
  onCombatEvent(listener: (event: CombatEvent) => void): () => void;
  grantExperience(amount: number): void;
  chooseUpgrade(token: number, id: UpgradeId): void;
}

declare global {
  interface Window {
    __arenaTest?: ArenaTest;
  }
}
