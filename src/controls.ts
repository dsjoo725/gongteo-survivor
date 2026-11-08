import type { Point } from './rules';

export const JOYSTICK_RADIUS = 46;
const DEAD_ZONE = 7;
const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

interface Joystick {
  pointerId: number;
  origin: Point;
  offset: Point;
}

export class MoveControls {
  enabled = true;
  joystick: Joystick | undefined;
  private readonly keys = new Set<string>();
  private readonly listeners = new AbortController();

  constructor(private readonly canvas: HTMLCanvasElement, private readonly toWorld: (x: number, y: number) => Point) {
    const { signal } = this.listeners;
    window.addEventListener('keydown', this.keyDown, { signal });
    window.addEventListener('keyup', this.keyUp, { signal });
    canvas.addEventListener('pointerdown', this.pointerDown, { signal });
    canvas.addEventListener('pointermove', this.pointerMove, { signal });
    canvas.addEventListener('pointerup', this.pointerEnd, { signal });
    canvas.addEventListener('pointercancel', this.pointerEnd, { signal });
    canvas.addEventListener('lostpointercapture', this.pointerEnd, { signal });
  }

  direction(): Point {
    if (!this.enabled) return { x: 0, y: 0 };
    if (this.joystick) {
      const { x, y } = this.joystick.offset;
      const length = Math.hypot(x, y);
      if (length <= DEAD_ZONE) return { x: 0, y: 0 };
      const magnitude = (length - DEAD_ZONE) / (JOYSTICK_RADIUS - DEAD_ZONE);
      return { x: (x / length) * magnitude, y: (y / length) * magnitude };
    }

    const x = Number(this.keys.has('ArrowRight')) - Number(this.keys.has('ArrowLeft'));
    const y = Number(this.keys.has('ArrowDown')) - Number(this.keys.has('ArrowUp'));
    const length = Math.hypot(x, y) || 1;
    return { x: x / length, y: y / length };
  }

  clear(): void {
    this.keys.clear();
    const pointerId = this.joystick?.pointerId;
    this.joystick = undefined;
    if (pointerId !== undefined && this.canvas.hasPointerCapture(pointerId)) {
      this.canvas.releasePointerCapture(pointerId);
    }
  }

  destroy(): void {
    this.clear();
    this.listeners.abort();
  }

  private keyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (!ARROW_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (!event.repeat) this.keys.add(event.key);
  };

  private keyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key);
  };

  private pointerPosition(event: PointerEvent): Point {
    const bounds = this.canvas.getBoundingClientRect();
    return this.toWorld((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
  }

  private pointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.pointerType !== 'touch' || !event.isPrimary || this.joystick) return;
    this.canvas.setPointerCapture(event.pointerId);
    this.joystick = {
      pointerId: event.pointerId,
      origin: this.pointerPosition(event),
      offset: { x: 0, y: 0 },
    };
  };

  private pointerMove = (event: PointerEvent): void => {
    const joystick = this.joystick;
    if (!joystick || joystick.pointerId !== event.pointerId) return;
    const position = this.pointerPosition(event);
    const x = position.x - joystick.origin.x;
    const y = position.y - joystick.origin.y;
    const scale = Math.max(1, Math.hypot(x, y) / JOYSTICK_RADIUS);
    joystick.offset = { x: x / scale, y: y / scale };
  };

  private pointerEnd = (event: PointerEvent): void => {
    if (this.joystick?.pointerId === event.pointerId) this.joystick = undefined;
  };
}
