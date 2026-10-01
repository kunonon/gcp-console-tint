import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { projectSettings, rule, settings, VERSION } from './fixtures.mjs';
import { browserTargets, createHarness, openTab } from './harness.mjs';

function topBar(color, height = 7, stripes = false) {
  return { enabled: true, color: { paletteId: null, custom: color }, height, stripes };
}

function platformBar(color, stripes = false) {
  return { enabled: true, color: { paletteId: null, custom: color }, stripes };
}

function textColor(color) {
  return { enabled: true, color: { paletteId: null, custom: color }, auto: false };
}

async function setStored(h, value, extra = {}) {
  const { browser } = h;
  await browser.switchToWindow(h.panelHandle);
  const result = await browser.executeAsync(
    async (key, settingsValue, additional, done) => {
      try {
        const extensionApi = globalThis.browser || globalThis.chrome;
        await extensionApi.storage.local.set({ [key]: settingsValue, ...additional });
        done({ ok: true });
      } catch (error) {
        done({ ok: false, message: String(error) });
      }
    },
    'tintSettings',
    value,
    extra,
  );
  assert.equal(result?.ok, true, result?.message || 'Failed to update extension storage');
  await browser.switchToWindow(h.mockHandle);
}

async function snapshotWhen(h, predicate, message, handle = h.mockHandle) {
  await h.browser.waitUntil(async () => predicate(await h.snapshotConsole(handle)), {
    timeout: 8000,
    interval: 100,
    timeoutMsg: message,
  });
  return h.snapshotConsole(handle);
}

async function assertStable(read, assertSample, message, duration = 450) {
  const deadline = Date.now() + duration;
  do {
    assertSample(await read(), message);
    if (Date.now() < deadline) await pause(100);
  } while (Date.now() < deadline);
}

async function waitSettings(h, predicate, message) {
  await h.browser.waitUntil(async () => predicate(await h.readSettings()), {
    timeout: 5000,
    interval: 100,
    timeoutMsg: message,
  });
  return h.readSettings();
}

async function pushHistoryUrl(h, path) {
  await h.browser.switchToWindow(h.mockHandle);
  await h.browser.execute((nextPath) => history.pushState({}, '', nextPath), path);
}

async function colorStyle(h) {
  const { browser } = h;
  await browser.switchToWindow(h.mockHandle);
  return browser.execute(() => {
    const overlay = [...document.documentElement.children].find(
      (element) =>
        element.tagName === 'DIV' && element.style.position === 'fixed' && element.style.zIndex === '2147483647',
    );
    const platform = document.querySelector('#ocb-platform-bar');
    const style = [...document.documentElement.children].find((element) => element.tagName === 'STYLE');
    const overlayStyle = overlay ? getComputedStyle(overlay) : null;
    const platformStyle = platform ? getComputedStyle(platform) : null;
    const textDescendant = document.querySelector('.cfc-platform-bar-left span');
    const textStyle = textDescendant ? getComputedStyle(textDescendant) : null;
    return {
      overlayTransition: overlay?.style.transition ?? null,
      overlayTransitionProperty: overlayStyle?.transitionProperty ?? null,
      overlayTransitionDuration: overlayStyle?.transitionDuration ?? null,
      overlayTransitionTimingFunction: overlayStyle?.transitionTimingFunction ?? null,
      overlayPosition: overlay?.style.position ?? null,
      overlayTop: overlay?.style.top ?? null,
      overlayLeft: overlay?.style.left ?? null,
      overlayRight: overlay?.style.right ?? null,
      overlayZIndex: overlay?.style.zIndex ?? null,
      overlayPointerEvents: overlay?.style.pointerEvents ?? null,
      overlayBackgroundAttachment: overlay?.style.backgroundAttachment ?? null,
      overlayBackgroundPosition: overlay?.style.backgroundPosition ?? null,
      overlayBackgroundSize: overlay?.style.backgroundSize ?? null,
      platformTransition: style?.textContent ?? '',
      platformTransitionProperty: platformStyle?.transitionProperty ?? null,
      platformTransitionDuration: platformStyle?.transitionDuration ?? null,
      platformTransitionTimingFunction: platformStyle?.transitionTimingFunction ?? null,
      textTransitionProperty: textStyle?.transitionProperty ?? null,
      textTransitionDuration: textStyle?.transitionDuration ?? null,
      textTransitionTimingFunction: textStyle?.transitionTimingFunction ?? null,
      platformBackgroundAttachment: platformStyle?.backgroundAttachment ?? null,
      platformBackgroundPosition: platformStyle?.backgroundPosition ?? null,
      platformBackgroundSize: platformStyle?.backgroundSize ?? null,
    };
  });
}

