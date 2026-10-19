import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  loadSkinFromDir,
  discoverSkins,
  normalizeAnimationFrames
} from '../src/overlay/skins.js';

describe('Mascot Skin System', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenpal-skins-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('normalizeAnimationFrames', () => {
    it('converts { from, to } range into full array of frame indices', () => {
      expect(normalizeAnimationFrames({ from: 0, to: 3 })).toEqual([0, 1, 2, 3]);
      expect(normalizeAnimationFrames({ from: 4, to: 7 })).toEqual([4, 5, 6, 7]);
      expect(normalizeAnimationFrames({ from: 2, to: 2 })).toEqual([2]);
    });

    it('preserves array of explicit frame numbers', () => {
      expect(normalizeAnimationFrames([0, 1, 2, 1])).toEqual([0, 1, 2, 1]);
    });

    it('safely handles missing or invalid input with fallback to [0]', () => {
      expect(normalizeAnimationFrames(undefined)).toEqual([0]);
      expect(normalizeAnimationFrames(null as any)).toEqual([0]);
      expect(normalizeAnimationFrames('invalid' as any)).toEqual([0]);
      expect(normalizeAnimationFrames({ from: -5, to: -2 } as any)).toEqual([0]);
    });
  });

  describe('loadSkinFromDir', () => {
    it('loads the bundled placeholder cat skin correctly', () => {
      const catDir = path.resolve(__dirname, '../../overlay/skins/cat');
      const skin = loadSkinFromDir(catDir);

      expect(skin).not.toBeNull();
      expect(skin?.id).toBe('cat');
      expect(skin?.name).toBe('Pixel Cat');
      expect(skin?.author).toBe('TokenPal Contributors');
      expect(skin?.license).toBe('CC0-1.0');
      expect(skin?.frameSize).toEqual({ width: 32, height: 32 });
      expect(skin?.fps).toBe(6);
      expect(skin?.supportsTint).toBe(true);
      expect(skin?.animations.idle).toEqual({ from: 0, to: 3 });
      expect(skin?.animations.walk).toEqual({ from: 4, to: 7 });
      expect(skin?.animations.sleep).toEqual({ from: 8, to: 11 });
      expect(skin?.animations.alert).toEqual({ from: 12, to: 15 });
      expect(skin?.animations.happy).toEqual({ from: 16, to: 19 });
    });

    it('returns null safely when skin directory does not exist or has no skin.json', () => {
      expect(loadSkinFromDir(path.join(tempDir, 'does-not-exist'))).toBeNull();

      const emptySkinDir = path.join(tempDir, 'empty-skin');
      fs.mkdirSync(emptySkinDir, { recursive: true });
      expect(loadSkinFromDir(emptySkinDir)).toBeNull();
    });

    it('returns null safely when skin.json contains malformed / corrupt JSON', () => {
      const corruptDir = path.join(tempDir, 'corrupt-skin');
      fs.mkdirSync(corruptDir, { recursive: true });
      fs.writeFileSync(path.join(corruptDir, 'skin.json'), '{ not valid json :::');

      expect(loadSkinFromDir(corruptDir)).toBeNull();
    });

    it('returns null safely when skin.json is missing required fields (name, frameSize)', () => {
      const invalidDir = path.join(tempDir, 'invalid-fields');
      fs.mkdirSync(invalidDir, { recursive: true });

      // Missing name
      fs.writeFileSync(
        path.join(invalidDir, 'skin.json'),
        JSON.stringify({ frameSize: { width: 32, height: 32 } })
      );
      expect(loadSkinFromDir(invalidDir)).toBeNull();

      // Missing frameSize
      fs.writeFileSync(
        path.join(invalidDir, 'skin.json'),
        JSON.stringify({ name: 'Test Mascot' })
      );
      expect(loadSkinFromDir(invalidDir)).toBeNull();
    });

    it('returns null safely when spritesheet.png does not exist', () => {
      const noImageDir = path.join(tempDir, 'no-image-skin');
      fs.mkdirSync(noImageDir, { recursive: true });

      fs.writeFileSync(
        path.join(noImageDir, 'skin.json'),
        JSON.stringify({
          name: 'No Image Skin',
          frameSize: { width: 32, height: 32 },
          animations: { idle: { from: 0, to: 1 } },
          spriteSheet: 'non_existent.png'
        })
      );

      expect(loadSkinFromDir(noImageDir)).toBeNull();
    });

    it('clamps fps between 1 and 18 FPS', () => {
      const skinDir = path.join(tempDir, 'fps-test');
      fs.mkdirSync(skinDir, { recursive: true });
      fs.writeFileSync(path.join(skinDir, 'spritesheet.png'), 'fake-png');

      fs.writeFileSync(
        path.join(skinDir, 'skin.json'),
        JSON.stringify({
          name: 'Fast Mascot',
          frameSize: { width: 32, height: 32 },
          fps: 60, // exceeds 18 fps cap
          animations: { idle: { from: 0, to: 1 } }
        })
      );

      const loaded = loadSkinFromDir(skinDir);
      expect(loaded?.fps).toBe(18); // clamped to 18
    });
  });

  describe('discoverSkins', () => {
    it('discovers custom user skins from ~/.tokenpal/skins', () => {
      const userSkinsDir = path.join(tempDir, 'user-skins');
      const customDogDir = path.join(userSkinsDir, 'dog');
      fs.mkdirSync(customDogDir, { recursive: true });
      fs.writeFileSync(path.join(customDogDir, 'spritesheet.png'), 'fake-png');
      fs.writeFileSync(
        path.join(customDogDir, 'skin.json'),
        JSON.stringify({
          name: 'Pixel Dog',
          author: 'Alice',
          license: 'MIT',
          frameSize: { width: 32, height: 32 },
          fps: 8,
          animations: {
            idle: { from: 0, to: 3 },
            walk: { from: 4, to: 7 }
          }
        })
      );

      const skins = discoverSkins({
        builtinDirs: [path.resolve(__dirname, '../../overlay/skins')],
        userDir: userSkinsDir
      });

      expect(skins.some((s) => s.id === 'cat')).toBe(true);
      const userSkin = skins.find((s) => s.id === 'dog');
      expect(userSkin).toBeDefined();
      expect(userSkin?.name).toBe('Pixel Dog');
      expect(userSkin?.isCustom).toBe(true);
    });

    it('returns fallback skin if all skin directories are empty', () => {
      const emptyBuiltin = path.join(tempDir, 'empty-builtin');
      const emptyUser = path.join(tempDir, 'empty-user');
      fs.mkdirSync(emptyBuiltin, { recursive: true });
      fs.mkdirSync(emptyUser, { recursive: true });

      const skins = discoverSkins({
        builtinDirs: [emptyBuiltin],
        userDir: emptyUser
      });

      expect(skins).toHaveLength(1);
      expect(skins[0].id).toBe('cat');
      expect(skins[0].name).toContain('Placeholder');
    });
  });
});
