export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PanelPlacementResult {
  x: number;
  y: number;
  flippedX: boolean;
  flippedY: boolean;
}

export const DRAG_THRESHOLD_PX = 5;

/**
 * Returns true if the cumulative mouse movement exceeds the threshold for a drag gesture.
 */
export function isDragGesture(
  x1OrDx: number,
  y1OrDy: number,
  x2OrThreshold?: number,
  maybeY2?: number,
  maybeThreshold?: number
): boolean {
  if (typeof maybeY2 === 'number') {
    const dx = x2OrThreshold! - x1OrDx;
    const dy = maybeY2 - y1OrDy;
    const threshold = maybeThreshold ?? DRAG_THRESHOLD_PX;
    return Math.hypot(dx, dy) >= threshold;
  }
  const threshold = x2OrThreshold ?? DRAG_THRESHOLD_PX;
  return Math.hypot(x1OrDx, y1OrDy) >= threshold;
}

/**
 * Calculates optimal on-screen panel placement relative to the mascot.
 *
 * Defaults to anchoring next to the mascot (preferring above and centered),
 * and flips below / left / right when colliding with display workArea boundaries.
 * If a custom savedOffset exists from user dragging, applies and clamps it.
 */
export interface PanelPositionOptions {
  mascotBounds: Bounds;
  panelSize?: Size;
  panelWidth?: number;
  panelHeight?: number;
  workArea: Bounds;
  customOffset?: Point | null;
  savedOffset?: Point | null;
  gap?: number;
}

export type WorkArea = Bounds;
export type WindowBounds = Bounds;

/**
 * Calculates optimal on-screen panel placement relative to the mascot.
 *
 * Defaults to anchoring next to the mascot (preferring right side),
 * and flips left / above / below when colliding with display workArea boundaries.
 * If a custom offset exists from user dragging, applies and clamps it to screen bounds.
 */
export function calculatePanelPosition(
  mascotBoundsOrOptions: Bounds | PanelPositionOptions,
  maybePanelSize?: Size,
  maybeWorkArea?: Bounds,
  maybeSavedOffset?: Point | null
): PanelPlacementResult {
  let mascotBounds: Bounds;
  let panelWidth: number;
  let panelHeight: number;
  let workArea: Bounds;
  let savedOffset: Point | null | undefined;
  let gap = 12;

  if ('mascotBounds' in mascotBoundsOrOptions) {
    const opts = mascotBoundsOrOptions as PanelPositionOptions;
    mascotBounds = opts.mascotBounds;
    panelWidth = opts.panelWidth ?? opts.panelSize?.width ?? 340;
    panelHeight = opts.panelHeight ?? opts.panelSize?.height ?? 360;
    workArea = opts.workArea;
    savedOffset = opts.customOffset ?? opts.savedOffset;
    if (typeof opts.gap === 'number') gap = opts.gap;
  } else {
    mascotBounds = mascotBoundsOrOptions;
    panelWidth = maybePanelSize?.width ?? 340;
    panelHeight = maybePanelSize?.height ?? 360;
    workArea = maybeWorkArea ?? { x: 0, y: 0, width: 1920, height: 1080 };
    savedOffset = maybeSavedOffset;
  }

  // 1. Custom user-dragged offset (honored and clamped to current display workArea)
  if (savedOffset && typeof savedOffset.x === 'number' && typeof savedOffset.y === 'number') {
    const rawX = mascotBounds.x + savedOffset.x;
    const rawY = mascotBounds.y + savedOffset.y;
    const clampedX = Math.round(Math.max(workArea.x, Math.min(rawX, workArea.x + workArea.width - panelWidth)));
    const clampedY = Math.round(Math.max(workArea.y, Math.min(rawY, workArea.y + workArea.height - panelHeight)));
    return {
      x: clampedX,
      y: clampedY,
      flippedX: false,
      flippedY: false
    };
  }

  // 2. Default Anchor Placement: Prefer anchoring next to mascot (to the right)
  let idealX = mascotBounds.x + mascotBounds.width + gap;
  let flippedX = false;

  // If overflowing right display edge, flip to left of mascot
  if (idealX + panelWidth > workArea.x + workArea.width) {
    idealX = mascotBounds.x - panelWidth - gap;
    flippedX = true;
  }

  // Clamp X strictly to workArea
  idealX = Math.max(workArea.x, Math.min(idealX, workArea.x + workArea.width - panelWidth));

  // Vertical placement: Align with mascot top
  let idealY = mascotBounds.y;
  let flippedY = false;

  // If overflowing bottom display edge, flip upwards
  if (idealY + panelHeight > workArea.y + workArea.height) {
    idealY = mascotBounds.y + mascotBounds.height - panelHeight;
    flippedY = true;
  }

  // Clamp Y strictly to workArea
  idealY = Math.max(workArea.y, Math.min(idealY, workArea.y + workArea.height - panelHeight));

  return {
    x: Math.round(idealX),
    y: Math.round(idealY),
    flippedX,
    flippedY
  };
}
