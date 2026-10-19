import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { SettingsManager, DEFAULT_OVERLAY_SETTINGS } from '../src/settings/manager.js';

describe('Visibility Mode and Overlay Configuration', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenpal-visibility-test-'));
    configPath = path.join(tempDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('defaults visibilityMode to "coding_apps"', () => {
    expect(DEFAULT_OVERLAY_SETTINGS.visibilityMode).toBe('coding_apps');
  });

  it('persists visibilityMode changes between "always", "coding_apps", and "alerts_only"', () => {
    const manager = new SettingsManager(configPath);
    const initial = manager.get('overlay');
    expect(initial.visibilityMode).toBe('coding_apps');

    // Switch to "always"
    manager.update('overlay', { visibilityMode: 'always' });
    expect(manager.get('overlay').visibilityMode).toBe('always');

    // Reload from disk
    const reloaded = new SettingsManager(configPath);
    expect(reloaded.get('overlay').visibilityMode).toBe('always');

    // Switch to "alerts_only"
    reloaded.update('overlay', { visibilityMode: 'alerts_only' });
    expect(reloaded.get('overlay').visibilityMode).toBe('alerts_only');

    // Reload from disk
    const reloadedAgain = new SettingsManager(configPath);
    expect(reloadedAgain.get('overlay').visibilityMode).toBe('alerts_only');
  });

  it('stores and persists panelOffset relative coordinates', () => {
    const manager = new SettingsManager(configPath);
    manager.update('overlay', { panelOffset: { x: 140, y: -50 } });

    const saved = manager.get('overlay');
    expect(saved.panelOffset).toEqual({ x: 140, y: -50 });

    const fromDisk = new SettingsManager(configPath);
    expect(fromDisk.get('overlay').panelOffset).toEqual({ x: 140, y: -50 });
  });

  it('stores and persists panel isPinned state', () => {
    const manager = new SettingsManager(configPath);
    expect(manager.get('overlay').isPinned).toBe(false);

    manager.update('overlay', { isPinned: true });
    expect(manager.get('overlay').isPinned).toBe(true);

    const fromDisk = new SettingsManager(configPath);
    expect(fromDisk.get('overlay').isPinned).toBe(true);
  });
});
