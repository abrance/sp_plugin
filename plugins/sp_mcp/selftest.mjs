#!/usr/bin/env node
/**
 * Self-check for the sp_mcp bridge without Super Productivity.
 *
 * It proves the parts that can be proven off-device:
 *   1. the host scripts run in a VM sandbox that only has `require(fs|path|os)`,
 *      `args`, `JSON` and `console` — the surface the real VM tier gives — so a
 *      `Buffer`/`process`/timer mistake fails here instead of on device;
 *   2. a command file written by the agent is drained, executed against a fake
 *      plugin API and answered with a response file plus a heartbeat;
 *   3. the agent-side queue turns a missing plugin into a `plugin-down` error
 *      and a silent plugin into a `timeout` error;
 *   4. every MCP tool maps to a real plugin action;
 *   5. the host-side loop (plugin.js) drains the queue on its own — no panel —
 *      and stays idle when the panel's switch is off.
 *
 *   node selftest.mjs
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const nodeRequire = createRequire(import.meta.url);

const { ACTIONS } = await import('./src/lib/actions.ts');
const { DRAIN_SCRIPT, COMMIT_SCRIPT, STAT_SCRIPT } = await import('./src/lib/scripts.ts');
const { createHostBridge, readHostConfig } = await import('./src/host/bridge.ts');
const { CONFIG_DEFAULTS } = await import('./src/lib/config-core.ts');
const { TOOLS } = await import('./bridge/src/tools.ts');
const { CommandQueue, BridgeError } = await import('./bridge/src/queue.ts');

/**
 * Mirrors the host's VM tier (`electron/plugin-node-executor.js`): the script
 * body runs inside an IIFE so a top-level `return` is legal, and the only
 * globals are require(fs|path|os), args, JSON and console.
 */
function sandbox(script, args) {
  const context = vm.createContext({
    require: (name) => {
      if (!['fs', 'path', 'os'].includes(name)) throw new Error(`sandbox denied require('${name}')`);
      return nodeRequire(name);
    },
    args,
    JSON,
    console: { log() {}, error() {}, warn() {} },
  });
  return vm.runInContext(`(function() {${script}\n})()`, context, { timeout: 5000 });
}

function fakeApi() {
  const now = Date.now();
  const tasks = [
    {
      id: 't1',
      title: 'Write the plugin',
      notes: 'docs first',
      timeEstimate: 3_600_000,
      timeSpent: 0,
      isDone: false,
      projectId: 'P1',
      tagIds: [],
      parentId: null,
      created: now,
      subTaskIds: [],
      timeSpentOnDay: {},
    },
  ];
  const projects = [
    { id: 'P1', title: 'Inbox', theme: {}, taskIds: ['t1'], backlogTaskIds: [], noteIds: [] },
  ];
  const tags = [
    { id: 'TODAY', title: 'Today', color: null, taskIds: [], created: now, theme: {}, advancedCfg: {} },
  ];
  const dispatched = [];
  let seq = 0;

  return {
    state: { tasks, projects, tags, dispatched },
    api: {
      getTasks: async () => tasks,
      getArchivedTasks: async () => tasks.filter((t) => t.isDone),
      getAllProjects: async () => projects,
      getAllTags: async () => tags,
      addTask: async (data) => {
        const id = `new${++seq}`;
        const parent = data.parentId ? tasks.find((t) => t.id === data.parentId) : null;
        tasks.push({
          ...data,
          id,
          timeSpent: 0,
          isDone: false,
          created: Date.now(),
          subTaskIds: [],
          // Mirrors SP core: a subtask is created with no tags and the parent's project.
          tagIds: parent ? [] : (data.tagIds ?? []),
          projectId: parent ? parent.projectId : data.projectId,
        });
        return id;
      },
      updateTask: async (id, updates) => {
        const task = tasks.find((t) => t.id === id);
        if (!task) throw new Error(`no task ${id}`);
        Object.assign(task, updates);
      },
      deleteTask: async (id) => {
        const index = tasks.findIndex((t) => t.id === id);
        if (index < 0) throw new Error(`no task ${id}`);
        tasks.splice(index, 1);
      },
      addProject: async (data) => {
        const id = `P${projects.length + 1}`;
        projects.push({
          id,
          title: data.title,
          theme: data.theme ?? {},
          taskIds: [],
          backlogTaskIds: [],
          noteIds: [],
        });
        return id;
      },
      updateProject: async (id, updates) =>
        Object.assign(
          projects.find((p) => p.id === id) ?? {},
          updates,
        ),
      deleteProject: async (id) => {
        const index = projects.findIndex((p) => p.id === id);
        if (index < 0) throw new Error(`no project ${id}`);
        projects.splice(index, 1);
      },
      addTag: async (data) => {
        const id = `tag${tags.length}`;
        tags.push({
          id,
          title: data.title,
          color: data.color ?? null,
          taskIds: [],
          created: Date.now(),
          theme: {},
          advancedCfg: {},
        });
        return id;
      },
      updateTag: async (id, updates) =>
        Object.assign(tags.find((t) => t.id === id) ?? {}, updates),
      reorderTasks: async () => undefined,
      showSnack: () => undefined,
      dispatchAction: (action) => dispatched.push(action),
    },
  };
}

