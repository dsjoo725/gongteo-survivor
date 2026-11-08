import Phaser from 'phaser';

export const ART_ROOT = `${import.meta.env.BASE_URL}art/moonlight/`;
export const ART_FILES = ['background', 'player', 'enemy', 'title', 'rose-paint'] as const;
export type ArtImages = Record<typeof ART_FILES[number], HTMLImageElement>;
export type ActorArt = Readonly<{ texture: string; height: number; originX: number; originY: number }>;
export const ACTOR_ART: Record<'player' | 'enemy', ActorArt> = {
  player: { texture: 'paint-player', height: 36, originX: 0.5, originY: 1 },
  enemy: { texture: 'paint-enemy', height: 28, originX: 0.5, originY: 1 },
};

export async function loadArt(): Promise<ArtImages> {
  const entries = await Promise.all(ART_FILES.map(key => new Promise<[typeof key, HTMLImageElement]>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve([key, image]);
    image.onerror = () => reject(new Error(`Could not load ${key}`));
    image.src = `${ART_ROOT}${key}.png`;
  })));
  return Object.fromEntries(entries) as ArtImages;
}

export function installArt(scene: Phaser.Scene, images: ArtImages): void {
  for (const key of ART_FILES) {
    const textureKey = `paint-${key}`;
    if (!scene.textures.exists(textureKey)) scene.textures.addImage(textureKey, images[key]);
  }
  // Frames remove transparent padding without altering the generated source files.
  const player = scene.textures.get('paint-player'), enemy = scene.textures.get('paint-enemy');
  if (!player.has('actor')) player.add('actor', 0, 344, 236, 507, 807);
  if (!enemy.has('actor')) enemy.add('actor', 0, 178, 205, 918, 865);
}