for (const browserName of browserTargets()) {
  describe(`content behavior: ${browserName}`, { concurrency: false }, () => {
    let h;
    const test = (name, fn) =>
      it(name, async () => {
        try {
          await fn();
        } catch (error) {
          try {
            await h.captureFailure(name);
          } catch {
            /* Keep the test failure. */
          }
          throw error;
        }
      });

    before(async () => {
      h = await createHarness(browserName);
    });

    after(async () => {
      await h?.close();
    });

    beforeEach(async () => {
      try {
        await h.reset();
      } catch (error) {
        try {
          await h.captureFailure('beforeEach');
        } catch {
          /* Keep the original setup failure. */
        }
        throw error;
      }
    });

    test('applies prefix, suffix, exact, and full-match regex rules in priority order', async () => {
      const colors = {
        prefix: projectSettings({ topBar: topBar('#cc0000') }),
        suffix: projectSettings({ topBar: topBar('#00aa00') }),
        exact: projectSettings({ topBar: topBar('#0000cc') }),
        regex: projectSettings({ topBar: topBar('#aa00aa') }),
      };
      await setStored(
        h,
        settings(
          rule('prefix', 'team-', 'prefix', colors.prefix),
          rule('suffix', '-prod', 'suffix', colors.suffix),
          rule('exact', 'exact-id', 'exact', colors.exact),
          rule('exact-path', 'team/prod', 'exact', projectSettings({ topBar: topBar('#ffaa00') })),
          rule('regex', 'svc[0-9]+|dev[0-9]+', 'regex', colors.regex),
          rule('invalid-regex', '[', 'regex', projectSettings({ topBar: topBar('#ff00ff') })),
        ),
      );

      const cases = [
        ['team-prod', 'rgb(204, 0, 0)'], // prefix wins over the later matching suffix.
        ['xteam-prod', 'rgb(0, 170, 0)'],
        ['team-prod-x', 'rgb(204, 0, 0)'],
        ['exact-id', 'rgb(0, 0, 204)'],
        ['exact-id-extra', 'none'],
        ['team/prod', 'rgb(255, 170, 0)'],
        ['svc123', 'rgb(170, 0, 170)'],
        ['svc123-extra', 'none'],
        ['dev7', 'rgb(170, 0, 170)'],
        ['xdev7', 'none'],
        ['team-other', 'rgb(204, 0, 0)'],
        ['invalid', 'none'],
      ];
      await h.openConsole(cases[0][0]);
      for (let index = 0; index < cases.length; index++) {
        const [projectId, expected] = cases[index];
        if (index > 0) await pushHistoryUrl(h, `/?project=${encodeURIComponent(projectId)}`);
        const snapshot = await snapshotWhen(
          h,
          (value) =>
            value.href.includes(encodeURIComponent(projectId)) &&
            (expected === 'none' ? value.topBar.display === 'none' : value.topBar.backgroundColor === expected),
          `URL or tint did not reach the expected state for ${projectId}`,
        );
        if (expected === 'none') assert.equal(snapshot.topBar.display, 'none', projectId);
        else assert.equal(snapshot.topBar.backgroundColor, expected, projectId);
      }
    });

    test('clears empty and unmatched routes, scopes injection to the console host, and observes HTTP handling', async () => {
      await setStored(
        h,
        settings(
          rule(
            'alpha',
            'alpha',
            'exact',
            projectSettings({
              topBar: topBar('#cc0000'),
              platformBar: platformBar('#00aa00'),
            }),
          ),
        ),
      );

      for (const path of ['/', '/?project=', '/?project=other']) {
        await h.openConsole('alpha');
        await snapshotWhen(
          h,
          (value) =>
            value.topBar.display === 'block' &&
            value.topBar.backgroundColor === 'rgb(204, 0, 0)' &&
            value.platformBar.backgroundColor === 'rgb(0, 170, 0)',
          'matched project was not tinted before no-match checks',
        );
        await pushHistoryUrl(h, path);
        const snapshot = await snapshotWhen(
          h,
          (value) =>
            value.href.endsWith(path) &&
            value.topBar.display === 'none' &&
            value.platformBar.backgroundColor === 'rgb(238, 238, 238)',
          `empty or unmatched project was not cleared for ${path}`,
        );
        assert.equal(snapshot.topBar.exists, true, path);
        assert.equal(snapshot.topBar.display, 'none', path);
        assert.equal(snapshot.platformBar.backgroundColor, 'rgb(238, 238, 238)', path);
      }

      for (const url of ['http://outside.example.test/?project=alpha', 'https://outside.example.test/?project=alpha']) {
        await h.openConsole(url);
        const snapshot = await snapshotWhen(
          h,
          (value) =>
            value.origin === new URL(url).origin && value.title === 'GCP Console mock' && value.platformBar.exists,
          `outside-origin fixture did not load for ${url}`,
        );
        assert.equal(new URL(snapshot.href).host, new URL(url).host, url);
        await assertStable(
          () => h.snapshotConsole(),
          (value, message) => {
            assert.equal(value.topBar.exists, false, message);
            assert.equal(value.topBar.display, null, message);
            assert.equal(value.topBar.backgroundColor, null, message);
            assert.equal(value.platformBar.backgroundColor, 'rgb(238, 238, 238)', message);
          },
          `outside-origin tint changed after load for ${url}`,
        );
      }

      await h.openConsole('http://console.cloud.google.com/?project=alpha');
      const httpAttempt = await snapshotWhen(
        h,
        (value) => value.title === 'GCP Console mock' && value.platformBar.exists,
        'HTTP response did not load the GCP Console fixture platform bar',
      );
      assert.equal(new URL(httpAttempt.href).host, 'console.cloud.google.com');
      const wasUpgraded = new URL(httpAttempt.href).protocol === 'https:';
      const httpObserved = wasUpgraded
        ? await snapshotWhen(
            h,
            (value) =>
              value.topBar.display === 'block' &&
              value.topBar.backgroundColor === 'rgb(204, 0, 0)' &&
              value.platformBar.backgroundColor === 'rgb(0, 170, 0)',
            'HTTPS-upgraded console page did not show both configured colors',
          )
        : httpAttempt;
      assert.equal(
        httpObserved.topBar.exists,
        wasUpgraded,
        'HTTP input should only run the content script if the browser upgraded it to HTTPS',
      );
      if (wasUpgraded) assert.equal(httpObserved.topBar.backgroundColor, 'rgb(204, 0, 0)');
      else {
        await assertStable(
          () => h.snapshotConsole(),
          (value, message) => {
            assert.equal(value.topBar.exists, false, message);
            assert.equal(value.topBar.display, null, message);
            assert.equal(value.topBar.backgroundColor, null, message);
            assert.equal(value.platformBar.backgroundColor, 'rgb(238, 238, 238)', message);
          },
          'non-upgraded HTTP console acquired a tint after load',
        );
      }

      await h.openConsole('alpha');
      await snapshotWhen(
        h,
        (value) =>
          value.topBar.display === 'block' &&
          value.topBar.backgroundColor === 'rgb(204, 0, 0)' &&
          value.platformBar.backgroundColor === 'rgb(0, 170, 0)',
        'matching settings were not restored after origin checks',
      );
      await setStored(h, settings());
      const emptyRules = await snapshotWhen(
        h,
        (value) => value.topBar.display === 'none',
        'empty project rules left the overlay visible',
      );
      assert.equal(emptyRules.topBar.display, 'none');
      assert.equal(emptyRules.platformBar.backgroundColor, 'rgb(238, 238, 238)');
    });

    test('covers all eight surface-enable combinations through real storage updates', async () => {
      const baselineTextColors = Object.values((await h.snapshotConsole()).platformBar.textColors);
      const expectedText = 'rgb(171, 18, 205)';
      await setStored(
        h,
        settings(
          rule(
            'alpha',
            'alpha',
            'exact',
            projectSettings({
              topBar: topBar('#123456', 11),
              platformBar: platformBar('#00aa00'),
              platformBarText: textColor('#ab12cd'),
            }),
          ),
        ),
      );
      await snapshotWhen(
        h,
        (current) =>
          current.topBar.display === 'block' &&
          current.topBar.backgroundColor === 'rgb(18, 52, 86)' &&
          current.topBar.height === '11px' &&
          current.platformBar.backgroundColor === 'rgb(0, 170, 0)' &&
          Object.values(current.platformBar.textColors).every((color) => color === expectedText),
        'all enabled surfaces did not render before the mask sequence',
      );
      for (let mask = 0; mask < 8; mask++) {
        const [topEnabled, platformEnabled, textEnabled] = [0, 1, 2].map((bit) => Boolean(mask & (1 << bit)));
        const value = settings(
          rule(
            'alpha',
            'alpha',
            'exact',
            projectSettings({
              topBar: { ...topBar('#123456', 11), enabled: topEnabled },
              platformBar: { ...platformBar('#00aa00'), enabled: platformEnabled },
              platformBarText: { ...textColor('#ab12cd'), enabled: textEnabled },
            }),
          ),
        );
        await setStored(h, value);
        const expectedTextColors = textEnabled ? Array(3).fill(expectedText) : baselineTextColors;
        const snapshot = await snapshotWhen(
          h,
          (current) =>
            current.topBar.display === (topEnabled ? 'block' : 'none') &&
            (platformEnabled
              ? current.platformBar.backgroundColor === 'rgb(0, 170, 0)'
              : current.platformBar.backgroundColor === 'rgb(238, 238, 238)') &&
            Object.values(current.platformBar.textColors).every((color, index) => color === expectedTextColors[index]),
          `surface combination ${mask} was not applied`,
        );
        if (topEnabled) assert.equal(snapshot.topBar.height, '11px');
        assert.deepEqual(Object.values(snapshot.platformBar.textColors), expectedTextColors);
        assert.equal(snapshot.unaffectedColor, 'rgb(32, 33, 36)');
      }
    });

    test('resolves palette references in rule scope, falls back for disabled or dangling entries, and updates all targeted text descendants', async () => {
      const first = projectSettings({
        palette: { enabled: true, entries: [{ id: 'shared', name: 'Alpha', color: '#00aa00' }] },
        topBar: { enabled: true, color: { paletteId: 'shared', custom: '#111111' }, height: 8, stripes: true },
        platformBar: { enabled: true, color: { paletteId: 'missing', custom: '#cc3300' }, stripes: true },
        platformBarText: { enabled: true, color: { paletteId: null, custom: '#1122cc' }, auto: false },
      });
      const second = projectSettings({
        palette: { enabled: true, entries: [{ id: 'shared', name: 'Beta', color: '#0000cc' }] },
        topBar: { enabled: true, color: { paletteId: 'shared', custom: '#113355' }, height: 9, stripes: false },
        platformBar: { enabled: true, color: { paletteId: 'shared', custom: '#224466' }, stripes: false },
        platformBarText: { enabled: true, color: { paletteId: null, custom: '#228844' }, auto: false },
      });
      const third = projectSettings({
        palette: { enabled: false, entries: [{ id: 'shared', name: 'Disabled', color: '#ffffff' }] },
        topBar: { enabled: true, color: { paletteId: 'shared', custom: '#abcdef' }, height: 10, stripes: false },
      });
      await setStored(
        h,
        settings(
          rule('alpha', 'alpha', 'exact', first),
          rule('beta', 'beta', 'exact', second),
          rule('disabled', 'disabled', 'exact', third),
        ),
      );

      await h.openConsole('alpha');
      let snapshot = await snapshotWhen(
        h,
        (value) =>
          value.topBar.backgroundColor === 'rgb(0, 170, 0)' &&
          value.platformBar.backgroundColor === 'rgb(204, 51, 0)' &&
          Object.values(value.platformBar.textColors).every((color) => color === 'rgb(17, 34, 204)'),
        'palette and text colors did not settle for alpha',
      );
      const css = await colorStyle(h);
      assert.equal(
        await h.browser.execute(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
        h.reducedMotion,
      );
      assert.match(snapshot.topBar.backgroundImage, /gradient/);
      assert.match(snapshot.platformBar.backgroundImage, /gradient/);
      assert.equal(css.overlayBackgroundAttachment, 'fixed');
      assert.equal(css.overlayBackgroundPosition, '0px 0px');
      assert.equal(css.overlayBackgroundSize, 'auto');
      assert.equal(css.overlayPosition, 'fixed');
      assert.equal(css.overlayTop, '0px');
      assert.equal(css.overlayLeft, '0px');
      assert.equal(css.overlayRight, '0px');
      assert.equal(css.overlayZIndex, '2147483647');
      assert.equal(css.overlayPointerEvents, 'none');
      if (!h.reducedMotion) {
        assert.deepEqual(
          [css.overlayTransitionProperty, css.overlayTransitionDuration, css.overlayTransitionTimingFunction],
          ['background-color, height', '0.3s, 0.2s', 'ease, ease'],
        );
        assert.deepEqual(
          [css.platformTransitionProperty, css.platformTransitionDuration, css.platformTransitionTimingFunction],
          ['background-color', '0.3s', 'ease'],
        );
        assert.deepEqual(
          [css.textTransitionProperty, css.textTransitionDuration, css.textTransitionTimingFunction],
          ['color', '0.3s', 'ease'],
        );
        assert.match(
          css.platformTransition,
          /#ocb-platform-bar\s*\{[^}]*transition: background-color 300ms ease !important;/,
        );
        assert.match(
          css.platformTransition,
          /\.cfc-platform-bar-left \*, \.cfc-platform-bar-right \*, \.pcc-platform-bar-button \*\s*\{[^}]*transition: color 300ms ease !important;/,
        );
      }
      assert.equal(css.platformBackgroundAttachment, 'fixed');
      assert.equal(css.platformBackgroundPosition, '0px 0px');
      assert.equal(css.platformBackgroundSize, 'auto');

      await h.browser.execute(() => {
        const left = document.querySelector('.cfc-platform-bar-left');
        const nested = document.createElement('strong');
        nested.id = 'late-platform-descendant';
        nested.textContent = 'Late rendered label';
        left.replaceChildren(nested);
      });
      await h.browser.waitUntil(
        () =>
          h.browser.execute(
            () => getComputedStyle(document.querySelector('#late-platform-descendant')).color === 'rgb(17, 34, 204)',
          ),
        {
          timeout: 5000,
          timeoutMsg: 'a newly rendered target text descendant did not receive the style rule',
        },
      );
      assert.equal((await h.snapshotConsole()).unaffectedColor, 'rgb(32, 33, 36)');
      await h.browser.execute(() => {
        document.querySelector('#late-platform-descendant').id = 'platform-left-text';
      });

      await pushHistoryUrl(h, '/?project=beta');
      snapshot = await snapshotWhen(
        h,
        (value) =>
          value.href.includes('project=beta') &&
          value.topBar.backgroundColor === 'rgb(0, 0, 204)' &&
          value.platformBar.backgroundColor === 'rgb(0, 0, 204)' &&
          value.topBar.backgroundImage === 'none' &&
          value.platformBar.backgroundImage === 'none' &&
          Object.values(value.platformBar.textColors).every((color) => color === 'rgb(34, 136, 68)'),
        'rule-scoped palette did not settle for beta',
      );
      assert.equal(snapshot.topBar.backgroundColor, 'rgb(0, 0, 204)', 'same palette id resolves within the beta rule');
      assert.equal(snapshot.platformBar.backgroundColor, 'rgb(0, 0, 204)');
      assert.equal(snapshot.topBar.backgroundImage, 'none');
      assert.equal(snapshot.platformBar.backgroundImage, 'none');
      assert.deepEqual(Object.values(snapshot.platformBar.textColors), Array(3).fill('rgb(34, 136, 68)'));

      await h.openConsole('disabled');
      snapshot = await snapshotWhen(
        h,
        (value) => value.topBar.backgroundColor === 'rgb(171, 205, 239)',
        'disabled palette did not use the surface custom color',
      );
      assert.equal(
        snapshot.topBar.backgroundColor,
        'rgb(171, 205, 239)',
        'disabled palette uses the surface custom color',
      );
    });

    test('selects black or white auto text for light and dark backgrounds', async () => {
      const dark = projectSettings({
        platformBar: platformBar('#111111'),
        platformBarText: { enabled: true, color: { paletteId: null, custom: '#777777' }, auto: true },
      });
      const light = projectSettings({
        platformBar: platformBar('#f8f8f8'),
        platformBarText: { enabled: true, color: { paletteId: null, custom: '#777777' }, auto: true },
      });
      const gray = projectSettings({
        platformBar: platformBar('#777777'),
        platformBarText: { enabled: true, color: { paletteId: null, custom: '#777777' }, auto: true },
      });
      await setStored(
        h,
        settings(
          rule('dark', 'dark', 'exact', dark),
          rule('light', 'light', 'exact', light),
          rule('gray', 'gray', 'exact', gray),
        ),
      );
      for (const [projectId, expected] of [
        ['dark', 'rgb(255, 255, 255)'],
        ['light', 'rgb(0, 0, 0)'],
        ['gray', 'rgb(0, 0, 0)'],
      ]) {
        await h.openConsole(projectId);
        const snapshot = await snapshotWhen(
          h,
          (value) => Object.values(value.platformBar.textColors).every((color) => color === expected),
          `auto text color did not settle for ${projectId}`,
        );
        assert.deepEqual(Object.values(snapshot.platformBar.textColors), Array(3).fill(expected));
      }
    });

    test('reacts to push, replace, back, and forward without reloading, and to shared storage changes', async () => {
      const alpha = projectSettings({ topBar: topBar('#cc0000'), platformBar: platformBar('#cc0000') });
      const beta = projectSettings({ topBar: topBar('#0000cc'), platformBar: platformBar('#0000cc') });
      await setStored(h, settings(rule('alpha', 'alpha', 'exact', alpha), rule('beta', 'beta', 'exact', beta)));
      await h.openConsole('alpha');
      const first = await h.browser.execute(() => {
        window.__e2ePageIdentity = crypto.randomUUID();
        return { identity: window.__e2ePageIdentity, length: history.length };
      });
      const clickOnConsole = async (selector) => {
        await h.browser.switchToWindow(h.mockHandle);
        await h.browser.$(selector).click();
      };
      const identityIsStable = async () => h.browser.execute(() => window.__e2ePageIdentity);

      await clickOnConsole('#navigate-project');
      let snapshot = await snapshotWhen(
        h,
        (current) => current.href.includes('project=beta') && current.topBar.backgroundColor === 'rgb(0, 0, 204)',
        'pushState did not apply beta',
      );
      assert.equal(snapshot.topBar.backgroundColor, 'rgb(0, 0, 204)');
      assert.equal(await identityIsStable(), first.identity, 'pushState performed a full page reload');

      const lengthBeforeReplace = await h.browser.execute(() => history.length);
      await clickOnConsole('#navigate-home');
      snapshot = await snapshotWhen(
        h,
        (current) => current.href.includes('project=alpha') && current.topBar.backgroundColor === 'rgb(204, 0, 0)',
        'pushState did not return to alpha',
      );
      assert.equal(
        await h.browser.execute(() => history.length),
        lengthBeforeReplace + 1,
        'pushState did not add a history entry',
      );
      const lengthAfterPush = await h.browser.execute(() => history.length);
      await clickOnConsole('#replace-project');
      snapshot = await snapshotWhen(
        h,
        (current) => current.href.includes('project=beta') && current.topBar.backgroundColor === 'rgb(0, 0, 204)',
        'replaceState did not apply beta',
      );
      assert.equal(
        await h.browser.execute(() => history.length),
        lengthAfterPush,
        'replaceState added a history entry',
      );
      assert.equal(await identityIsStable(), first.identity, 'replaceState performed a full page reload');

      await clickOnConsole('#navigate-home');
      snapshot = await snapshotWhen(
        h,
        (current) => current.href.includes('project=alpha') && current.topBar.backgroundColor === 'rgb(204, 0, 0)',
        'pushState after replace did not return to alpha',
      );
      await h.browser.switchToWindow(h.mockHandle);
      await h.browser.back();
      snapshot = await snapshotWhen(
        h,
        (current) => current.href.includes('project=beta') && current.platformBar.backgroundColor === 'rgb(0, 0, 204)',
        'back did not restore beta',
      );
      await h.browser.switchToWindow(h.mockHandle);
      await h.browser.forward();
      snapshot = await snapshotWhen(
        h,
        (current) => current.href.includes('project=alpha') && current.platformBar.backgroundColor === 'rgb(204, 0, 0)',
        'forward did not restore alpha',
      );
      assert.equal(await identityIsStable(), first.identity, 'history navigation performed a full page reload');

      const secondHandle = await openTab(h.browser, browserName, 'https://console.cloud.google.com/?project=alpha');
      try {
        await snapshotWhen(
          h,
          (current) =>
            current.origin === 'https://console.cloud.google.com' &&
            current.href.includes('project=alpha') &&
            current.topBar.display === 'block' &&
            current.topBar.backgroundColor === 'rgb(204, 0, 0)' &&
            current.platformBar.backgroundColor === 'rgb(204, 0, 0)',
          'second tab did not load the initial content script and project tint',
          secondHandle,
        );
        const shared = projectSettings({ topBar: topBar('#00aa00'), platformBar: platformBar('#00aa00') });
        await setStored(h, settings(rule('alpha', 'alpha', 'exact', shared), rule('beta', 'beta', 'exact', beta)));
        snapshot = await snapshotWhen(
          h,
          (current) =>
            current.topBar.display === 'block' &&
            current.topBar.backgroundColor === 'rgb(0, 170, 0)' &&
            current.platformBar.backgroundColor === 'rgb(0, 170, 0)',
          'first tab did not receive storage.onChanged',
        );
        await snapshotWhen(
          h,
          (current) =>
            current.topBar.display === 'block' &&
            current.topBar.backgroundColor === 'rgb(0, 170, 0)' &&
            current.platformBar.backgroundColor === 'rgb(0, 170, 0)',
          'second tab did not receive storage.onChanged',
          secondHandle,
        );

        await h.browser.switchToWindow(h.panelHandle);
        const unrelatedChange = await h.browser.executeAsync(async (done) => {
          try {
            await (globalThis.browser || globalThis.chrome).storage.local.set({ unrelatedKey: 'ignored' });
            done({ ok: true });
          } catch (error) {
            done({ ok: false, message: String(error) });
          }
        });
        assert.equal(unrelatedChange?.ok, true, unrelatedChange?.message || 'Failed to write unrelated storage key');
        for (const handle of [h.mockHandle, secondHandle]) {
          await assertStable(
            () => h.snapshotConsole(handle),
            (current, message) => {
              assert.equal(current.topBar.display, 'block', message);
              assert.equal(current.topBar.backgroundColor, 'rgb(0, 170, 0)', message);
              assert.equal(current.platformBar.backgroundColor, 'rgb(0, 170, 0)', message);
            },
            `unrelated storage update changed the tint in ${handle}`,
          );
        }
      } finally {
        if (
          secondHandle !== h.mockHandle &&
          secondHandle !== h.panelHandle &&
          (await h.browser.getWindowHandles()).includes(secondHandle)
        ) {
          await h.browser.switchToWindow(secondHandle);
          await h.browser.closeWindow();
        }
        await h.browser.switchToWindow(h.mockHandle);
      }
      await h.reloadPanel();
      await h.openConsole('alpha');
      snapshot = await snapshotWhen(
        h,
        (current) => current.topBar.backgroundColor === 'rgb(0, 170, 0)',
        'storage did not persist through panel reload',
      );
      assert.equal(snapshot.topBar.backgroundColor, 'rgb(0, 170, 0)', 'storage did not persist through panel reload');
    });

    test('recovers legacy and corrupt storage on extension reload while retaining current and newer schemas', async () => {
      const legacy = {
        projectRules: [rule('legacy', 'alpha', 'exact', projectSettings({ topBar: topBar('#cc0000') }))],
      };
      const old = {
        schemaVersion: '0.0.9',
        projectRules: [rule('old', 'alpha', 'exact', projectSettings({ topBar: topBar('#cc0000') }))],
      };
      const corrupt = 'not-a-settings-record';
      for (const [name, stored] of [
        ['unversioned legacy', legacy],
        ['older schema', old],
        ['corrupt storage', corrupt],
      ]) {
        await setStored(h, stored);
        await h.reloadExtension();
        const migrated = await waitSettings(
          h,
          (value) =>
            value?.schemaVersion === VERSION && Array.isArray(value.projectRules) && value.projectRules.length === 0,
          `${name} recovery did not finish after extension reload`,
        );
        assert.equal(migrated.schemaVersion, VERSION, `${name} was not stamped with the current extension version`);
        assert.deepEqual(migrated.projectRules, [], `${name} did not fall back to safe defaults`);
      }

      const current = settings(rule('current', 'alpha', 'exact', projectSettings({ topBar: topBar('#00aa00') })));
      await setStored(h, current);
      await h.reloadExtension();
      const currentReloaded = await waitSettings(
        h,
        (value) => isDeepStrictEqual(value, current),
        'current schema did not remain intact after extension reload',
      );
      assert.deepEqual(currentReloaded, current, 'current schema data did not remain intact after extension reload');
      await snapshotWhen(
        h,
        (value) =>
          value.href.includes('project=alpha') &&
          value.topBar.display === 'block' &&
          value.topBar.backgroundColor === 'rgb(0, 170, 0)' &&
          value.topBar.height === '7px',
        'current schema tint and height did not render in the fresh document',
      );
      await assertStable(
        () => h.readSettings(),
        (value, message) => assert.deepEqual(value, current, message),
        'current schema raw settings changed after the fresh document rendered',
      );

      const partiallyCorrupt = {
        schemaVersion: VERSION,
        projectRules: [
          { ...rule('bad-pattern', 'discard-me'), pattern: 42 },
          rule(
            'good',
            'alpha',
            'exact',
            projectSettings({
              palette: {
                enabled: true,
                entries: [{ id: 'brand', name: 'Brand', color: '#00aa00' }, 'invalid-palette-entry'],
              },
              topBar: {
                enabled: true,
                color: { paletteId: 'invalid-entry', custom: '#cc3366' },
                height: 0,
                stripes: false,
              },
            }),
          ),
        ],
      };
      await setStored(h, partiallyCorrupt);
      await h.reloadExtension();

      await h.openPanel();
      const browser = h.browser;
      await browser.waitUntil(async () => (await browser.$$('[draggable="true"]')).length === 1, {
        timeout: 5000,
        interval: 100,
        timeoutMsg: 'partially corrupt settings did not render only the valid rule',
      });
      const visibleRules = await browser.$$('[draggable="true"]');
      assert.equal(visibleRules.length, 1);
      assert.match(await visibleRules[0].getText(), /alpha/);
      await visibleRules[0].$('button[aria-label="Edit"]').click();
      await browser.$('button[aria-label="Back"]').waitForDisplayed();
      assert.equal(await browser.$('input[aria-label="Top bar height"]').getValue(), '4');
      const picker = await browser.$('button[aria-label="Top bar color"]');
      assert.equal(await picker.getText(), '#cc3366', 'a dangling palette reference should use its custom color');
      await picker.click();
      await browser.$('button[aria-label="Brand"]').waitForDisplayed();
      const visiblePaletteEntries = await browser.$$('[role="dialog"] button[aria-label]');
      assert.deepEqual(
        await visiblePaletteEntries.map((entry) => entry.getAttribute('aria-label')),
        ['Brand'],
        'the invalid palette sibling should be excluded while Brand remains visible',
      );
      await browser.keys('Escape');

      await h.openConsole('alpha');
      const recovered = await snapshotWhen(
        h,
        (value) =>
          value.topBar.display === 'block' &&
          value.topBar.backgroundColor === 'rgb(204, 51, 102)' &&
          value.topBar.height === '4px',
        'partially corrupt CSS did not use the custom fallback color and default height',
      );
      assert.equal(recovered.topBar.display, 'block');
      assert.equal(recovered.topBar.backgroundColor, 'rgb(204, 51, 102)');
      assert.equal(recovered.topBar.height, '4px');
      await assertStable(
        () => h.readSettings(),
        (value, message) => assert.deepEqual(value, partiallyCorrupt, message),
        'partially corrupt current-schema raw settings changed after the CSS fallback rendered',
      );

      const newer = {
        ...settings(rule('future', 'alpha', 'exact', projectSettings({ topBar: topBar('#0000cc') }))),
        schemaVersion: '99.0.0',
      };
      await setStored(h, newer);
      await h.reloadExtension();
      const newerReloaded = await waitSettings(
        h,
        (value) => isDeepStrictEqual(value, newer),
        'newer schema did not remain intact after extension reload',
      );
      assert.deepEqual(newerReloaded, newer, 'newer schema data did not remain intact after extension reload');
      await snapshotWhen(
        h,
        (value) =>
          value.href.includes('project=alpha') &&
          value.topBar.display === 'block' &&
          value.topBar.backgroundColor === 'rgb(0, 0, 204)' &&
          value.topBar.height === '7px',
        'newer schema tint and height did not render in the fresh document',
      );
      await assertStable(
        () => h.readSettings(),
        (value, message) => assert.deepEqual(value, newer, message),
        'newer schema raw settings changed after the fresh document rendered',
      );
    });

    test('reapplies scoped CSS when the mock platform bar is replaced', async () => {
      const project = projectSettings({
        topBar: topBar('#aa00aa'),
        platformBar: platformBar('#00aa00'),
        platformBarText: textColor('#0000cc'),
      });
      await setStored(h, settings(rule('alpha', 'alpha', 'exact', project)));
      await h.openConsole('alpha');
      await snapshotWhen(
        h,
        (current) => current.topBar.backgroundColor === 'rgb(170, 0, 170)',
        'initial content style was not applied',
      );
      await h.browser.execute(() => {
        const previous = document.querySelector('#ocb-platform-bar');
        const replacement = previous.cloneNode(true);
        replacement.id = 'ocb-platform-bar';
        replacement.dataset.replaced = 'true';
        previous.replaceWith(replacement);
      });
      await h.browser.waitUntil(
        () =>
          h.browser.execute(
            () =>
              document.querySelector('#ocb-platform-bar')?.dataset.replaced === 'true' &&
              getComputedStyle(document.querySelector('#ocb-platform-bar')).backgroundColor === 'rgb(0, 170, 0)' &&
              getComputedStyle(document.querySelector('#platform-left-text')).color === 'rgb(0, 0, 204)',
          ),
        {
          timeout: 5000,
          timeoutMsg: 'replacement platform DOM lost content styles',
        },
      );
      const snapshot = await h.snapshotConsole();
      assert.equal(snapshot.unaffectedColor, 'rgb(32, 33, 36)');
    });
  });

  describe(`content reduced motion: ${browserName}`, { concurrency: false }, () => {
    let h;
    before(async () => {
      h = await createHarness(browserName, { reducedMotion: true });
    });
    after(async () => {
      await h?.close();
    });
    it('omits color and height transitions when reduce motion is enabled', async () => {
      try {
        await h.reset();
        await setStored(
          h,
          settings(
            rule(
              'alpha',
              'alpha',
              'exact',
              projectSettings({
                topBar: topBar('#cc0000'),
                platformBar: platformBar('#00aa00'),
                platformBarText: textColor('#0000cc'),
              }),
            ),
          ),
        );
        await h.openConsole('alpha');
        const snapshot = await snapshotWhen(
          h,
          (current) =>
            current.topBar.backgroundColor === 'rgb(204, 0, 0)' &&
            current.platformBar.backgroundColor === 'rgb(0, 170, 0)' &&
            Object.values(current.platformBar.textColors).every((color) => color === 'rgb(0, 0, 204)'),
          'content styles were not applied under reduced motion',
        );
        assert.equal(snapshot.topBar.backgroundColor, 'rgb(204, 0, 0)');
        assert.equal(snapshot.platformBar.backgroundColor, 'rgb(0, 170, 0)');
        assert.deepEqual(Object.values(snapshot.platformBar.textColors), Array(3).fill('rgb(0, 0, 204)'));
        await h.browser.switchToWindow(h.mockHandle);
        assert.equal(
          await h.browser.execute(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
          h.reducedMotion,
        );
        const css = await colorStyle(h);
        assert.equal(css.overlayTransition, '');
        assert.match(css.platformTransition, /#ocb-platform-bar\s*\{[^}]*background-color:/);
        assert.match(
          css.platformTransition,
          /\.cfc-platform-bar-left \*, \.cfc-platform-bar-right \*, \.pcc-platform-bar-button \*\s*\{[^}]*color:/,
        );
        assert.doesNotMatch(css.platformTransition, /transition\s*:/);
      } catch (error) {
        try {
          await h.captureFailure('reduced motion styles');
        } catch {
          /* Keep the test failure. */
        }
        throw error;
      }
    });
  });
}
