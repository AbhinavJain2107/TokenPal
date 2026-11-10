import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export interface SkinAnimationRange {
  from: number;
  to: number;
  loop?: boolean;
}

export type SkinAnimationDef = SkinAnimationRange | number[];

export interface SkinAnimations {
  idle: SkinAnimationDef;
  walk: SkinAnimationDef;
  sleep: SkinAnimationDef;
  alert: SkinAnimationDef;
  happy: SkinAnimationDef;
  curious?: SkinAnimationDef;
}

export interface SkinAccessoryAnchors {
  hat?: { x: number; y: number };
  glasses?: { x: number; y: number };
  bow?: { x: number; y: number };
}

export interface SkinDefinition {
  id: string;
  name: string;
  author: string;
  license: string;
  frameSize: {
    width: number;
    height: number;
  };
  fps: number;
  spriteSheet: string; // full path to image file
  spriteSheetRelative?: string;
  supportsTint?: boolean;
  tintPalettes?: Record<string, string>;
  accessoryAnchors?: SkinAccessoryAnchors;
  animations: SkinAnimations;
  dirPath: string;
  isCustom?: boolean;
}

/**
 * Normalizes an animation definition (either { from, to } or number[]) into an array of frame indices.
 */
export function normalizeAnimationFrames(animDef: SkinAnimationDef | undefined): number[] {
  if (!animDef) return [0];
  if (Array.isArray(animDef)) {
    const valid = animDef.filter((n) => typeof n === 'number' && !isNaN(n) && n >= 0);
    return valid.length > 0 ? valid : [0];
  }
  if (typeof animDef === 'object' && typeof animDef.from === 'number' && typeof animDef.to === 'number') {
    const start = Math.max(0, animDef.from);
    const end = Math.max(start, animDef.to);
    const frames: number[] = [];
    for (let i = start; i <= end; i++) {
      frames.push(i);
    }
    return frames;
  }
  return [0];
}

/**
 * Safely loads and validates a single skin definition from a directory.
 * Returns null if skin.json is missing or corrupt (fail-safe).
 */
export function loadSkinFromDir(dirPath: string, isCustom = false): SkinDefinition | null {
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return null;
    }

    const skinJsonPath = path.join(dirPath, 'skin.json');
    if (!fs.existsSync(skinJsonPath)) {
      return null;
    }

    let parsed: any;
    try {
      const raw = fs.readFileSync(skinJsonPath, 'utf-8');
      parsed = JSON.parse(raw);
    } catch (err: any) {
      console.warn(`[TokenPal] Failed to parse skin.json at ${skinJsonPath}: ${err?.message || err}`);
      return null;
    }

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    // Required fields: name, frameSize
    if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
      return null;
    }

    const frameWidth = Number(parsed.frameSize?.width);
    const frameHeight = Number(parsed.frameSize?.height);
    if (!frameWidth || !frameHeight || frameWidth <= 0 || frameHeight <= 0) {
      return null;
    }

    // Sprite sheet validation
    const spriteFileName = typeof parsed.spriteSheet === 'string' && parsed.spriteSheet.trim()
      ? parsed.spriteSheet.trim()
      : 'spritesheet.png';

    const spriteFullPath = path.resolve(dirPath, spriteFileName);
    if (!fs.existsSync(spriteFullPath)) {
      return null;
    }

    // Animation validation: idle is required; others fall back safely to idle
    const rawAnims = parsed.animations || {};
    if (!rawAnims.idle) {
      return null;
    }
    const idleFrames = normalizeAnimationFrames(rawAnims.idle);
    if (idleFrames.length === 0) {
      return null;
    }

    const animations: SkinAnimations = {
      idle: rawAnims.idle,
      walk: rawAnims.walk || rawAnims.idle,
      sleep: rawAnims.sleep || rawAnims.idle,
      alert: rawAnims.alert || rawAnims.idle,
      happy: rawAnims.happy || rawAnims.idle,
      curious: rawAnims.curious || rawAnims.idle
    };

    // FPS clamping: between 1 and 18 FPS (TokenPal animation cap)
    const rawFps = Number(parsed.fps);
    const fps = isNaN(rawFps) || rawFps <= 0 ? 6 : Math.min(18, Math.max(1, Math.round(rawFps)));

    const skinId = path.basename(dirPath);

    const defaultAnchors: SkinAccessoryAnchors = {
      hat: { x: 11, y: 4 },
      glasses: { x: 10, y: 12 },
      bow: { x: 15, y: 23 }
    };
    const accessoryAnchors: SkinAccessoryAnchors = parsed.accessoryAnchors
      ? { ...defaultAnchors, ...parsed.accessoryAnchors }
      : defaultAnchors;

    const tintPalettes = parsed.tintPalettes && typeof parsed.tintPalettes === 'object'
      ? parsed.tintPalettes
      : undefined;

    return {
      id: skinId,
      name: parsed.name.trim(),
      author: typeof parsed.author === 'string' ? parsed.author.trim() : 'Unknown',
      license: typeof parsed.license === 'string' ? parsed.license.trim() : 'Unspecified',
      frameSize: {
        width: frameWidth,
        height: frameHeight
      },
      fps,
      spriteSheet: spriteFullPath,
      spriteSheetRelative: spriteFileName,
      supportsTint: Boolean(parsed.supportsTint),
      tintPalettes,
      accessoryAnchors,
      animations,
      dirPath,
      isCustom
    };
  } catch (err: any) {
    console.warn(`[TokenPal] Error loading skin at ${dirPath}: ${err?.message || err}`);
    return null;
  }
}

