import Phaser from 'phaser';
import { JOYSTICK_RADIUS, MoveControls } from './controls';
import {
  ARENA, clampToArena, COMBAT, constrainEnemyPosition, distanceSquared, nearestTarget, type Point, type ArenaSize, RunState, spawnIntervalTicks, spawnPoint,
} from './rules';
import { solveCrowd, type CrowdResult } from './crowd';
import { FixedClock, TICKS_PER_SECOND } from './simulation';
import type { ArenaEvent, ArenaFixture, ArenaSnapshot, EnemyFixture } from './testing';
import { HitFeedback } from './feedback';
import { createPlayerStats, formatStat, playerRadius, type ActorStats } from './stats';
import './style.css';
import './moonlight.css';
import { arenaViewport } from './viewport';
import { GameUI } from './ui';
import { createEnemyStats, ENEMY_DEFINITION, enemyRadius, EnemyState } from './enemies';
import { CombatSession, type AttackSnapshot, type CombatEvent } from './combat';
import { AttackClock } from './attacks';
import { sweptCircleTime } from './collision';
import { Progression, availableUpgrades, type UpgradeId } from './progression';
import { ProgressionUI } from './progression-ui';
import { loadArt, installArt, type ArtImages } from './art';
import { ArenaPresentation } from './presentation';

type Image = Phaser.Physics.Arcade.Image;
type Bullet = { id: number; expiresAtTick: number; attack: AttackSnapshot; remaining: number };

const results = document.querySelector<HTMLElement>('#results')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const restart = document.querySelector<HTMLButtonElement>('#restart')!;
const query = new URLSearchParams(location.search);
const stressTest = import.meta.env.DEV && query.has('stress');
const manualTest = import.meta.env.DEV && query.has('simtest');
let started = (manualTest && !query.has('title')) || stressTest;
let artImages: ArtImages;
const still: Point = { x: 0, y: 0 };

function center(image: Image): Point {
  return image.body!.center;
}

function snapshotPosition(image: Image): Point {
  const { x, y } = center(image);
  return { x, y };
}

export class ArenaScene extends Phaser.Scene {
  private get stats(): Readonly<ActorStats> { return this.run.stats; }
  private run = new RunState();
  private combat!: CombatSession;
  get combatRuntime(): CombatSession { return this.combat; }
  private attackClock = new AttackClock();
  private appliedPlayerStats?: Readonly<ActorStats>;
  private combatEventsForTest?: CombatEvent[];
  private readonly clock = new FixedClock();
  private nextSpawnTick = 0;
  private nextEnemyId = 0;
  private nextBulletId = 0;
  private paused = false;
  private readonly pauseReasons = new Set<string>();
  private bounds: ArenaSize = { ...ARENA };
  private presentation!: ArenaPresentation;
  private titleListeners!: AbortController;
  private enemyDetails!: Phaser.GameObjects.Graphics;
  private ui!: GameUI;
  private progression!: Progression;
  private progressionUI!: ProgressionUI;
  private growthRandom!: Phaser.Math.RandomDataGenerator;
  private awaitingGrowthInput = false;
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
  private readonly activeEnemies = new Map<Image, EnemyState>();
  private readonly contacts = new Set<Image>();
  private readonly activeBullets = new Map<Image, Bullet>();
  private fixture?: ArenaFixture;
  private fixtureSpawn = 0;
  private round = 0;
  private eventsForTest?: ArenaEvent[];
  private crowdResult: CrowdResult = { passes: 0, maxPenetrationPx: 0 };
  private crowdElapsedMs = 0;

