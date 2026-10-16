import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RuleThresholds } from '../rules/types.js';
import { DEFAULT_THRESHOLDS } from '../rules/config.js';

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
  }
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
}
