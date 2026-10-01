# End-to-end tests

The WebdriverIO suite installs the built Chrome MV3 and Firefox MV2 extensions in separate browser profiles and drives them in Chrome and Firefox. The default Compose run builds both artifacts and runs the suite serially under Xvfb:

```sh
docker compose --profile e2e run --rm --build e2e
```

To run one browser, add `-e E2E_BROWSER=chrome` or `-e E2E_BROWSER=firefox` before `e2e`. The equivalent package scripts are `pnpm test:e2e`, `pnpm test:e2e:chrome`, and `pnpm test:e2e:firefox`. Failure screenshots, page captures, and startup diagnostics are saved under `.e2e-artifacts/`.

| Spec | Covered behavior |
| --- | --- |
| `smoke.e2e.mjs` | Installs and opens each built extension, reaches the local HTTPS fixture through the proxy, checks the expected untinted initial state, and verifies native panel opening. |
| `ui.e2e.mjs` | Adds rules in all four match modes; validates input, Enter, and Escape; edits, duplicates, reorders, and deletes rules; checks palette and surface controls, input bounds, all three palette-reference clears, and visible control values and swatches after reload. Exports a real JSON backup and checks its payload, schema version, and local-date filename; imports it into empty settings for a full round trip; and checks cancel, zero-selection, select-all/mixed selection, duplicate replacement order, and all six parser refusal reasons with an invalid-field path. It also clicks **Copy details** and verifies the visible parser detail through clipboard paste. |
| `content.e2e.mjs` | Checks match precedence, exact and full-match regex behavior, missing/unmatched projects, origin boundaries, browser-observed HTTP handling, all eight surface enable combinations, palette resolution and fallback, targeted text descendants, stripes and fixed background alignment, automatic contrast, SPA push/replace/back/forward without a document reload, storage changes in two tabs, unrelated-key stability, extension reload with legacy, wholly corrupt, partly corrupt, current, and newer stored schemas, DOM replacement, and reduced-motion styles. The partly corrupt case retains raw storage while checking that invalid rules and palette entries are ignored and sanitized values render. |

## Scope and limits

The browser tests use a local HTTPS fixture served as `console.cloud.google.com` and `outside.example.test`. It has the small set of elements and SPA controls required by the tests; the proxy rejects other network targets. These tests do not exercise Google sign-in, live Console pages, Google's production DOM, or its real navigation implementation.

The settings screen is opened at the extension's `sidepanel.html` URL in a WebDriver tab. The smoke test separately verifies native opening: Firefox clicks the toolbar action and checks the browser sidebar's open state; Chrome checks `openPanelOnActionClick`, makes a trusted click on a button in the extension page to call `sidePanel.open`, and confirms a real `SIDE_PANEL` runtime context. It does not click Chrome's operating-system toolbar icon. Import uses WebDriver to provide a path to the actual file input, and export reads the downloaded file from the isolated test directory; native OS file-picker, permission, and download-prompt windows are outside the test boundary.

Firefox drag/drop coverage uses xdotool/XTest mouse input on the Xvfb display because Firefox WebDriver Actions have a reported HTML drag-and-drop limitation ([Mozilla Bug 1515879](https://bugzilla.mozilla.org/show_bug.cgi?id=1515879)). The tests do not synthesize DOM drag events. The custom color input is set through its value setter and bubbling `input`/`change` events, so the native browser/OS color-picker dialog is outside the test boundary.

Coverage is by the scenarios in the table, not every cross-product of match mode, color, platform, and browser setting. The content suite exercises all eight combinations of the three surface enable flags, but other combinations are representative examples. The run targets Chrome and Firefox in the Linux container; it does not cover every browser release, operating system, profile, or display configuration.

The extension-reload case checks recovery for unversioned, unsupported older, and wholly corrupt storage, plus preservation of current and newer schemas. A partly corrupt current schema remains unchanged in storage while invalid entries are excluded from the rendered UI and invalid fields use sanitized values. The repository currently defines no schema migration steps, so this case does not claim to execute a historical data-shape migration. Parser coverage includes the six `SettingsImportError` refusal reasons; filesystem permission failures and inaccessible-file dialogs are not simulated.
