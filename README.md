# TokenPal 🐾

[![npm version](https://img.shields.io/npm/v/tokenpal.svg?color=emerald)](https://www.npmjs.com/package/tokenpal)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![tests](https://img.shields.io/badge/tests-169%20passing-success.svg)](packages/core/test)

**Proactive Context & Rate Limit Guardian with Desktop Mascot Companion for AI Coding Agents.**

TokenPal tails local agent session logs in real time (**Claude Code** & **OpenAI Codex**), calculates weekly quota usage and context growth using deterministic, zero-token local rules, alerts you before conversations become bloated and expensive, and provides a customizable desktop pixel pet that keeps you informed at a glance.

---

## ✨ Features

- 📊 **Real-Time Rate Limit Meter**: Displays your weekly quota percentage (e.g. `9%`), reset countdown (e.g. `5d 0h`), plan type (`team`, `prolite`), and projected exhaustion pace.
- 🤖 **Multi-Agent Support**: Out-of-the-box streaming log adapters for:
  - **Claude Code**: Tails `~/.claude/projects/` and `~/.claude/sessions/` with tool use, cache read/write token tracking, and sub-second turn updates.
  - **OpenAI Codex**: Tails `~/.codex/sessions` (CLI and VS Code extension) with full token and tool call monitoring.
- 🐾 **Floating Mascot Companion**: A lightweight, customizable desktop pixel pet (Cat, Dog, Fox, Robot) that reacts to agent turns, alerts, and model switches.
- 🖥️ **Cross-Platform System Tray**: Native template icon for macOS Menu Bar, Windows System Tray, and Linux panel with click-to-toggle status card and right-click settings.
- 🚶 **Edge Roaming**: When quota is healthy, your mascot companion naturally roams along the bottom of your screen.
- 🎯 **Smart Visibility ("Only in Coding Apps")**: Automatically stays visible while you code in VS Code, Cursor, Antigravity, Windsurf, Zed, or Terminal, and seamlessly hides when you switch to Google Chrome, Slack, or other apps (macOS, Linux, Windows).
- ⚡ **Zero Network & Zero LLM Calls**: Completely offline and privacy-first. Byte-offset incremental log parsing with zero prompt/message text storage—only token counts and guardian metadata in SQLite.
- 📋 **Active Session Handoffs**: Automatically resolves your active project git branch, diff stats, and human task prompts into clean markdown with instant `✓ Copied!` clipboard feedback.

---

## 🚀 Quickstart

### Install via npm

```bash
# Install globally
npm install -g tokenpal

# Start the background guardian daemon
tokenpal start

# Check status and quota meter
tokenpal status
```

Or run directly without installing:

```bash
npx tokenpal start
```

---

## 💻 CLI Commands

| Command | Description |
| :--- | :--- |
| `tokenpal start` | Starts the background daemon and desktop mascot overlay |
| `tokenpal status` | Shows daemon health, weekly quota %, countdown, and plan type |
| `tokenpal stop` | Gracefully stops the daemon and closes desktop overlay processes |
| `tokenpal restart` | Restarts the background daemon and reloads settings |
| `tokenpal test-alert` | Sends a verification test card to the desktop overlay |
| `tokenpal logs [-f]` | Views daemon logs with auto-rotation (capped at 5MB) |
| `tokenpal demo` | Cycles through all mascot visual states with mock data (~5s each) |
| `tokenpal autostart on\|off` | Configures autostart on login (macOS LaunchAgent, Linux XDG, Windows Startup) |
| `tokenpal watch [--no-ui]` | Runs guardian watcher in terminal (optional headless mode with `--no-ui`) |
| `tokenpal replay <file>` | Replays a past session `.jsonl` file to audit context growth |
| `tokenpal handoff` | Generates a clean markdown handoff and copies it to clipboard |

---

## 🎨 Desktop Mascot & Customization

Click on the mascot or click the **Customize** button on the status card to open the **Mascot Studio**:

- **Skins**: Choose from **Cat**, **Dog**, **Fox**, or **Robot** pixel skins.
- **Accessories**: Toggle hats, glasses, and ribbons.
- **Scale & Opacity**: Adjust mascot size (50% to 200%) and transparency.
- **Roaming Mode**: Toggle walking animations across your screen edges.
- **Visibility Modes**:
  - **Only in Coding Apps** *(Recommended)*: Visible in VS Code, Cursor, Zed, Windsurf, Antigravity, Terminal, and iTerm; hides in browsers and other apps.
  - **Always Visible**: Floats as a persistent desktop companion above all windows.
  - **Only on Alerts**: Remains hidden until an exhaustion or high-usage alert triggers.

---

## 🛡️ Privacy & Performance

- **Zero Prompt Storage**: TokenPal log adapters are strictly read-only and never store message bodies, user prompts, code diffs, or LLM responses.
- **Zero External Calls**: All rules evaluation, projections, and alert cooldowns run locally on your machine.
- **Incremental Byte-Offset Parsing**: Never re-reads entire log files. Only streams newly appended bytes directly from disk.
- **Ultra-low Resource Footprint**:
  - Core Daemon: **< 0.1% CPU**, **~75 MB RAM**.
  - Headless Mode (`--no-ui`): **~35 MB RAM**.
  - Electron Overlay: **0.0% idle CPU** with throttled rendering and auto-exit watchdog on parent daemon shutdown.

---

## 🛠️ Monorepo Architecture

```
TokenPal/
├── packages/
│   ├── core/       # Session adapters (Claude Code, Codex), SQLite DB, rules engine, handoffs, meter
│   ├── cli/        # Command-line interface and daemon management (tokenpal)
│   └── overlay/    # Electron companion mascot, status panel card, and Mascot Studio
├── docs/           # Log schemas, research, and rate limit meter specifications
└── packages/core/test/ # 169 automated Vitest unit & integration tests (18 suites)
```

---

## 🧑‍💻 Contributing & Local Development

TokenPal uses `pnpm` workspaces on Node 20+.

```bash
# 1. Clone repository
git clone https://github.com/AbhinavJain2107/TokenPal.git
cd TokenPal

# 2. Install dependencies (better-sqlite3 & electron compile automatically)
pnpm install

# 3. Build all workspace packages
pnpm build

# 4. Run test suite
pnpm test

# 5. Type-check & lint
pnpm type-check
pnpm lint

# 6. Link locally for testing
pnpm --filter tokenpal link --global
```

---

## 📄 License

MIT © [Abhinav Jain](https://github.com/AbhinavJain2107)