/**
 * Returns a fallback in-memory skin definition (Pixel Cat) in case directories are empty or missing.
 */
export function getFallbackSkin(): SkinDefinition {
  return {
    id: 'cat',
    name: 'Pixel Cat (Placeholder)',
    author: 'TokenPal Contributors',
    license: 'CC0-1.0',
    frameSize: { width: 32, height: 32 },
    fps: 6,
    spriteSheet: '',
    supportsTint: true,
    accessoryAnchors: {
      hat: { x: 11, y: 3 },
      glasses: { x: 10, y: 12 },
      bow: { x: 15, y: 23 }
    },
    animations: {
      idle: { from: 0, to: 3 },
      walk: { from: 4, to: 7 },
      sleep: { from: 8, to: 11 },
      alert: { from: 12, to: 15 },
      happy: { from: 16, to: 19 },
      curious: { from: 20, to: 23 }
    },
    dirPath: ''
  };
}

/**
 * Finds default built-in skin directories across common repository and dist locations.
 */
export function getDefaultBuiltinSkinDirs(): string[] {
  const dirs: string[] = [];

  const currentDir = typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

  const candidates = [
    path.resolve(currentDir, '../../../overlay/skins'),
    path.resolve(currentDir, '../../overlay/skins'),
    path.resolve(currentDir, '../overlay/skins'),
    path.resolve(process.cwd(), 'packages/overlay/skins'),
    path.resolve(process.cwd(), 'packages/overlay/dist/skins'),
    path.resolve(currentDir, '../../../overlay/dist/skins')
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && !dirs.includes(c)) {
      dirs.push(c);
    }
  }

  try {
    const req = createRequire(import.meta.url);
    const overlayPkg = req.resolve('tokenpal-overlay/package.json');
    const distSkins = path.resolve(path.dirname(overlayPkg), 'dist/skins');
    if (fs.existsSync(distSkins) && !dirs.includes(distSkins)) {
      dirs.push(distSkins);
    }
  } catch {
    // ignore
  }

  return dirs;
}

/**
 * Discovers all available skins from built-in and user directories (~/.tokenpal/skins).
 */
export function discoverSkins(options: {
  builtinDirs?: string[];
  userDir?: string;
} = {}): SkinDefinition[] {
  const skinMap = new Map<string, SkinDefinition>();

  // 1. Built-in skin directories
  const builtinDirs = options.builtinDirs || getDefaultBuiltinSkinDirs();
  for (const bDir of builtinDirs) {
    if (!fs.existsSync(bDir)) continue;
    try {
      const entries = fs.readdirSync(bDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skinPath = path.join(bDir, entry.name);
          const loaded = loadSkinFromDir(skinPath, false);
          if (loaded && !skinMap.has(loaded.id)) {
            skinMap.set(loaded.id, loaded);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. User skin directory (~/.tokenpal/skins by default)
  const userDir = options.userDir || path.join(os.homedir(), '.tokenpal', 'skins');
  if (fs.existsSync(userDir)) {
    try {
      const entries = fs.readdirSync(userDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skinPath = path.join(userDir, entry.name);
          const loaded = loadSkinFromDir(skinPath, true);
          if (loaded) {
            skinMap.set(loaded.id, loaded);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const result = Array.from(skinMap.values());
  if (result.length === 0) {
    result.push(getFallbackSkin());
  }
  return result;
}
