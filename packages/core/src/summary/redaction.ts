/**
 * Redacts common secrets (API keys, tokens, passwords, bearer tokens, .env pairs)
 * from text before sending to any summarizer service.
 */
export function redactSecrets(text: string): string {
  let cleaned = text;

  // 1. Specific API keys (run before generic prefixes)
  // Anthropic keys (sk-ant-...) before general sk-...
  cleaned = cleaned.replace(/sk-ant-[a-zA-Z0-9_-]{15,}/g, '[REDACTED_ANTHROPIC_KEY]');

  // OpenAI keys (sk-...)
  cleaned = cleaned.replace(/sk-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_API_KEY]');

  // GitHub personal access tokens (ghp_..., gho_..., ghu_..., ghs_..., ghr_...)
  cleaned = cleaned.replace(/gh[pousr]_[a-zA-Z0-9]{20,}/g, '[REDACTED_GITHUB_TOKEN]');

  // Bearer tokens
  cleaned = cleaned.replace(/Bearer\s+[a-zA-Z0-9_\-\.]{15,}/gi, 'Bearer [REDACTED_TOKEN]');

  // JWT tokens (3 base64url chunks separated by dots)
  cleaned = cleaned.replace(/eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, '[REDACTED_JWT]');

  // Generic key/secret assignments (e.g. API_KEY=xyz, SECRET=xyz, PASSWORD=xyz), ignoring already redacted tokens
  cleaned = cleaned.replace(
    /((?:API[_-]?KEY|SECRET|PASSWORD|TOKEN|AUTH|PRIVATE[_-]?KEY)\s*[=:]\s*['"]?)(?!\[REDACTED_)[^\s'"\n]{6,}(['"]?)/gi,
    '$1[REDACTED_SECRET]$2'
  );

  return cleaned;
}
