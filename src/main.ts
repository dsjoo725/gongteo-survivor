import Phaser from 'phaser';
import { JOYSTICK_RADIUS, MoveControls } from './controls';
import {
  ARENA, clampToArena, COMBAT, distanceSquared, nearestTarget, type Point, RunState, spawnIntervalTicks, spawnPoint,
} from './rules';
import { solveCrowd, type CrowdResult } from './crowd';
import { FixedClock, TICKS_PER_SECOND } from './simulation';
import type { ArenaEvent, ArenaFixture, ArenaSnapshot } from './testing';
import { HitFeedback } from './feedback';
import { attackDamage, createPlayerStats, formatStat, playerRadius, shotIntervalTicks } from './stats';
import './style.css';

type Image = Phaser.Physics.Arcade.Image;
type Enemy = { id: number; health: number };
type Bullet = { id: number; expiresAtTick: number };

const health = document.querySelector<HTMLElement>('#health')!;
const kills = document.querySelector<HTMLElement>('#kills')!;
const results = document.querySelector<HTMLElement>('#results')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const restart = document.querySelector<HTMLButtonElement>('#restart')!;
const query = new URLSearchParams(location.search);
const stressTest = import.meta.env.DEV && query.has('stress');
const manualTest = import.meta.env.DEV && query.has('simtest');
const still: Point = { x: 0, y: 0 };

function center(image: Image): Point {
  return image.body!.center;
}

function snapshotPosition(image: Image): Point {
  const { x, y } = center(image);
  return { x, y };
}

class ArenaScene extends Phaser.Scene {
  private stats = createPlayerStats();
  private run = new RunState();
  private readonly clock = new FixedClock();
  private nextSpawnTick = 0;
  private nextShotTick = 0;
  private nextEnemyId = 0;
  private nextBulletId = 0;
  private paused = false;
  private random!: Phaser.Math.RandomDataGenerator;
  private combatRandom!: Phaser.Math.RandomDataGenerator;
  private player!: Image;
  private enemies!: Phaser.Physics.Arcade.Group;
  private bullets!: Phaser.Physics.Arcade.Group;
  private joystick!: Phaser.GameObjects.Graphics;
  private controls!: MoveControls;
  private feedback!: HitFeedback;
  private stressReadout?: Phaser.GameObjects.Text;
  private readonly frameTimesMs: number[] = [];
  private readonly activeEnemies = new Map<Image, Enemy>();
  private readonly contacts = new Set<Image>();
  private readonly activeBullets = new Map<Image, Bullet>();
  private fixture?: ArenaFixture;
  private fixtureSpawn = 0;
  private round = 0;
  private eventsForTest?: ArenaEvent[];
  private crowdResult: CrowdResult = { passes: 0, maxPenetrationPx: 0 };
  private crowdElapsedMs = 0;

