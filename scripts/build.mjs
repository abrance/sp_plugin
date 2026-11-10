#!/usr/bin/env node
/**
 * Builds Super Productivity plugin packages.
 *
 *   node scripts/build.mjs              # build every plugin
 *   node scripts/build.mjs base-ai-bot  # build one plugin (dir name)
 *   node scripts/build.mjs --all
 *   node scripts/build.mjs --dev base-ai-bot   # vite dev server for one plugin
 *   node scripts/build.mjs --clean
 *
 * Output:
 *   plugins/<id>/dist/index.html        (single self-contained iframe page)
 *   release/<manifest-id>-<version>.zip (uploadable plugin package)
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = path.join(repoRoot, 'plugins');
const releaseDir = path.join(repoRoot, 'release');

const log = (...args) => console.log('[build]', ...args);

async function listPlugins() {
  const entries = await readdir(pluginsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

async function readManifest(dir) {
  const manifestPath = path.join(pluginsDir, dir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`${dir}: missing manifest.json`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const field of ['id', 'name', 'version', 'manifestVersion', 'minSupVersion']) {
    if (!manifest[field]) throw new Error(`${dir}: manifest.json missing "${field}"`);
  }
  if (!Array.isArray(manifest.hooks) || !Array.isArray(manifest.permissions)) {
    throw new Error(`${dir}: manifest.json needs "hooks" and "permissions" arrays`);
  }
  return manifest;
}

async function runVite(pluginDir, mode) {
  const { build } = await import('vite');
  await build({
    root: pluginDir,
    mode,
    logLevel: 'warn',
  });
}

async function runViteDev(pluginDir) {
  const { createServer } = await import('vite');
  const server = await createServer({ root: pluginDir, configFile: path.join(pluginDir, 'vite.config.ts') });
  await server.listen();
  server.printUrls();
}

/** Files beside the built `index.html` that ship inside the zip. */
async function packagePlugin(dir) {
  const pluginDir = path.join(pluginsDir, dir);
  const manifest = await readManifest(dir);
  const distDir = path.join(pluginDir, 'dist');

  await runVite(pluginDir, 'production');

  const indexPath = path.join(distDir, 'index.html');
  if (!existsSync(indexPath)) throw new Error(`${dir}: vite build produced no dist/index.html`);

  const shipped = [];
  const copyIfExists = async (name) => {
    const from = path.join(pluginDir, name);
    if (!existsSync(from)) return;
    await cp(from, path.join(distDir, name));
    shipped.push(name);
  };

  await copyIfExists('manifest.json');
  for (const asset of manifest.assets ?? []) await copyIfExists(asset);
  if (manifest.icon) await copyIfExists(manifest.icon);
  if (existsSync(path.join(pluginDir, 'plugin.js'))) await copyIfExists('plugin.js');
  if (existsSync(path.join(pluginDir, 'README.md'))) await copyIfExists('README.md');

  const files = ['index.html', ...shipped];
  await mkdir(releaseDir, { recursive: true });
  const zipName = `${manifest.id}-${manifest.version}.zip`;
  const zipPath = path.join(releaseDir, zipName);
  await rm(zipPath, { force: true });
  await execFileAsync('zip', ['-q', '-r', zipPath, ...files], { cwd: distDir });

  const buffer = await readFile(zipPath);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const sizeKb = (buffer.length / 1024).toFixed(1);

  return { manifest, zipName, zipPath, sha256, sizeKb, files };
}

async function clean() {
  const dirs = await listPlugins();
  for (const dir of dirs) {
    await rm(path.join(pluginsDir, dir, 'dist'), { recursive: true, force: true });
  }
  await rm(releaseDir, { recursive: true, force: true });
  log('cleaned dist/ and release/');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--clean')) {
    await clean();
    if (args.length === 1) return;
  }

  const devIndex = args.indexOf('--dev');
  if (devIndex !== -1) {
    const target = args[devIndex + 1];
    if (!target) throw new Error('--dev needs a plugin directory name');
    log(`dev server for ${target}`);
    await runViteDev(path.join(pluginsDir, target));
    return;
  }

  const positional = args.filter((a) => !a.startsWith('--'));
  const all = args.includes('--all') || positional.length === 0;
  const targets = all ? await listPlugins() : positional;

  if (targets.length === 0) {
    log('no plugins found');
    return;
  }

  let failed = false;
  const packages = [];
  for (const dir of targets) {
    try {
      const result = await packagePlugin(dir);
      packages.push({
        id: result.manifest.id,
        name: result.manifest.name,
        version: result.manifest.version,
        zip: result.zipName,
        sha256: result.sha256,
      });
      log(`${result.manifest.id} v${result.manifest.version} → release/${result.zipName} (${result.sizeKb} kB)`);
      log(`  files: ${result.files.join(', ')}`);
      log(`  sha256: ${result.sha256}`);
    } catch (error) {
      failed = true;
      console.error(`[build] ${dir} FAILED:`, error.message);
    }
  }

  await mkdir(releaseDir, { recursive: true });
  await writeFile(
    path.join(releaseDir, 'packages.json'),
    `${JSON.stringify({ packages }, null, 2)}\n`,
  );

  if (failed) process.exitCode = 1;
}

await main();
