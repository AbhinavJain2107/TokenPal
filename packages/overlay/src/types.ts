export type OverlayState = 'green' | 'yellow' | 'red';

export interface OverlayAlertPayload {
  state: OverlayState;
  rule: string;
  reason: string;
  advice: string;
  contextTokens?: number;
  turnIndex?: number;
  model?: string;
}

export interface OverlayConfig {
  roamingEnabled: boolean;
  lowPowerMode: boolean;
  fpsLimit: number;
  autoDismissSec: number;
}
