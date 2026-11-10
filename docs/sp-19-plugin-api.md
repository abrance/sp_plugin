# Super Productivity plugin API — digest for 19.2.0

Pinned to Super Productivity **19.2.0** (the version installed on this machine: deb package at
`/opt/Super Productivity`, data dir `~/.config/superProductivity`).

Sources: `packages/plugin-api/src/types.ts`, `src/app/plugins/plugin-api.ts`,
`src/app/plugins/plugin-bridge.service.ts`, `docs/plugin-development.md` at tag `v19.2.0`, plus the
iframe bridge allowlist inlined in the packaged app (`resources/app.asar`).

Update this file when bumping `minSupVersion`, and re-sync
`packages/plugin-kit/src/types.ts`.

## Packaging rules

- A plugin zip contains `manifest.json` at the root plus `plugin.js` and/or `index.html`, and any
  files referenced by `icon` / `assets`.
- **Iframe plugins must be one self-contained `index.html`.** The host renders it through `srcdoc`
  and does not serve sibling assets, so CSS/JS must be inlined (`vite-plugin-singlefile` does this).
- Installing is GUI-only: Settings → Plugins → Install from file. Plugins live in the app profile
  (IndexedDB/localStorage), not on the filesystem.

## Manifest

```json
{
  "id": "kebab-case-id",
  "name": "Display name",
  "version": "1.0.0",
  "manifestVersion": 1,
  "minSupVersion": "19.2.0",
  "description": "optional",
  "icon": "icon.svg",
  "iFrame": true,
  "sidePanel": true,
  "isSkipMenuEntry": true,
  "hooks": ["currentTaskChange"],
  "permissions": ["getTasks", "showSnack"],
  "allowedHosts": []
}
```

Required: `name`, `id`, `manifestVersion`, `version`, `minSupVersion`, `hooks`, `permissions`
(arrays may be empty). `id` must be a single safe token for `nodeExecution` plugins (no spaces,
`:`, slashes, ≤100 chars).

Enforced permissions: only `nodeExecution`, `http` + `allowedHosts`, and `deleteProject`. The rest
are displayed to the user but not gated.

## Iframe API surface (exact allowlist)

Injected into `index.html` as `window.PluginAPI`:

```
getTasks, getArchivedTasks, getCurrentContextTasks, getSelectedTask, getFocusedTask,
selectTask, reInitData, updateTask, addTask, deleteTask, batchUpdateForProject, reorderTasks,
getAllProjects, addProject, updateProject, deleteProject, getAllTags, addTag, updateTag,
showSnack, notify, request, translate, formatDate, getCurrentLanguage, openDialog,
showIndexHtmlAsView, showIndexHtmlInSidePanel, showInWorkContext, closeWorkContextView,
getActiveWorkContext, getAppState, persistDataSynced, loadPersistedData, registerHook,
registerWorkContextHeaderButton, executeNodeScript, dispatchAction,
setCounter, getCounter, incrementCounter, decrementCounter, deleteCounter, getAllCounters,
getAllSimpleCounters
```

`loadSyncedData` exists in the iframe as an alias of `loadPersistedData`.

### Host-only (must live in `plugin.js`)

`registerHeaderButton`, `registerMenuEntry`, `registerTaskContextMenuEntry`,
`registerSidePanelButton`, `registerShortcut` / `unregisterShortcut`, `registerConfigHandler`,
`registerIssueProvider`, and — importantly — `setSecret` / `getSecret` / `deleteSecret`,
`getConfig`, `onMessage`, `onReady`, `onUnload`, `isWindowFocused`, `downloadFile`,
`startOAuthFlow`.

The iframe gets `unsupportedIframeRegistration()` stubs that throw for the registration methods.

## Data shapes

`Task`: `id, title, notes, timeEstimate, timeSpent, isDone, projectId, tagIds, parentId, created,
updated, subTaskIds, timeSpentOnDay, doneOn, dueDay, dueWithTime, plannedAt, deadlineDay,
deadlineWithTime, remindAt, repeatCfgId`.

- `plannedAt` is a `number` (unix ms). The start of today's timestamp = "planned for today";
  `null` unplans.
- `dueDay` is `YYYY-MM-DD`.
- `updateTask` rejects relational fields (`parentId`, `subTaskIds`); create subtasks via
  `addTask({ parentId })`.

`PluginCreateTaskData`: `title, projectId, tagIds, notes, timeEstimate, parentId, isDone, dueDay`.

Projects: `id, title, theme{primary}, taskIds, backlogTaskIds, noteIds, isEnabledBacklog, ...
addProject(Partial<Project>)`. Tags: `id, title, color, icon, taskIds, ...`.

