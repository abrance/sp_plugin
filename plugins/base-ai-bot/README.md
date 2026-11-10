# Base AI Bot

AI chat assistant for Super Productivity. Talks to any OpenAI-compatible endpoint and manages your
workspace through tool calls: tasks, subtasks, projects, tags, planning for today, time tracking and
worklog reports.

Migrated from [`ai-eifying/ai-assistant-plugin`](https://github.com/ai-eifying/ai-assistant-plugin)
and rebuilt as a SolidJS plugin for Super Productivity 19.2.0.

## Features

- **两种后端** — 直连模型（插件自带 30 个工具）或 **本机 Pi Agent**（调用本机 `pi` CLI，
  具备本机全部工具/MCP/skills/记忆；按 SP 会话续接 Pi session；输出流式显示）
- Chat with a conversation history (multiple conversations, stored in synced plugin data)
- **日报 / 周报 / 月度总结** — one click on the welcome chips renders the report locally (no model
  call); each report has *复制 Markdown* and *AI 改写* buttons, and the model can also build one in
  chat via the `get_report_data` tool
- Tool calling with up to 10 rounds per turn; tool failures are reported back to the model
- Task CRUD, bulk complete/update, subtask trees, tag add/remove, move between projects, reorder
- Plan/unplan tasks for today, switch the active project/tag view
- Timer start/stop (via `currentTaskChange` mirroring — the API has no "get current task")
- In Pi mode, Pi's own extensions come along for free (including `pi-hermes-memory`: keep
  `memory_search`/`memory_add` in the tool allowlist and Pi can recall its long-term memory)
- Worklog summary: time per day/project/tag, tasks completed, estimate accuracy
- Markdown rendering (headings, lists, tables, code, links) with escaping and URL sanitising
- Cancellable requests, per-device API key

## Reports

Three fixed windows, always **previous period vs current period**:

| Period | Previous | Current |
| --- | --- | --- |
| 日报 | 昨日 | 今日 |
| 周报 | 上周 (Mon–Sun) | 本周 |
| 月度总结 | 上月 | 本月 |

Output template (section titles are literal — the first one ends with a colon, the others do not):

```
## 昨日事项：
- xxx
- xxx

## 今日事项
- xxx
- xxx

## 风险和关注
- 逾期 3 天：xxx
- 超出估算（180%）：xxx
```

Each period section lists **everything touched in that window**, not only completed work:

- completed inside the window (`doneOn`), or
- any tracked time inside the window (`timeSpentOnDay[day] > 0`) — so half-done work shows up too;
- the current-period section additionally includes what is planned for it (TODAY tag; plus `dueDay`
  inside the period for weekly/monthly).

Ordering: completed items first (by completion time), then the rest by tracked time. Sections cap at
20 lines and append `- 另有 N 项未列出` instead of silently dropping items.

“风险和关注” is derived from data, one line per task (first match wins): overdue tasks, deadlines
inside the current period, `timeSpent > 1.2 × timeEstimate`, and started-but-unscheduled work; plus a
warning when the current period has no planned task at all.

**Plan source:** the current period's plan comes from the `TODAY` tag's `taskIds` (that is where
Super Productivity 19.x keeps it — `task.plannedAt` is dead), plus `dueDay` inside the period for
weekly/monthly reports. Completions come from `doneOn` (unix ms) over open + archived tasks.

Implementation: `src/lib/report.ts` (windows, collection, template) is pure and model-free; the
`get_report_data` tool exposes the same data (`previousPeriodItems` / `currentPeriodItems`, each with
`kind` = `done|progress` and `tracked` duration) so chatting “帮我写今天日报” produces the same format.

## Two backends

Selected in settings (⚙), which is a two-tab sheet: **直连模型** and **本机 Pi**. Each tab only shows
the fields its backend reads, so nothing on screen is dead config:

| Mode | What runs | Needs |
| --- | --- | --- |
| `direct` | plugin's own `POST /chat/completions` loop + 30 plugin tools | API key |
| `pi` | local `pi --mode json`, i.e. the real Pi agent | `nodeExecution` consent + Pi installed |

### Pi agent mode

- Per turn the plugin runs the host-side script `lib/piAgent.ts` (permission `nodeExecution`),
  which spawns `pi --mode json --no-approve --session-id sp-<conversationId>` **detached** and
  redirects stdout to `~/.local/share/sp-base-ai-bot/runs/<runId>/events.jsonl`. The renderer then
  polls that file (~700 ms) and maps Pi's JSONL events onto the chat transcript.
