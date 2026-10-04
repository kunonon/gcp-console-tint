# End-to-end tests

The WebdriverIO suite installs the built Chrome MV3 and Firefox MV2 extensions in separate browser profiles and drives them in Chrome and Firefox. The default Compose run builds both artifacts and runs the suite serially under Xvfb:

```sh
docker compose --profile e2e run --rm --build e2e
```

CI runs Chrome and Firefox in parallel with separate Compose project names, isolating their `node_modules`, `.wxt`, and `.output` volumes. Each CI container mounts the existing host pnpm store cache; local Compose behavior is unchanged. The default local command above remains serial. For parallel local runs, run these commands in separate terminals with different `--project-name` values:

```sh
docker compose --project-name e2e-chrome --profile e2e run --rm --build -e E2E_BROWSER=chrome e2e
docker compose --project-name e2e-firefox --profile e2e run --rm --build -e E2E_BROWSER=firefox e2e
```

To run one browser, add `-e E2E_BROWSER=chrome` or `-e E2E_BROWSER=firefox` before `e2e`. If pnpm is available on the host, the optional launchers are `pnpm test:e2e`, `pnpm test:e2e:chrome`, and `pnpm test:e2e:firefox`; the Compose command requires no host pnpm installation. Failed harness runs retain screenshots, page captures, and startup diagnostics under `.e2e-artifacts/`. Successful runs remove their own run directory, leaving earlier failures untouched. When the container runs as root, artifact ownership is restored to the mounted checkout's UID/GID so Linux users can inspect and remove their diagnostics.

## Browser versions and downloads

Local runs follow Chrome and Firefox `stable` at runtime by default. This catches compatibility changes in current browsers, but the same commit can fail after a browser or driver release. CI pins the browser and Geckodriver versions shown below; update those pins together with a successful both-browser run. These downloads are outside `pnpm-lock.yaml` and `minimumReleaseAge`. WebdriverIO does not supply an expected archive hash to the downloader; npm lockfile integrity does not verify these browser archives.

To use the CI browser and driver versions locally, pass the pinned overrides to Compose explicitly:

```sh
docker compose --profile e2e run --rm --build \
  -e E2E_CHROME_VERSION=154.0.8037.92 \
  -e E2E_FIREFOX_VERSION=stable_157.0 \
  -e GECKODRIVER_VERSION=0.37.1 e2e
```

ChromeDriver follows the resolved Chrome version. Firefox stable versions need the `stable_` prefix; a bare numeric Firefox build ID is interpreted as Nightly by the downloader. Geckodriver selects its own latest release unless `GECKODRIVER_VERSION` is supplied. The Docker base image and apt packages can still change, so these overrides do not freeze the entire container environment. Extension discovery uses Chrome's internal developer API and Firefox's internal UUID preference, which can change across browser versions.

The service currently targets `linux/amd64`. Apple Silicon hosts run it through x86 emulation, which can make local runs slower; native Linux arm64 execution of this suite has not been verified.

The parent-scoped `@wdio/utils>@puppeteer/browsers` override keeps `extract-zip` out of the dependency graph across WebdriverIO version updates. CI explicitly checks its absence. The override exceeds WebdriverIO's declared 2.x range, so retain both-browser E2E checks and review compatibility on dependency updates. Review this explicit pin manually; do not assume dependency update automation will update or remove it.

This service assumes direct network access for browser downloads. Host `HTTP_PROXY` / `HTTPS_PROXY` variables are not forwarded by default, and the selected Puppeteer downloader has no installed `proxy-agent` peer. Proxy-based browser and driver downloads are not supported or verified by this setup. The browser's local fixture proxy is configured separately and is unrelated to download proxy support.

## Execution and validation

Both browsers run with visible windows on Xvfb; Firefox pointer input depends on that display. The service sets `TZ=Asia/Tokyo`, and the export check fixes a time at which the local and UTC calendar dates differ. Reduced motion is requested explicitly by its separate suite so normal cases keep their transition checks.

The Node runner uses `--test-force-exit` because standalone WebdriverIO can leave browser/driver handles active. In particular, if session creation rejects after a driver starts, no browser object is returned to the harness for `deleteSession()`. `init: true` and the one-shot Compose container bound those processes to the container lifetime; forced exit is not proof that JavaScript cleanup completed. Assertions and awaited harness cleanup still determine the test result.

