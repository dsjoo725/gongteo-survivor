export const LEVEL_CAP_WIDTH = 28;
export const STAR_PATH = 'M10 1.6 12.6 6.9 18.5 7.8 14.2 12 15.2 17.9 10 15.1 4.8 17.9 5.8 12 1.5 7.8 7.4 6.9Z';
export const STAR_HIGHLIGHT = 'm3.9 8.8 4.5-.7L10 4.7';

const UPGRADE_ART = {
  attack: ['base', 158, 153, 415, 454],
  move: ['base', 876, 174, 411, 393],
  burst: ['base', 1625, 175, 373, 377],
  speed: ['extra', 93, 175, 266, 392],
  crit: ['extra', 467, 183, 365, 377],
  health: ['extra', 896, 205, 378, 339],
  size: ['extra', 1334, 200, 345, 349],
  heal: ['extra', 1799, 174, 291, 386],
} as const;
export type UpgradeSymbol = keyof typeof UPGRADE_ART;

/** Size each painting from its visible silhouette, retaining a small transparent rim. */
export function upgradePicture(symbol: UpgradeSymbol) {
  const [atlas, x, y, width, height] = UPGRADE_ART[symbol];
  const rim = 2;
  const size = Math.max(width, height) + 2 * rim;
  return { atlas, variables: {
    '--sprite-width': (width + 2 * rim) / size,
    '--sprite-height': (height + 2 * rim) / size,
    '--sprite-sheet-width': 2172 / size,
    '--sprite-sheet-height': 724 / size,
    '--sprite-left': (rim - x) / size,
    '--sprite-top': (rim - y) / size,
  } };
}

export function experienceOutline(width: number): string {
  const end = width - LEVEL_CAP_WIDTH;
  return [
    `M5.5 7 H${end - 2}`,
    `Q${end + 1} 7 ${end + 3} 4.5 Q${end + 5} 2 ${end + 8} 2`,
    `H${width - 7} Q${width - 1} 2 ${width - 1} 8 V15 Q${width - 1} 21 ${width - 7} 21`,
    `H${end + 8} Q${end + 5} 21 ${end + 3} 18.5 Q${end + 1} 16 ${end - 2} 16`,
    'H5.5 A4.5 4.5 0 0 1 5.5 7Z',
  ].join(' ');
}
