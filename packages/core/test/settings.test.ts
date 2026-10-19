import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { SettingsManager, DEFAULT_CONFIG } from '../src/settings/manager.js';

describe('SettingsManager (M5)', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenpal-settings-test-'));
    configPath = path.join(tempDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads default settings when config file does not exist', () => {
    const manager = new SettingsManager(configPath);
    const config = manager.getConfig();

    expect(config.snoozeMinutes).toBe(30);
    expect(config.mascotEnabled).toBe(true);
    expect(config.notificationsEnabled).toBe(true);
    expect(config.summarizer.enabled).toBe(false); // off by default
    expect(config.thresholds.contextGrowthMultiplier).toBe(4.5);
    expect(config.thresholds.contextMaxTokens).toBe(120000);
  });

  it('persists and updates configuration settings to disk', () => {
    const manager = new SettingsManager(configPath);

    manager.save({
      snoozeMinutes: 45,
      mascotEnabled: false,
      thresholds: {
        ...DEFAULT_CONFIG.thresholds,
        contextGrowthMultiplier: 4.0
      }
    });

    expect(fs.existsSync(configPath)).toBe(true);

    // Read back in fresh instance
    const freshManager = new SettingsManager(configPath);
    expect(freshManager.get('snoozeMinutes')).toBe(45);
    expect(freshManager.get('mascotEnabled')).toBe(false);
    expect(freshManager.get('thresholds').contextGrowthMultiplier).toBe(4.0);
  });

  it('loads default overlay settings correctly', () => {
    const manager = new SettingsManager(configPath);
    const overlay = manager.get('overlay');

    expect(overlay.skin).toBe('cat');
    expect(overlay.colorTint).toBe('none');
    expect(overlay.accessories).toEqual({ hat: false, glasses: false, bow: false });
    expect(overlay.size).toBe(1.0);
    expect(overlay.opacity).toBe(1.0);
    expect(overlay.name).toBe('Pal');
    expect(overlay.roam).toBe(false);
    expect(overlay.showAlertsAnywhere).toBe(false);
    expect(overlay.codingApps).toContain('Visual Studio Code');
    expect(overlay.codingApps).toContain('Antigravity');
  });

  it('persists and updates overlay customizations (skin, tint, accessories, size, roam)', () => {
    const manager = new SettingsManager(configPath);

    manager.save({
      overlay: {
        ...manager.get('overlay'),
        skin: 'cat',
        colorTint: '#f59e0b',
        accessories: { hat: true, glasses: true, bow: false },
        size: 1.5,
        opacity: 0.85,
        name: 'Whisker',
        roam: true,
        showAlertsAnywhere: true,
        codingApps: ['Visual Studio Code', 'Cursor']
      }
    });

    const reloaded = new SettingsManager(configPath);
    const updated = reloaded.get('overlay');

    expect(updated.skin).toBe('cat');
    expect(updated.colorTint).toBe('#f59e0b');
    expect(updated.accessories).toEqual({ hat: true, glasses: true, bow: false });
    expect(updated.size).toBe(1.5);
    expect(updated.opacity).toBe(0.85);
    expect(updated.name).toBe('Whisker');
    expect(updated.roam).toBe(true);
    expect(updated.showAlertsAnywhere).toBe(true);
    expect(updated.codingApps).toEqual(['Visual Studio Code', 'Cursor']);
  });
});
