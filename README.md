# TokenPal 🐾

[![npm version](https://img.shields.io/npm/v/tokenpal.svg?color=emerald)](https://www.npmjs.com/package/tokenpal)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![tests](https://img.shields.io/badge/tests-161%20passing-success.svg)](packages/core/test)

**Proactive Context & Rate Limit Guardian with Desktop Mascot Companion for AI Coding Agents.**

TokenPal tails local agent session logs in real time (Codex VS Code extension & CLI), calculates weekly quota usage and context growth using deterministic, zero-token local rules, alerts you before conversations become bloated and expensive, and provides a customizable desktop pixel pet that keeps you informed at a glance.

---

## ✨ Features

- 📊 **Real-Time Rate Limit Meter**: Displays your weekly quota percentage (e.g. `6%`), reset countdown (e.g. `5d 1h`), plan type (`team`, `prolite`), and projected exhaustion pace.
- 🐾 **Floating Mascot Companion**: A lightweight, customizable desktop pixel pet (Cat, Dog, Fox, Robot) that reacts to agent turns, alerts, and model switches.
- 🚶 **Edge Roaming**: When quota is healthy, your mascot companion naturally roams along the bottom of your screen.
- 🎯 **Smart Visibility ("Only in Coding Apps")**: Automatically stays visible while you code in VS Code, Cursor, Antigravity, Windsurf, Zed, or Terminal, and seamlessly hides when you switch to Google Chrome, Slack, or other apps.
- ⚡ **Zero Network & Zero LLM Calls**: Completely offline and privacy-first. Tails local session logs (`~/.codex/sessions`) with zero prompt/message text storage—only token counts and guardian metadata in SQLite.
- 📋 **One-Click Layer A Handoffs**: Extracts factual git status, diff stats, and recent test results into a concise summary to resume cleanly in fresh sessions.

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
| `tokenpal autostart on\|off` | Configures macOS LaunchAgent to start automatically on login |
| `tokenpal watch` | Runs guardian watcher directly in foreground terminal mode |
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
- **Lightweight Desktop Footprint**: The Electron overlay runs at capped frame rates with GPU-accelerated canvas rendering, consuming minimal battery and memory.

---

## 🛠️ Monorepo Architecture

```
TokenPal/
├── packages/
│   ├── core/       # Session adapters, SQLite DB, deterministic rules, handoffs, meter calculations
│   ├── cli/        # Command-line interface and daemon management (tokenpal)
│   └── overlay/    # Electron companion mascot, status panel card, and Mascot Studio
├── docs/           # Log schemas, research, and rate limit meter specifications
└── packages/core/test/ # 161 automated Vitest unit & integration tests
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
