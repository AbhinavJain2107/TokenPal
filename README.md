# TokenPal: Proactive Context & Token Guardian

TokenPal is a lightweight local monitor and desktop guardian for AI coding agents. It tails agent session logs (Codex VS Code extension & CLI) in real time, computes per-turn context growth using deterministic, zero-token rules, alerts you at natural breakpoints before conversations become bloated and expensive, and prepares instant Layer A handoffs so you can resume cleanly in a fresh session.

---

## Quickstart

Run directly without installation:

```bash
# Start background watcher in terminal mode
npx tokenpal watch --no-ui

# Watch with the desktop companion overlay enabled
npx tokenpal watch

# Replay an existing session to inspect context growth and alerts
npx tokenpal replay ~/.codex/sessions/2026/10/14/rollout-*.jsonl

# Generate a Layer A handoff summary and copy it to clipboard
npx tokenpal handoff
```

---

## CLI Commands

### 1. `tokenpal watch`
Monitors session logs in real time using stored file offsets. Emits turn updates with context size (input tokens), cached token counts, output tokens, and fires alerts when threads become heavy or expensive.

```bash
tokenpal watch [options]
  -d, --dir <path>     Watch a specific directory (default: ~/.codex/sessions)
  --db <path>          Path to SQLite database (default: ~/.tokenpal/tokenpal.sqlite)
  --config <path>      Path to custom config.json
  --no-ui              Terminal-only mode without desktop overlay
```

### 2. `tokenpal replay <file>`
Parses a past `.jsonl` session file from start to finish, evaluating rules at each turn and displaying a breakdown of context growth, cached tokens, and a Triggered Alerts Summary.

```bash
tokenpal replay <session-file.jsonl>
```

### 3. `tokenpal handoff`
Extracts factual state from git (`git branch`, last commit, `git status`, `git diff --stat`) and recent session test/lint logs, formats a concise markdown handoff under 60 lines, saves to `.handoff/latest.md`, and copies it to your clipboard.

```bash
tokenpal handoff [options]
  -p, --project <dir>  Project directory (default: current working directory)
  -s, --session <id>   Specific session ID to summarize
```

---

## Monorepo Architecture

```
TokenPal/
├── packages/
│   ├── core/       # Codex log adapter, SQLite storage, 9 deterministic rules, Layer A handoff, secret redaction, Layer B Ollama summarizer
│   ├── cli/        # CLI binary (tokenpal watch, replay, handoff)
│   └── overlay/    # On-demand transparent Electron companion mascot (18 fps cap, tray menu, low-power mode)
├── docs/           # Log schema documentation and findings
└── scripts/        # 18 fps overlay resource benchmark script
```

---

## Rules Engine (PRD 6.2)

Deterministic code with zero network and zero LLM calls.

| Signal | Trigger Condition | Recommended Advice |
|---|---|---|
| **Context Growth** | Input tokens >= 3x initial turn or > 100,000 tokens | Start a new thread with a handoff |
| **Turn Count** | Thread exceeds 40 turns | Start fresh or compact |
| **Expensive Model** | Switch to costly model tiers (`gpt-6-astra`, `o1-pro`) | Confirm task needs it |
| **High Effort on Simple Task** | High reasoning effort with small input context (< 10k tokens) | Try medium effort |
| **Retry Loop** | 3 consecutive tool execution failures | Stop and diagnose the root cause yourself |
| **Large Tool Output** | Single tool output exceeds 50 KB | Trim output next time |
| **Exploration Crawl** | > 8 tool operations in 3 turns | Narrow scope or split by folder |
| **Low Cache Ratio** | Prompt cache share drops below 20% on turn 5+ | Avoid editing earlier context mid-thread |
| **Burn Rate** | Session tokens exceed daily pacing allowance | Slow down or plan credits |

- **Breakpoint Detection:** Escalates to RED alerts only when the agent is idle or after a turn concludes—never mid-execution.
- **Cooldown & Snooze:** Suppresses redundant alerts for the same thread unless context worsens by >= 20% or 5 turns elapse; supports 30-minute snooze.

---

## Development & Verification Commands

```bash
pnpm install       # Install dependencies across all packages
pnpm build         # Build TypeScript packages
pnpm test          # Run Vitest test suite across core and CLI
pnpm lint          # Run ESLint
pnpm type-check    # Run TypeScript compiler checks
```
