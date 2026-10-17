# TokenPal: Proactive Context & Token Guardian

TokenPal is a lightweight local monitor and desktop guardian for AI coding agents. It tails agent session logs (Codex VS Code extension & CLI) in real time, computes per-turn context growth using deterministic, zero-token rules, alerts you at natural breakpoints before conversations become bloated and expensive, and prepares instant Layer A handoffs so you can resume cleanly in a fresh session.

---

## Setup & Quickstart

### Clean Clone Setup

TokenPal is a pnpm monorepo requiring Node 20+ and pnpm.

```bash
# 1. Clone repository
git clone https://github.com/AbhinavJain2107/TokenPal.git
cd TokenPal

# 2. Install dependencies
pnpm install

# 3. Build all workspace packages
pnpm build

# 4. Run watcher with desktop mascot overlay (defaults to ~/.codex/sessions)
node packages/cli/dist/index.js watch

# Terminal-only watcher:
node packages/cli/dist/index.js watch --no-ui

# 5. Check current rate limits meter once
node packages/cli/dist/index.js status

# 6. Test overlay animations with demo mode (cycles 5 states with fake data, ~5s each)
node packages/cli/dist/index.js demo
```

### Native Build Note (`better-sqlite3`)

TokenPal relies on `better-sqlite3` for high-performance zero-latency local SQLite operations. It compiles native C++ bindings upon install.

* **Prerequisites**: Python 3 and a C++ compiler toolchain:
  * **macOS**: `xcode-select --install`
  * **Linux (Ubuntu/Debian)**: `sudo apt install build-essential python3`
  * **Windows**: Visual Studio C++ Build Tools & Python 3
* **If installation fails or sqlite bindings are missing**:
  ```bash
  pnpm rebuild better-sqlite3
  ```
* **If Electron reports a `NODE_MODULE_VERSION` mismatch**:
  The watcher process uses Node's native module while the Electron overlay communicates via JSON IPC over stdin/stdout. If running native SQLite directly in Electron, rebuild bindings:
  ```bash
  npx electron-rebuild -f -w better-sqlite3
  ```

---

## CLI Commands

### 1. `tokenpal watch`
Monitors session logs in real time using stored file offsets. Emits turn updates with context size (input tokens), cached token counts, output tokens, rate limits meter with countdown, and proactive alerts.

```bash
tokenpal watch [options]
  -d, --dir <path>     Watch a specific directory (default: ~/.codex/sessions)
  --db <path>          Path to SQLite database (default: ~/.tokenpal/tokenpal.sqlite)
  --config <path>      Path to custom config.json
  --no-ui              Terminal-only mode without desktop overlay
```

### 2. `tokenpal status`
Prints the current rate limits meter once (percent, local reset countdown & timestamp, plan, last reset in local time, and early-reset count) read directly from the latest session event in `~/.codex/sessions`. Zero message text.

```bash
tokenpal status [options]
  -d, --dir <path>     Directory containing session logs (default: ~/.codex/sessions)
  --db <path>          Path to SQLite database (default: ~/.tokenpal/tokenpal.sqlite)
  --json               Output machine-readable JSON (preserves UTC ISO timestamps)
```

### 3. `tokenpal demo`
Opens the desktop mascot overlay once and automatically cycles through every guardian state (Healthy, Projected Exhaustion, Single High Request, Astra Badge, and Stale Reading) using fake data (~5 seconds each), then exits cleanly. Performs zero file reads.

```bash
tokenpal demo
```

### 4. `tokenpal replay <file>`
Parses a past `.jsonl` session file from start to finish, evaluating rules at each turn and displaying a breakdown of context growth, cached tokens, and a Triggered Alerts Summary.

```bash
tokenpal replay <session-file.jsonl>
```

### 5. `tokenpal handoff`
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
