# AGENTS.md

Guidance for coding agents working in this repo.

## What this repo is

A personal monorepo of [Super Productivity](https://github.com/super-productivity/super-productivity)
plugins. Target app version: **19.2.0** (desktop deb install on this machine). No backward
compatibility: bump `minSupVersion` when moving to a newer app release instead of adding shims.

## Ground truth

- `docs/sp-19-plugin-api.md` — API/allowlist/action-name digest for the pinned app version.
  Read it before adding plugin behaviour; most mistakes come from calling APIs the iframe does not
  expose or from guessing redux action payloads.
- `packages/plugin-kit/src/types.ts` — vendored API types for 19.2.0.
- `packages/plugin-kit/src/api.ts` — typed iframe API surface.

## Conventions

- One directory per plugin under `plugins/<manifest-id>/`; directory name == manifest `id`.
- SolidJS + TypeScript. No `className`, no destructuring props, no `React.*`.
- Shared code goes to `packages/plugin-kit` (source-only, imported via the `@sp/plugin-kit` alias).
- Iframe plugins must produce a single `index.html`; never import CSS/assets by URL at runtime.
- Keep `manifest.json` `hooks` and `permissions` honest — they are the user-facing permission story.
- Credentials: never in `persistDataSynced`. Use `setSecret` from the kit (localStorage-backed for
  iframes) or host-side `plugin.js` secrets.
- Plugin UI must use the injected theme variables (`var(--bg)`, `var(--c-primary)`, `...`) so light
  and dark themes both work.

## Commands

```bash
pnpm install
pnpm typecheck                              # tsc for every workspace
node scripts/build.mjs [plugin-dir]         # build + zip → release/<id>-<version>.zip
node scripts/build.mjs --dev <plugin-dir>   # vite dev server (no host API in the browser)
node scripts/release.mjs --dry-run          # which versions would get a GitHub release
```

## Verify before claiming done

1. `pnpm typecheck` clean.
2. `node scripts/build.mjs <plugin>` produces `release/<id>-<version>.zip`.
3. Built `plugins/<plugin>/dist/index.html` has no external `src=`/`href=` references to local
   files (everything inlined).
4. Any new API call appears in the iframe allowlist in `docs/sp-19-plugin-api.md`.

Manual install check (user action, cannot be automated): Settings → Plugins → Install from file →
pick the zip → enable → open the side panel and watch the devtools console.

## Release flow

Bump `version` in `manifest.json` → commit → push to `main`. CI typechecks, builds, and creates a
`<id>-v<version>` release with the zip. Never reuse a released version number.
