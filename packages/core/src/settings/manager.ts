import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RuleThresholds } from '../rules/types.js';
import { DEFAULT_THRESHOLDS } from '../rules/config.js';

export interface OverlayAccessoriesConfig {
  hat: boolean;
  glasses: boolean;
  bow: boolean;
}

export type OverlayVisibilityMode = 'always' | 'coding_apps' | 'alerts_only';

export interface OverlaySettingsConfig {
  skin: string;
  colorTint: string;
  accessories: OverlayAccessoriesConfig;
  size: number;
  opacity: number;
  name: string;
  roam: boolean;
  visibilityMode: OverlayVisibilityMode | string;
  codingApps: string[];
  showAlertsAnywhere: boolean;
  positionsByDisplay: Record<string, { x: number; y: number }>;
  panelOffset?: { x: number; y: number } | null;
  isPinned?: boolean;
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettingsConfig = {
  skin: 'cat',
  colorTint: 'none',
  accessories: {
    hat: false,
    glasses: false,
    bow: false
  },
  size: 1.0,
  opacity: 1.0,
  name: 'Pal',
  roam: false,
  visibilityMode: 'coding_apps',
  codingApps: [
    'Visual Studio Code',
    'Code',
    'Antigravity',
    'Antigravity IDE',
    'Cursor',
    'Terminal',
    'iTerm2',
    'iTerm'
  ],
  showAlertsAnywhere: false,
  positionsByDisplay: {},
  panelOffset: null,
  isPinned: false
};

export interface TokenPalConfig {
  thresholds: RuleThresholds;
  snoozeMinutes: number;
  agentsWatched: string[];
  mascotEnabled: boolean;
  notificationsEnabled: boolean;
  summarizer: {
    enabled: boolean;
    provider: 'ollama' | 'none';
    model: string;
    endpoint: string;
  };
  overlay: OverlaySettingsConfig;
}

export const DEFAULT_CONFIG: TokenPalConfig = {
  thresholds: DEFAULT_THRESHOLDS,
  snoozeMinutes: 30,
  agentsWatched: ['codex'],
  mascotEnabled: true,
  notificationsEnabled: true,
  summarizer: {
    enabled: false, // off by default per PRD / user prompt
    provider: 'none',
    model: 'llama3.2',
    endpoint: 'http://127.0.0.1:11434'
  },
  overlay: DEFAULT_OVERLAY_SETTINGS
};

export class SettingsManager {
  private configPath: string;
  private currentConfig: TokenPalConfig;

  constructor(customPath?: string) {
    this.configPath = customPath || path.join(os.homedir(), '.tokenpal', 'config.json');
    this.currentConfig = this.load();
  }

  public getConfig(): TokenPalConfig {
    return { ...this.currentConfig };
  }

  public load(): TokenPalConfig {
    if (fs.existsSync(this.configPath)) {
      try {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          thresholds: {
            ...DEFAULT_CONFIG.thresholds,
            ...(parsed.thresholds || {})
          },
          summarizer: {
            ...DEFAULT_CONFIG.summarizer,
            ...(parsed.summarizer || {})
          },
          overlay: {
            ...DEFAULT_CONFIG.overlay,
            ...(parsed.overlay || {}),
            accessories: {
              ...DEFAULT_CONFIG.overlay.accessories,
              ...((parsed.overlay && parsed.overlay.accessories) || {})
            },
            codingApps: Array.isArray(parsed.overlay?.codingApps)
              ? parsed.overlay.codingApps
              : DEFAULT_CONFIG.overlay.codingApps,
            positionsByDisplay: {
              ...(parsed.overlay?.positionsByDisplay || {})
            }
          }
        };
      } catch {
        // Fallback to defaults on error
      }
    }
    return { ...DEFAULT_CONFIG };
  }

  public save(updates: Partial<TokenPalConfig>): TokenPalConfig {
    this.currentConfig = {
      ...this.currentConfig,
      ...updates,
      thresholds: {
        ...this.currentConfig.thresholds,
        ...(updates.thresholds || {})
      },
      summarizer: {
        ...this.currentConfig.summarizer,
        ...(updates.summarizer || {})
      },
      overlay: {
        ...this.currentConfig.overlay,
        ...(updates.overlay || {}),
        accessories: {
          ...this.currentConfig.overlay.accessories,
          ...((updates.overlay && updates.overlay.accessories) || {})
        },
        codingApps: Array.isArray(updates.overlay?.codingApps)
          ? updates.overlay.codingApps
          : this.currentConfig.overlay.codingApps,
        positionsByDisplay: {
          ...this.currentConfig.overlay.positionsByDisplay,
          ...(updates.overlay?.positionsByDisplay || {})
        }
      }
    };

    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.configPath, JSON.stringify(this.currentConfig, null, 2), 'utf-8');
    return { ...this.currentConfig };
  }

  public get<K extends keyof TokenPalConfig>(key: K): TokenPalConfig[K] {
    return this.currentConfig[key];
  }

  public set<K extends keyof TokenPalConfig>(key: K, value: TokenPalConfig[K]): void {
    this.save({ [key]: value } as any);
  }

  public update<K extends keyof TokenPalConfig>(key: K, updates: Partial<TokenPalConfig[K]>): TokenPalConfig {
    const current = this.get(key);
    if (typeof current === 'object' && current !== null) {
      return this.save({ [key]: { ...current, ...updates } } as any);
    }
    return this.save({ [key]: updates } as any);
  }
}
