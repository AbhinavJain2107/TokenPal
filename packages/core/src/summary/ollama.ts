import { Summarizer, LayerBNarrative } from './interface.js';
import { redactSecrets } from './redaction.js';

export interface OllamaSummarizerOptions {
  endpoint?: string;
  model?: string;
}

export class OllamaSummarizer implements Summarizer {
  readonly id = 'ollama';
  readonly name = 'Ollama (Local)';

  private endpoint: string;
  private model: string;

  constructor(options: OllamaSummarizerOptions = {}) {
    this.endpoint = options.endpoint || 'http://127.0.0.1:11434';
    this.model = options.model || 'llama3.2';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(1000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async summarize(trimmedTranscript: string): Promise<LayerBNarrative> {
    const defaultFallback: LayerBNarrative = {
      decisions: ['Documented in commit history and PR comments'],
      ruledOut: ['None recorded'],
      openProblems: ['None blocking'],
      nextSteps: ['Continue from current handoff state']
    };

    const sanitized = redactSecrets(trimmedTranscript);

    try {
      const prompt = `You are summarizing an AI coding session for a developer handoff.
Analyze this trimmed session transcript and output valid JSON with these 4 array fields:
"decisions": [key architectural or code decisions],
"ruledOut": [approaches considered but discarded],
"openProblems": [unresolved bugs or remaining challenges],
"nextSteps": [immediate next 2-3 tasks]

Keep every bullet point concise (under 12 words).

Transcript:
${sanitized.slice(-4000)}
`;

      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          format: 'json',
          stream: false
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (!res.ok) return defaultFallback;

      const data: any = await res.json();
      const parsed = JSON.parse(data.response);

      return {
        decisions: Array.isArray(parsed.decisions) && parsed.decisions.length > 0 ? parsed.decisions : defaultFallback.decisions,
        ruledOut: Array.isArray(parsed.ruledOut) && parsed.ruledOut.length > 0 ? parsed.ruledOut : defaultFallback.ruledOut,
        openProblems: Array.isArray(parsed.openProblems) && parsed.openProblems.length > 0 ? parsed.openProblems : defaultFallback.openProblems,
        nextSteps: Array.isArray(parsed.nextSteps) && parsed.nextSteps.length > 0 ? parsed.nextSteps : defaultFallback.nextSteps
      };
    } catch {
      return defaultFallback;
    }
  }
}
