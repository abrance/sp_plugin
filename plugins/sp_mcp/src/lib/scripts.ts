/**
 * Host-side scripts passed to `executeNodeScript`.
 *
 * Hard constraints from SP 19.2.0 (`electron/plugin-node-executor.js`): a script
 * that only requires `fs` / `path` / `os` runs in a bare VM context with no
 * `Buffer`, no `process` and no timers. Everything here is therefore plain
 * string/JSON work, which also means no child process is spawned per poll.
 */

const PRELUDE = `
var fs = require('fs');
var path = require('path');
var os = require('os');
function root() {
  var raw = String(args[0] || '');
  if (raw === '~' || raw.slice(0, 2) === '~/') raw = os.homedir() + raw.slice(1);
  return raw;
}
function ensure(dir) { try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {} }
function writeAtomic(target, text) {
  var tmp = target + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, target);
}
`;

/** Reads every pending command and returns them with their absolute paths. */
export const DRAIN_SCRIPT = `${PRELUDE}
var dir = root();
var commandsDir = path.join(dir, 'commands');
var responsesDir = path.join(dir, 'responses');
var stateDir = path.join(dir, 'state');
ensure(commandsDir); ensure(responsesDir); ensure(stateDir);

var out = { dir: dir, commands: [], rejected: 0 };
var files = [];
try { files = fs.readdirSync(commandsDir); } catch (e) { files = []; }
for (var i = 0; i < files.length; i++) {
  var name = files[i];
  var full = path.join(commandsDir, name);
  if (!/\\.json$/.test(name)) {
    try { fs.unlinkSync(full); } catch (e) {}
    continue;
  }
  try {
    var raw = fs.readFileSync(full, 'utf8');
    if (!raw || raw.length > 262144) throw new Error('bad size');
    var cmd = JSON.parse(raw);
    if (!cmd || typeof cmd.id !== 'string' || typeof cmd.action !== 'string') throw new Error('bad shape');
    out.commands.push({ file: full, cmd: cmd });
  } catch (e) {
    out.rejected++;
    try { fs.unlinkSync(full); } catch (e2) {}
  }
}
return out;
`;

/**
 * Writes responses, deletes the consumed command files and refreshes the
 * heartbeat in a single host call.
 * args: [dir, [{ id, commandFile, response }], state]
 */
export const COMMIT_SCRIPT = `${PRELUDE}
var dir = root();
var entries = args[1] || [];
var state = args[2] || null;
var responsesDir = path.join(dir, 'responses');
ensure(responsesDir);
var written = 0;
for (var i = 0; i < entries.length; i++) {
  var entry = entries[i];
  writeAtomic(path.join(responsesDir, entry.id + '.json'), JSON.stringify(entry.response));
  written++;
  if (entry.commandFile) { try { fs.unlinkSync(entry.commandFile); } catch (e) {} }
}
if (state) {
  var statePath = path.join(dir, 'state', 'plugin.json');
  ensure(path.dirname(statePath));
  writeAtomic(statePath, JSON.stringify(state));
}
return { written: written, dir: dir };
`;

/** Directory inventory for the status panel; never throws on a missing dir. */
export const STAT_SCRIPT = `${PRELUDE}
var dir = root();
function count(sub) {
  try { return fs.readdirSync(path.join(dir, sub)).filter(function (n) { return /\\.json$/.test(n); }).length; }
  catch (e) { return -1; }
}
var pluginState = null;
try { pluginState = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'plugin.json'), 'utf8')); } catch (e) {}
var exists = false;
try { exists = fs.statSync(dir).isDirectory(); } catch (e) {}
return {
  dir: dir,
  exists: exists,
  commands: count('commands'),
  responses: count('responses'),
  pluginState: pluginState
};
`;
