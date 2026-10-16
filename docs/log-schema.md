# Codex Session Log Schema

## Log Location and Organization
- **Base directory:** `~/.codex/sessions/YYYY/MM/DD/`
- **File naming:** `rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl`
- **Origin verification (FR-5):** Both VS Code extension and CLI log to this exact location. The VS Code extension writes `originator: "codex_vscode"` and `source: "vscode"` in `session_meta`.

## Event Types
Codex sessions are JSON Lines (`.jsonl`) streams comprising 7 event types:
1. `session_meta`: Session initialization and workspace metadata.
2. `turn_context`: Turn parameters, active model, reasoning effort, and policies.
3. `event_msg`: Lifecycle messages (e.g. `turn_started`, `turn_complete`, timing, context window limit).
4. `response_item`: User inputs, agent thoughts, tool invocations, and tool results.
5. `token_usage_record`: Token accounting per turn and cumulatively per thread.
6. `world_state`: Periodic snapshot of project agents, tools, and environments.
7. `compacted`: Context compaction boundaries.

---

## Per-Turn Fields Availability

| Target Field | Exists? | Event Type | JSON Path | Data Type / Example Value |
|---|---|---|---|---|
| **Input tokens** | **Yes** | `token_usage_record` | `payload.turn_token_usage.input_tokens` | `integer` (e.g. `22736`) |
| **Cached input tokens** | **Yes** | `token_usage_record` | `payload.turn_token_usage.cached_input_tokens` | `integer` (e.g. `0`) |
| **Output tokens** | **Yes** | `token_usage_record` | `payload.turn_token_usage.output_tokens` | `integer` (e.g. `199`) |
| **Reasoning tokens** | **Yes** | `token_usage_record` | `payload.turn_token_usage.reasoning_output_tokens` | `integer` (e.g. `0`) |
| **Total turn tokens** | **Yes** | `token_usage_record` | `payload.turn_token_usage.total_tokens` | `integer` (e.g. `22935`) |
| **Cumulative thread tokens** | **Yes** | `token_usage_record` | `payload.thread_token_usage.total_tokens` | `integer` |
| **Model name** | **Yes** | `turn_context` / `session_meta` | `payload.model` / `payload.collaboration_mode.settings.model` | `string` (e.g. `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6-astra`) |
| **Reasoning effort** | **Yes** | `turn_context` | `payload.effort` / `payload.collaboration_mode.settings.reasoning_effort` | `string` (e.g. `medium`, `high`, `low`) |
| **Tool calls** | **Yes** | `response_item` | `payload.type == "custom_tool_call"` / `"function_call"` | `payload.name` (`string`), `payload.call_id` (`string`), `payload.input` (`string`) |
| **Tool results** | **Yes** | `response_item` | `payload.type == "custom_tool_call_output"` / `"function_call_output"` | `payload.call_id` (`string`), `payload.output[]` (`array of {type: string, text: string}`) |
| **Tool output size** | **Yes** | `response_item` | Calculated from `payload.output[].text` byte length | `integer` (byte count) |
| **Command exit codes** | **Yes** | `response_item` | Extracted from tool output string via `exit code:? (\d+)` | `integer` (e.g. `0`, `1`) |
| **Timestamp** | **Yes** | All events | `timestamp` | `string` (ISO 8601 UTC) |
| **Session ID** | **Yes** | `session_meta`, `token_usage_record` | `payload.session_id` | `string` (UUID) |

---

## Token Mathematical Relationships (Empirically Verified)
Across **814 session files** and **23,746 `token_usage_record`s** inspected locally:
- `cached_input_tokens <= input_tokens`: **100% of cases (23,746 / 23,746)**. `cached_input_tokens` is strictly a subset of `input_tokens`.
- `reasoning_output_tokens <= output_tokens`: **100% of cases (23,746 / 23,746)**. `reasoning_output_tokens` is strictly a subset of `output_tokens`.
- `total_tokens = input_tokens + output_tokens`: Confirmed across all records.
- **Context Size Rule:** As confirmed by the data, **Context size = `input_tokens`**.

---

## Log Format Stability and Fail-Safe Behavior
- **Alpha Build Warning:** Session logs currently report `cli_version: "0.162.0-alpha.17.2"`. The format comes from an active alpha build and may evolve.
- **Fail-Safe Requirement:**
  - Adapters must inspect `cli_version` from `session_meta`.
  - Adapters must tolerate unknown event types and extra unmodeled fields gracefully without throwing errors.
  - If a log format breaks structural invariants or is unparseable, the adapter must return `"unsupported version"` fail-safe rather than crashing.
- **Command Exit Codes:** Command exit codes parsed from tool output text (e.g. `exit code: (\d+)`) are **best-effort heuristics**. The retry-loop rule (PRD FR-6) depends on this heuristic.


---

## Real Expensive Sessions for Replay Testing
The following sessions were identified from the local environment for tuning rules and replaying:
1. `~/.codex/sessions/2026/10/14/rollout-2026-10-14T10-50-22-01a138da-c082-7453-a944-5c1279ae4306.jsonl`
   - Max turn input tokens: `328,636`
   - Total tokens: `122,575,655`
   - Turns: `906`
   - Tool calls: `842`
   - Model: `gpt-6-astra`
2. `~/.codex/sessions/2026/10/09/rollout-2026-10-09T17-54-16-01a1209f-097e-77a2-be4a-95e615565acf.jsonl`
   - Max turn input tokens: `248,775`
   - Total tokens: `101,718,809`
   - Turns: `815`
   - Tool calls: `764`
   - Model: `gpt-6.1-sol`
3. `~/.codex/sessions/2026/10/13/rollout-2026-10-13T14-53-28-01a13492-f48e-74a2-9c58-a3a84d10f0f2.jsonl`
   - Max turn input tokens: `246,040`
   - Total tokens: `12,406,260`
   - Turns: `88`
   - Tool calls: `82`
   - Model: `gpt-6.1-sol`
