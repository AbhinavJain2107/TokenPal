# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-11-10

### Added
- **Core Watcher**: Real-time incremental tailing of Codex sessions (`~/.codex/sessions`) with atomic byte offsets.
- **Authoritative Meter**: Direct ingestion of `rate_limits.primary` (`used_percent`, `resets_at`, `window_minutes`, `plan_type`), early reset frequency detection, and burnout projections.
- **Rules Engine**: 9 deterministic, zero-token rules evaluating context growth, turn count, model tier switches, reasoning effort, retry loops, tool output size, crawl behavior, cache hit ratio, and burn pacing.
- **Breakpoint Detection & Cooldowns**: Natural pause alerting without mid-task interrupts; 30-minute snooze and context worsening guards.
- **Layer A Handoff Generator**: Automatic state collection from `git`, recent tool events, and logs into `.handoff/latest.md` with clipboard copy.
- **Desktop Companion (Overlay)**: Electron mascot companion with 6 customizable skins, low-power mode, multi-display roaming, and visibility modes (Always, Coding Apps, Alerts Only).
- **CLI Commands**: `start`, `stop`, `restart`, `status`, `logs`, `test-alert`, `watch`, `demo`, `replay`, `handoff`, and `autostart` (macOS launchd).

