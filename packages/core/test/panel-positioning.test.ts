import { describe, it, expect } from 'vitest';
import { calculatePanelPosition, WorkArea, WindowBounds } from '../src/overlay/positioning.js';

describe('Panel Positioning and Flipping Logic', () => {
  const standardDisplay: WorkArea = {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080
  };

  const mascotBounds: WindowBounds = {
    x: 800,
    y: 500,
    width: 120,
    height: 100
  };

  const panelWidth = 340;
  const panelHeight = 360;

  it('anchors to the right of the mascot by default when there is sufficient screen space', () => {
    const pos = calculatePanelPosition({
      mascotBounds,
      panelWidth,
      panelHeight,
      workArea: standardDisplay
    });

    // Right anchor: x = mascot.x + mascot.width + 12 = 800 + 120 + 12 = 932
    expect(pos.x).toBe(932);
    // Centered or top aligned, clamped within bounds
    expect(pos.y).toBeGreaterThanOrEqual(standardDisplay.y);
    expect(pos.y + panelHeight).toBeLessThanOrEqual(standardDisplay.y + standardDisplay.height);
  });

  it('auto-flips to the left when mascot is near the right edge of the screen', () => {
    const rightEdgeMascot: WindowBounds = {
      x: 1800, // Near right edge (1920)
      y: 500,
      width: 120,
      height: 100
    };

    const pos = calculatePanelPosition({
      mascotBounds: rightEdgeMascot,
      panelWidth,
      panelHeight,
      workArea: standardDisplay
    });

    // When placed on right: 1800 + 120 + 12 = 1932 > 1920 - 340, so flips to left
    // Left anchor: x = mascot.x - panelWidth - 12 = 1800 - 340 - 12 = 1448
    expect(pos.x).toBe(1448);
    expect(pos.x + panelWidth).toBeLessThanOrEqual(standardDisplay.width);
    expect(pos.x).toBeGreaterThanOrEqual(0);
  });

  it('auto-flips vertically to above when mascot is near bottom edge', () => {
    const bottomEdgeMascot: WindowBounds = {
      x: 500,
      y: 1000, // Near bottom edge (1080)
      width: 120,
      height: 100
    };

    const pos = calculatePanelPosition({
      mascotBounds: bottomEdgeMascot,
      panelWidth,
      panelHeight,
      workArea: standardDisplay
    });

    // Panel must fit within the workArea height without overflowing 1080
    expect(pos.y + panelHeight).toBeLessThanOrEqual(standardDisplay.height);
    expect(pos.y).toBeGreaterThanOrEqual(standardDisplay.y);
  });

  it('auto-flips vertically to below when mascot is near top edge', () => {
    const topEdgeMascot: WindowBounds = {
      x: 500,
      y: 10, // Near top edge (0)
      width: 120,
      height: 100
    };

    const pos = calculatePanelPosition({
      mascotBounds: topEdgeMascot,
      panelWidth,
      panelHeight,
      workArea: standardDisplay
    });

    expect(pos.y).toBeGreaterThanOrEqual(standardDisplay.y);
    expect(pos.y + panelHeight).toBeLessThanOrEqual(standardDisplay.height);
  });

  it('clamps strictly to display boundaries on multi-monitor / non-zero workAreas', () => {
    const secondaryDisplay: WorkArea = {
      x: 1920,
      y: 100,
      width: 1440,
      height: 900
    };

    const mascotOnSecondary: WindowBounds = {
      x: 3200, // Very close to 1920 + 1440 = 3360
      y: 850,
      width: 120,
      height: 100
    };

    const pos = calculatePanelPosition({
      mascotBounds: mascotOnSecondary,
      panelWidth,
      panelHeight,
      workArea: secondaryDisplay
    });

    expect(pos.x).toBeGreaterThanOrEqual(secondaryDisplay.x);
    expect(pos.x + panelWidth).toBeLessThanOrEqual(secondaryDisplay.x + secondaryDisplay.width);
    expect(pos.y).toBeGreaterThanOrEqual(secondaryDisplay.y);
    expect(pos.y + panelHeight).toBeLessThanOrEqual(secondaryDisplay.y + secondaryDisplay.height);
  });

  it('honors remembered relative offset when provided', () => {
    const customOffset = { x: -200, y: 50 };

    const pos = calculatePanelPosition({
      mascotBounds,
      panelWidth,
      panelHeight,
      workArea: standardDisplay,
      customOffset
    });

    // x should be mascot.x + customOffset.x = 800 - 200 = 600
    expect(pos.x).toBe(600);
    // y should be mascot.y + customOffset.y = 500 + 50 = 550
    expect(pos.y).toBe(550);
  });

  it('clamps custom offset if user drags panel partially offscreen', () => {
    const extremeOffset = { x: -2000, y: -2000 };

    const pos = calculatePanelPosition({
      mascotBounds,
      panelWidth,
      panelHeight,
      workArea: standardDisplay,
      customOffset: extremeOffset
    });

    expect(pos.x).toBe(standardDisplay.x);
    expect(pos.y).toBe(standardDisplay.y);
  });
});
