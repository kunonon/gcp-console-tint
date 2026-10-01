import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { Key } from 'webdriverio';
import { browserTargets, createHarness } from './harness.mjs';

const { version: VERSION } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const MATCH_LABELS = { prefix: 'Starts with', suffix: 'Ends with', exact: 'Exact', regex: 'Regex' };

function projectSettings(overrides = {}) {
  return {
    palette: { enabled: false, entries: [] },
    topBar: { enabled: false, color: { paletteId: null, custom: '#123456' }, height: 4, stripes: false },
    platformBar: { enabled: false, color: { paletteId: null, custom: '#234567' }, stripes: false },
    platformBarText: { enabled: false, color: { paletteId: null, custom: '#345678' }, auto: false },
    ...overrides,
  };
}

function rule(id, pattern, matchType = 'exact', settings = projectSettings()) {
  return { id, matchType, pattern, settings };
}

function settings(...projectRules) {
  return { schemaVersion: VERSION, projectRules };
}

async function panel(h) {
  await h.browser.switchToWindow(h.panelHandle);
  return h.browser;
}

async function click(browser, selector) {
  let element;
  await browser.waitUntil(
    async () => {
      element = await browser.$(selector);
      return element.isDisplayed();
    },
    {
      timeout: 10000,
      interval: 100,
      timeoutMsg: `${selector} still not displayed`,
    },
  );
  element = await browser.$(selector);
  await element.click();
  return element;
}

async function fill(browser, input, value) {
  await input.click();
  await browser.keys([Key.Ctrl, 'a']);
  if (value === '') await browser.keys(Key.Backspace);
  else await browser.keys(value);
}

async function switchByLabel(browser, label) {
  return browser.$(`//label[.//input[@role="switch"] and normalize-space(.)="${label}"]`);
}

async function waitForPopoverClosed(browser, button) {
  const isOpen = () =>
    browser.execute((element) => element.parentElement?.getAttribute('aria-expanded') === 'true', button);
  if (await isOpen()) await button.click();
  await browser.waitUntil(
    () => browser.execute((element) => element.parentElement?.getAttribute('aria-expanded') === 'false', button),
    { timeout: 5000, timeoutMsg: 'color popover did not close after selecting a palette entry' },
  );
}

async function stored(h) {
  const value = await h.readSettings();
  return value?.tintSettings ?? value?.settings ?? value;
}

async function waitStored(h, predicate) {
  await h.browser.waitUntil(
    async () => {
      const value = await stored(h);
      return value !== null && predicate(value);
    },
    {
      timeout: 5000,
      timeoutMsg: 'extension storage did not reach the expected state',
    },
  );
  return stored(h);
}

async function dialog(browser) {
  const element = await browser.$('[role="dialog"]');
  await element.waitForDisplayed();
  return element;
}

async function dialogIsClosed(browser) {
  const element = await browser.$('[role="dialog"]');
  const backdrop = await browser.$('.modal__backdrop');
  const [dialogDisplayed, backdropDisplayed] = await Promise.all([element.isDisplayed(), backdrop.isDisplayed()]);
  return !dialogDisplayed && !backdropDisplayed;
}

async function alertText(browser) {
  const alert = await browser.$('.alert--danger');
  await alert.waitForDisplayed();
  return await alert.getText();
}

async function alertIsHidden(browser) {
  const alert = await browser.$('.alert--danger');
  return !(await alert.isDisplayed());
}

async function chooseMatchType(browser, container, type) {
  await container.$('button[aria-haspopup="listbox"]').click();
  const option = await browser.$(`//*[@role="option" and normalize-space(.)="${MATCH_LABELS[type]}"]`);
  await option.waitForDisplayed();
  await option.click();
}

async function addRuleThroughUi(h, type, value) {
  const browser = await panel(h);
  await click(browser, 'button[aria-label="Add rule"]');
  const modal = await dialog(browser);
  if (type !== 'exact') await chooseMatchType(browser, modal, type);
  const label = type === 'regex' ? 'Pattern' : 'Project ID';
  const input = await modal.$(`input[aria-label="${label}"]`);
  await fill(browser, input, value);
  await browser.keys('Enter');
  await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });
}

async function rowAt(browser, index) {
  let rows = [];
  await browser.waitUntil(
    async () => {
      rows = await browser.$$('[draggable="true"]');
      return rows.length > index;
    },
    { timeout: 5000, timeoutMsg: 'rule row did not render' },
  );
  assert.ok(rows[index], `missing rule row at index ${index}`);
  return rows[index];
}

async function openDetail(browser, index = 0) {
  const row = await rowAt(browser, index);
  await row.$('button[aria-label="Edit"]').click();
  await browser.$('button[aria-label="Back"]').waitForDisplayed();
}

async function selectTab(browser, name) {
  await click(browser, `[role="tab"][data-key="${name.toLowerCase()}"]`);
}

async function setColor(browser, input, color) {
  await browser.execute(
    (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    },
    input,
    color,
  );
}