  create(): void {
    this.round += 1;
    this.stats = createPlayerStats(this.fixture?.stats);
    this.run = new RunState(this.stats.maxHealth);
    this.crowdResult = { passes: 0, maxPenetrationPx: 0 };
    this.crowdElapsedMs = 0;
    this.clock.clear();
    this.nextSpawnTick = spawnIntervalTicks(0);
    this.nextShotTick = 0;
    this.nextEnemyId = 0;
    this.nextBulletId = 0;
    this.fixtureSpawn = 0;
    this.paused = false;
    const seed = this.fixture?.seed ?? crypto.getRandomValues(new Uint32Array(2)).join('-');
    this.random = new Phaser.Math.RandomDataGenerator([seed]);
    this.combatRandom = new Phaser.Math.RandomDataGenerator([`${seed}:combat`]);
    this.activeEnemies.clear();
    this.contacts.clear();
    this.activeBullets.clear();
    this.frameTimesMs.length = 0;
    this.eventsForTest = manualTest ? [] : undefined;
    results.hidden = true;
    this.drawArena();

    this.makeTexture('player', COMBAT.playerRadius, 0x73d5ff, 0x17354a);
    this.makeTexture('enemy', COMBAT.enemyRadius, 0xf2766b, 0x672e29);
    this.makeTexture('bullet', COMBAT.bulletRadius, 0xffdb73);

    this.player = this.physics.add.image(ARENA.width / 2, ARENA.height / 2, 'player')
      .setCircle(COMBAT.playerRadius).setCollideWorldBounds(true).setImmovable(true).setPushable(false).setDepth(2);
    this.enemies = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, maxSize: COMBAT.enemyLimit });
    this.bullets = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, maxSize: 8 });
    this.applyStats();
    this.physics.add.collider(this.player, this.enemies, (_player, enemy) => {
      this.contacts.add(enemy as Image);
    });
    this.physics.resume();
    this.joystick = this.add.graphics().setDepth(4);
    this.controls = new MoveControls(this.game.canvas);
    this.feedback = new HitFeedback(this);
    if (stressTest) {
      this.stressReadout = this.add.text(10, ARENA.height - 12, '부하 테스트 준비 중', {
        fontFamily: 'system-ui, sans-serif', fontSize: '12px', backgroundColor: '#111a16',
        padding: { x: 6, y: 4 },
      }).setOrigin(0, 1).setDepth(5);
    }

    const listeners = new AbortController();
    const { signal } = listeners;
    const syncFocus = () => this.setPaused(document.hidden || !document.hasFocus());
    const playAgain = () => {
      if (this.run.health !== 0 || results.hidden) return;
      results.hidden = true;
      this.scene.restart();
    };

    restart.addEventListener('click', playAgain, { signal });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.repeat && event.target !== restart) playAgain();
    }, { signal });
    if (!manualTest) {
      document.addEventListener('visibilitychange', syncFocus, { signal });
      window.addEventListener('blur', () => this.setPaused(true), { signal });
      window.addEventListener('focus', syncFocus, { signal });
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      listeners.abort();
      this.controls.destroy();
      this.feedback.dispose();
    });

    if (import.meta.env.DEV && manualTest) {
      if (this.fixture) this.applyFixture(this.fixture);
      window.__arenaTest = {
        configure: (fixture) => {
          if (this.run.tick !== 0 || this.fixture) throw new Error('Configure a fresh arena before advancing it.');
          const copy = structuredClone(fixture);
          this.applyFixture(copy);
          this.fixture = copy;
        },
        advanceFrame: (deltaMs) => this.advanceFrame(deltaMs),
        setPaused: (paused) => this.setPaused(paused),
        snapshot: () => this.snapshot(),
        crowd: () => ({
          ...this.crowdResult, elapsedMs: this.crowdElapsedMs,
          maxBodyRenderErrorPx: Math.max(0, ...[this.player, ...this.activeEnemies.keys()].map(image =>
            Math.hypot(image.x - center(image).x, image.y - center(image).y))),
        }),
        feedback: () => this.feedback.snapshot(),
      };
    }
    this.updateHud();
    if (!manualTest) this.setPaused(document.hidden);
  }

  update(_timeMs: number, deltaMs: number): void {
    if (!manualTest) this.advanceFrame(deltaMs);
    if (stressTest && !this.paused && this.run.health > 0) this.sampleStressFrame();
  }

  private advanceFrame(deltaMs: number): void {
    if (this.paused) return;
    this.feedback.advance(deltaMs);
    if (this.run.health > 0) {
      const movement = this.controls.direction();
      this.clock.advanceFrame(deltaMs, () => {
        const input = this.fixture?.input ? this.fixture.input[this.run.tick] ?? still : movement;
        this.step(input);
        return this.run.health > 0;
      });
    }
    this.drawJoystick();
    this.feedback.render(this.player, this.activeEnemies);
  }

  private step(movement: Point): void {
    this.run.tick += 1;
    this.player.setVelocity(movement.x * this.stats.moveSpeed, movement.y * this.stats.moveSpeed);
    for (const enemy of this.activeEnemies.keys()) {
      this.physics.moveToObject(enemy, this.player, COMBAT.enemySpeed);
    }

    this.contacts.clear();
    this.physics.world.singleStep();
    this.constrainActors();
    this.resolveBulletHits();
    this.resolveContact();
    if (this.run.health === 0) return;

    this.recycleMissedShots();
    this.spawnDueEnemies();
    if (this.stats.attackSpeed > 0 && this.run.tick >= this.nextShotTick) {
      const target = nearestTarget(this.player, this.activeEnemies.keys());
      if (target) this.fire(target);
    }
  }

  private constrainActors(): void {
    const radius = playerRadius(this.stats);
    this.moveBodyTo(this.player, clampToArena(center(this.player), radius));
    const player = center(this.player);
    const positions = Array.from(this.activeEnemies, ([image, { id }]) => ({ ...snapshotPosition(image), id, image }));
    const startedMs = manualTest ? performance.now() : 0;
    this.crowdResult = solveCrowd(player, positions, radius);
    if (manualTest) this.crowdElapsedMs = performance.now() - startedMs;
    for (const position of positions) {
      this.moveBodyTo(position.image, position);
      if (distanceSquared(position, player) <= (radius + COMBAT.enemyRadius + 1e-6) ** 2) {
        this.contacts.add(position.image);
      }
    }
  }

  private moveBodyTo(image: Image, position: Point): void {
    const body = image.body!;
    const dx = position.x - body.center.x;
    const dy = position.y - body.center.y;
    if (dx === 0 && dy === 0) return;
    // singleStep has already synchronized the sprite. Move both by the same
    // correction without resetting velocity or losing this tick's contacts.
    body.position.x += dx;
    body.position.y += dy;
    body.updateCenter();
    image.x += dx;
    image.y += dy;
  }

  private spawnDueEnemies(): void {
    const tick = this.run.tick;
    if (stressTest) {
      while (this.activeEnemies.size < COMBAT.enemyLimit && this.spawnEnemy()) {
        // Replenish the stress population after this tick's hits.
      }
    } else if (this.fixture?.spawns) {
      const schedule = this.fixture.spawns;
      while (schedule[this.fixtureSpawn]?.tick === tick) {
        this.spawnEnemy(schedule[this.fixtureSpawn].position);
        this.fixtureSpawn += 1;
      }
    } else if (tick >= this.nextSpawnTick) {
      this.spawnEnemy();
      this.nextSpawnTick = tick + spawnIntervalTicks(tick);
    }
  }

  private sampleStressFrame(): void {
    this.frameTimesMs.push(this.game.loop.rawDelta);
    if (this.frameTimesMs.length < 60) return;
    this.frameTimesMs.sort((a, b) => a - b);
    const p95Ms = this.frameTimesMs[Math.ceil(this.frameTimesMs.length * 0.95) - 1];
    this.stressReadout?.setText(`적 ${this.activeEnemies.size} · 프레임 p95 ${p95Ms.toFixed(1)} ms`);
    this.frameTimesMs.length = 0;
  }

  private spawnEnemy(position?: Point & { health?: number }): boolean {
    if (this.activeEnemies.size >= COMBAT.enemyLimit) return false;
    const selected = position ?? spawnPoint(center(this.player), () => this.random.frac(),
      Array.from(this.activeEnemies.keys(), center), playerRadius(this.stats));
    if (!selected) return false;
    const { x, y } = selected;
    const enemy = this.enemies.get(x, y, 'enemy') as Image | null;
    if (!enemy) return false;
    enemy.enableBody(true, x, y, true, true)
      .setCircle(COMBAT.enemyRadius).setCollideWorldBounds(true).setDepth(1).clearTint();
    const id = ++this.nextEnemyId;
    this.activeEnemies.set(enemy, { id, health: position?.health ?? 1 });
    this.eventsForTest?.push({ type: 'spawn', tick: this.run.tick, id });
    return true;
  }

  private spawnBullet({ x, y }: Point): Image | null {
    const bullet = this.bullets.get(x, y, 'bullet') as Image | null;
    if (!bullet) return null;
    bullet.enableBody(true, x, y, true, true).setCircle(COMBAT.bulletRadius).setDepth(3);
    const id = ++this.nextBulletId;
    this.activeBullets.set(bullet, { id, expiresAtTick: this.run.tick + COMBAT.bulletLifetimeTicks });
    this.eventsForTest?.push({ type: 'shot', tick: this.run.tick, id });
    return bullet;
  }

  private fire(target: Image): void {
    const bullet = this.spawnBullet(center(this.player));
    if (!bullet) return;
    this.physics.moveToObject(bullet, target, COMBAT.bulletSpeed);
    this.nextShotTick = this.run.tick + shotIntervalTicks(this.stats);
  }

  private recycleMissedShots(): void {
    for (const [bullet, { expiresAtTick }] of this.activeBullets) {
      const { x, y } = center(bullet);
      if (this.run.tick >= expiresAtTick || x < 0 || x > ARENA.width || y < 0 || y > ARENA.height) {
        this.recycleBullet(bullet);
      }
    }
  }

  private recycleBullet(bullet: Image): void {
    this.activeBullets.delete(bullet);
    bullet.disableBody(true, true);
  }

  private resolveBulletHits(): void {
    for (const [bullet, shot] of this.activeBullets) {
      let target: Image | undefined;
      let nearestDistance = (COMBAT.bulletRadius + COMBAT.enemyRadius) ** 2;
      for (const enemy of this.activeEnemies.keys()) {
        const distance = distanceSquared(center(bullet), center(enemy));
        if (distance > nearestDistance || (target && distance === nearestDistance)) continue;
        target = enemy;
        nearestDistance = distance;
      }
      if (target) this.hitEnemy(bullet, shot.id, target);
    }
  }

  private hitEnemy(bullet: Image, bulletId: number, enemy: Image): void {
    const position = snapshotPosition(enemy);
    this.recycleBullet(bullet);
    const state = this.activeEnemies.get(enemy)!;
    const damage = Math.min(state.health, attackDamage(this.stats, () => this.combatRandom.frac()));
    state.health = Math.max(0, state.health - damage);
    this.run.heal(damage * this.stats.lifesteal);
    this.updateHud();
    this.feedback.enemyHit(state.id, position);
    if (state.health > 0) return;
    this.activeEnemies.delete(enemy);
    enemy.disableBody(true, true);
    this.run.kills += 1;
    this.eventsForTest?.push({ type: 'kill', tick: this.run.tick, id: state.id, bulletId });
    this.updateHud();
  }

  private resolveContact(): void {
    if (stressTest || this.run.tick < this.run.protectedUntilTick) return;
    for (const enemy of this.activeEnemies.keys()) {
      if (this.contacts.has(enemy)) {
        this.hitPlayer();
        return;
      }
    }
  }

  private hitPlayer(): void {
    if (!this.run.takeContactDamage()) return;
    this.feedback.playerHit();
    this.eventsForTest?.push({ type: 'damage', tick: this.run.tick, health: this.run.health });
    this.updateHud();
    if (this.run.health > 0) return;

    this.clock.clear();
    this.controls.clear();
    this.joystick.clear();
    this.player.setVelocity(0, 0);
    this.physics.pause();
    summary.textContent = `처치 ${this.run.kills} · 생존 ${(this.run.tick / TICKS_PER_SECOND).toFixed(1)}초`;
    results.hidden = false;
    restart.focus({ preventScroll: true });
  }

  private setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.clock.clear();
    this.controls.clear();
    if (paused) {
      this.frameTimesMs.length = 0;
      this.joystick.clear();
      this.player.setVelocity(0, 0);
      this.physics.pause();
    } else if (this.run.health > 0) {
      this.physics.resume();
    }
  }

  private applyStats(extraBullets = 0): void {
    const radius = playerRadius(this.stats);
    this.player.setScale(this.stats.size);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.updateFromGameObject();
    // Phaser rounds scaled half extents down. Keep fractional sizes centered and
    // use the same exact radius for Arcade collisions and crowd projection.
    body.halfWidth = radius;
    body.halfHeight = radius;
    const position = clampToArena(this.player, radius);
    body.reset(position.x, position.y);
    this.bullets.maxSize = Math.max(8, Math.ceil(COMBAT.bulletLifetimeTicks / shotIntervalTicks(this.stats)) + 1 + extraBullets);

    const values = {
      attackDamage: formatStat(this.stats.attackDamage),
      attackSpeed: `${formatStat(this.stats.attackSpeed)}회/초`,
      critChance: `${formatStat(this.stats.critChance * 100)}%`,
      critMultiplier: `${formatStat(this.stats.critMultiplier * 100)}%`,
      maxHealth: formatStat(this.stats.maxHealth),
      moveSpeed: `${formatStat(this.stats.moveSpeed)}px/초`,
      size: `${formatStat(this.stats.size)}배`,
      lifesteal: `${formatStat(this.stats.lifesteal * 100)}%`,
    };
    for (const [key, value] of Object.entries(values)) {
      document.querySelector<HTMLElement>(`[data-stat="${key}"]`)!.textContent = value;
    }
  }

  private applyFixture(fixture: ArenaFixture): void {
    this.stats = createPlayerStats(fixture.stats);
    this.run = new RunState(this.stats.maxHealth);
    this.applyStats(fixture.bullets?.length);
    if (fixture.seed !== undefined) {
      this.random.sow([fixture.seed]);
      this.combatRandom.sow([`${fixture.seed}:combat`]);
    }
    if (fixture.player) {
      const position = clampToArena(fixture.player, playerRadius(this.stats));
      this.player.body!.reset(position.x, position.y);
    }
    if (fixture.health !== undefined) this.run.health = fixture.health;
    for (const position of fixture.enemies ?? []) this.spawnEnemy(position);
    for (const { position, velocity } of fixture.bullets ?? []) {
      this.spawnBullet(position)?.setVelocity(velocity.x, velocity.y);
    }
    this.updateHud();
  }

  private snapshot(): ArenaSnapshot {
    return {
      round: this.round,
      tick: this.run.tick,
      health: this.run.health,
      kills: this.run.kills,
      stats: { ...this.stats },
      playerRadius: this.player.body!.halfWidth,
      player: snapshotPosition(this.player),
      enemies: Array.from(this.activeEnemies, ([enemy, state]) => ({ ...snapshotPosition(enemy), ...state })),
      bullets: Array.from(this.activeBullets, ([bullet, { id }]) => ({ ...snapshotPosition(bullet), id })),
      events: this.eventsForTest!.slice(),
    };
  }

  private updateHud(): void {
    health.textContent = `${formatStat(this.run.health)} / ${formatStat(this.stats.maxHealth)}`;
    kills.textContent = String(this.run.kills);
  }

  private drawJoystick(): void {
    this.joystick.clear();
    const joystick = this.controls.joystick;
    if (!joystick) return;
    const { origin, offset } = joystick;
    this.joystick.lineStyle(2, 0xe4fff0, 0.6)
      .fillStyle(0x101d17, 0.35)
      .fillCircle(origin.x, origin.y, JOYSTICK_RADIUS)
      .strokeCircle(origin.x, origin.y, JOYSTICK_RADIUS)
      .fillStyle(0xe4fff0, 0.65)
      .fillCircle(origin.x + offset.x, origin.y + offset.y, 14);
  }

  private makeTexture(key: string, radius: number, color: number, outline?: number): void {
    if (this.textures.exists(key)) return;
    const graphics = this.add.graphics();
    graphics.fillStyle(color).fillCircle(radius, radius, radius);
    if (outline !== undefined) {
      graphics.lineStyle(2, outline).strokeCircle(radius, radius, radius - 1);
    }
    graphics.generateTexture(key, radius * 2, radius * 2);
    graphics.destroy();
  }

  private drawArena(): void {
    const { width, height } = ARENA;
    const floor = this.add.graphics().fillStyle(0x263c31).fillRect(0, 0, width, height);
    floor.lineStyle(1, 0x3c5345, 0.5);
    for (let x = 20; x < width; x += 40) floor.lineBetween(x, 0, x, height);
    for (let y = 20; y < height; y += 40) floor.lineBetween(0, y, width, y);
    floor.lineStyle(1, 0x6d8676, 0.6).strokeRect(4, 4, width - 8, height - 8);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, ...ARENA },
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, customUpdate: true, fixedStep: true, fps: TICKS_PER_SECOND, timeScale: 1 } },
  input: { keyboard: false, mouse: false, touch: false, gamepad: false },
  scene: ArenaScene,
});
