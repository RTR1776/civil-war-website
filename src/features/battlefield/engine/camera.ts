import type { WorldPoint } from "@/features/battlefield/engine/projection";

export interface CameraPose {
  x: number;
  y: number;
  /** CSS pixels per world meter. */
  scale: number;
  /** Map rotation in radians (clockwise). */
  bearing: number;
}

export interface Viewport {
  width: number;
  height: number;
}

function shortestAngleDelta(from: number, to: number): number {
  const tau = Math.PI * 2;
  let delta = (to - from) % tau;
  if (delta > Math.PI) delta -= tau;
  if (delta < -Math.PI) delta += tau;
  return delta;
}

export class CameraController {
  current: CameraPose;
  target: CameraPose;
  /** 1/seconds — larger settles faster. */
  stiffness = 2.6;
  minScale = 0.02;
  maxScale = 3;

  constructor(initial: CameraPose) {
    this.current = { ...initial };
    this.target = { ...initial };
  }

  jumpTo(pose: CameraPose) {
    this.current = { ...pose };
    this.target = { ...pose };
  }

  easeTo(pose: Partial<CameraPose>) {
    this.target = { ...this.target, ...pose };
    this.target.scale = Math.min(this.maxScale, Math.max(this.minScale, this.target.scale));
  }

  update(dtMs: number) {
    const blend = 1 - Math.exp(-(dtMs / 1000) * this.stiffness);
    this.current.x += (this.target.x - this.current.x) * blend;
    this.current.y += (this.target.y - this.current.y) * blend;
    // Interpolate scale in log space so zooming feels even.
    const logScale = Math.log(this.current.scale)
      + (Math.log(this.target.scale) - Math.log(this.current.scale)) * blend;
    this.current.scale = Math.exp(logScale);
    this.current.bearing += shortestAngleDelta(this.current.bearing, this.target.bearing) * blend;
  }

  isSettled(): boolean {
    return (
      Math.abs(this.target.x - this.current.x) * this.current.scale < 0.4
      && Math.abs(this.target.y - this.current.y) * this.current.scale < 0.4
      && Math.abs(Math.log(this.target.scale / this.current.scale)) < 0.004
      && Math.abs(shortestAngleDelta(this.current.bearing, this.target.bearing)) < 0.002
    );
  }

  worldToScreen(point: WorldPoint, viewport: Viewport): { x: number; y: number } {
    const dx = point.x - this.current.x;
    const dy = point.y - this.current.y;
    const cos = Math.cos(this.current.bearing);
    const sin = Math.sin(this.current.bearing);

    return {
      x: (dx * cos - dy * sin) * this.current.scale + viewport.width / 2,
      y: (dx * sin + dy * cos) * this.current.scale + viewport.height / 2,
    };
  }

  screenToWorld(x: number, y: number, viewport: Viewport): WorldPoint {
    const sx = (x - viewport.width / 2) / this.current.scale;
    const sy = (y - viewport.height / 2) / this.current.scale;
    const cos = Math.cos(-this.current.bearing);
    const sin = Math.sin(-this.current.bearing);

    return {
      x: sx * cos - sy * sin + this.current.x,
      y: sx * sin + sy * cos + this.current.y,
    };
  }

  /** Pan by a screen-space delta, moving current and target together. */
  panBy(dxPx: number, dyPx: number) {
    const cos = Math.cos(-this.current.bearing);
    const sin = Math.sin(-this.current.bearing);
    const wx = (-dxPx * cos + dyPx * sin) / this.current.scale;
    const wy = (-dxPx * sin - dyPx * cos) / this.current.scale;

    this.current.x += wx;
    this.current.y += wy;
    this.target.x = this.current.x;
    this.target.y = this.current.y;
    this.target.scale = this.current.scale;
    this.target.bearing = this.current.bearing;
  }

  /** Zoom by a factor keeping the world point under (px, py) fixed. */
  zoomAround(px: number, py: number, factor: number, viewport: Viewport) {
    const anchor = this.screenToWorld(px, py, viewport);
    const nextScale = Math.min(this.maxScale, Math.max(this.minScale, this.current.scale * factor));
    const applied = nextScale / this.current.scale;

    this.current.scale = nextScale;
    this.current.x = anchor.x + (this.current.x - anchor.x) / applied;
    this.current.y = anchor.y + (this.current.y - anchor.y) / applied;
    this.target = { ...this.current };
  }
}