## Hooks

`taskCreated`, `taskComplete`, `taskUpdate`, `taskDelete`, `currentTaskChange`, `finishDay`,
`languageChange`, `persistedDataChanged`, `action`, `anyTaskUpdate`, `projectListUpdate`,
`workContextChange`.

Declare the ones you use in the manifest `hooks` array. `currentTaskChange` payload is
`{ current: Task | null, previous: Task | null }`.

## Persistence

- `persistDataSynced(str, key?)` / `loadPersistedData(key?)` (alias `loadSyncedData`) — synced,
  exported, backed up. Never store credentials here.
- Iframe plugins have **no secret API** in 19.2.0. `@sp/plugin-kit`'s `setSecret/getSecret` use
  `localStorage` (device-local, unsynced) with an in-memory fallback.
- Host-side `plugin.js` can use the real `PluginAPI.setSecret`.

## Useful facts learned the hard way

- **The active timer is not queryable.** `getAppState()` returns `tasks/projects/tags/notes/
  taskRepeatCfgs/simpleCounters/globalConfig` — no `currentTaskId`. Mirror the
  `currentTaskChange` hook instead.
- **Action payload shapes** (verified against `v19.2.0` sources):
  - `[Task] SetCurrentTask` → props `{ id: string | null }` (setting it starts tracking when time
    tracking is enabled)
  - `[Task] UnsetCurrentTask` → no props (pause; flushes tracked time)
  - `[Task] Toggle start` → no props
  - `[WorkContext] Set Active Work Context` → props `{ activeId: string, activeType: 'PROJECT' |
    'TAG' }` (both required — `activeType` is not optional)
  - Action names are exact strings including spaces, e.g. `[Task] Toggle start` is lowercase.
- `reorderTasks(contextId, contextType, taskIds)` exists in the iframe — prefer it over writing an
  `_order` field through `updateTask`.
- **Today's plan is only observable through the TODAY tag.** The planner keeps it in
  `planner.days[date] = taskIds`, which `getAppState()` does not expose; the plugin-equivalent read is
  `getAllTags()` → the tag with `id === 'TODAY'` → its `taskIds`. Write it with
  `dispatchAction({ type: '[Task Shared] planTasksForToday', taskIds, today: 'YYYY-MM-DD' })` and
  remove with `[Task Shared] removeTasksFromTodayTag` (payload `{ taskIds }`). Both exist in v19.2.0
  `task-shared.actions.ts`; `task.plannedAt` is dead and must not be used.
- `task.doneOn` is unix ms (confirmed against a real data export), so completion-day windows work.
  Completed tasks move to the archive, which `getArchivedTasks()` does return.
- Theme variables and a UI-kit CSS reset are injected into iframe plugins (`--bg`, `--card-bg`,
  `--text-color`, `--c-primary`, `--c-accent`, `--c-warn`, `--divider-color`, `--s`…`--s4`,
  `--card-border-radius`, `--whiteframe-shadow-*`, `--font-primary-stack`, `--is-dark-theme`).
  Set `"uiKit": false` to opt out of the reset.
- `plugin.js` runs in the app renderer via `new Function`, and iframes are same-origin
  (`allow-same-origin`) — neither is a security sandbox.
- Node access only through `executeNodeScript` (permission `nodeExecution`, native consent prompt,
  call it inside `plugin.onReady`).
- Iframe plugins can call `executeNodeScript` too — it is proxied through the host bridge once the
  permission is granted. The Electron executor has two tiers: a VM sandbox for scripts whose only
  `require()`s are `fs`, `path`, `os` (5 s timeout, no `child_process`/`eval`/`spawn`/`Function`
  tokens), and a spawned Node process (default 30 s, max 300 s) for everything else. Prefer the
  safe subset — reading local files needs only `fs`.
  **The safe tier is a bare VM context: only `require('fs'|'path'|'os')`, `console`, `JSON` and
  `args` exist — no `Buffer`, no `process`, no `setTimeout`.** Use string APIs and `/proc/<pid>`
  checks there; anything that needs `Buffer`/`process` must include `child_process` (or another
  denied token) to be routed to the spawned tier on purpose.
- Useful local integration point: the Pi `pi-hermes-memory` extension stores memory at
  `~/.pi/agent/pi-hermes-memory/MEMORY.md` (global), `~/.pi/agent/projects-memory/<project>/MEMORY.md`
  (per project; entries separated by a `§` line) and an FTS5 index in
  `~/.pi/agent/pi-hermes-memory/sessions.db` (`memories`, `messages`).
