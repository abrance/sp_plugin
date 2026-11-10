# sp_plugin

Personal [Super Productivity](https://github.com/super-productivity/super-productivity) plugin
monorepo. Every plugin here targets the **latest** Super Productivity release and is tuned to run
on this machine only — no backward compatibility with older app versions.

Plugins are built with SolidJS, bundled into a single self-contained `index.html`, and shipped as a
zip you install through the app's plugin screen.

## Plugins

| Plugin | What it does |
| ------ | ------------ |
| [`base-ai-bot`](plugins/base-ai-bot) | OpenAI-compatible chat assistant that creates, updates, plans, tags, completes and time-tracks tasks, and renders 日报 / 周报 / 月度总结 reports. Optional read-only access to the local Pi memory (`pi-hermes-memory`) via `nodeExecution`. |

## Layout

```
plugins/<plugin-id>/     one directory per plugin (SolidJS + Vite, single-file build)
packages/plugin-kit/     shared source-only helpers: SP API types, synced storage, local secrets, logger
scripts/build.mjs        build + package plugins into release/*.zip
scripts/release.mjs      create GitHub releases for new manifest versions
docs/                    plugin API digest for the targeted app version, dev workflow
```

## Requirements

- Node 20+, pnpm 10
- Super Productivity desktop app (the API surface here is pinned to **19.2.0**)
- `zip` binary for packaging

## Quick start

```bash
pnpm install
pnpm build                 # builds every plugin → release/<id>-<version>.zip
pnpm build:all             # same thing, explicit
node scripts/build.mjs base-ai-bot   # build a single plugin
pnpm dev                   # vite dev server for base-ai-bot (browser, no host API)
pnpm typecheck             # tsc over all workspaces
```

Install a build:

1. Super Productivity → **Settings → Plugins**
2. **Install from file** (or "Choose plugin file")
3. Pick `release/<id>-<version>.zip`
4. Enable the plugin; it appears in the right side panel

Plugins are stored inside the app's own profile (IndexedDB/localStorage), so there is no "install
from directory" shortcut — rebuilding always means re-uploading the zip.

## Adding a plugin

```bash
mkdir -p plugins/my-plugin/src
cd plugins/my-plugin
```

`manifest.json` (see [docs/sp-19-plugin-api.md](docs/sp-19-plugin-api.md) for the full field list):

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "manifestVersion": 1,
  "minSupVersion": "19.2.0",
  "description": "What it does",
  "icon": "icon.svg",
  "iFrame": true,
  "sidePanel": true,
  "hooks": [],
  "permissions": ["getTasks", "showSnack"]
}
```

`package.json` — copy from `plugins/base-ai-bot/package.json`, change `name`.

`vite.config.ts` — copy verbatim; it wires the Solid plugin and the single-file inliner.

`index.html` — the Vite entry:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>My Plugin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/index.tsx"></script>
  </body>
</html>
```

`src/index.tsx`:

```tsx
import { waitForApi } from '@sp/plugin-kit';
import { render } from 'solid-js/web';
import { onMount } from 'solid-js';

function App() {
  onMount(async () => {
    const api = await waitForApi();
    const tasks = await api.getTasks();
    api.showSnack({ msg: `${tasks.length} tasks`, type: 'INFO' });
  });
  return <div>Hello from my plugin</div>;
}

render(() => <App />, document.getElementById('root')!);
```

Then `node scripts/build.mjs my-plugin` and upload the zip.

A plugin that needs callback registrations (`registerHeaderButton`, `registerMenuEntry`,
`registerShortcut`, `registerTaskContextMenuEntry`, `registerConfigHandler`) must also ship a
host-side `plugin.js`; the iframe cannot make those calls. `scripts/build.mjs` copies `plugin.js`
into the package automatically when it exists.

## Releasing

Bump `version` in the plugin's `manifest.json`, commit, push to `main`. The
[release workflow](.github/workflows/release.yml) typechecks, builds, and creates a
`<plugin-id>-v<version>` GitHub release with the zip attached for every version that has no tag yet.

Locally:

```bash
node scripts/build.mjs --all
node scripts/release.mjs --dry-run   # what would be released
node scripts/release.mjs             # needs gh CLI + GH_TOKEN
```

## Notes

- Plugin data written with `persistDataSynced` is synced/exported; secrets (API keys) are kept on
  device only. Iframe plugins have no host secret API in 19.2.0, so `base-ai-bot` stores its key in
  `localStorage` via `@sp/plugin-kit`'s `setSecret`.
- Bump `minSupVersion` together with the vendored types in
  `packages/plugin-kit/src/types.ts` when the app's plugin API changes.
