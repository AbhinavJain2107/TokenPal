export interface LayerBNarrative {
  decisions: string[];
  ruledOut: string[];
  openProblems: string[];
  nextSteps: string[];
}

export interface Summarizer {
  readonly id: string;
  readonly name: string;

  /**
   * Checks whether the summarizer service/model is accessible.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Generates Layer B narrative from a trimmed, redacted transcript.
   */
  summarize(trimmedTranscript: string): Promise<LayerBNarrative>;
}
