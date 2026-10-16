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
});
