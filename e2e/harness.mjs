import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chown, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { remote } from 'webdriverio';
import { startGcpMock } from './gcp-mock.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputDir = join(projectRoot, '.output');
const settingsKey = 'tintSettings';
const reloadMarkerKey = '__e2eReloadMarker';
const extensionName = 'GCP Console Tint';
const defaultConsoleUrl = 'https://console.cloud.google.com/?project=alpha';

export function browserTargets() {
  const selection = process.env.E2E_BROWSER || 'all';
  if (selection === 'all') return ['chrome', 'firefox'];
  if (selection === 'chrome' || selection === 'firefox') return [selection];
  throw new Error(`E2E_BROWSER must be chrome, firefox, or all (received ${JSON.stringify(selection)})`);
}

async function chromeExtensionId(browser) {
  await browser.url('chrome://extensions');
  let item;
  await browser.waitUntil(
    async () => {
      item = await browser.execute(async () => {
        const chromeApi = globalThis.chrome;
        if (typeof chromeApi?.developerPrivate?.getExtensionsInfo !== 'function') {
          throw new Error('chrome.developerPrivate.getExtensionsInfo is unavailable on chrome://extensions');
        }
        const extensions = await new Promise((resolve, reject) => {
          chromeApi.developerPrivate.getExtensionsInfo({}, (items) => {
            const error = chromeApi.runtime.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }
            resolve(items || []);
          });
        });
        const extension = extensions.find(({ name, id }) => name === 'GCP Console Tint' && /^[a-p]{32}$/.test(id));
        return extension ? { id: extension.id, name: extension.name } : null;
      });
      return Boolean(item);
    },
    { timeout: 15000, interval: 200, timeoutMsg: 'Chrome did not show the loaded GCP Console Tint extension' },
  );
  assert.ok(item, `Chrome extension manager did not expose the ${extensionName} ID`);
  return item;
}

