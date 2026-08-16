/**
 * Pure formation-layout math for the 3D armies. Each rendered figure stands
 * for a handful of real soldiers; a formation is laid out as a two-rank line
 * of battle (or a broader column for cavalry) centered on the formation's
 * interpolated map position and rotated to its heading.
 */

export interface FigureOffset {
  /** Meters along the formation front (perpendicular to heading). */
  along: number;
  /** Meters along the heading (positive = toward the enemy). */
  advance: number;
}

function jitter(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return (value - Math.floor(value)) - 0.5;
}

export function infantryLine(count: number, spacingM = 4.2, ranks = 2): FigureOffset[] {
  const offsets: FigureOffset[] = [];
  if (count <= 0) {
    return offsets;
  }

  const perRank = Math.ceil(count / ranks);
  const frontage = (perRank - 1) * spacingM;

  for (let index = 0; index < count; index += 1) {
    const rank = Math.floor(index / perRank);
    const file = index % perRank;

    offsets.push({
      along: file * spacingM - frontage / 2 + jitter(index, 1) * spacingM * 0.45,
      advance: -rank * 5.5 + jitter(index, 2) * 1.6,
    });
  }

  return offsets;
}

export function cavalryBlock(count: number, spacingM = 7.5, ranks = 3): FigureOffset[] {
  const offsets: FigureOffset[] = [];
  if (count <= 0) {
    return offsets;
  }

  const perRank = Math.ceil(count / ranks);
  const frontage = (perRank - 1) * spacingM;

  for (let index = 0; index < count; index += 1) {
    const rank = Math.floor(index / perRank);
    const file = index % perRank;

    offsets.push({
      along: file * spacingM - frontage / 2 + jitter(index, 3) * spacingM * 0.5,
      advance: -rank * 9 + jitter(index, 4) * 2.4,
    });
  }

  return offsets;
}

/**
 * Rotate a local offset into world space. Heading is the direction the
 * formation faces (radians, atan2(dy, dx) in map space).
 */
export function offsetToWorld(
  centerX: number,
  centerY: number,
  heading: number,
  offset: FigureOffset,
): { x: number; y: number } {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  // "advance" points along the heading; "along" is perpendicular.
  return {
    x: centerX + cos * offset.advance - sin * offset.along,
    y: centerY + sin * offset.advance + cos * offset.along,
  };
}

/** How many rendered figures represent a formation of the given strength. */
export function figureCount(strength: number, menPerFigure: number, maxFigures: number): number {
  return Math.max(4, Math.min(maxFigures, Math.round(strength / menPerFigure)));
}