- Why detached + poll: `executeNodeScript` is synchronous with a 300 s ceiling, while an agent turn
  can be longer and must stream. Nothing is buffered in the plugin process.
- The spawned Node process has **no PATH/HOME**, so the script rebuilds them (nvm node bin dirs +
  `/usr/local/bin:/usr/bin:/bin`) before launching Pi; Pi's own `bash` tool inherits that PATH.
- Sessions: one Pi session per SP conversation (`--session-id sp-<conversationId>`), so Pi keeps
  context and the same sessions are visible from a terminal via `pi -r`.
- `--no-approve` is always passed: deterministic headless runs, no trust prompts mid-turn, project
  local trust-gated extensions are not loaded.
- Tools default to `read,grep,ls,memory_search,memory_add,mcp__*`: Pi has no Super Productivity
  tools of its own, so **writing to SP goes through the local `sp-mcp` bridge** (`mcp__*`, i.e. the
  `mcp__super_productivity` proxy). Without an `mcp__…` entry in the allowlist Pi can only read files. The settings
  sheet edits this as chips, with an explicit `全部 *` switch for bash/edit/write — a task title can
  then drive shell commands, so it is a deliberate opt-in.
- Each turn appends a compact SP workspace snapshot (`[SP 工作区快照]`) so Pi can answer task
  questions without spending a tool call.
- **Task decomposition lives in Pi, not in this plugin.** The `sp-task-decompose` skill
  (`~/.pi/agent/skills/sp-task-decompose/`) holds the method: locate task → draft with estimates,
  execution-type tags (手动/半自动/自动) and acceptance criteria → wait for「确认」→ create subtasks
  through `sp-mcp` → parent estimate = sum → reorder → undo via `delete_task`. The plugin only
  injects the selected task into the prompt and reminds Pi to follow the skill.
- **Reports in Pi mode**: Pi has no Super Productivity tools, so a bare "写日报" produced empty
  section titles. When the turn matches 日报/周报/月度 keywords, the plugin now also appends
  `[SP 报表数据]` (the same precomputed digest the local report uses) plus the literal template
  rules. Verified against real `pi`: output is the three sections with real items.
- UI mapping: `text_delta`/`message_end` → bubble text (multi-round turns concatenated),
  `tool_execution_end` → action cards, `auto_retry_start`/`compaction_start` → quoted notes,
  exit with no output → error banner carrying the Pi stderr tail.

Settings UX: tabs = backend, per-tab `恢复默认`, dirty-highlighted save that closes immediately and
persists in the background (8 s timeout → visible error instead of a stuck spinner).

Settings keys: `agentMode`, `piBin`, `piCwd`, `piModel` (empty = Pi default), `piTools`.

## Configuration

Gear icon in the plugin header:

| Field | Default | Notes |
| --- | --- | --- |
| API key | — | stored in `localStorage` on this device only, never synced or exported |
| Base URL | `https://api.openai.com/v1` | any OpenAI-compatible endpoint, include the `/v1` segment |
| Model | `gpt-4o` | e.g. `deepseek-chat`, `qwen2.5`, `llama3.1` |
| Max tokens | `4096` | |
| Temperature | `0.7` | |

## Architecture

| Path | Role |
| --- | --- |
| `manifest.json` | iframe + side panel plugin, pinned to `minSupVersion` 19.2.0 |
| `index.html` | Vite entry; the build inlines everything into one page |
| `src/App.tsx` | boot (`waitForApi` → load config/conversations), layout |
| `src/components/` | header + conversation menu, chat view, composer, settings dialog |
| `src/lib/tools.ts` | tool schemas + executors (the actual Super Productivity operations) |
| `src/lib/report.ts` | report windows, data collection, fixed markdown template |
| `src/lib/memory.ts` | read-only Pi memory reader, cache, keyword search |
| `src/lib/piAgent.ts` | Pi agent mode: detached `pi --mode json` run + JSONL polling |
| `src/lib/llm.ts` | `/chat/completions` client with tool support and abort |
| `src/lib/chat.ts` | agent loop: send → tool calls → tool results → final answer |
| `src/lib/prompt.ts` | system prompt + per-turn app context snapshot |
| `src/lib/conversations.ts` | conversation state, synced persistence (debounced) |
| `src/lib/host.ts` | dispatch-based host actions (timer, work context) and snackbars |
| `src/lib/markdown.ts` | markdown → sanitised HTML |

## Build

```bash
node scripts/build.mjs base-ai-bot
# → release/base-ai-bot-<version>.zip
```

Install: Settings → Plugins → Install from file.
