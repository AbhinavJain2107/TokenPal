import { describe, it, expect } from 'vitest';
import { resolveMascotAnimation } from '../src/overlay/animations.js';
import { SkinDefinition } from '../src/overlay/skins.js';

describe('State-to-Animation Mapping and Graceful Fallback', () => {
  const fullSkin: SkinDefinition = {
    id: 'test-cat',
    name: 'Test Cat',
    author: 'TokenPal Contributors',
    license: 'CC0-1.0',
    frameSize: { width: 32, height: 32 },
    fps: 6,
    spriteSheet: 'spritesheet.png',
    animations: {
      idle: { from: 0, to: 3 },
      walk: { from: 4, to: 7 },
      sleep: { from: 8, to: 11 },
      alert: { from: 12, to: 15 },
      happy: { from: 16, to: 19 },
      curious: { from: 20, to: 23 }
    },
    dirPath: '/tmp/skins/test-cat'
  };

  const skinWithoutCurious: SkinDefinition = {
    ...fullSkin,
    animations: {
      idle: { from: 0, to: 3 },
      walk: { from: 4, to: 7 },
      sleep: { from: 8, to: 11 },
      alert: { from: 12, to: 15 },
      happy: { from: 16, to: 19 }
    }
  };

  const minimalSkin: SkinDefinition = {
    ...fullSkin,
    animations: {
      idle: { from: 0, to: 3 }
    } as any
  };

  it('maps healthy quota state to idle', () => {
    const anim = resolveMascotAnimation({
      state: 'green',
      skin: fullSkin
    });
    expect(anim).toBe('idle');
  });

  it('maps warning and red state to alert', () => {
    expect(resolveMascotAnimation({ state: 'yellow', skin: fullSkin })).toBe('alert');
    expect(resolveMascotAnimation({ state: 'red', skin: fullSkin })).toBe('alert');
  });

  it('maps projected_exhaustion and single_request_high rules to alert', () => {
    expect(resolveMascotAnimation({
      state: 'yellow',
      rule: 'projected_exhaustion',
      skin: fullSkin
    })).toBe('alert');

    expect(resolveMascotAnimation({
      state: 'yellow',
      rule: 'single_request_high',
      skin: fullSkin
    })).toBe('alert');
  });

  it('maps info notice (e.g. model switch) to happy', () => {
    const anim = resolveMascotAnimation({
      state: 'green',
      notice: 'Switched to Astra',
      skin: fullSkin
    });
    expect(anim).toBe('happy');
  });

  it('maps stale reading to sleep', () => {
    const anim = resolveMascotAnimation({
      state: 'yellow',
      rule: 'stale_reading',
      meter: {
        usedPercent: 50,
        timeToResetFormatted: '3d',
        planType: 'prolite',
        isStale: true
      },
      skin: fullSkin
    });
    expect(anim).toBe('sleep');
  });

  it('maps expensive request (>1.5%) to curious if skin supports it', () => {
    const anim = resolveMascotAnimation({
      state: 'green',
      meter: {
        usedPercent: 40,
        timeToResetFormatted: '4d',
        planType: 'prolite',
        requestCostDisplay: '+3.5% (40,000 tokens)'
      },
      skin: fullSkin
    });
    expect(anim).toBe('curious');
  });

  it('falls back to idle for expensive request when skin lacks curious animation', () => {
    const anim = resolveMascotAnimation({
      state: 'green',
      meter: {
        usedPercent: 40,
        timeToResetFormatted: '4d',
        planType: 'prolite',
        requestCostDisplay: '+3.5% (40,000 tokens)'
      },
      skin: skinWithoutCurious
    });
    expect(anim).toBe('idle');
  });

  it('honors explicit animationOverride when skin supports it', () => {
    expect(resolveMascotAnimation({
      state: 'green',
      animationOverride: 'walk',
      skin: fullSkin
    })).toBe('walk');

    expect(resolveMascotAnimation({
      state: 'green',
      animationOverride: 'curious',
      skin: fullSkin
    })).toBe('curious');
  });

  it('gracefully falls back to idle if requested animation is missing from skin', () => {
    // skinWithoutCurious does not have 'curious'
    expect(resolveMascotAnimation({
      state: 'green',
      animationOverride: 'curious',
      skin: skinWithoutCurious
    })).toBe('idle');

    // minimalSkin only has 'idle'
    expect(resolveMascotAnimation({
      state: 'yellow',
      skin: minimalSkin
    })).toBe('idle');

    expect(resolveMascotAnimation({
      state: 'green',
      notice: 'Notice',
      skin: minimalSkin
    })).toBe('idle');
  });
});
