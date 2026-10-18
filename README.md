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

# 4. Link CLI globally to run 'tokenpal' from any directory:
pnpm link --global
# (or from the cli package directly: pnpm --filter @tokenpal/cli link --global)

# 5. Start watcher as a background daemon:
tokenpal start

# 6. Check daemon and quota meter status:
tokenpal status

# 7. View daemon logs (rotates at ~5 MB):
tokenpal logs -f

# 8. Stop background daemon:
tokenpal stop

# 9. Test overlay animations with demo mode (cycles 5 states with fake data, ~5s each):
tokenpal demo
```

### Native Build & Electron Binaries (`onlyBuiltDependencies`)

TokenPal relies on `better-sqlite3` for zero-latency local SQLite operations and `electron` for the desktop overlay companion.
In modern pnpm (v10+), install lifecycle scripts are blocked by default for security. TokenPal configures `"pnpm": { "onlyBuiltDependencies": ["better-sqlite3", "esbuild", "electron"] }` in root `package.json`. This ensures that on a fresh `pnpm install`:
- `better-sqlite3` native C++ bindings are compiled via node-gyp automatically.
- `electron` downloads its platform binary automatically.
Zero manual rebuild or postinstall steps are required from a fresh clone.

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

### 1. `tokenpal start`
Runs the watcher as a detached background daemon in its own session, redirecting stdio to `~/.tokenpal/tokenpal.log`, writes its PID atomically to `~/.tokenpal/tokenpal.pid`, verifies process liveness, and prints `started (pid N)`. By default, the desktop mascot overlay opens whenever an alert triggers; pass `--no-ui` to disable the overlay. If already running, prints that and exits 0 without spawning a second instance. Safe PID validation guards against PID reuse after a reboot or crash, cleaning stale PID files automatically.

```bash
tokenpal start [options]
  --foreground         Run watcher directly in the terminal (foreground mode)
  -d, --dir <path>     Watch a specific directory (default: ~/.codex/sessions)
  --db <path>          Path to SQLite database (default: ~/.tokenpal/tokenpal.sqlite)
  --config <path>      Path to custom config.json
  --no-ui              Disable desktop overlay mascot during alerts (enabled by default)
```

### 2. `tokenpal stop`
Stops the running TokenPal daemon. Sends SIGTERM, waits up to ~5 seconds for clean termination, and escalates to SIGKILL if necessary. Recursively terminates any child processes (such as Electron overlay and helper processes) and verifies no remaining process command line includes the overlay entry (`overlay/dist/main.js`), printing what it found (`Overlay processes: none remaining.`). Cleanly deletes `~/.tokenpal/tokenpal.pid`. If not running, prints `not running` and exits 0.

```bash
tokenpal stop
```

### 3. `tokenpal test-alert`
Sends a clearly labeled "TEST" alert through the running daemon via a local control socket (`~/.tokenpal/tokenpal.sock`) so you can verify the overlay opens from the daemon path without reading session logs. If the daemon is not running, prints `TokenPal daemon is not running.` and exits immediately.

```bash
tokenpal test-alert
```

### 4. `tokenpal restart`
Stops the running daemon and starts a fresh background instance.

```bash
tokenpal restart [options]
```

### 5. `tokenpal status`
First line displays the daemon state (`TokenPal daemon: running (pid N, uptime ...)` or `TokenPal daemon: stopped`). Followed by the complete rate limits meter (percent, local reset countdown & timestamp, plan, last reset in local time, and early-reset count) read directly from the latest session event in `~/.codex/sessions`. Works even when the daemon is stopped. Zero message text.

```bash
tokenpal status [options]
  -d, --dir <path>     Directory containing session logs (default: ~/.codex/sessions)
  --db <path>          Path to SQLite database (default: ~/.tokenpal/tokenpal.sqlite)
  --json               Output machine-readable JSON (preserves UTC ISO timestamps)
```

### 6. `tokenpal logs`
Prints the last 50 lines of `~/.tokenpal/tokenpal.log` by default. Use `-f` to follow log output in real time. Log files are capped at ~5 MB and automatically rotated to `tokenpal.log.1`. No prompt or message text is ever logged—only token counts and guardian metadata.

```bash
tokenpal logs [options]
  -n, --lines <count>  Number of lines to display (default: 50)
  -f, --follow         Follow log output in real time
```

### 7. `tokenpal autostart on|off` (macOS)
Creates or removes a launchd LaunchAgent at `~/Library/LaunchAgents/com.tokenpal.watcher.plist` with `RunAtLoad = true` and NO `KeepAlive`, using absolute paths to `node` and the CLI so `tokenpal stop` stays stopped until next login. On non-macOS platforms, prints `not supported yet`. Reports the exact `launchctl` command executed.

```bash
tokenpal autostart on    # launchctl load -w ~/Library/LaunchAgents/com.tokenpal.watcher.plist
tokenpal autostart off   # launchctl unload -w ~/Library/LaunchAgents/com.tokenpal.watcher.plist
```

### 8. `tokenpal watch`
Monitors session logs in foreground mode. Emits turn updates with context size (input tokens), cached token counts, output tokens, rate limits meter with countdown, and proactive alerts. Desktop overlay opens by default during alerts; pass `--no-ui` to disable. Handles SIGINT/SIGTERM cleanly.

```bash
tokenpal watch [options]
  -d, --dir <path>     Watch a specific directory (default: ~/.codex/sessions)
  --db <path>          Path to SQLite database (default: ~/.tokenpal/tokenpal.sqlite)
  --config <path>      Path to custom config.json
  --no-ui              Disable desktop overlay mascot during alerts (enabled by default)
```

### 9. `tokenpal demo`
Opens the desktop mascot overlay once and automatically cycles through every guardian state (Healthy, Projected Exhaustion, Single High Request, Astra Badge, and Stale Reading) using fake data (~5 seconds each), then exits cleanly. Performs zero file reads.

```bash
tokenpal demo
```

### 10. `tokenpal replay <file>`
Parses a past `.jsonl` session file from start to finish, evaluating rules at each turn and displaying a breakdown of context growth, cached tokens, and a Triggered Alerts Summary.

```bash
tokenpal replay <session-file.jsonl>
```

### 11. `tokenpal handoff`
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