  create(): void {
    this.titleListeners = new AbortController();
    this.round += 1;
    this.run = new RunState(createPlayerStats(this.fixture?.stats));
    this.attackClock = new AttackClock();
    this.appliedPlayerStats = undefined;
    this.crowdResult = { passes: 0, maxPenetrationPx: 0 };
    this.crowdElapsedMs = 0;
    this.clock.clear();
    this.nextSpawnTick = spawnIntervalTicks(0);
    this.nextEnemyId = 0;
    this.nextBulletId = 0;
    this.fixtureSpawn = 0;
    this.paused = false;
    this.awaitingGrowthInput = false;
    this.pauseReasons.clear();
    this.bounds = this.fixture?.bounds ?? arenaViewport(this.scale.width, this.scale.height);
    const seed = this.fixture?.seed ?? crypto.getRandomValues(new Uint32Array(2)).join('-');
    this.random = new Phaser.Math.RandomDataGenerator([seed]);
    this.combatRandom = new Phaser.Math.RandomDataGenerator([`${seed}:combat`]);
    this.growthRandom = new Phaser.Math.RandomDataGenerator([`${seed}:growth`]);
    this.progression = new Progression(!stressTest && this.fixture?.progression !== false, () => this.growthRandom.frac());
    this.combat = new CombatSession(() => this.combatRandom.frac());
    this.combat.add(this.run);
    this.activeEnemies.clear();
    this.contacts.clear();
    this.activeBullets.clear();
    this.frameTimesMs.length = 0;
    this.eventsForTest = manualTest ? [] : undefined;
    this.combatEventsForTest = manualTest ? [] : undefined;
    this.combat.events.subscribe(event => {
      this.combatEventsForTest?.push(event);
      if (event.type === 'kill' && event.attack.source.kind === 'player' && event.target.kind === 'enemy') {
        this.run.kills += 1;
        this.progression.awardKill(event.target.id);
        this.eventsForTest?.push({ type: 'kill', tick: event.tick, id: event.target.id, bulletId: event.attack.projectileId ?? 0 });
      }
      if (event.type === 'hit' && event.target.kind === 'player') {
        this.feedback.playerHit();
        this.eventsForTest?.push({ type: 'damage', tick: event.tick, health: event.healthAfter });
      }
    });
    results.hidden = true;
    installArt(this, artImages);
    this.presentation = new ArenaPresentation(this);
    this.enemyDetails = this.add.graphics().setDepth(40);
    this.drawArena();

    this.makeTexture('player', COMBAT.playerRadius, 0x73d5ff, 0x17354a);
    this.makeTexture('enemy', COMBAT.enemyRadius, ENEMY_DEFINITION.color, ENEMY_DEFINITION.outline);
    this.makeTexture('bullet', COMBAT.bulletRadius, 0xf6edd3);

    this.physics.world.setBounds(0, 0, this.bounds.width, this.bounds.height);
    this.player = this.physics.add.image(this.bounds.width / 2, this.bounds.height / 2, 'player')
      .setCircle(COMBAT.playerRadius).setCollideWorldBounds(true).setImmovable(true).setPushable(false).setDepth(2);
    this.enemies = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, maxSize: COMBAT.enemyLimit });
    this.bullets = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, maxSize: 8 });
    this.applyStats();
    this.presentation.attach(this.player, 'player', 0);
    this.physics.add.collider(this.player, this.enemies, (_player, enemy) => {
      this.contacts.add(enemy as Image);
    });
    this.physics.resume();
    this.joystick = this.add.graphics().setDepth(50);
    this.controls = new MoveControls(this.game.canvas, (x, y) => this.cameras.main.getWorldPoint(x * this.scale.width, y * this.scale.height));
    this.feedback = new HitFeedback(this);
    this.ui = new GameUI({
      pause: paused => this.setPaused(paused, 'menu'),
      restart: () => this.scene.restart(),
      effects: reduced => { this.feedback.reducedEffects = reduced; },
    });
    this.progressionUI = new ProgressionUI((token, id) => this.selectUpgrade(token, id), () => this.feedback.reducedEffects || !this.run.alive);
    this.ui.setTitle(!started);
    if (!started) this.setPaused(true, 'title');
    document.getElementById('title-start')!.addEventListener('click', () => {
      if (started) return;
      started = true;
      this.ui.setTitle(false);
      this.setPaused(false, 'title');
      this.updateHud();
      this.game.canvas.tabIndex = -1;
      this.game.canvas.focus({ preventScroll: true });
    }, { signal: this.titleListeners.signal });
    this.fitCamera();
    if (stressTest) {
      this.stressReadout = this.add.text(10, ARENA.height - 12, '부하 테스트 준비 중', {
        fontFamily: 'system-ui, sans-serif', fontSize: '12px', backgroundColor: '#111a16',
        padding: { x: 6, y: 4 },
      }).setOrigin(0, 1).setDepth(60);
    }

    const listeners = new AbortController();
    const { signal } = listeners;
    const syncFocus = () => this.setPaused(document.hidden || !document.hasFocus(), 'focus');
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
      window.addEventListener('blur', () => this.setPaused(true, 'focus'), { signal });
      window.addEventListener('focus', syncFocus, { signal });
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      listeners.abort();
      this.controls.destroy();
      this.feedback.dispose();
      this.combat.dispose();
      this.ui.destroy();
      this.progressionUI.destroy();
      this.presentation.destroy();
      this.titleListeners.abort();
      this.scale.off(Phaser.Scale.Events.RESIZE, this.resizeArena, this);
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, this.resizeArena, this);

    if (import.meta.env.DEV && manualTest) {
      if (this.fixture) this.applyFixture(this.fixture);
      window.__arenaTest = {
        view: () => ({ ...this.bounds, zoom: this.cameras.main.zoom }),
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
        presentation: () => ({ phase: started ? (this.run.alive ? 'playing' : 'results') : 'title', actors: this.presentation.snapshot(), objects: this.children.length }),
        setBaseStats: (target, patch) => { this.combat.setBase(target, patch); this.synchronizeStats(); },
        upsertModifier: (target, modifier) => { this.combat.upsertModifier(target, modifier); this.synchronizeStats(); },
        removeModifier: (target, id) => { this.combat.removeModifier(target, id); this.synchronizeStats(); },
        enqueue: command => this.combat.enqueue(command),
        onCombatEvent: listener => this.combat.events.subscribe(listener),
        grantExperience: amount => { this.progression.gain(amount); this.updateHud(); this.maybeOpenLevelUp(); },
        chooseUpgrade: (token, id) => this.selectUpgrade(token, id),
      };
    }
    this.updateHud();
    if (!manualTest) this.setPaused(document.hidden, 'focus');
  }

  update(_timeMs: number, deltaMs: number): void {
    if (!manualTest) this.advanceFrame(deltaMs);
    if (stressTest && !this.paused && this.run.health > 0) this.sampleStressFrame();
  }

  private advanceFrame(deltaMs: number): void {
    this.synchronizeStats();
    if (this.awaitingGrowthInput && this.pauseReasons.size === 1 && this.pauseReasons.has('level-up')) {
      const movement = this.controls.direction();
      if (movement.x !== 0 || movement.y !== 0) {
        this.awaitingGrowthInput = false;
        this.progressionUI.close();
        this.setPaused(false, 'level-up', true);
      }
    }
    this.maybeOpenLevelUp();
    if (this.paused) return;
    this.feedback.advance(deltaMs);
    if (this.run.health > 0) {
      const movement = this.controls.direction();
      this.clock.advanceFrame(deltaMs, () => {
        const input = this.fixture?.input ? this.fixture.input[this.run.tick] ?? still : movement;
        this.step(input);
        return this.run.health > 0 && !this.paused;
      });
    }
    this.drawJoystick();
    this.drawEnemyDetails();
    this.updateHud();
  }

  private step(movement: Point): void {
    this.run.tick += 1;
    this.combat.beginTick(this.run.tick);
    this.removeDeadEnemies();
    this.synchronizeStats();
    if (!this.run.alive) {
      this.combat.events.flush();
      this.finishRun();
      return;
    }
    this.player.setVelocity(movement.x * this.stats.moveSpeed, movement.y * this.stats.moveSpeed);
    for (const [enemy, state] of this.activeEnemies) {
      if (this.run.tick < state.recoilUntilTick) enemy.setVelocity(0, 0);
      else this.physics.moveToObject(enemy, this.player, state.stats.moveSpeed);
    }

    this.contacts.clear();
    const bulletFrom = new Map(Array.from(this.activeBullets.keys(), image => [image, snapshotPosition(image)]));
    const enemyFrom = new Map(Array.from(this.activeEnemies.keys(), image => [image, snapshotPosition(image)]));
    this.physics.world.singleStep();
    this.constrainActors();
    if (this.resolveBulletHits(bulletFrom, enemyFrom)) {
      this.contacts.clear();
      this.constrainActors();
    }
    this.resolveContact();
    this.combat.events.flush();
    this.removeDeadEnemies();
    this.synchronizeStats();
    if (!this.run.alive) { this.finishRun(); return; }
    if (this.maybeOpenLevelUp()) return;

    this.recycleMissedShots();
    this.spawnDueEnemies();
    const target = nearestTarget(this.player, this.activeEnemies.keys());
    const attacks = this.attackClock.advance(this.stats.attackSpeed, target !== undefined);
    if (target && attacks > 0) this.fire(target, attacks);
    this.combat.events.flush();
    this.synchronizeStats();
    this.maybeOpenLevelUp();
  }

  private constrainActors(): void {
    const radius = playerRadius(this.stats);
    this.moveBodyTo(this.player, clampToArena(center(this.player), radius, this.bounds));
    const player = center(this.player);
    const positions = Array.from(this.activeEnemies, ([image, { id, stats }]) => ({
      ...snapshotPosition(image), id, image, radius: enemyRadius(stats),
    }));
    const startedMs = manualTest ? performance.now() : 0;
    this.crowdResult = solveCrowd(player, positions, radius, this.bounds);
    if (manualTest) this.crowdElapsedMs = performance.now() - startedMs;
    for (const position of positions) {
      this.moveBodyTo(position.image, position);
      if (distanceSquared(position, player) <= (radius + position.radius + 1e-6) ** 2) {
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

  private spawnEnemy(position?: EnemyFixture): boolean {
    if (this.activeEnemies.size >= COMBAT.enemyLimit) return false;
    const stats = createEnemyStats(position?.stats);
    const radius = enemyRadius(stats);
    const selected = position ?? spawnPoint(center(this.player), () => this.random.frac(),
      Array.from(this.activeEnemies, ([image, state]) => ({ ...snapshotPosition(image), radius: enemyRadius(state.stats) })),
      playerRadius(this.stats), this.bounds, radius);
    if (!selected) return false;
    const { x, y } = clampToArena(selected, radius, this.bounds);
    const enemy = this.enemies.get(x, y, 'enemy') as Image | null;
    if (!enemy) return false;
    enemy.setTexture('enemy').setScale(stats.size).enableBody(true, x, y, true, true)
      .setCircle(COMBAT.enemyRadius).setCollideWorldBounds(true).setDepth(1).clearTint();
    const body = enemy.body as Phaser.Physics.Arcade.Body;
    body.updateFromGameObject();
    body.halfWidth = radius;
    body.halfHeight = radius;
    body.reset(x, y);
    const id = ++this.nextEnemyId;
    const state = new EnemyState(id, stats);
    state.health = position?.health ?? stats.maxHealth;
    this.activeEnemies.set(enemy, state);
    this.presentation.attach(enemy, 'enemy', id);
    this.combat.add(state);
    this.eventsForTest?.push({ type: 'spawn', tick: this.run.tick, id });
    return true;
  }

  private spawnBullet({ x, y }: Point, count = 1): Image | null {
    const bullet = this.bullets.get(x, y, 'bullet') as Image | null;
    if (!bullet) return null;
    bullet.enableBody(true, x, y, true, true).setCircle(COMBAT.bulletRadius).setDepth(30);
    const id = ++this.nextBulletId;
    this.activeBullets.set(bullet, { id, expiresAtTick: this.run.tick + COMBAT.bulletLifetimeTicks,
      attack: this.combat.createAttack(this.run, 'projectile', count, id), remaining: count });
    this.eventsForTest?.push({ type: 'shot', tick: this.run.tick, id });
    return bullet;
  }

  private fire(target: Image, count: number): void {
    const bullet = this.spawnBullet(center(this.player), count);
    if (!bullet) return;
    this.physics.moveToObject(bullet, target, COMBAT.bulletSpeed);
  }

  private recycleMissedShots(): void {
    for (const [bullet, { expiresAtTick }] of this.activeBullets) {
      const { x, y } = center(bullet);
      if (this.run.tick >= expiresAtTick || x < 0 || x > this.bounds.width || y < 0 || y > this.bounds.height) {
        this.recycleBullet(bullet);
      }
    }
  }

  private recycleBullet(bullet: Image): void {
    this.activeBullets.delete(bullet);
    bullet.disableBody(true, true);
  }

  private resolveBulletHits(bulletFrom: Map<Image, Point>, enemyFrom: Map<Image, Point>): boolean {
    let recoiled = false;
    const enemyTo = new Map(Array.from(this.activeEnemies.keys(), image => [image, snapshotPosition(image)]));
    for (const [bullet, shot] of this.activeBullets) {
      const from = bulletFrom.get(bullet)!;
      const to = snapshotPosition(bullet);
      const candidates: { image: Image; time: number; id: number }[] = [];
      for (const [enemy, state] of this.activeEnemies) {
        const time = sweptCircleTime(from, to, enemyFrom.get(enemy)!, enemyTo.get(enemy)!, COMBAT.bulletRadius + enemyRadius(state.stats));
        if (time !== undefined) candidates.push({ image: enemy, time, id: state.id });
      }
      candidates.sort((a, b) => a.time - b.time || a.id - b.id);
      for (const { image } of candidates) {
        if (!this.activeEnemies.has(image) || !this.activeBullets.has(bullet)) continue;
        recoiled = this.hitEnemy(bullet, shot, image) || recoiled;
      }
    }
    return recoiled;
  }

  private hitEnemy(bullet: Image, shot: Bullet, enemy: Image): boolean {
    const position = snapshotPosition(enemy);
    const velocity = bullet.body!.velocity;
    // Stationary fixture shots fall back to the direction away from the player.
    const dx = velocity.lengthSq() > 0 ? velocity.x : position.x - center(this.player).x;
    const dy = velocity.lengthSq() > 0 ? velocity.y : position.y - center(this.player).y;
    const length = Math.hypot(dx, dy);
    const state = this.activeEnemies.get(enemy)!;
    const result = this.combat.applyAttack(shot.attack, state, shot.remaining);
    const damage = result.damage;
    shot.remaining -= damage === 0 ? shot.remaining : result.hits;
    if (shot.remaining <= 0) this.recycleBullet(bullet);
    this.updateHud();
    if (state.health > 0) {
      if (damage <= 0) return false;
      const distance = 3 / Math.max(0.75, state.stats.size);
      const destination = constrainEnemyPosition({
        x: position.x + (length > 0 ? dx / length : 1) * distance,
        y: position.y + (length > 0 ? dy / length : 0) * distance,
      }, center(this.player), playerRadius(this.stats), this.bounds, enemyRadius(state.stats));
      this.moveBodyTo(enemy, destination);
      state.recoilUntilTick = this.run.tick + 3;
      this.feedback.enemyHit(state.id, destination);
      return true;
    }
    this.removeEnemy(enemy, state);
    return false;
  }

  private resolveContact(): void {
    if (stressTest || this.run.tick < this.run.protectedUntilTick) return;
    for (const [enemy, state] of this.activeEnemies) {
      if (this.contacts.has(enemy) && state.stats.attackDamage > 0) {
        this.combat.applyAttack(this.combat.createAttack(state, 'contact'), this.run);
        return;
      }
    }
  }

  private finishRun(): void {
    this.awaitingGrowthInput = false;
    this.progressionUI.close();
    this.clock.clear();
    this.controls.clear();
    this.joystick.clear();
    this.player.setVelocity(0, 0);
    this.physics.pause();
    summary.textContent = `처치 ${this.run.kills} · 생존 ${(this.run.tick / TICKS_PER_SECOND).toFixed(1)}초`;
    results.hidden = false;
    this.controls.enabled = false;
    this.ui.end();
    restart.focus({ preventScroll: true });
  }

  private setPaused(value: boolean, reason = 'test', preserveInput = false): void {
    if (value) this.pauseReasons.add(reason);
    else this.pauseReasons.delete(reason);
    const paused = this.pauseReasons.size > 0;
    const freshGrowthInput = this.awaitingGrowthInput && this.pauseReasons.size === 1 && this.pauseReasons.has('level-up');
    this.controls.enabled = this.run.alive && (!paused || freshGrowthInput);
    if (paused === this.paused) {
      if (value && !freshGrowthInput) this.controls.clear();
      return;
    }
    this.paused = paused;
    this.clock.clear();
    if (!preserveInput) this.controls.clear();
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
    const position = clampToArena(this.player, radius, this.bounds);
    body.reset(position.x, position.y);
    this.bullets.maxSize = Math.max(this.bullets.maxSize, COMBAT.bulletLifetimeTicks + 1 + extraBullets);
    this.appliedPlayerStats = this.stats;

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
    const stats = createPlayerStats(fixture.stats);
    if (fixture.bounds) {
      this.bounds = { ...fixture.bounds };
      this.physics.world.setBounds(0, 0, this.bounds.width, this.bounds.height);
      this.player.body!.reset(this.bounds.width / 2, this.bounds.height / 2);
      this.drawArena();
      this.fitCamera();
    }
    this.run = new RunState(stats);
    this.progression = new Progression(!stressTest && fixture.progression !== false, () => this.growthRandom.frac());
    this.combat.add(this.run);
    this.applyStats(fixture.bullets?.length);
    if (fixture.seed !== undefined) {
      this.random.sow([fixture.seed]);
      this.combatRandom.sow([`${fixture.seed}:combat`]);
      this.growthRandom.sow([`${fixture.seed}:growth`]);
    }
    if (fixture.player) {
      const position = clampToArena(fixture.player, playerRadius(this.stats), this.bounds);
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
      enemies: Array.from(this.activeEnemies, ([enemy, state]) => ({
        ...snapshotPosition(enemy), id: state.id, stats: state.stats, health: state.health, recoilUntilTick: state.recoilUntilTick,
        radius: enemyRadius(state.stats), bodyRadius: enemy.body!.halfWidth,
      })),
      bullets: Array.from(this.activeBullets, ([bullet, { id, attack, remaining }]) => ({ ...snapshotPosition(bullet), id, attack, remaining })),
      events: this.eventsForTest!.slice(),
      combatEvents: this.combatEventsForTest!.slice(),
      progression: this.progression.snapshot(),
      awaitingGrowthInput: this.awaitingGrowthInput,
    };
  }

  private updateHud(): void {
    this.renderActors();
    this.ui.update(this.run.health, this.stats.maxHealth, this.run.kills, this.run.tick);
    this.progressionUI?.update(this.progression, this.awaitingGrowthInput);
    if (this.pauseReasons.has('level-up')) document.getElementById('control-hint')!.hidden = true;
    const zoom = this.cameras.main.zoom;
    const offsetX = (this.scale.width - this.bounds.width * zoom) / 2;
    const offsetY = (this.scale.height - this.bounds.height * zoom) / 2;
    const rect = this.game.canvas.getBoundingClientRect();
    const xScale = rect.width / this.scale.width, yScale = rect.height / this.scale.height;
    const position = center(this.player);
    this.ui.positionHealth((offsetX + position.x * zoom) * xScale,
      (offsetY + (position.y + 6) * zoom) * yScale,
      (offsetY + (position.y - 36 * this.stats.size - 6) * zoom) * yScale, rect.width, rect.height);
  }

  private maybeOpenLevelUp(): boolean {
    if (!this.run.alive || this.progression.pending === 0 || this.awaitingGrowthInput) return false;
    if (Array.from(this.pauseReasons).some(reason => reason !== 'level-up')) return false;
    const choices = this.progression.offer(availableUpgrades(this.run, this.progression.ranks, this.run.tick));
    if (choices.length === 0) return false;
    this.setPaused(true, 'level-up');
    this.ui.setGrowthBlocked(true);
    this.progressionUI.show(this.progression);
    this.updateHud();
    return true;
  }

  private selectUpgrade(token: number, id: UpgradeId): void {
    if (!this.run.alive || !this.pauseReasons.has('level-up') || this.awaitingGrowthInput) return;
    let selected: boolean;
    try {
      selected = this.progression.choose(token, id, choice => {
        this.combat.upsertModifier(this.run.ref, choice.effect);
        this.synchronizeStats();
      });
    } catch {
      this.progression.invalidateOffer();
      this.maybeOpenLevelUp();
      return;
    }
    if (!selected) return;
    if (this.progression.pending > 0 && this.maybeOpenLevelUp()) return;
    this.awaitingGrowthInput = true;
    this.progressionUI.close(true);
    this.ui.setGrowthBlocked(false);
    this.controls.clear();
    this.controls.enabled = this.pauseReasons.size === 1;
    this.updateHud();
  }

  private removeEnemy(image: Image, state: EnemyState): void {
    this.feedback.enemyDeath(state.id, image, this.presentation.image(image));
    this.presentation.detach(image);
    this.activeEnemies.delete(image);
    this.combat.remove(state.ref);
    image.disableBody(true, true);
  }

  private removeDeadEnemies(): void {
    for (const [image, state] of this.activeEnemies) if (!state.alive) this.removeEnemy(image, state);
  }

  private synchronizeStats(): void {
    if (!this.player || !this.ui) return;
    let changed = false;
    if (this.appliedPlayerStats !== this.stats) { this.applyStats(); changed = true; }
    for (const [image, state] of this.activeEnemies) {
      if (state.appliedStats === state.stats) continue;
      const position = snapshotPosition(image);
      const radius = enemyRadius(state.stats);
      image.setScale(state.stats.size);
      const body = image.body as Phaser.Physics.Arcade.Body;
      body.updateFromGameObject();
      body.halfWidth = body.halfHeight = radius;
      const clamped = clampToArena(position, radius, this.bounds);
      body.reset(clamped.x, clamped.y);
      state.appliedStats = state.stats;
      changed = true;
    }
    if (changed) { this.constrainActors(); this.drawEnemyDetails(); this.updateHud(); }
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

  private drawEnemyDetails(): void {
    const graphics = this.enemyDetails;
    graphics.clear();
    for (const [image, state] of this.activeEnemies) {
      const { x, y } = center(image);
      const radius = enemyRadius(state.stats);
      if (state.health < state.stats.maxHealth) {
        const width = radius * 2;
        const barY = Math.max(2, y - 28 * state.stats.size - 4);
        graphics.fillStyle(0x15231d).fillRect(x - radius, barY, width, 2);
        graphics.fillStyle(0xc4cbb5).fillRect(x - radius, barY, width * state.health / state.stats.maxHealth, 2);
      }
    }
  }

  private drawArena(): void {
    const { width, height } = this.bounds;
    this.presentation.resize(width, height);
  }

  private renderActors(): void {
    if (!this.presentation || !this.feedback || !this.player) return;
    this.feedback.render(this.player);
    this.presentation.sync(this.run.tick, this.feedback.reducedEffects, this.paused);
  }

  private fitCamera(): void {
    this.cameras.main.setZoom(Math.min(this.scale.width / this.bounds.width, this.scale.height / this.bounds.height));
    this.cameras.main.centerOn(this.bounds.width / 2, this.bounds.height / 2);
  }

  private resizeArena(): void {
    if (!this.player) return;
    this.controls.clear();
    this.joystick.clear();
    if (!this.fixture?.bounds) {
      const previous = this.bounds;
      this.bounds = arenaViewport(this.scale.width, this.scale.height);
      this.feedback.resize(previous, this.bounds);
      this.physics.world.setBounds(0, 0, this.bounds.width, this.bounds.height);
      for (const actor of [this.player, ...this.activeEnemies.keys(), ...this.activeBullets.keys()]) {
        const position = center(actor);
        this.moveBodyTo(actor, {
          x: position.x * this.bounds.width / previous.width,
          y: position.y * this.bounds.height / previous.height,
        });
      }
      this.constrainActors();
      this.drawArena();
    }
    this.fitCamera();
    this.updateHud();
  }
}

function launchGame(): void { new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, customUpdate: true, fixedStep: true, fps: TICKS_PER_SECOND, timeScale: 1 } },
  input: { keyboard: false, mouse: false, touch: false, gamepad: false },
  scene: ArenaScene,
}); }

let loading = false;
async function boot(): Promise<void> {
  if (loading) return;
  loading = true;
  const start = document.getElementById('title-start') as HTMLButtonElement;
  const settings = document.getElementById('title-settings') as HTMLButtonElement;
  const retry = document.getElementById('art-retry') as HTMLButtonElement;
  const status = document.getElementById('art-status')!;
  start.disabled = settings.disabled = true;
  retry.hidden = true;
  status.textContent = '공터를 준비하고 있어요.';
  try {
    artImages = await loadArt();
    launchGame();
    status.textContent = '';
  } catch {
    status.textContent = '화면을 불러오지 못했어요. 다시 시도해 주세요.';
    retry.hidden = false;
  } finally { loading = false; }
}
document.getElementById('art-retry')!.addEventListener('click', () => { void boot(); });
void boot();
