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
}

export interface OverlayAlertPayload {
  state: OverlayState;
  rule?: string;
  reason?: string;
  advice?: string;
  contextTokens?: number;
  turnIndex?: number;
  turnCount?: number;
  model?: string;
  meter?: MeterDisplayData;
  notice?: string;
}
