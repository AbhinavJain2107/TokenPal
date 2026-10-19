import { describe, it, expect } from 'vitest';
import { isDragGesture } from '../src/overlay/positioning.js';

describe('Click vs Drag Movement Threshold', () => {
  it('identifies movements under 5px as clicks (not drag)', () => {
    // 0 distance
    expect(isDragGesture(100, 100, 100, 100)).toBe(false);

    // 2px horizontal movement
    expect(isDragGesture(100, 100, 102, 100)).toBe(false);

    // 3px vertical movement
    expect(isDragGesture(100, 100, 100, 103)).toBe(false);

    // (3, 3) -> distance = sqrt(9+9) = 4.24px < 5px
    expect(isDragGesture(100, 100, 103, 103)).toBe(false);

    // 4.9px movement
    expect(isDragGesture(100, 100, 104.9, 100)).toBe(false);
  });

  it('identifies movements of 5px or greater as drag gestures', () => {
    // Exactly 5px
    expect(isDragGesture(100, 100, 105, 100)).toBe(true);
    expect(isDragGesture(100, 100, 100, 105)).toBe(true);

    // (3, 4) -> distance = sqrt(9+16) = 5px
    expect(isDragGesture(100, 100, 103, 104)).toBe(true);

    // Large movements
    expect(isDragGesture(100, 100, 250, 300)).toBe(true);
  });

  it('handles negative direction deltas correctly', () => {
    // -2px movement -> not drag
    expect(isDragGesture(100, 100, 98, 100)).toBe(false);

    // -5px movement -> drag
    expect(isDragGesture(100, 100, 95, 100)).toBe(true);
    expect(isDragGesture(100, 100, 100, 95)).toBe(true);
    expect(isDragGesture(100, 100, 97, 96)).toBe(true); // (-3, -4) -> 5px
  });

  it('supports custom threshold parameter', () => {
    // Custom 10px threshold
    expect(isDragGesture(100, 100, 107, 100, 10)).toBe(false);
    expect(isDragGesture(100, 100, 110, 100, 10)).toBe(true);
  });
});