The `.mjs` harness and specs receive Biome lint and real browser execution; they are outside the application TypeScript check. The default Compose command always rebuilds both artifacts. `test:e2e:run` is an internal command: running it directly can reuse older build output whose manifest version still matches the checkout.

| Spec | Covered behavior |
| --- | --- |
| `smoke.e2e.mjs` | Installs and opens each built extension, reaches the local HTTPS fixture through the proxy, checks the expected untinted initial state, and verifies native panel opening. |
| `ui.e2e.mjs` | Adds rules in all four match modes; validates input, Enter, and Escape; edits, duplicates, reorders, and deletes rules; checks palette and surface controls, input bounds, all three palette-reference clears, and visible control values and swatches after reload. Exports a real JSON backup and checks its payload, schema version, and local-date filename; imports it into empty settings for a full round trip; and checks cancel, zero-selection, select-all/mixed selection, one-use replacement targets with excess duplicates appended under fresh IDs, and a full backup restoring distinct settings to two existing duplicate rules. Covers the six parser refusal reasons reachable in a build, with an invalid-field path; `migration-failed` needs a schema migration step and the repository defines none, so unit tests cover it. It also clicks **Copy details** and verifies the visible parser detail through clipboard paste. |
| `content.e2e.mjs` | Checks match precedence, exact and full-match regex behavior, missing/unmatched projects, origin boundaries, browser-observed HTTP handling, all eight surface enable combinations, palette resolution and fallback, targeted text descendants, stripes and fixed background alignment, automatic contrast, SPA push/replace/back/forward without a document reload, storage changes in two tabs, unrelated-key stability, extension reload with legacy, wholly corrupt, partly corrupt, current, and newer stored schemas, DOM replacement, and reduced-motion styles. The partly corrupt case retains raw storage while checking that invalid rules and palette entries are ignored and sanitized values render. |

## Scope and limits

The browser tests use a local HTTPS fixture served as `console.cloud.google.com` and `outside.example.test`. It has the small set of elements and SPA controls required by the tests; the proxy rejects other network targets. These tests do not exercise Google sign-in, live Console pages, Google's production DOM, or its real navigation implementation.

The settings screen is opened at the extension's `sidepanel.html` URL in a WebDriver tab. The smoke test separately verifies native opening: Firefox clicks the toolbar action and checks the browser sidebar's open state; Chrome checks `openPanelOnActionClick`, makes a trusted click on a button in the extension page to call `sidePanel.open`, and confirms a real `SIDE_PANEL` runtime context. It does not click Chrome's operating-system toolbar icon. Import uses WebDriver to provide a path to the actual file input, and export reads the downloaded file from the isolated test directory; native OS file-picker, permission, and download-prompt windows are outside the test boundary.

Firefox drag/drop coverage uses xdotool/XTest mouse input on the Xvfb display because Firefox WebDriver Actions have a reported HTML drag-and-drop limitation ([Mozilla Bug 1515879](https://bugzilla.mozilla.org/show_bug.cgi?id=1515879)). The tests do not synthesize DOM drag events. The custom color input is set through its value setter and bubbling `input`/`change` events, so the native browser/OS color-picker dialog is outside the test boundary.

Coverage is by the scenarios in the table, not every cross-product of match mode, color, platform, and browser setting. The content suite exercises all eight combinations of the three surface enable flags, but other combinations are representative examples. The run targets Chrome and Firefox in the Linux container; it does not cover every browser release, operating system, profile, or display configuration.

The extension-reload case checks recovery for unversioned, unsupported older, and wholly corrupt storage, plus retained values of current and newer schemas after visible startup and a bounded observation period. It does not prove that storage writes never occurred; unit tests use a storage spy for that contract. A partly corrupt current schema retains its raw stored values while invalid entries are excluded from the rendered UI and invalid fields use sanitized values. The repository currently defines no schema migration steps, so this case does not claim to execute a historical data-shape migration. Negative origin checks and unrelated-key stability also have finite observation windows, rather than proving that no later change is possible. Stripe E2E checks cover gradient application/removal and fixed alignment; unit tests cover the exact angle, width, and light/dark phase. Parser coverage includes six of the seven `SettingsImportError` refusal reasons (`migration-failed` is unit-tested only, since no migration step exists); filesystem permission failures and inaccessible-file dialogs are not simulated.
