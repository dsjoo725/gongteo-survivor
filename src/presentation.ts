import Phaser from 'phaser';
import { ACTOR_ART, type ActorArt } from './art';
import type { Point } from './rules';

type BodyImage = Phaser.Physics.Arcade.Image;
type ActorVisual = { image: Phaser.GameObjects.Image; art: ActorArt; facingLeft: boolean; phase: number; wave: number };

/** Art follows existing circular bodies; no art transform ever writes to physics. */
export class ArenaPresentation {
  private readonly actors = new Map<BodyImage, ActorVisual>();
  private readonly background: Phaser.GameObjects.Image;

  constructor(private readonly scene: Phaser.Scene) {
    this.background = scene.add.image(0, 0, 'paint-background').setOrigin(0.5).setDepth(-2);
  }

  resize(width: number, height: number): void {
    const source = this.background.texture.getSourceImage() as HTMLImageElement;
    // Cover with one continuous painting. Wide views crop to its quiet clearing;
    // no stretched edge strips, repeated horizons or nonuniform art scaling.
    const scale = Math.max(width / source.width, height / source.height);
    this.background.setPosition(width / 2, height / 2).setScale(scale);
  }

  attach(body: BodyImage, kind: 'player' | 'enemy', id: number): void {
    this.detach(body);
    const art = ACTOR_ART[kind];
    const image = this.scene.add.image(body.body!.center.x, body.body!.center.y, art.texture, 'actor')
      .setOrigin(art.originX, art.originY);
    this.actors.set(body, { image, art, facingLeft: false, phase: id * 0.7, wave: 0 });
    body.setAlpha(0);
  }

  sync(tick: number, reduced: boolean, paused = false): void {
    for (const [body, visual] of this.actors) {
      const physics = body.body!;
      const moving = physics.velocity.lengthSq() > 0.01;
      if (Math.abs(physics.velocity.x) > 0.01) visual.facingLeft = physics.velocity.x < 0;
      if (!paused || reduced) visual.wave = moving && !reduced ? Math.sin(tick / 60 * Math.PI * 8 + visual.phase) : 0;
      const wave = visual.wave;
      const scale = visual.art.height * body.scaleY / visual.image.frame.height;
      visual.image.setPosition(physics.center.x, physics.center.y - Math.abs(wave))
        .setScale(scale).setFlipX(visual.facingLeft).setAngle(wave * 2)
        .setDepth(10 + physics.center.y / 10000).setVisible(body.active);
      visual.image.setTint(body.tintTopLeft).setTintMode(Phaser.TintModes.MULTIPLY);
    }
  }

  image(body: BodyImage): Phaser.GameObjects.Image | undefined { return this.actors.get(body)?.image; }
  detach(body: BodyImage): void { this.actors.get(body)?.image.destroy(); this.actors.delete(body); }

  snapshot() {
    return Array.from(this.actors, ([body, { image, art }]) => ({
      kind: art === ACTOR_ART.player ? 'player' : 'enemy', texture: image.texture.key,
      x: image.x, y: image.y, foot: { x: body.body!.center.x, y: body.body!.center.y } as Point,
      height: image.displayHeight, angle: image.angle, flipX: image.flipX, tint: image.tintTopLeft,
    }));
  }

  destroy(): void {
    for (const visual of this.actors.values()) visual.image.destroy();
    this.actors.clear();
    this.background.destroy();
  }
}