const passed = [];
const check = (name) => passed.push(name);

const dir = await mkdtemp(path.join(tmpdir(), 'sp-mcp-selftest-'));
const dirs = {
  root: dir,
  commands: path.join(dir, 'commands'),
  responses: path.join(dir, 'responses'),
  state: path.join(dir, 'state'),
};

try {
  // 1. VM-tier safety of every host script
  sandbox(STAT_SCRIPT, [dir]);
  sandbox(DRAIN_SCRIPT, [dir]);
  check('host scripts run with only fs/path/os, args, JSON and console');

  // 2. command -> action -> response -> heartbeat
  const { api, state } = fakeApi();
  const command = {
    id: 'req-1',
    action: 'create_task',
    args: { title: 'from the agent', plan_today: true, due_day: '2026-11-20' },
    issuedAt: Date.now(),
  };
  await mkdir(dirs.commands, { recursive: true });
  await writeFile(path.join(dirs.commands, 'req-1.json'), JSON.stringify(command), 'utf8');

  const drained = sandbox(DRAIN_SCRIPT, [dir]);
  assert.equal(drained.commands.length, 1, 'drain returns the pending command');
  assert.equal(drained.commands[0].cmd.action, 'create_task');

  const startedAt = Date.now();
  const actionCtx = { api, getCurrentTaskId: () => null, log: () => undefined };
  const result = await ACTIONS[command.action](command.args, actionCtx);
  const finishedAt = Date.now();
  const response = {
    id: command.id,
    action: command.action,
    ok: true,
    result,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
  };
  const heartbeat = {
    protocol: 1,
    pluginVersion: '0.1.0',
    updatedAt: Date.now(),
    pollMs: 800,
    enabled: true,
    currentTaskId: null,
    lastAction: command.action,
    lastError: null,
    stats: { processed: 1, errors: 0, expired: 0 },
  };

  sandbox(COMMIT_SCRIPT, [
    dir,
    [{ id: command.id, commandFile: drained.commands[0].file, response }],
    heartbeat,
  ]);

  const written = JSON.parse(await readFile(path.join(dirs.responses, 'req-1.json'), 'utf8'));
  assert.equal(written.ok, true);
  assert.equal(state.tasks.length, 2, 'task was created');
  assert.equal(state.tasks[1].dueDay, '2026-11-20');
  assert.equal(state.dispatched[0].type, '[Task Shared] planTasksForToday');
  check('command → plugin action → response → heartbeat round trip');

  // 2b. subtask create keeps the fields SP core would drop
  const parentId = state.tasks[1].id;
  const sub = await ACTIONS.create_task(
    {
      title: 'subtask with tags',
      parent_id: parentId,
      tag_names: ['Today'],
      time_estimate: 1_800_000,
    },
    actionCtx,
  );
  const subTask = state.tasks.find((t) => t.id === sub.id);
  assert.deepEqual(subTask.tagIds, ['TODAY'], 'subtask keeps the tags it asked for');
  assert.equal(subTask.projectId, state.tasks[1].projectId, 'subtask follows the parent project');
  assert.equal(subTask.timeEstimate, 1_800_000, 'subtask keeps its estimate');
  check('subtask create keeps tagIds, parent project and timeEstimate');

  // 2c. delete_project reports the cascade before removing the project
  await assert.rejects(
    ACTIONS.delete_project({ project_id: 'nope' }, actionCtx),
    /project nope not found/,
  );
  const del = await ACTIONS.delete_project({ project_id: 'P1' }, actionCtx);
  assert.equal(del.deleted, 'P1');
  assert.equal(del.tasksMoved, 1, 'cascade count comes from the project payload');
  assert.equal(state.projects.length, 0, 'project is gone');
  check('delete_project reports cascade counts and rejects unknown ids');

  assert.equal(sandbox(DRAIN_SCRIPT, [dir]).commands.length, 0, 'consumed command file is gone');
  assert.equal(sandbox(STAT_SCRIPT, [dir]).pluginState?.pluginVersion, '0.1.0');
  check('command file removed, heartbeat readable');

  // 3. agent-side failure modes
  const queue = new CommandQueue(dirs, { timeoutMs: 400 });
  await assert.rejects(queue.call('get_tasks', {}), (error) => {
    assert.ok(error instanceof BridgeError);
    assert.equal(error.code, 'timeout');
    return true;
  });
  check('silent plugin → timeout error, command dropped');

  const coldDir = await mkdtemp(path.join(tmpdir(), 'sp-mcp-cold-'));
  const cold = new CommandQueue({
    root: coldDir,
    commands: path.join(coldDir, 'commands'),
    responses: path.join(coldDir, 'responses'),
    state: path.join(coldDir, 'state'),
  });
  await assert.rejects(cold.call('get_tasks', {}), (error) => {
    assert.equal(error.code, 'plugin-down');
    assert.match(error.message, /has never polled/);
    return true;
  });
  await rm(coldDir, { recursive: true, force: true });
  check('missing plugin → plugin-down with a fixable message');

  // 4. tool list ↔ action table
  const missing = TOOLS.filter((tool) => !tool.local && !ACTIONS[tool.action]).map((tool) => tool.name);
  assert.deepEqual(missing, [], `tools without an action handler: ${missing.join(', ')}`);
  check(`all ${TOOLS.length} MCP tools map to a plugin action`);

  // 5. host-side loop: owns polling, needs no panel, honours the switch
  const fresh = await readHostConfig(async () => null);
  assert.equal(fresh.bridgeDir, CONFIG_DEFAULTS.bridgeDir, 'fresh install falls back to defaults');
  assert.equal(fresh.enabled, true);

  const hostDir = await mkdtemp(path.join(tmpdir(), 'sp-mcp-host-'));
  await mkdir(path.join(hostDir, 'commands'), { recursive: true });
  const hostConfig = JSON.stringify({ bridgeDir: hostDir, pollMs: 300 });
  const hostEnv = (loadConfig) => ({
    version: '0.2.0',
    api: () => fakeApi().api,
    runNode: async (script, args) => sandbox(script, args),
    loadConfig,
    superviseMs: 60_000,
  });

  const hostBridge = createHostBridge(hostEnv(async () => hostConfig));
  await writeFile(
    path.join(hostDir, 'commands', 'host-1.json'),
    JSON.stringify({ id: 'host-1', action: 'ping', args: {}, issuedAt: Date.now() }),
    'utf8',
  );
  await hostBridge.pump();
  const hostResponse = JSON.parse(
    await readFile(path.join(hostDir, 'responses', 'host-1.json'), 'utf8'),
  );
  assert.equal(hostResponse.ok, true, 'host loop executed the queued command');
  const hostState = sandbox(STAT_SCRIPT, [hostDir]).pluginState;
  assert.equal(hostState.pluginVersion, '0.2.0');
  assert.ok(Date.now() - hostState.updatedAt < 5000, 'host loop wrote a fresh heartbeat');
  hostBridge.stop();

  const paused = createHostBridge(
    hostEnv(async () => JSON.stringify({ bridgeDir: hostDir, enabled: false })),
  );
  await writeFile(
    path.join(hostDir, 'commands', 'paused-1.json'),
    JSON.stringify({ id: 'paused-1', action: 'ping', args: {}, issuedAt: Date.now() }),
    'utf8',
  );
  await paused.start();
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(paused.runner.snapshot().running, false, 'switch off → host loop idle');
  assert.ok(
    existsSync(path.join(hostDir, 'commands', 'paused-1.json')),
    'switch off → queued command left untouched',
  );
  paused.stop();
  await rm(hostDir, { recursive: true, force: true });
  check('host-side loop drains the queue without a panel and obeys the panel switch');

  console.log(`[selftest] ${passed.length} checks passed (node ${process.version})`);
  for (const line of passed) console.log(`  ✓ ${line}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
