export interface ProjectionResult {
  hoursToExhaustion: number;
  projectedExhaustionTimestamp: number; // epoch seconds
  projectedExhaustionText: string;
  isBeforeReset: boolean;
}

export interface MeterReaderOptions {
  modelMultiplierText?: string;
}