async function enableChromeDeveloperMode(browser) {
  const result = await browser.execute(async () => {
    const chromeApi = globalThis.chrome;
    const developerPrivate = chromeApi?.developerPrivate;
    if (!developerPrivate) {
      return { ok: false, message: 'chrome.developerPrivate is unavailable on chrome://extensions' };
    }
    const invoke = (method) =>
      new Promise((resolve, reject) => {
        method((value) => {
          const error = chromeApi.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(value);
        });
      });
    const updateProfile = () =>
      new Promise((resolve, reject) => {
        developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, () => {
          const error = chromeApi.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve();
        });
      });
    try {
      let profile = await invoke((callback) => developerPrivate.getProfileConfiguration(callback));
      if (profile?.inDeveloperMode) {
        return { ok: true, enabled: true };
      }
      await updateProfile();
      profile = await invoke((callback) => developerPrivate.getProfileConfiguration(callback));
      return { ok: true, enabled: profile?.inDeveloperMode === true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  assert.equal(result?.ok, true, result?.message || 'Failed to enable Chrome Developer Mode for the E2E profile');
  assert.equal(result.enabled, true, 'Chrome Developer Mode remained disabled in the E2E profile');
}

async function firefoxPanelUrl(browser, addonId) {
  const originalContext = await browser.getMozContext();
  let uuid;
  try {
    await browser.setMozContext('chrome');
    await browser.waitUntil(
      async () => {
        uuid = await browser.execute((targetAddonId) => {
          const uuids = JSON.parse(globalThis.Services.prefs.getStringPref('extensions.webextensions.uuids', '{}'));
          return uuids[targetAddonId] || null;
        }, addonId);
        return Boolean(uuid);
      },
      {
        timeout: 15000,
        interval: 200,
        timeoutMsg: 'Firefox did not expose the installed add-on UUID',
      },
    );
    assert.ok(uuid, 'Firefox did not expose the add-on internal UUID');
  } finally {
    await browser.setMozContext(originalContext);
  }
  return `moz-extension://${uuid}/sidepanel.html`;
}

async function extensionArtifact(browserName, version) {
  if (browserName === 'chrome') {
    const directory = join(outputDir, 'chrome-mv3');
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, version, 'Chrome output version does not match this checkout; rebuild first');
    assert.equal(
      manifest.side_panel?.default_path,
      'sidepanel.html',
      'Chrome output does not register the native side panel',
    );
    assert.deepEqual(
      manifest.content_scripts?.flatMap((script) => script.matches || []),
      ['https://console.cloud.google.com/*'],
    );
    return { directory, manifest };
  }
  const archive = join(outputDir, `gcp-console-tint-${version}-firefox.zip`);
  const manifest = JSON.parse(execFileSync('unzip', ['-p', archive, 'manifest.json'], { encoding: 'utf8' }));
  assert.equal(manifest.name, extensionName, 'Firefox ZIP contains a different extension');
  assert.equal(manifest.version, version, 'Firefox output version does not match this checkout; rebuild first');
  assert.equal(
    manifest.sidebar_action?.default_panel,
    'sidepanel.html',
    'Firefox ZIP does not register the native sidebar',
  );
  assert.deepEqual(
    manifest.content_scripts?.flatMap((script) => script.matches || []),
    ['https://console.cloud.google.com/*'],
  );
  return { archive, manifest };
}

async function waitForPage(browser) {
  await browser.waitUntil(() => browser.execute(() => document.readyState === 'complete'), {
    timeout: 15000,
    interval: 100,
    timeoutMsg: 'Timed out waiting for the page to finish loading',
  });
}

export async function openTab(browser, browserName, url) {
  const existingHandles = await browser.getWindowHandles();
  let handle;
  if (browserName === 'firefox') {
    await browser.execute(() => window.open('about:blank', '', ''));
    await browser.waitUntil(
      async () => {
        const newHandles = (await browser.getWindowHandles()).filter(
          (candidate) => !existingHandles.includes(candidate),
        );
        if (newHandles.length === 1) handle = newHandles[0];
        return newHandles.length === 1;
      },
      {
        timeout: 10000,
        interval: 100,
        timeoutMsg: 'Firefox did not create exactly one new tab',
      },
    );
  } else {
    ({ handle } = await browser.createWindow('tab'));
  }
  assert.ok(handle && !existingHandles.includes(handle), 'WebDriver did not create a distinct tab');
  await browser.switchToWindow(handle);
  if (url) await browser.url(url);
  return handle;
}

export async function createHarness(browserName, { reducedMotion = false } = {}) {
  assert.equal(
    process.env.E2E_CONTAINER,
    '1',
    'Run browser tests through the dedicated Docker Compose E2E service (E2E_CONTAINER=1).',
  );
  assert.ok(['chrome', 'firefox'].includes(browserName), `Unsupported browser: ${browserName}`);
  const packageInfo = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  const extension = await extensionArtifact(browserName, packageInfo.version);
  const runId = randomUUID();
  const artifactRoot = resolve(process.env.E2E_ARTIFACT_DIR || join(projectRoot, '.e2e-artifacts'));
  const artifactDir = join(artifactRoot, browserName, runId);
  const tempDir = await mkdtemp(join(tmpdir(), `gcp-console-tint-${browserName}-`));
  const downloadDir = join(artifactDir, 'downloads');
  const cacheDir = resolve(
    process.env.WEBDRIVER_CACHE_DIR || join(projectRoot, 'node_modules', '.cache', 'webdriverio'),
  );
  let mock;
  let browser;
  let closed = false;
  let failed = false;
  const restoreArtifactOwnership = async () => {
    if (process.getuid?.() !== 0) return;
    const { uid, gid } = await stat(projectRoot);
    await chown(artifactRoot, uid, gid);
    await chown(join(artifactRoot, browserName), uid, gid);
    execFileSync('chown', ['-R', `${uid}:${gid}`, artifactDir]);
  };

  try {
    await mkdir(downloadDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    if (browserName === 'chrome') await mkdir(join(tempDir, 'profile'), { recursive: true });
    else {
      await Promise.all(
        ['firefox-profiles', 'firefox-app-data', 'firefox-local-app-data'].map((directory) =>
          mkdir(join(tempDir, directory), { recursive: true }),
        ),
      );
    }
    mock = await startGcpMock();

    const proxy = {
      proxyType: 'manual',
      httpProxy: mock.proxyUrl,
      sslProxy: mock.proxyUrl,
      noProxy: ['127.0.0.1', 'localhost'],
    };
    const capabilities =
      browserName === 'chrome'
        ? {
            browserName: 'chrome',
            browserVersion: process.env.E2E_CHROME_VERSION || 'stable',
            acceptInsecureCerts: true,
            proxy,
            'goog:chromeOptions': {
              args: [
                `--user-data-dir=${join(tempDir, 'profile')}`,
                `--load-extension=${extension.directory}`,
                '--window-size=1400,1200',
                '--no-first-run',
                '--disable-sync',
                '--no-sandbox',
                ...(reducedMotion ? ['--force-prefers-reduced-motion=reduce'] : []),
              ],
              prefs: {
                'download.default_directory': downloadDir,
                'download.prompt_for_download': false,
                'download.directory_upgrade': true,
              },
            },
            'goog:loggingPrefs': { browser: 'ALL' },
          }
        : {
            browserName: 'firefox',
            browserVersion: process.env.E2E_FIREFOX_VERSION || 'stable',
            acceptInsecureCerts: true,
            proxy,
            'wdio:enforceWebDriverClassic': true,
            'wdio:geckodriverOptions': {
              allowSystemAccess: true,
              profileRoot: join(tempDir, 'firefox-profiles'),
              log: process.env.E2E_GECKODRIVER_LOG || 'warn',
              spawnOpts: {
                env: {
                  ...process.env,
                  MOZ_APP_DATA: join(tempDir, 'firefox-app-data'),
                  MOZ_LOCAL_APP_DATA: join(tempDir, 'firefox-local-app-data'),
                },
              },
            },
            'moz:firefoxOptions': {
              args: [],
              prefs: {
                'browser.download.dir': downloadDir,
                'browser.download.folderList': 2,
                'browser.download.useDownloadDir': true,
                'ui.prefersReducedMotion': reducedMotion ? 1 : 0,
              },
            },
          };

    browser = await remote({
      capabilities,
      cacheDir,
      logLevel: 'warn',
      connectionRetryCount: 0,
      connectionRetryTimeout: 60000,
      waitforTimeout: 10000,
    });
    let panelUrl;
    let extensionId;
    if (browserName === 'chrome') {
      extensionId = await chromeExtensionId(browser);
      // Keep the unpacked extension in a Developer Mode profile for the reload scenario.
      await enableChromeDeveloperMode(browser);
      panelUrl = `chrome-extension://${extensionId.id}/sidepanel.html`;
    } else {
      extensionId = await browser.installAddOn((await readFile(extension.archive)).toString('base64'), true);
      panelUrl = await firefoxPanelUrl(browser, extensionId);
    }
    await mkdir(join(artifactDir, 'startup'), { recursive: true });
    await writeFile(
      join(artifactDir, 'startup', 'extension.json'),
      JSON.stringify(
        {
          browserName,
          extensionId,
          manifest: extension.manifest,
          panelUrl,
        },
        null,
        2,
      ),
    );
    await writeFile(join(artifactDir, 'startup', 'browser.json'), JSON.stringify(browser.capabilities, null, 2));

    const mockHandle = await browser.getWindowHandle();
    await browser.url(defaultConsoleUrl);
    await waitForPage(browser);
    await browser.waitUntil(
      () =>
        mock.requests.some(
          (request) =>
            request.scheme === 'https' && request.host === 'console.cloud.google.com' && request.method === 'CONNECT',
        ),
      {
        timeout: 10000,
        interval: 100,
        timeoutMsg: 'The console page did not pass through the local HTTPS GCP mock',
      },
    );
    let panelHandle = await openTab(browser, browserName, panelUrl);
    await waitForPage(browser);
    await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector('#root')?.children.length)), {
      timeout: 15000,
      interval: 150,
      timeoutMsg: `Extension panel did not render: ${panelUrl}`,
    });
    const installedManifest = await browser.execute((name) => {
      const extensionApi = globalThis.browser || globalThis.chrome;
      const manifest = extensionApi.runtime.getManifest();
      return {
        name: manifest.name,
        version: manifest.version,
        nativePanelPath:
          name === 'chrome'
            ? manifest.side_panel?.default_path
            : new URL(manifest.sidebar_action?.default_panel, location.href).pathname.slice(1),
        matches: (manifest.content_scripts || []).flatMap((script) => script.matches || []),
      };
    }, browserName);
    assert.equal(installedManifest.name, extensionName, 'Opened page is not the built GCP Console Tint extension');
    assert.equal(
      installedManifest.version,
      packageInfo.version,
      'Opened extension version does not match this checkout',
    );
    assert.equal(
      installedManifest.nativePanelPath,
      'sidepanel.html',
      'Installed extension did not register its native panel',
    );
    assert.deepEqual(installedManifest.matches, ['https://console.cloud.google.com/*'], 'Built match pattern changed');
    await browser.switchToWindow(mockHandle);

    const clickFirefoxAction = async () => {
      const context = await browser.getMozContext();
      try {
        await browser.setMozContext('chrome');
        const selector = `toolbarbutton.webextension-browser-action[data-extensionid="${extensionId}"]`;
        if (!(await (await browser.$(selector)).isDisplayed())) {
          const extensionsButton = await browser.$('#unified-extensions-button');
          assert.equal(
            await extensionsButton.isExisting(),
            true,
            'Firefox unified extensions button was not available to expose the add-on action',
          );
          await extensionsButton.click();
        }
        await browser.waitUntil(async () => (await browser.$(selector)).isDisplayed(), {
          timeout: 10000,
          interval: 100,
          timeoutMsg: `Firefox toolbar action for add-on ${extensionId} was not visible`,
        });
        await (await browser.$(selector)).click();
      } finally {
        await browser.setMozContext(context);
      }
    };

    const harness = {
      browser,
      browserName,
      panelUrl,
      get panelHandle() {
        return panelHandle;
      },
      mockHandle,
      downloadDir,
      artifactDir,
      mockRequests: mock.requests,
      reducedMotion,
      async openPanel() {
        await browser.switchToWindow(panelHandle);
        await waitForPage(browser);
        await browser.waitUntil(
          () => browser.execute(() => Boolean(document.querySelector('#root')?.children.length)),
          {
            timeout: 15000,
            interval: 150,
            timeoutMsg: 'Extension panel did not render',
          },
        );
      },
      async reloadPanel() {
        await browser.switchToWindow(panelHandle);
        await browser.refresh();
        await waitForPage(browser);
        await browser.waitUntil(
          () => browser.execute(() => Boolean(document.querySelector('#root')?.children.length)),
          {
            timeout: 15000,
            interval: 150,
            timeoutMsg: 'Extension panel did not render after reload',
          },
        );
      },
      async reloadExtension() {
        await browser.switchToWindow(mockHandle);
        const consoleUrl = await browser.getUrl();
        await harness.openPanel();
        const previousPanelHandle = panelHandle;
        const previousContext = await browser.execute(() => ({
          href: location.href,
          timeOrigin: performance.timeOrigin,
          extensionName: (globalThis.browser || globalThis.chrome).runtime.getManifest().name,
        }));
        const reloadMarker = randomUUID();
        const reload = await browser.execute(
          async (key, marker) => {
            const extensionApi = globalThis.browser || globalThis.chrome;
            if (typeof extensionApi?.runtime?.reload !== 'function') {
              return { ok: false, message: 'browser.runtime.reload is unavailable' };
            }
            try {
              await extensionApi.storage.local.set({ [key]: marker });
              setTimeout(() => extensionApi.runtime.reload(), 0);
              return { ok: true };
            } catch (error) {
              return { ok: false, message: String(error) };
            }
          },
          reloadMarkerKey,
          reloadMarker,
        );
        assert.equal(reload?.ok, true, reload?.message || 'Failed to schedule extension reload');
        await browser.waitUntil(
          async () => {
            try {
              if (!(await browser.getWindowHandles()).includes(previousPanelHandle)) return true;
              await browser.switchToWindow(previousPanelHandle);
              return await browser.execute((previous) => {
                const currentUrl = new URL(location.href);
                const extensionApi = globalThis.browser || globalThis.chrome;
                let currentName;
                try {
                  currentName = extensionApi?.runtime?.getManifest?.().name;
                } catch {
                  currentName = undefined;
                }
                return (
                  currentUrl.origin !== new URL(previous.href).origin ||
                  performance.timeOrigin !== previous.timeOrigin ||
                  currentName !== previous.extensionName
                );
              }, previousContext);
            } catch {
              return true;
            }
          },
          {
            timeout: 30000,
            interval: 100,
            timeoutMsg: 'runtime.reload() did not invalidate or reload the old extension page',
          },
        );
        await browser.switchToWindow(mockHandle);
        const handles = await browser.getWindowHandles();
        if (handles.includes(previousPanelHandle)) {
          await browser.switchToWindow(previousPanelHandle);
          await browser.closeWindow();
        }
        await browser.switchToWindow(mockHandle);
        panelHandle = await openTab(browser, browserName);
        await browser.waitUntil(
          async () => {
            try {
              await browser.switchToWindow(panelHandle);
              await browser.url(panelUrl);
              return await browser.execute(
                (expectedUrl, expectedName) => {
                  const actualUrl = new URL(location.href);
                  const targetUrl = new URL(expectedUrl);
                  const extensionApi = globalThis.browser || globalThis.chrome;
                  return (
                    document.readyState === 'complete' &&
                    actualUrl.origin === targetUrl.origin &&
                    actualUrl.pathname === targetUrl.pathname &&
                    extensionApi?.runtime?.getManifest?.().name === expectedName
                  );
                },
                panelUrl,
                extensionName,
              );
            } catch {
              return false;
            }
          },
          {
            timeout: 30000,
            interval: 500,
            timeoutMsg: 'Extension panel did not become available after runtime.reload()',
          },
        );
        await waitForPage(browser);
        await browser.waitUntil(
          () => browser.execute(() => Boolean(document.querySelector('#root')?.children.length)),
          {
            timeout: 15000,
            interval: 150,
            timeoutMsg: 'Fresh extension panel did not render after extension reload',
          },
        );
        const reloadedMarker = await browser.execute(async (key) => {
          const extensionApi = globalThis.browser || globalThis.chrome;
          try {
            const values = await extensionApi.storage.local.get(key);
            await extensionApi.storage.local.remove(key);
            return { value: values[key] ?? null };
          } catch (error) {
            return { error: String(error) };
          }
        }, reloadMarkerKey);
        assert.equal(
          reloadedMarker?.value,
          reloadMarker,
          reloadedMarker?.error || 'Fresh extension context did not retain the runtime.reload() marker',
        );
        await harness.openConsole(consoleUrl);
      },
      async openConsole(projectOrPath) {
        let url = defaultConsoleUrl;
        if (projectOrPath !== undefined) {
          if (/^https?:\/\//i.test(projectOrPath)) url = projectOrPath;
          else if (projectOrPath.startsWith('/')) url = `https://console.cloud.google.com${projectOrPath}`;
          else url = `https://console.cloud.google.com/?project=${encodeURIComponent(projectOrPath)}`;
        }
        await browser.switchToWindow(mockHandle);
        await browser.url(url);
        await waitForPage(browser);
      },
      async seedSettings(value) {
        await harness.openPanel();
        const result = await browser.execute(
          async (key, settings) => {
            try {
              const extensionApi = globalThis.browser || globalThis.chrome;
              await extensionApi.storage.local.set({ [key]: settings });
              return { ok: true };
            } catch (error) {
              return { ok: false, message: String(error) };
            }
          },
          settingsKey,
          value,
        );
        assert.equal(result?.ok, true, result?.message || 'Failed to seed browser.storage.local');
        await harness.reloadPanel();
      },
      async readSettings() {
        const originalHandle = await browser.getWindowHandle();
        try {
          await harness.openPanel();
          const result = await browser.execute(async (key) => {
            try {
              const extensionApi = globalThis.browser || globalThis.chrome;
              const value = await extensionApi.storage.local.get(key);
              return value[key] ?? null;
            } catch (error) {
              return { __error: String(error) };
            }
          }, settingsKey);
          assert.equal(result?.__error, undefined, result?.__error || 'Failed to read browser.storage.local');
          return result;
        } finally {
          await browser.switchToWindow(originalHandle);
        }
      },
      async reset() {
        await harness.openPanel();
        await browser
          .execute(async () => {
            try {
              const extensionApi = globalThis.browser || globalThis.chrome;
              await extensionApi.storage.local.clear();
              // The panel's first-paint theme hint is the only thing kept in localStorage; without
              // this a test would open on the theme the previous test left behind.
              localStorage.clear();
              return { ok: true };
            } catch (error) {
              return { ok: false, message: String(error) };
            }
          })
          .then((result) => assert.equal(result?.ok, true, result?.message || 'Failed to clear browser.storage.local'));
        await harness.reloadPanel();
        await harness.openConsole();
      },
      async snapshotConsole(handle = mockHandle) {
        const originalHandle = await browser.getWindowHandle();
        try {
          await browser.switchToWindow(handle);
          return await browser.execute(() => {
            const computed = (selector) => {
              const element = document.querySelector(selector);
              return element ? getComputedStyle(element) : null;
            };
            const bar = [...document.documentElement.children].find(
              (element) =>
                element.tagName === 'DIV' &&
                element.style.position === 'fixed' &&
                element.style.zIndex === '2147483647',
            );
            const overlay = bar ? getComputedStyle(bar) : null;
            const platformBar = computed('#ocb-platform-bar');
            return {
              origin: location.origin,
              href: location.href,
              title: document.title,
              topBar: {
                exists: Boolean(bar),
                display: overlay?.display ?? null,
                height: overlay?.height ?? null,
                backgroundColor: overlay?.backgroundColor ?? null,
                backgroundImage: overlay?.backgroundImage ?? null,
              },
              platformBar: {
                exists: Boolean(platformBar),
                backgroundColor: platformBar?.backgroundColor ?? null,
                backgroundImage: platformBar?.backgroundImage ?? null,
                textColors: {
                  left: computed('#platform-left-text')?.color ?? null,
                  right: computed('#platform-right-text')?.color ?? null,
                  button: computed('#platform-button-text')?.color ?? null,
                },
              },
              unaffectedColor: computed('#unaffected-content')?.color ?? null,
              unaffectedButtonColor: computed('#navigate-project')?.color ?? null,
              bodyText: document.body.innerText,
            };
          });
        } finally {
          await browser.switchToWindow(originalHandle);
        }
      },
      async openNativePanel() {
        await harness.openPanel();
        if (browserName === 'chrome') {
          let behavior;
          await browser.waitUntil(
            async () => {
              behavior = await browser.execute(async () => {
                try {
                  const extensionApi = globalThis.browser || globalThis.chrome;
                  const value = await extensionApi.sidePanel.getPanelBehavior();
                  return { ok: true, value };
                } catch (error) {
                  return { ok: false, message: String(error) };
                }
              });
              return behavior?.ok && behavior.value.openPanelOnActionClick === true;
            },
            {
              timeout: 10000,
              interval: 100,
              timeoutMsg: 'Chrome side panel action behavior did not become enabled',
            },
          );
          assert.equal(
            behavior?.value?.openPanelOnActionClick,
            true,
            'Chrome side panel does not open when the extension action is clicked',
          );
          assert.equal(
            await harness.nativePanelOpen(),
            false,
            'Chrome side panel was already open before the smoke check',
          );
        } else if (await harness.nativePanelOpen()) {
          await clickFirefoxAction();
          await browser.waitUntil(async () => !(await harness.nativePanelOpen()), {
            timeout: 15000,
            interval: 150,
            timeoutMsg: 'Firefox native sidebar remained open after the initial toolbar-action toggle',
          });
          assert.equal(await harness.nativePanelOpen(), false, 'Firefox sidebar did not close before the action click');
        }

        if (browserName === 'chrome') {
          const currentWindow = await browser.execute(async () => {
            try {
              const extensionApi = globalThis.browser || globalThis.chrome;
              const window = await extensionApi.windows.getCurrent();
              return { ok: true, windowId: window.id };
            } catch (error) {
              return { ok: false, message: String(error) };
            }
          });
          assert.equal(currentWindow?.ok, true, currentWindow?.message || 'Failed to find the current browser window');
          await browser.execute((targetWindowId) => {
            const extensionApi = globalThis.browser || globalThis.chrome;
            document.querySelector('#__e2e-open-native-panel')?.remove();
            const button = document.createElement('button');
            button.id = '__e2e-open-native-panel';
            button.type = 'button';
            button.textContent = 'Open native panel';
            button.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647';
            button.addEventListener(
              'click',
              () => {
                try {
                  const opening = extensionApi.sidePanel.open({ windowId: targetWindowId });
                  Promise.resolve(opening).then(
                    () => {
                      button.dataset.opened = 'true';
                    },
                    (error) => {
                      button.dataset.error = String(error);
                    },
                  );
                } catch (error) {
                  button.dataset.error = String(error);
                }
              },
              { once: true },
            );
            document.body.append(button);
          }, currentWindow.windowId);
          await browser.$('#__e2e-open-native-panel').click();
          await browser.waitUntil(
            async () => {
              const state = await browser.execute(() => ({
                opened: document.querySelector('#__e2e-open-native-panel')?.dataset.opened === 'true',
                error: document.querySelector('#__e2e-open-native-panel')?.dataset.error,
              }));
              assert.equal(state.error, undefined, state.error || 'Failed to open the native panel');
              return state.opened;
            },
            { timeout: 10000, interval: 100, timeoutMsg: 'Native panel open request did not complete' },
          );
          await browser.execute(() => document.querySelector('#__e2e-open-native-panel')?.remove());
        } else await clickFirefoxAction();

        await browser.waitUntil(() => harness.nativePanelOpen(), {
          timeout: 15000,
          interval: 150,
          timeoutMsg: `The ${browserName} native panel did not open`,
        });
      },
      async nativePanelOpen() {
        const originalHandle = await browser.getWindowHandle();
        try {
          await harness.openPanel();
          const result = await browser.execute(
            async (name, expectedUrl) => {
              try {
                const extensionApi = globalThis.browser || globalThis.chrome;
                if (name === 'chrome') {
                  const contexts = await extensionApi.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] });
                  return contexts.some((context) => context.documentUrl === expectedUrl);
                } else {
                  const window = await extensionApi.windows.getCurrent();
                  return await extensionApi.sidebarAction.isOpen({ windowId: window.id });
                }
              } catch (error) {
                return { __error: String(error) };
              }
            },
            browserName,
            panelUrl,
          );
          assert.equal(result?.__error, undefined, result?.__error || 'Failed to inspect native panel state');
          return result;
        } finally {
          await browser.switchToWindow(originalHandle);
        }
      },
      async captureFailure(label = 'failure') {
        failed = true;
        const screenshotsDir = join(artifactDir, 'screenshots');
        await mkdir(screenshotsDir, { recursive: true });
        const stem =
          String(label?.name || label || 'failure')
            .replace(/[^a-z0-9_-]+/gi, '-')
            .replace(/^-|-$/g, '') || 'failure';
        for (const [name, handle] of [
          ['panel', panelHandle],
          ['console', mockHandle],
        ]) {
          try {
            await browser.switchToWindow(handle);
          } catch {
            continue; // A closed tab cannot provide diagnostics.
          }
          await Promise.allSettled([
            browser.saveScreenshot(join(screenshotsDir, `${stem}-${name}.png`)),
            browser.getPageSource().then((source) => writeFile(join(screenshotsDir, `${stem}-${name}.html`), source)),
          ]);
        }
      },
      async close() {
        if (closed) return;
        closed = true;
        const cleanupErrors = [];
        for (const cleanup of [
          () => browser.deleteSession(),
          () => mock.close(),
          () => rm(tempDir, { recursive: true, force: true }),
          async () => {
            await restoreArtifactOwnership();
            if (!failed && cleanupErrors.length === 0) await rm(artifactDir, { recursive: true, force: true });
          },
        ]) {
          try {
            await cleanup();
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        if (cleanupErrors.length === 1) throw cleanupErrors[0];
        if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, 'Failed to close E2E harness');
      },
    };
    return harness;
  } catch (error) {
    try {
      await mkdir(join(artifactDir, 'startup'), { recursive: true });
      await writeFile(join(artifactDir, 'startup', 'error.txt'), String(error.stack || error));
      if (browser) {
        await Promise.allSettled([
          browser.getUrl().then((url) => writeFile(join(artifactDir, 'startup', 'url.txt'), url)),
          browser.getPageSource().then((source) => writeFile(join(artifactDir, 'startup', 'page.html'), source)),
          browser.saveScreenshot(join(artifactDir, 'startup', 'page.png')),
          browser
            .getLogs('browser')
            .then((logs) =>
              writeFile(join(artifactDir, 'startup', 'browser-logs.json'), JSON.stringify(logs, null, 2)),
            ),
        ]);
      }
    } catch {
      // Startup diagnostics must not replace the actual browser error.
    }
    const cleanupErrors = [];
    for (const cleanup of [
      () => browser?.deleteSession(),
      () => mock?.close(),
      () => rm(tempDir, { recursive: true, force: true }),
      () => restoreArtifactOwnership(),
    ]) {
      try {
        await cleanup();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], 'E2E startup failed and cleanup also failed');
    }
    throw error;
  }
}
