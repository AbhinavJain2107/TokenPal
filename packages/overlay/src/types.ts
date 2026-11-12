export type OverlayState = 'green' | 'yellow' | 'red';

export interface MeterDisplayData {
  usedPercent: number;
  timeToResetFormatted: string;
  planType: string;
  percentBar?: string;
  earlyResetsCount?: number;
  earlyResetsNote?: string;
  projectedExhaustionText?: string;
  modelBadgeText?: string;
  requestCostDisplay?: string;
  asOfLocal?: string;
  resetsAtLocal?: string;
  isStale?: boolean;
  staleReason?: string;
}

export interface OverlayAlertPayload {
  state: OverlayState;
  rule?: string;
  reason?: string;
  advice?: string;
  contextTokens?: number;
  cachedTokens?: number;
  turnIndex?: number;
  turnCount?: number;
  model?: string;
  meter?: MeterDisplayData;
  notice?: string;
  animationOverride?: 'idle' | 'walk' | 'sleep' | 'alert' | 'happy' | 'curious';
  openCustomize?: boolean;
}

export interface OverlayAccessoriesConfig {
  hat: boolean;
  glasses: boolean;
  bow: boolean;
}

export interface OverlaySettingsConfig {
  skin: string;
  colorTint: string;
  accessories: OverlayAccessoriesConfig;
  size: number;
  opacity: number;
  name: string;
  roam: boolean;
  visibilityMode?: 'coding_apps' | 'always' | 'alerts_only';
  codingApps: string[];
  showAlertsAnywhere: boolean;
  positionsByDisplay: Record<string, { x: number; y: number }>;
  panelOffset?: { x: number; y: number };
  isPinned?: boolean;
}

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
  spriteSheet: string;
  spriteSheetRelative?: string;
  supportsTint?: boolean;
  animations: SkinAnimations;
  dirPath: string;
  isCustom?: boolean;
}

export interface OverlayConfig {
  roamingEnabled: boolean;
  lowPowerMode: boolean;
  fpsLimit: number;
  autoDismissSec: number;
}
