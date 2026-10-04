# GCP Console Tint

A browser extension (Chrome MV3 / Firefox MV2) that tints parts of the [Google Cloud Console](https://console.cloud.google.com/) per project, so you always know at a glance which project you are looking at. Built with [WXT](https://wxt.dev/), React, and HeroUI.

## Features

- **Per-project rules** — matched against the console URL's `?project=` parameter with four match types: *Starts with*, *Ends with*, *Exact* (literal string comparisons), or *Regex* (must match the entire project id). Rules are an ordered list: the first match wins, drag the grip to reprioritize, and when nothing matches, nothing is tinted.
- **Tinted surfaces**
  - A fixed bar along the top edge (height 1–40px, optional diagonal stripes)
  - The platform bar background (`#ocb-platform-bar`), optional stripes
  - The platform bar text color (descendants of `.cfc-platform-bar-left` / `.cfc-platform-bar-right` / `.pcc-platform-bar-button`), with an auto mode that picks black or white by WCAG contrast against the platform bar color
- **Per-project color palette** — named color entries that the pickers reference; change a palette color once and every surface using it follows.
- **Live updates** — settings apply immediately via `storage.onChanged`, and the tint follows the console's SPA project switches without a reload, with a short crossfade (disabled under `prefers-reduced-motion`).
- **Export / import** — the Settings tab saves every rule (with its palette and colors) to a JSON file, as stored once pending changes have been written, and imports rules back from one: pick the rules to take, and a rule with the same match type and pattern as an existing one replaces that rule in place instead of being added.

## Usage

Click the toolbar icon: the settings open in the side panel (Chrome) or sidebar (Firefox), so you can adjust colors while the console stays visible.

## Install

- **Chrome**: install from the [Chrome Web Store](https://chromewebstore.google.com/detail/gcp-console-tint/kaekepkbdapagaiikdbhdlkbefoepghi).
- **Firefox**: not published to AMO yet — build from source below.

### Build from source

Build inside Docker (no Node or pnpm needed on the host):

```sh
docker compose run --rm dev sh -c "corepack enable && pnpm install && pnpm build"          # Chrome  → .output/chrome-mv3
docker compose run --rm dev sh -c "corepack enable && pnpm install && pnpm build:firefox"  # Firefox → .output/firefox-mv2
```

- **Chrome**: `chrome://extensions` → enable Developer mode → *Load unpacked* → select `.output/chrome-mv3`
- **Firefox**: `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* → select `.output/firefox-mv2/manifest.json`

## Development

Local dependency installation and the development server run inside Docker. Browser end-to-end tests use a separate Linux container so Chrome and Firefox run in a consistent environment. Make shortcuts:

```sh
make up      # start the dev stack in the background (docker compose up -d)
make down    # stop it
make export  # production Chrome zip (Web Store submittable) into .output/
```

Or run compose directly:

```sh
docker compose up
```

This installs dependencies and starts the WXT dev server (HMR on port 3000). Load `.output/chrome-mv3-dev` as an unpacked extension to develop against the live build.

The container keeps its `node_modules` in a named Docker volume (`node_modules`), separate from any `node_modules` a host-side `pnpm install` may have created: pnpm installs the native binaries (lightningcss, rolldown, Biome, TypeScript, Tailwind's oxide) for one platform only, so sharing a single directory between macOS and the Linux container breaks whichever side installed second. `docker compose down -v` removes this project’s Compose named volumes, including the separate E2E dependency and build volumes; the next `make up` reinstalls the dev dependencies.

With the stack running:

```sh
docker compose exec dev pnpm test       # Vitest suite
docker compose exec dev pnpm compile    # TypeScript typecheck (tsc --noEmit)
docker compose exec dev pnpm lint       # Biome (lint + format check)
docker compose exec dev pnpm lint:fix   # Biome with autofixes
docker compose exec dev pnpm build      # production build (add :firefox for Firefox)
```

### Browser extension tests

The WebdriverIO tests load the production Chrome and Firefox extensions against a local HTTPS Google Cloud Console mock. They do not require a Google account. Run both browsers with:

```sh
docker compose --profile e2e run --rm --build e2e
```

The service installs dependencies, builds both extension artifacts, and runs the browsers under Xvfb. Use `docker compose --profile e2e run --rm --build -e E2E_BROWSER=chrome e2e` or the same command with `E2E_BROWSER=firefox` to select one browser. If pnpm is already available on the host, `pnpm test:e2e`, `pnpm test:e2e:chrome`, and `pnpm test:e2e:firefox` are optional launchers for those Compose runs; host dependency installation is unnecessary. Browser binaries and dependencies use dedicated Docker volumes, separate from the development container and host `node_modules`. Failed runs retain screenshots and startup diagnostics in `.e2e-artifacts/`; successful harness runs remove their own artifacts.

See [E2E coverage and scope](e2e/README.md) for the scenarios and browser-coverage limits.

If dev-mode styles look stale after larger edits, restart the server: `docker compose restart dev` (the dev side panel loads a pre-render chunk that is fixed at server start).

Dependency updates sit behind a one-week cooldown: `minimumReleaseAge` in `pnpm-workspace.yaml` makes pnpm resolve only versions published at least 7 days ago (transitive dependencies included), so a compromised release that gets pulled within hours never lands in the lockfile. pnpm applies the same check to the versions already in `pnpm-lock.yaml` on every install, so a lockfile that carries a younger version (for example from a dependency PR resolved elsewhere) fails to install — in CI and in the dev container — until that version is a week old. For an urgent fix, add the package to `minimumReleaseAgeExclude` in the same file.

## CI

GitHub Actions runs on every pull request and push to `main`: Biome lint, typecheck, the Vitest suite, and both browser builds run as a parallel step group, followed by the Chrome and Firefox extension end-to-end tests. On failure, the workflow uploads only the E2E screenshots and startup diagnostics. Commits on `develop` are validated by the pull-request runs (feature PRs, and the release PR whose head is `develop`), so there is no separate develop push run. CodeQL code scanning (GitHub default setup: JavaScript/TypeScript and Actions workflows) runs independently on pushes and pull requests.

## Branching and releases

`develop` is the default branch. Feature work is PRed into `develop` (squash merges are fine there).

Every merge into `develop` automatically creates or updates a release PR (`develop` → `main`) listing the changes since the last release.

To ship a release:

1. If needed, merge a version-bump PR (bumping `version` in `package.json`) into `develop`.
2. On the release PR, click **Approve and run** on its held CI run (bot-opened PRs are held with `action_required` until a maintainer approves the run) and wait for green. The required version bump check fails here if step 1 was skipped.
3. Approve the release PR (the `main` ruleset requires one approving review, and approvals reset whenever `develop` moves), then merge it using **Create a merge commit** — the only method the `main` ruleset allows, since squashing would break the invariant that `develop`'s history is a superset of `main`'s.

The merge starts the separate `Release` workflow on the push to `main`. It tags `v{version}`, builds the Chrome and Firefox zips, and publishes a GitHub Release with generated notes and the zips attached; it does not depend on the main-push CI run or its result.

Store submission is a separate, manual step: publishing to the Chrome Web Store (or AMO) happens independently of the GitHub Release and on its own timing.

One thing worth knowing:

- Required status checks are bound to CI job names: `Lint, typecheck, test, build` (required on `develop` and `main`) and `Version bump check (release PRs)` (required on `main`). Renaming those jobs requires updating the branch rulesets to match.

### Release notes and labels

Release notes are generated from merged PRs and categorized by PR label (config in `.github/release.yml`). Labels are applied automatically from the conventional-commit title prefix by `label-pr.yml`:

| Title prefix | Label | Notes category |
|---|---|---|
| `feat:` | `enhancement` | 🚀 Features |
| `fix:` | `bug` | 🐛 Bug Fixes |
| `docs:` | `documentation` | 📖 Documentation |
| `ci:` / `build:` | `ci` | 🧰 Maintenance |
| `chore:` / `refactor:` / `test:` / `perf:` / `style:` | `maintenance` | 🧰 Maintenance |

Dependabot PRs keep Dependabot's own `dependencies` label (📦 Dependencies). PRs without a recognized prefix land under "Other Changes".

### Rolling back a release

Release tags are immutable — a tag ruleset blocks moving or deleting `v*` tags for everyone, including admins — so a bad release is rolled forward, not back: fix on `develop`, bump the version, and ship the next release. In a genuine emergency, an admin can temporarily disable the ruleset under Settings → Rules, operate, and re-enable it.

## Project layout

```
src/
  port/           # interfaces (SettingsStore: the persistence boundary)
  adapter/
    in/             # driving side: WXT entrypoints, React UI, hooks
      entrypoints/
        content.ts    # applies the tint on console.cloud.google.com
        background.ts # opens the side panel / sidebar on toolbar-icon click
        sidepanel/    # React settings UI, incl. its components/
      hooks/          # settings state + persistence for the side panel
    out/            # driven side: browser.storage store + settings repository
                    # (Zod schemas of the persisted JSON, toDomain/toStored mapping)
  domain/           # pure core: immutable entities/VOs per concept (Color, Palette,
                    # ProjectSettings, ProjectRule, TintSettings); no framework or
                    # library imports, base/ holds the Entity/ValueObject classes
  utils/            # dependency-free helpers shared across layers (assertNever)
```

Settings are stored in `browser.storage.local` as versioned JSON. Storage saves use the running extension release version, floored at `CURRENT_SCHEMA_VERSION`; exported files use `CURRENT_SCHEMA_VERSION` to identify their data shape. Releases with the same shape therefore export files an earlier release can import.

A shape change must include a migration whose `to` and `CURRENT_SCHEMA_VERSION` equal the first extension release that ships it, above every earlier release version. Import accepts stamps from `SCHEMA_MIN_VERSION` through the importing build's effective schema version ceiling and runs applicable migrations; a future schema stamp above that ceiling is refused. A file exported by older code may keep its release version stamp, so an older importer can still reject that legacy file even when its data shape is otherwise unchanged.
