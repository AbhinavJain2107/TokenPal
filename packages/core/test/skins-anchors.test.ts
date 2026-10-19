import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { discoverSkins, loadSkinFromDir } from '../src/overlay/skins.js';

describe('Animal Skins, Anchors, and Tint Palettes', () => {
  const skinsDir = path.resolve(__dirname, '../../overlay/skins');
  const expectedAnimals = ['cat', 'dog', 'hamster', 'rabbit', 'fox', 'panda'];

  it('discovers all 6 required animal skins', () => {
    const skins = discoverSkins({
      builtinDirs: [skinsDir],
      userDir: '/tmp/no-user-skins'
    });

    const skinIds = skins.map((s) => s.id);
    for (const animal of expectedAnimals) {
      expect(skinIds).toContain(animal);
    }
  });

  for (const animal of expectedAnimals) {
    describe(`Skin: ${animal}`, () => {
      const animalDir = path.join(skinsDir, animal);
      const skin = loadSkinFromDir(animalDir);

      it('loads skin metadata correctly', () => {
        expect(skin).not.toBeNull();
        expect(skin?.id).toBe(animal);
        expect(skin?.author).toBe('TokenPal Contributors');
        expect(skin?.license).toBe('CC0-1.0');
        expect(skin?.frameSize).toEqual({ width: 32, height: 32 });
        expect(skin?.fps).toBeLessThanOrEqual(18);
        expect(skin?.supportsTint).toBe(true);
      });

      it('defines all 6 animations including curious', () => {
        expect(skin?.animations.idle).toBeDefined();
        expect(skin?.animations.walk).toBeDefined();
        expect(skin?.animations.sleep).toBeDefined();
        expect(skin?.animations.alert).toBeDefined();
        expect(skin?.animations.happy).toBeDefined();
        expect(skin?.animations.curious).toBeDefined();
      });

      it('defines accessory anchors for hat, glasses, and bow with within-frame coordinates', () => {
        const anchors = skin?.accessoryAnchors;
        expect(anchors).toBeDefined();
        expect(anchors?.hat).toBeDefined();
        expect(anchors?.glasses).toBeDefined();
        expect(anchors?.bow).toBeDefined();

        expect(anchors!.hat.x).toBeGreaterThanOrEqual(0);
        expect(anchors!.hat.x).toBeLessThan(32);
        expect(anchors!.hat.y).toBeGreaterThanOrEqual(0);
        expect(anchors!.hat.y).toBeLessThan(32);

        expect(anchors!.glasses.x).toBeGreaterThanOrEqual(0);
        expect(anchors!.glasses.x).toBeLessThan(32);
        expect(anchors!.glasses.y).toBeGreaterThanOrEqual(0);
        expect(anchors!.glasses.y).toBeLessThan(32);

        expect(anchors!.bow.x).toBeGreaterThanOrEqual(0);
        expect(anchors!.bow.x).toBeLessThan(32);
        expect(anchors!.bow.y).toBeGreaterThanOrEqual(0);
        expect(anchors!.bow.y).toBeLessThan(32);
      });

      it('defines curated tint palettes', () => {
        const palettes = skin?.tintPalettes;
        expect(palettes).toBeDefined();
        expect(Object.keys(palettes!).length).toBeGreaterThanOrEqual(4);
      });

      it('has a contact-sheet preview image generated in skins/previews/', () => {
        const previewPath = path.join(skinsDir, 'previews', `${animal}.png`);
        expect(fs.existsSync(previewPath)).toBe(true);
        const stat = fs.statSync(previewPath);
        expect(stat.size).toBeGreaterThan(100);
      });
    });
  }
});
