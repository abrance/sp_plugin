#!/usr/bin/env node
/**
 * Creates one GitHub release per plugin whose manifest version has no
 * `<plugin-id>-v<version>` tag yet, uploading the built zip from `release/`.
 *
 * Expects `node scripts/build.mjs` to have produced `release/packages.json`.
 * Requires the `gh` CLI and a token with `contents: write`.
 *
 *   node scripts/release.mjs --dry-run
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesPath = path.join(repoRoot, 'release', 'packages.json');
const dryRun = process.argv.includes('--dry-run');

const log = (...args) => console.log('[release]', ...args);

async function sh(cmd, args, options = {}) {
  const { stdout } = await execFileAsync(cmd, args, { cwd: repoRoot, ...options });
  return stdout.trim();
}

async function tagExists(tag) {
  try {
    await sh('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);
    return true;
  } catch {
    return false;
  }
}

function releaseBody(pkg) {
  return [
    `## ${pkg.name} v${pkg.version}`,
    '',
    '### Install',
    '1. Download the zip below.',
    '2. Super Productivity → Settings → Plugins → Install from file.',
    '3. Pick the zip. Plugin id: `' + pkg.id + '`.',
    '',
    '### Integrity',
    '```',
    `${pkg.sha256}  ${pkg.zip}`,
    '```',
  ].join('\n');
}

async function main() {
  if (!existsSync(packagesPath)) {
    throw new Error('release/packages.json missing — run node scripts/build.mjs first');
  }
  const { packages } = JSON.parse(await readFile(packagesPath, 'utf8'));
  const created = [];

  for (const pkg of packages) {
    const tag = `${pkg.id}-v${pkg.version}`;
    const zipPath = path.join(repoRoot, 'release', pkg.zip);

    if (await tagExists(tag)) {
      log(`${pkg.id} v${pkg.version}: tag ${tag} exists, skipping`);
      continue;
    }
    if (!existsSync(zipPath)) {
      log(`${pkg.id} v${pkg.version}: missing ${pkg.zip}, skipping`);
      continue;
    }
    if (dryRun) {
      log(`${pkg.id} v${pkg.version}: would create release ${tag} with ${pkg.zip}`);
      created.push(tag);
      continue;
    }

    await sh('gh', [
      'release',
      'create',
      tag,
      zipPath,
      '--title',
      `${pkg.name} v${pkg.version}`,
      '--notes',
      releaseBody(pkg),
    ]);
    log(`${pkg.id} v${pkg.version}: released as ${tag}`);
    created.push(tag);
  }

  if (created.length === 0) log('nothing to release');
}

await main().catch((error) => {
  console.error('[release] FAILED:', error.message);
  process.exit(1);
});