async function uploadJson(h, fileName, value) {
  const path = join(h.downloadDir, fileName);
  await writeFile(path, JSON.stringify(value, null, 2));
  const browser = await panel(h);
  const input = await browser.$('input[aria-label="Import settings file"]');
  await setFileInput(browser, input, path);
  return path;
}

async function setFileInput(browser, input, path) {
  try {
    await input.addValue(path);
  } catch (error) {
    if (
      !/interactable|not reachable|not visible|not displayed|could not be scrolled into view/i.test(
        String(error?.message),
      )
    ) {
      throw error;
    }
    await browser.execute((element) => {
      element.style.position = 'fixed';
      element.style.left = '0';
      element.style.top = '0';
      element.style.width = '12px';
      element.style.height = '12px';
      element.style.margin = '0';
      element.style.opacity = '0.01';
      element.style.clip = 'auto';
      element.style.clipPath = 'none';
      element.style.zIndex = '2147483647';
      element.style.pointerEvents = 'auto';
    }, input);
    await input.waitForDisplayed();
    await input.addValue(path);
  }
}

async function dragWithPointer(browser, from, to, browserName) {
  const [fromLocation, fromSize, toLocation, toSize] = await Promise.all([
    from.getLocation(),
    from.getSize(),
    to.getLocation(),
    to.getSize(),
  ]);
  const start = {
    x: Math.round(fromLocation.x + fromSize.width / 2),
    y: Math.round(fromLocation.y + fromSize.height / 2),
  };
  const end = {
    x: Math.round(toLocation.x + toSize.width / 2),
    y: Math.round(toLocation.y + toSize.height / 2),
  };
  if (browserName === 'firefox') {
    assert.equal(process.env.E2E_CONTAINER, '1', 'Firefox XTest drag requires the dedicated E2E Compose container');
    const origin = await browser.execute(() => ({
      x: window.mozInnerScreenX,
      y: window.mozInnerScreenY,
      dpr: window.devicePixelRatio,
    }));
    assert.equal(origin.dpr, 1, 'Firefox XTest coordinates require a 1:1 Xvfb display scale');
    assert.ok(Number.isFinite(origin.x) && Number.isFinite(origin.y), 'Firefox did not expose the panel screen origin');
    const screenStart = { x: Math.round(origin.x + start.x), y: Math.round(origin.y + start.y) };
    const screenEnd = { x: Math.round(origin.x + end.x), y: Math.round(origin.y + end.y) };
    const move = (point) => execFileSync('xdotool', ['mousemove', '--sync', String(point.x), String(point.y)]);
    let pressed = false;
    try {
      move(screenStart);
      pressed = true;
      execFileSync('xdotool', ['mousedown', '1']);
      await sleep(150);
      for (let step = 1; step <= 8; step++) {
        move({
          x: Math.round(screenStart.x + ((screenEnd.x - screenStart.x) * step) / 8),
          y: Math.round(screenStart.y + ((screenEnd.y - screenStart.y) * step) / 8),
        });
        await sleep(80);
      }
      await sleep(200);
    } finally {
      if (pressed) execFileSync('xdotool', ['mouseup', '1']);
    }
    return;
  }
  try {
    await browser.performActions([
      {
        type: 'pointer',
        id: 'e2e-mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          { type: 'pointerMove', duration: 0, ...start },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 100 },
          { type: 'pointerMove', duration: 150, ...end },
          { type: 'pause', duration: 100 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ]);
  } finally {
    await browser.releaseActions();
  }
}

for (const browserName of browserTargets()) {
  describe(`side panel UI: ${browserName}`, { concurrency: false }, () => {
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
        await h.openPanel();
      } catch (error) {
        try {
          await h.captureFailure('beforeEach');
        } catch {
          /* Keep the original setup failure. */
        }
        throw error;
      }
    });

    test('creates all four match modes, validates input, and supports Enter and Escape', async () => {
      const browser = await panel(h);
      await click(browser, 'button[aria-label="Add rule"]');
      const modal = await dialog(browser);
      assert.equal(await browser.execute(() => document.activeElement?.getAttribute('aria-label')), 'Project ID');
      const add = await modal.$('button=Add');
      assert.equal(await add.isEnabled(), false);
      await fill(browser, await modal.$('input[aria-label="Project ID"]'), '   ');
      assert.equal(await add.isEnabled(), false);

      await chooseMatchType(browser, modal, 'regex');
      const pattern = await modal.$('input[aria-label="Pattern"]');
      await fill(browser, pattern, 'svc-[');
      await modal.$('//*[normalize-space(.)="Invalid regular expression"]').waitForDisplayed();
      assert.equal(await add.isEnabled(), false);
      await fill(browser, pattern, '^svc-[0-9]+$');
      await browser.keys('Enter');
      await waitStored(h, (value) => value.projectRules?.some((item) => item.pattern === '^svc-[0-9]+$'));
      await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });

      await addRuleThroughUi(h, 'prefix', 'team-');
      await addRuleThroughUi(h, 'suffix', '-prod');
      await addRuleThroughUi(h, 'exact', '  exact-project  ');
      const saved = await stored(h);
      assert.deepEqual(
        saved.projectRules.map(({ matchType, pattern: value }) => [matchType, value]),
        [
          ['regex', '^svc-[0-9]+$'],
          ['prefix', 'team-'],
          ['suffix', '-prod'],
          ['exact', 'exact-project'],
        ],
      );

      await click(browser, 'button[aria-label="Add rule"]');
      const cancel = await dialog(browser);
      await fill(browser, await cancel.$('input[aria-label="Project ID"]'), 'discard-me');
      await browser.keys('Escape');
      await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });
      assert.equal((await stored(h)).projectRules.length, 4);
      await click(browser, 'button[aria-label="Add rule"]');
      const reopened = await dialog(browser);
      assert.equal(await reopened.$('input[aria-label="Project ID"]').getValue(), '');
      assert.equal(await browser.execute(() => document.activeElement?.getAttribute('aria-label')), 'Project ID');
      await browser.keys('Escape');
      await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });
    });

    test('edits and duplicates a rule independently, and gates deletion behind a dismissible confirmation', async () => {
      await h.seedSettings(settings(rule('base', 'old-id')));
      const browser = await panel(h);
      await openDetail(browser);
      await fill(browser, await browser.$('input[aria-label="Project ID"]'), 'edited-id');
      const trigger = await browser.$('button[aria-haspopup="listbox"]');
      await trigger.click();
      await browser.$('//*[@role="option" and normalize-space(.)="Starts with"]').click();
      await waitStored(
        h,
        (value) => value.projectRules?.[0]?.pattern === 'edited-id' && value.projectRules[0].matchType === 'prefix',
      );
      await click(browser, 'button[aria-label="Back"]');
      await (await rowAt(browser, 0)).$('button[aria-label="Duplicate"]').click();
      const duplicated = await waitStored(h, (value) => value.projectRules?.length === 2);
      assert.equal(duplicated.projectRules[1].pattern, 'edited-id');
      assert.notEqual(duplicated.projectRules[0].id, duplicated.projectRules[1].id);
      await openDetail(browser, 1);
      await fill(browser, await browser.$('input[aria-label="Project ID"]'), 'copy-id');
      const independentlyEdited = await waitStored(h, (value) => value.projectRules?.[1]?.pattern === 'copy-id');
      assert.equal(independentlyEdited.projectRules[0].pattern, 'edited-id');
      await click(browser, 'button[aria-label="Back"]');

      await (await rowAt(browser, 1)).$('button[aria-label="Delete"]').click();
      await dialog(browser);
      await browser.keys('Escape');
      await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });
      assert.equal((await stored(h)).projectRules.length, 2);
      await (await rowAt(browser, 1)).$('button[aria-label="Delete"]').click();
      const confirmation = await dialog(browser);
      await confirmation.$('button=Delete').click();
      const remaining = await waitStored(h, (value) => value.projectRules?.length === 1);
      assert.equal(remaining.projectRules[0].pattern, 'edited-id');

      await openDetail(browser);
      const matchType = await browser.$('button[aria-haspopup="listbox"]');
      await matchType.click();
      await browser.$('//*[@role="option" and normalize-space(.)="Regex"]').click();
      const pattern = await browser.$('input[aria-label="Pattern"]');
      await fill(browser, pattern, '[');
      const invalidPattern = await browser.$('//*[normalize-space(.)="Invalid regular expression"]');
      await invalidPattern.waitForDisplayed();
      const invalidRegex = await waitStored(
        h,
        (value) => value.projectRules?.[0]?.matchType === 'regex' && value.projectRules[0].pattern === '[',
      );
      assert.equal(invalidRegex.projectRules[0].pattern, '[', 'an invalid regex remains visible while editing');
      await fill(browser, pattern, '^edited-id$');
      const validRegex = await waitStored(
        h,
        (value) => value.projectRules?.[0]?.matchType === 'regex' && value.projectRules[0].pattern === '^edited-id$',
      );
      assert.equal(validRegex.projectRules[0].pattern, '^edited-id$');
      await browser.waitUntil(async () => !(await invalidPattern.isDisplayed()), {
        timeout: 5000,
        timeoutMsg: 'valid regex did not clear the detail validation message',
      });
    });

    test('reorders rules from the grip and ignores a drag that starts on the rule text', async () => {
      const exactSettings = projectSettings({
        topBar: { enabled: true, color: { paletteId: null, custom: '#cc0000' }, height: 4, stripes: false },
      });
      const prefixSettings = projectSettings({
        topBar: { enabled: true, color: { paletteId: null, custom: '#00cc00' }, height: 4, stripes: false },
      });
      await h.seedSettings(
        settings(
          rule('a', 'alpha', 'exact', exactSettings),
          rule('b', 'a', 'prefix', prefixSettings),
          rule('c', 'prod', 'suffix'),
        ),
      );
      const browser = await panel(h);
      await browser.waitUntil(async () => (await h.snapshotConsole()).topBar.backgroundColor === 'rgb(204, 0, 0)', {
        timeout: 8000,
        interval: 100,
        timeoutMsg: 'the first matching rule did not color the target project',
      });
      await panel(h);
      const first = await rowAt(browser, 0);
      const third = await rowAt(browser, 2);
      await dragWithPointer(browser, await first.$('span[aria-hidden="true"]'), third, browserName);
      const reordered = await waitStored(h, (value) => value.projectRules?.[0]?.matchType === 'prefix');
      assert.deepEqual(
        reordered.projectRules.map((item) => item.pattern),
        ['a', 'prod', 'alpha'],
      );

      const before = reordered.projectRules.map((item) => item.pattern);
      const fromText = await (await rowAt(browser, 0)).$('span:not([aria-hidden="true"])');
      await dragWithPointer(browser, fromText, await rowAt(browser, 2), browserName);
      let afterTextDrag;
      const unchangedSince = Date.now();
      await browser.waitUntil(
        async () => {
          afterTextDrag = (await stored(h)).projectRules.map((item) => item.pattern);
          return JSON.stringify(afterTextDrag) !== JSON.stringify(before) || Date.now() - unchangedSince >= 400;
        },
        { timeout: 1000, interval: 50, timeoutMsg: 'text drag did not settle within the stability window' },
      );
      assert.deepEqual(afterTextDrag, before, 'dragging from rule text must not change rule order');
      await browser.waitUntil(async () => (await h.snapshotConsole()).topBar.backgroundColor === 'rgb(0, 204, 0)', {
        timeout: 8000,
        interval: 100,
        timeoutMsg: 'reordered priority did not select the new first matching rule',
      });
    });

    test('edits a rule-scoped palette, surface colors, auto text, stripes, and bounded height', async () => {
      const otherPalette = {
        enabled: true,
        entries: [{ id: 'other-color', name: 'Other', color: '#abcdef' }],
      };
      const otherSettings = projectSettings({
        palette: otherPalette,
        topBar: { enabled: true, color: { paletteId: 'other-color', custom: '#abcdef' }, height: 8, stripes: false },
      });
      await h.seedSettings(settings(rule('first', 'project-a'), rule('second', 'project-b', 'exact', otherSettings)));
      const browser = await panel(h);
      await openDetail(browser);
      const paletteSwitch = await switchByLabel(browser, 'Color palette');
      await paletteSwitch.click();
      await click(browser, 'button[aria-label="Add color"]');
      await waitStored(h, (value) => value.projectRules?.[0]?.settings.palette.entries.length === 1);
      const name = await browser.$('input[aria-label="Color name"]');
      await fill(browser, name, 'Brand');
      await setColor(browser, await browser.$('input[type="color"]'), '#cc3366');
      await waitStored(h, (value) => value.projectRules?.[0]?.settings.palette.entries[0]?.color === '#cc3366');

      await (await switchByLabel(browser, 'Top bar')).click();
      await click(browser, 'button[aria-label="Top bar color"]');
      await click(browser, 'button[aria-label="Brand"]');
      await browser.keys('Escape');
      await waitStored(h, (value) => Boolean(value.projectRules?.[0]?.settings.topBar.color.paletteId));
      const height = await browser.$('input[aria-label="Top bar height"]');
      await waitForPopoverClosed(browser, await browser.$('button[aria-label="Top bar color"]'));
      await height.waitForClickable({
        timeout: 5000,
        timeoutMsg: 'top bar height control remained blocked after closing its color picker',
      });
      await fill(browser, height, '40');
      await waitStored(h, (value) => value.projectRules?.[0]?.settings.topBar.height === 40);
      await fill(browser, height, '1');
      await waitStored(h, (value) => value.projectRules?.[0]?.settings.topBar.height === 1);
      const waitForHeightToStay = async (expected, input) => {
        let stableSince;
        await browser.waitUntil(
          async () => {
            const current = (await stored(h)).projectRules?.[0]?.settings.topBar.height;
            if (current !== expected) {
              stableSince = undefined;
              return false;
            }
            stableSince ??= Date.now();
            return Date.now() - stableSince >= 400;
          },
          { timeout: 5000, interval: 100, timeoutMsg: `top bar height did not settle after entering ${input}` },
        );
      };
      await fill(browser, height, '0');
      await waitForHeightToStay(1, '0');
      assert.equal((await stored(h)).projectRules[0].settings.topBar.height, 1);
      await fill(browser, height, '1.5');
      await waitForHeightToStay(1, '1.5');
      assert.equal((await stored(h)).projectRules[0].settings.topBar.height, 1);
      await fill(browser, height, '41');
      await waitForHeightToStay(4, '41');
      assert.equal(
        (await stored(h)).projectRules[0].settings.topBar.height,
        4,
        'the valid first digit is saved before the invalid 41 is rejected',
      );
      await fill(browser, height, '1');
      await waitStored(h, (value) => value.projectRules?.[0]?.settings.topBar.height === 1);
      await fill(browser, height, '');
      await waitForHeightToStay(1, 'empty input');
      assert.equal((await stored(h)).projectRules[0].settings.topBar.height, 1);

      const palette = await waitStored(h, (value) => value.projectRules?.[0]?.settings.palette.enabled);
      const brandId = palette.projectRules[0].settings.topBar.color.paletteId;
      await (await switchByLabel(browser, 'Color palette')).click();
      const paletteDisabled = await waitStored(
        h,
        (value) => value.projectRules?.[0]?.settings.palette.enabled === false,
      );
      assert.equal(
        paletteDisabled.projectRules[0].settings.palette.entries.length,
        palette.projectRules[0].settings.palette.entries.length,
      );
      assert.equal(paletteDisabled.projectRules[0].settings.topBar.color.paletteId, brandId);
      await (await switchByLabel(browser, 'Color palette')).click();
      await waitStored(h, (value) => value.projectRules?.[0]?.settings.palette.enabled === true);

      await (await switchByLabel(browser, 'Stripes')).click();
      await waitStored(h, (value) => value.projectRules?.[0]?.settings.topBar.stripes === true);
      await (await switchByLabel(browser, 'Platform Bar')).click();
      const stripeSwitches = await browser.$$('//label[.//input[@role="switch"] and normalize-space(.)="Stripes"]');
      assert.equal(stripeSwitches.length, 2, 'both surface-specific Stripes controls should be rendered');
      await stripeSwitches[1].click();
      await waitStored(h, (value) => value.projectRules?.[0]?.settings.platformBar.stripes === true);
      const updatedStripeSwitches = await browser.$$(
        '//label[.//input[@role="switch"] and normalize-space(.)="Stripes"]',
      );
      assert.equal(updatedStripeSwitches.length, 2);
      await updatedStripeSwitches[1].click();
      await waitStored(h, (value) => value.projectRules?.[0]?.settings.platformBar.stripes === false);

      await (await switchByLabel(browser, 'Platform Bar text color')).click();
      await click(browser, 'button[aria-label="Platform Bar text color"]');
      await click(browser, 'button[aria-label="Auto"]');
      const autoText = await waitStored(h, (value) => value.projectRules?.[0]?.settings.platformBarText.auto === true);
      assert.equal(autoText.projectRules[0].settings.platformBarText.color.custom, '#345678');
      await click(browser, 'button[aria-label="Brand"]');
      const paletteText = await waitStored(
        h,
        (value) =>
          value.projectRules?.[0]?.settings.platformBarText.auto === false &&
          value.projectRules[0].settings.platformBarText.color.paletteId === brandId,
      );
      assert.equal(paletteText.projectRules[0].settings.platformBarText.color.custom, '#345678');
      await setColor(browser, await browser.$('input[aria-label="Custom color"]'), '#223344');
      await browser.keys('Escape');
      const saved = await waitStored(h, (value) => value.projectRules?.[0]?.settings.platformBarText.auto === false);
      assert.equal(saved.projectRules[0].settings.platformBarText.color.custom, '#223344');
      assert.equal(saved.projectRules[1].settings.palette.entries[0].name, 'Other');

      const platformTextPicker = await browser.$('button[aria-label="Platform Bar text color"]');
      await waitForPopoverClosed(browser, platformTextPicker);
      await (await browser.$('button[aria-label="Platform Bar color"]')).waitForClickable({
        timeout: 5000,
        timeoutMsg: 'text color popover did not close before opening the platform color picker',
      });
      await click(browser, 'button[aria-label="Platform Bar color"]');
      await click(browser, 'button[aria-label="Brand"]');
      await browser.keys('Escape');
      const platformPicker = await browser.$('button[aria-label="Platform Bar color"]');
      await waitForPopoverClosed(browser, platformPicker);
      await platformTextPicker.waitForClickable({
        timeout: 5000,
        timeoutMsg: 'platform color popover did not close before reopening the text color picker',
      });
      await click(browser, 'button[aria-label="Platform Bar text color"]');
      await click(browser, 'button[aria-label="Brand"]');
      await browser.keys('Escape');
      await waitForPopoverClosed(browser, platformTextPicker);
      let referenced = await waitStored(
        h,
        (value) =>
          value.projectRules?.[0]?.settings.platformBar.color.paletteId === brandId &&
          value.projectRules[0].settings.platformBarText.color.paletteId === brandId,
      );
      assert.equal(referenced.projectRules[0].settings.topBar.color.paletteId, brandId);

      for (const label of ['Top bar', 'Platform Bar', 'Platform Bar text color']) {
        await (await switchByLabel(browser, label)).click();
      }
      const disabled = await waitStored(
        h,
        (value) =>
          value.projectRules?.[0]?.settings.topBar.enabled === false &&
          value.projectRules[0].settings.platformBar.enabled === false &&
          value.projectRules[0].settings.platformBarText.enabled === false,
      );
      assert.deepEqual(
        [
          disabled.projectRules[0].settings.topBar.enabled,
          disabled.projectRules[0].settings.platformBar.enabled,
          disabled.projectRules[0].settings.platformBarText.enabled,
        ],
        [false, false, false],
      );
      for (const label of ['Top bar', 'Platform Bar', 'Platform Bar text color']) {
        await (await switchByLabel(browser, label)).click();
      }
      await waitStored(
        h,
        (value) =>
          value.projectRules?.[0]?.settings.topBar.enabled === true &&
          value.projectRules[0].settings.platformBar.enabled === true &&
          value.projectRules[0].settings.platformBarText.enabled === true,
      );
      await h.reloadPanel();
      await openDetail(browser);
      referenced = await stored(h);
      assert.equal(referenced.projectRules[0].settings.topBar.enabled, true);
      assert.equal(referenced.projectRules[0].settings.platformBar.enabled, true);
      assert.equal(referenced.projectRules[0].settings.platformBarText.enabled, true);
      assert.equal(referenced.projectRules[0].settings.platformBar.color.paletteId, brandId);
      assert.equal(referenced.projectRules[0].settings.platformBarText.color.paletteId, brandId);
      const surfaceLabels = ['Top bar', 'Platform Bar', 'Platform Bar text color'];
      await browser.waitUntil(
        async () =>
          (await browser.$('input[aria-label="Top bar height"]').getValue()) === '1' &&
          (
            await Promise.all(
              surfaceLabels.map(async (label) =>
                (await (await switchByLabel(browser, label)).$('input[role="switch"]')).isSelected(),
              ),
            )
          ).every(Boolean),
        { timeout: 5000, interval: 100, timeoutMsg: 'reloaded surface settings were not visible in the detail panel' },
      );
      assert.equal(await browser.$('input[aria-label="Top bar height"]').getValue(), '1');
      for (const label of ['Top bar color', 'Platform Bar color', 'Platform Bar text color']) {
        const picker = await browser.$(`button[aria-label="${label}"]`);
        assert.equal(await picker.getText(), 'Brand');
        assert.equal(
          await browser.execute(
            (button) => getComputedStyle(button.querySelector('span[aria-hidden="true"]')).backgroundColor,
            picker,
          ),
          'rgb(204, 51, 102)',
          `${label} swatch should show the referenced Brand color after reload`,
        );
      }
      for (const label of surfaceLabels) {
        assert.equal(
          await (await (await switchByLabel(browser, label)).$('input[role="switch"]')).isSelected(),
          true,
          `${label} should appear enabled after reload`,
        );
      }

      await (await browser.$('button[aria-label="Remove color"]')).click();
      await dialog(browser);
      await browser.keys('Escape');
      await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });
      assert.equal((await stored(h)).projectRules[0].settings.palette.entries.length, 1);
      await (await browser.$('button[aria-label="Remove color"]')).click();
      const confirm = await dialog(browser);
      await confirm.$('button=Remove').click();
      const removed = await waitStored(h, (value) => value.projectRules?.[0]?.settings.palette.entries.length === 0);
      for (const surface of ['topBar', 'platformBar', 'platformBarText']) {
        assert.equal(
          removed.projectRules[0].settings[surface].color.paletteId,
          null,
          `${surface} palette reference should clear`,
        );
      }
      assert.equal(removed.projectRules[0].settings.topBar.color.custom, '#123456');
      assert.equal(removed.projectRules[0].settings.platformBar.color.custom, '#234567');
      assert.equal(removed.projectRules[0].settings.platformBarText.color.custom, '#223344');
      assert.equal(removed.projectRules[1].settings.palette.entries[0].name, 'Other');
      await h.reloadPanel();
      await openDetail(browser);
      const reloaded = await stored(h);
      await browser.waitUntil(
        async () =>
          (await browser.$('input[aria-label="Top bar height"]').getValue()) === '1' &&
          (
            await Promise.all(
              surfaceLabels.map(async (label) =>
                (await (await switchByLabel(browser, label)).$('input[role="switch"]')).isSelected(),
              ),
            )
          ).every(Boolean),
        { timeout: 5000, interval: 100, timeoutMsg: 'reloaded defaults were not visible in the detail panel' },
      );
      assert.equal(await browser.$('input[aria-label="Top bar height"]').getValue(), '1');
      for (const surface of ['topBar', 'platformBar', 'platformBarText']) {
        assert.equal(
          reloaded.projectRules[0].settings[surface].color.paletteId,
          null,
          `${surface} clear should persist after panel reload`,
        );
        assert.equal(
          reloaded.projectRules[0].settings[surface].enabled,
          true,
          `${surface} enabled state should persist after panel reload`,
        );
      }
      for (const label of surfaceLabels) {
        assert.equal(
          await (await (await switchByLabel(browser, label)).$('input[role="switch"]')).isSelected(),
          true,
          `${label} should appear enabled after reload`,
        );
      }
      for (const [label, text, color] of [
        ['Top bar color', '#123456', 'rgb(18, 52, 86)'],
        ['Platform Bar color', '#234567', 'rgb(35, 69, 103)'],
        ['Platform Bar text color', '#223344', 'rgb(34, 51, 68)'],
      ]) {
        const picker = await browser.$(`button[aria-label="${label}"]`);
        assert.equal(await picker.getText(), text);
        assert.equal(
          await browser.execute(
            (button) => getComputedStyle(button.querySelector('span[aria-hidden="true"]')).backgroundColor,
            picker,
          ),
          color,
          `${label} swatch should use its custom fallback after removing Brand`,
        );
      }
    });

    test('downloads a real JSON backup and imports selected rules while replacing duplicates in place', async () => {
      const initial = settings(
        rule(
          'keep',
          'same',
          'exact',
          projectSettings({
            palette: { enabled: true, entries: [{ id: 'brand', name: 'Brand', color: '#cc3366' }] },
            topBar: { enabled: true, color: { paletteId: 'brand', custom: '#123456' }, height: 13, stripes: true },
            platformBar: {
              enabled: true,
              color: { paletteId: 'brand', custom: '#234567' },
              stripes: true,
            },
            platformBarText: { enabled: true, color: { paletteId: null, custom: '#345678' }, auto: true },
          }),
        ),
        rule('tail', 'tail'),
      );
      await h.seedSettings(initial);
      const browser = await panel(h);
      await selectTab(browser, 'Settings');
      const importInput = await browser.$('input[aria-label="Import settings file"]');
      await browser.execute((input) => {
        input.dataset.e2eClickForwarded = '0';
        input.click = () => {
          input.dataset.e2eClickForwarded = String(Number(input.dataset.e2eClickForwarded) + 1);
        };
      }, importInput);
      try {
        await click(browser, 'button=Import…');
        assert.equal(
          await browser.execute((input) => input.dataset.e2eClickForwarded, importInput),
          '1',
          'Import button did not forward activation to the file input',
        );
      } finally {
        await browser.execute((input) => {
          delete input.click;
          delete input.dataset.e2eClickForwarded;
        }, importInput);
      }
      for (const name of await readdir(h.downloadDir)) {
        if (name.endsWith('.json')) await unlink(join(h.downloadDir, name));
      }
      await click(browser, 'button=Export');
      let exportedName;
      await browser.waitUntil(
        async () => {
          exportedName = (await readdir(h.downloadDir)).find((name) =>
            /^gcp-console-tint-settings-\d{4}-\d{2}-\d{2}\.json$/.test(name),
          );
          return Boolean(exportedName);
        },
        { timeout: 10000, timeoutMsg: 'Export did not produce a downloaded JSON file' },
      );
      const exported = JSON.parse(await readFile(join(h.downloadDir, exportedName), 'utf8'));
      const date = await browser.execute(() => {
        const now = new Date();
        const pad = (value) => String(value).padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      });
      assert.equal(exportedName, `gcp-console-tint-settings-${date}.json`);
      assert.equal(exported.schemaVersion, VERSION);
      assert.deepEqual(exported, initial);

      await h.seedSettings(settings());
      await selectTab(browser, 'Settings');
      const backupInput = await browser.$('input[aria-label="Import settings file"]');
      await setFileInput(browser, backupInput, join(h.downloadDir, exportedName));
      await dialog(browser);
      await click(browser, 'button=Import 2 rules');
      await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });
      const roundTripped = await stored(h);
      assert.deepEqual(
        roundTripped.projectRules.map(({ id, ...item }) => item),
        initial.projectRules.map(({ id, ...item }) => item),
        'importing the exported backup should round-trip every rule and setting',
      );

      await h.seedSettings(initial);
      await selectTab(browser, 'Settings');
      const replacement = rule(
        'file-duplicate-id',
        'same',
        'exact',
        projectSettings({
          topBar: { enabled: true, color: { paletteId: null, custom: '#aabbcc' }, height: 4, stripes: false },
        }),
      );
      const laterReplacement = rule(
        'file-duplicate-id',
        'same',
        'exact',
        projectSettings({
          topBar: { enabled: true, color: { paletteId: null, custom: '#ddeeff' }, height: 9, stripes: true },
        }),
      );
      const incoming = settings(
        replacement,
        laterReplacement,
        rule('file-duplicate-id', 'new'),
        rule('skip-id', 'skip'),
      );
      await uploadJson(h, 'cancel.json', settings(rule('cancel-id', 'cancel')));
      await dialog(browser);
      const selection = await browser.$('//label[.//input[@type="checkbox"] and contains(., "Select all")]');
      await selection.click();
      const importNone = await browser.$('button=Import 0 rules');
      assert.equal(await importNone.isEnabled(), false, 'Import should be disabled with no selected rules');
      await selection.click();
      await browser.keys('Escape');
      await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });
      assert.deepEqual(
        (await stored(h)).projectRules.map((item) => item.pattern),
        ['same', 'tail'],
      );

      await uploadJson(h, 'incoming.json', incoming);
      await dialog(browser);
      const warning = await browser.$('.alert--warning');
      await warning.waitForDisplayed();
      assert.match(await warning.getText(), /Replaces 2 existing rules/);
      await browser.$('//label[.//input[@type="checkbox" and @aria-label="skip"]]').click();
      await click(browser, 'button=Import 3 rules');
      await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });
      const imported = await waitStored(h, (value) => value.projectRules?.some((item) => item.pattern === 'new'));
      assert.deepEqual(
        imported.projectRules.map((item) => item.pattern),
        ['same', 'tail', 'new'],
      );
      assert.equal(imported.projectRules[0].id, 'keep');
      assert.equal(
        imported.projectRules[0].settings.topBar.color.custom,
        '#ddeeff',
        'the later matching file rule should win',
      );
      assert.equal(imported.projectRules[0].settings.topBar.height, 9);
      assert.notEqual(imported.projectRules[2].id, 'file-duplicate-id');
      assert.equal(new Set(imported.projectRules.map((item) => item.id)).size, imported.projectRules.length);
      assert.equal(
        imported.projectRules.some((item) => item.pattern === 'skip'),
        false,
      );
    });

    test('shows every parser refusal reason and invalid field path without changing stored rules', async () => {
      const original = settings(rule('safe', 'safe-project'));
      await h.seedSettings(original);
      const browser = await panel(h);
      await selectTab(browser, 'Settings');
      const input = await browser.$('input[aria-label="Import settings file"]');
      const failures = [
        {
          name: 'invalid-json.json',
          content: '{',
          message: /invalid-json\.json could not be parsed as JSON\./,
          detail: /SyntaxError/,
        },
        {
          name: 'not-settings.json',
          content: '[]',
          message: /not-settings\.json isn’t a GCP Console Tint settings file\./,
        },
        {
          name: 'unsupported.json',
          content: JSON.stringify({ schemaVersion: '0.0.9', projectRules: [] }),
          message: /unsupported\.json was written by an unsupported version \(0\.0\.9\)\./,
        },
        {
          name: 'newer.json',
          content: JSON.stringify({ schemaVersion: '999.0.0', projectRules: [] }),
          message: /newer\.json was written by a newer version of GCP Console Tint \(999\.0\.0\)/,
        },
        {
          name: 'invalid-fields.json',
          content: JSON.stringify(
            settings(
              rule(
                'invalid-fields',
                'invalid',
                'exact',
                projectSettings({
                  topBar: {
                    enabled: false,
                    color: { paletteId: null, custom: 'not-a-color' },
                    height: 4,
                    stripes: false,
                  },
                }),
              ),
            ),
          ),
          message: /invalid-fields\.json has missing or invalid fields\./,
          detail: /projectRules\[0\]\.settings\.topBar\.color\.custom: expected a color/,
        },
        {
          name: 'no-rules.json',
          content: JSON.stringify({ schemaVersion: VERSION, projectRules: [] }),
          message: /no-rules\.json contains no rules\./,
        },
      ];
      for (let index = 0; index < failures.length; index++) {
        const failure = failures[index];
        const path = join(h.downloadDir, failure.name);
        await writeFile(path, failure.content);
        await setFileInput(browser, input, path);
        const currentAlert = await alertText(browser);
        assert.match(currentAlert, /Couldn’t import this file/);
        assert.match(currentAlert, failure.message);
        if (failure.detail) assert.match(currentAlert, failure.detail);
        const copyDetails = await browser.$('button=Copy details');
        assert.equal(await copyDetails.isExisting(), failure.detail !== undefined);
        if (index === 0) {
          const expectedDetails = await browser.$('.alert--danger .whitespace-pre-wrap').getText();
          assert.ok(expectedDetails, 'the parser detail should be visible before copying');

          const probeId = 'e2e-clipboard-probe';
          await browser.execute((id) => {
            const probe = document.createElement('textarea');
            probe.id = id;
            probe.setAttribute('aria-label', 'E2E clipboard probe');
            probe.style.cssText = 'position:fixed;top:8px;left:8px;width:320px;height:48px;z-index:2147483647';
            document.body.appendChild(probe);
          }, probeId);
          const probe = await browser.$(`#${probeId}`);
          try {
            await probe.setValue(`e2e-clipboard-sentinel-${Date.now()}-${Math.random()}`);
            await probe.click();
            await browser.keys([Key.Ctrl, 'a']);
            await browser.keys([Key.Ctrl, 'c']);
            await click(browser, 'button=Copy details');
            await browser.waitUntil(
              async () => {
                await probe.click();
                await browser.keys([Key.Ctrl, 'a']);
                await browser.keys([Key.Ctrl, 'v']);
                return (await probe.getValue()) === expectedDetails;
              },
              {
                timeout: 5000,
                interval: 100,
                timeoutMsg: 'Copy details did not place the visible parser detail on the clipboard',
              },
            );
          } finally {
            await browser.execute((id) => document.getElementById(id)?.remove(), probeId);
          }
        }
        assert.deepEqual(
          (await stored(h)).projectRules.map((item) => item.pattern),
          ['safe-project'],
        );
        if (index === 0) {
          await click(browser, 'button=Export');
          await browser.waitUntil(() => alertIsHidden(browser), { timeout: 5000 });
          await setFileInput(browser, input, path);
          const retryAlert = await alertText(browser);
          assert.match(retryAlert, /invalid-json\.json could not be parsed as JSON\./);
          assert.deepEqual(
            (await stored(h)).projectRules.map((item) => item.pattern),
            ['safe-project'],
          );
        }
        if (index < failures.length - 1) {
          await click(browser, 'button=Export');
          await browser.waitUntil(() => alertIsHidden(browser), { timeout: 5000 });
        }
      }
    });
  });
}
