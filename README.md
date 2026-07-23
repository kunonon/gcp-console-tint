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

All package-manager and runtime work happens inside the Docker container. Make shortcuts:

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

With the stack running:

```sh
docker compose exec dev pnpm test       # Vitest suite
docker compose exec dev pnpm compile    # TypeScript typecheck (tsc --noEmit)
docker compose exec dev pnpm lint       # Biome (lint + format check)
docker compose exec dev pnpm lint:fix   # Biome with autofixes
docker compose exec dev pnpm build      # production build (add :firefox for Firefox)
```

If dev-mode styles look stale after larger edits, restart the server: `docker compose restart dev` (the dev side panel loads a pre-render chunk that is fixed at server start).

## CI

GitHub Actions runs on every pull request and push to `main`: Biome lint, typecheck, the Vitest suite, and both browser builds, executed as a parallel step group. Commits on `develop` are validated by the pull-request runs (feature PRs, and the release PR whose head is `develop`), so there is no separate develop push run. CodeQL code scanning (GitHub default setup: JavaScript/TypeScript and Actions workflows) runs independently on pushes and pull requests.

## Branching and releases

`develop` is the default branch. Feature work is PRed into `develop` (squash merges are fine there).

Every merge into `develop` automatically creates or updates a release PR (`develop` → `main`) listing the changes since the last release.

To ship a release:

1. If needed, merge a version-bump PR (bumping `version` in `package.json`) into `develop`.
2. On the release PR, click **Approve and run** on its held CI run (bot-opened PRs are held with `action_required` until a maintainer approves the run) and wait for green. The required version bump check fails here if step 1 was skipped.
3. Approve the release PR (the `main` ruleset requires one approving review, and approvals reset whenever `develop` moves), then merge it using **Create a merge commit** — the only method the `main` ruleset allows, since squashing would break the invariant that `develop`'s history is a superset of `main`'s.

Merging the release PR triggers CI to tag `v{version}`, build the Chrome and Firefox zips, and publish a GitHub Release with generated notes and the zips attached.

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
  entrypoints/
    content.ts    # applies the tint on console.cloud.google.com
    background.ts # opens the side panel / sidebar on toolbar-icon click
    sidepanel/    # React settings UI
  components/     # shared UI (pickers, add-rule modal, confirm popover)
  utils/          # settings schema/matching, color math, version compare
  types.ts        # settings data model
```

Settings are stored in `browser.storage.local` under a versioned schema; while the project is pre-release, older stored shapes may be read destructively instead of migrated.
