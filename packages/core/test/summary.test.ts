import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../src/summary/redaction.js';
import { OllamaSummarizer } from '../src/summary/ollama.js';
import { Summarizer } from '../src/summary/interface.js';
import { generateLayerAHandoff } from '../src/handoff/generator.js';


describe('Summary & Redaction (M5)', () => {
  it('redacts API keys, passwords, bearer tokens, and JWTs from text', () => {
    const sensitive = `
      OPENAI_KEY=sk-abcdef1234567890abcdef1234567890
      ANTHROPIC=sk-ant-api03-abcdef1234567890abcdef1234567890
      GITHUB=ghp_123456789012345678901234567890123456
      Authorization: Bearer mySecretToken1234567890
      API_KEY='supersecretpassword123'
      Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
    `;


    const cleaned = redactSecrets(sensitive);

    expect(cleaned).not.toContain('sk-abcdef1234567890abcdef1234567890');
    expect(cleaned).not.toContain('sk-ant-api03-');
    expect(cleaned).not.toContain('ghp_1234567890');
    expect(cleaned).not.toContain('mySecretToken1234567890');
    expect(cleaned).not.toContain('supersecretpassword123');
    expect(cleaned).toContain('[REDACTED_API_KEY]');
    expect(cleaned).toContain('[REDACTED_ANTHROPIC_KEY]');
    expect(cleaned).toContain('[REDACTED_GITHUB_TOKEN]');
    expect(cleaned).toContain('[REDACTED_TOKEN]');
    expect(cleaned).toContain('[REDACTED_SECRET]');
    expect(cleaned).toContain('[REDACTED_JWT]');
  });

  it('OllamaSummarizer handles offline endpoint gracefully with default fallback', async () => {
    // Point to non-running port
    const summarizer = new OllamaSummarizer({ endpoint: 'http://127.0.0.1:59999' });

    const available = await summarizer.isAvailable();
    expect(available).toBe(false);

    const result = await summarizer.summarize('Some transcript content here');
    expect(result).toBeDefined();
    expect(result.decisions.length).toBeGreaterThan(0);
    expect(result.nextSteps.length).toBeGreaterThan(0);
  });

  it('pluggable Summarizer interface integrates into handoff generation', async () => {
    const mockSummarizer: Summarizer = {
      id: 'mock',
      name: 'Mock Summarizer',
      isAvailable: async () => true,
      summarize: async () => ({
        decisions: ['Adopted SQLite for local persistence', 'Selected 18fps overlay cap'],
        ruledOut: ['Tauri was ruled out in favor of zero-install Electron'],
        openProblems: ['None blocking for M5'],
        nextSteps: ['Run real Mac multi-monitor validation']
      })
    };

    const handoff = await generateLayerAHandoff({
      summarizer: mockSummarizer
    });

    expect(handoff.markdown).toContain('Adopted SQLite for local persistence');
    expect(handoff.markdown).toContain('Selected 18fps overlay cap');
    expect(handoff.markdown).toContain('Tauri was ruled out');
    expect(handoff.markdown).toContain('Note: verify state with git diff before continuing.');
    expect(handoff.lineCount).toBeLessThan(60);
  });
});
