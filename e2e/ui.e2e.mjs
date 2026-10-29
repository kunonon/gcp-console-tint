import assert from 'node:assert/strict';
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Key } from 'webdriverio';
import { projectSettings, rule, SCHEMA_VERSION, settings, THEME_HINT_KEY } from './fixtures.mjs';
import { browserTargets, createHarness } from './harness.mjs';

const MATCH_LABELS = { prefix: 'Starts with', suffix: 'Ends with', exact: 'Exact', regex: 'Regex' };

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
  await element.scrollIntoView({ block: 'center' });
  await element.waitForClickable();
  await element.click();
  return element;
}

// The panel's enter and exit motion (style.css, components/Presence.tsx) keeps a leaving row, section
// or tab panel mounted and inert for about 200ms, clips an entering one while its height grows, and
// moves whatever sits below either of them, so a direct click right after such a change can be
// intercepted or miss. Resolves once no finite animation or transition is running. HeroUI's
// scroll-shadow animations run on a ScrollTimeline and never finish, so they are ignored.
async function motionIdle(browser) {
  await browser.waitUntil(
    () =>
      browser.execute(
        () =>
          !document
            .getAnimations()
            .some(
              (animation) =>
                animation.timeline === document.timeline &&
                Number.isFinite(animation.effect?.getComputedTiming().endTime) &&
                (animation.playState === 'running' || animation.playState === 'pending'),
            ),
      ),
    { timeout: 5000, interval: 50, timeoutMsg: 'panel motion did not settle' },
  );
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

async function waitForPopoverClosed(browser) {
  const popover = await browser.$('[role="dialog"]');
  if (await popover.isDisplayed()) await browser.keys('Escape');
  await browser.waitUntil(async () => !(await browser.$('[role="dialog"]').isDisplayed()), {
    timeout: 5000,
    timeoutMsg: 'color popover did not close after selecting a palette entry',
  });
}

async function stored(h) {
  return h.readSettings();
}

async function waitStored(h, predicate) {
  let matched;
  await h.browser.waitUntil(
    async () => {
      matched = await stored(h);
      return matched !== null && predicate(matched);
    },
    {
      timeout: 5000,
      timeoutMsg: 'extension storage did not reach the expected state',
    },
  );
  return matched;
}

async function dialog(browser) {
  const element = await browser.$('[role="dialog"]');
  await element.waitForDisplayed();
  return element;
}

async function dialogIsClosed(browser) {
  const element = await browser.$('[role="dialog"]');
  return !(await element.isDisplayed());
}

async function alertText(browser, expected) {
  await browser.waitUntil(
    async () => {
      const alert = await browser.$('[role="alert"]');
      return (await alert.isDisplayed()) && expected.test(await alert.getText());
    },
    { timeout: 5000, interval: 100, timeoutMsg: `alert did not show ${expected}` },
  );
  return await (await browser.$('[role="alert"]')).getText();
}

async function statusText(browser, expected) {
  await browser.waitUntil(
    async () => {
      const status = await browser.$('[role="status"]');
      return (await status.isDisplayed()) && expected.test(await status.getText());
    },
    { timeout: 5000, interval: 100, timeoutMsg: `status did not show ${expected}` },
  );
  return await (await browser.$('[role="status"]')).getText();
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
  await modal.$('button=Add').click();
  await waitStored(h, (storedSettings) =>
    storedSettings.projectRules?.some((item) => item.matchType === type && item.pattern === value.trim()),
  );
  await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });
}

async function rowAt(browser, index) {
  // A deleted row stays in the document, inert, until its exit ends, and would shift the indices; a
  // row that has just been added is still clipped.
  await motionIdle(browser);
  let rows = [];
  await browser.waitUntil(
    async () => {
      rows = await browser.$$('[data-rule-row]');
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
  await click(browser, `//*[@role="tab" and normalize-space(.)="${name}"]`);
}

// Types into the hex input of the open colour popover ("Hex" in a palette row's, "Custom color"
// in a surface picker's) with a real click and real keys. In a surface picker that click is also
// a press on the custom control, which makes the kept custom colour the choice before any key.
async function typeHex(browser, label, text) {
  const input = await browser.$(`[role="dialog"] input[aria-label="${label}"]`);
  await input.waitForDisplayed();
  await fill(browser, input, text);
  return input;
}

// Reads something from the page until two reads 200ms apart agree: a popover scales in when it
// opens and a thumb eases to its place, so a rectangle read once can be a frame of that motion.
async function settled(browser, read, label, ...args) {
  let previous;
  let current;
  await browser.waitUntil(
    async () => {
      previous = current;
      current = await browser.execute(read, ...args);
      return previous !== undefined && JSON.stringify(previous) === JSON.stringify(current);
    },
    { timeout: 5000, interval: 200, timeoutMsg: `${label} did not settle` },
  );
  return current;
}

// The open colour popover's boxes in viewport pixels, rounded to 0.01.
function readColorPopover() {
  const box = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const round = (value) => Math.round(value * 100) / 100;
    return {
      left: round(rect.left),
      top: round(rect.top),
      right: round(rect.right),
      bottom: round(rect.bottom),
      width: round(rect.width),
      height: round(rect.height),
    };
  };
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return null;
  return {
    dialog: box(dialog),
    placement: dialog.closest('[data-placement]')?.getAttribute('data-placement') ?? null,
    well: box(dialog.querySelector('.color-well')),
    face: box(dialog.querySelector('.color-well .color-area')),
    strip: box(dialog.querySelector('.color-well .color-slider__track')),
    faceThumb: box(dialog.querySelector('.color-well .color-area__thumb')),
    hueThumb: box(dialog.querySelector('.color-well .color-slider__thumb')),
  };
}

// The longhands of style.css that react-aria's inline `background` shorthand resets on every
// change, one entry per background layer (an engine may list a value once or once per layer).
function readWellCss() {
  const layers = (value) => value.split(',').map((layer) => layer.trim());
  const face = getComputedStyle(document.querySelector('[role="dialog"] .color-well .color-area'));
  const strip = getComputedStyle(document.querySelector('[role="dialog"] .color-well .color-slider__track'));
  return {
    faceOrigin: layers(face.backgroundOrigin),
    stripRepeat: layers(strip.backgroundRepeat),
    stripColor: strip.backgroundColor,
  };
}

function assertWellCss(css, label) {
  assert.ok(
    css.faceOrigin.every((layer) => layer === 'border-box'),
    `${label}: the face's gradients should still start at the border box, got ${css.faceOrigin.join(', ')}`,
  );
  assert.ok(
    css.stripRepeat.every((layer) => layer === 'no-repeat'),
    `${label}: the hue gradient should still not repeat under the strip's borders, got ${css.stripRepeat.join(', ')}`,
  );
  assert.equal(css.stripColor, 'rgb(255, 0, 0)', `${label}: the strip's ends should still be red`);
}

// A held mouse drag through viewport points, as WebDriver pointer actions: the pointer events
// react-aria's colour area and slider, and the rule list's grips, listen to.
async function dragThrough(browser, points) {
  const [start, ...rest] = points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
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
          ...rest.flatMap((point) => [
            { type: 'pointerMove', duration: 80, ...point },
            { type: 'pause', duration: 40 },
          ]),
          { type: 'pointerUp', button: 0 },
        ],
      },
    ]);
  } finally {
    await browser.releaseActions();
  }
}

// Viewport points for a reorder drag: from the center of `from` to two thirds of a row past the
// center of the `target` row, in the drag's direction, so the end is never exactly on a midpoint.
// Three points between let the passed rows make way on the way there.
async function reorderPath(browser, from, target) {
  const { start, end } = await browser.execute(
    (source, row) => {
      source.scrollIntoView({ block: 'center', inline: 'nearest' });
      const a = source.getBoundingClientRect();
      const b = row.getBoundingClientRect();
      const x = a.left + a.width / 2;
      const y = a.top + a.height / 2;
      const middle = b.top + b.height / 2;
      const past = (b.height * 2) / 3;
      return { start: { x, y }, end: { x, y: middle + (middle > y ? past : -past) } };
    },
    from,
    target,
  );
  const between = [1, 2, 3].map((step) => ({ x: start.x, y: start.y + ((end.y - start.y) * step) / 4 }));
  return [start, ...between, end];
}

const centerOf = (box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });

// Moves the mouse onto the middle of `element` without pressing it, as a WebDriver pointer action,
// so the page sees a real hover there.
async function pointTo(browser, element) {
  await element.scrollIntoView({ block: 'center' });
  const { x, y } = centerOf(
    await browser.execute((target) => {
      const { left, right, top, bottom } = target.getBoundingClientRect();
      return { left, right, top, bottom };
    }, element),
  );
  await browser.performActions([
    {
      type: 'pointer',
      id: 'e2e-mouse',
      parameters: { pointerType: 'mouse' },
      actions: [{ type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) }],
    },
  ]);
}

// The computed opacity of each rule row's selection checkbox, in row order.
async function ruleSelectOpacities(browser) {
  return browser.execute(() =>
    [...document.querySelectorAll('[data-rule-row] .rule-select')].map((element) => getComputedStyle(element).opacity),
  );
}

// 'rgb(r, g, b)' as a computed style gives it, to the '#rrggbb' storage holds.
function rgbToHex(rgb) {
  const channels = rgb.match(/\d+/g)?.slice(0, 3) ?? [];
  assert.equal(channels.length, 3, `expected an rgb() colour, got ${rgb}`);
  return `#${channels.map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`;
}

const hexChannels = (hex) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));

async function chipColor(browser, triggerLabel) {
  return rgbToHex(
    await browser.execute(
      (label) => getComputedStyle(document.querySelector(`button[aria-label="${label}"] .color-chip`)).backgroundColor,
      triggerLabel,
    ),
  );
}

// One rule whose palette holds the colours at the well's corners, with every surface enabled and
// the Platform Bar text on a palette entry.
function pickerSettings() {
  return settings(
    rule(
      'picker',
      'project-a',
      'exact',
      projectSettings({
        palette: {
          enabled: true,
          entries: [
            { id: 'paper', name: 'Paper', color: '#ffffff' },
            { id: 'ink', name: 'Ink', color: '#000000' },
            { id: 'red', name: 'Red', color: '#ff0000' },
            { id: 'blue', name: 'Blue', color: '#1a73e8' },
          ],
        },
        topBar: { enabled: true, color: { paletteId: 'red', custom: '#123456' }, height: 4, stripes: false },
        platformBar: { enabled: true, color: { paletteId: null, custom: '#234567' }, stripes: false },
        platformBarText: { enabled: true, color: { paletteId: 'red', custom: '#345678' }, auto: false },
      }),
    ),
  );
}

const focusedLabel = (browser) => browser.execute(() => document.activeElement?.getAttribute('aria-label') ?? null);

// react-aria's FocusScope returns focus to a popover's trigger from an animation frame it requests
// as the popover unmounts, so for a frame after the dialog has left the document the focus is on
// <body>. Where focus lands is therefore waited for, not read once.
async function waitFocused(browser, expected, message) {
  let label;
  await browser.waitUntil(
    async () => {
      label = await focusedLabel(browser);
      return label === expected;
    },
    {
      timeout: 5000,
      interval: 50,
      timeoutMsg: () => `${message}: focus stayed on ${JSON.stringify(label)}, expected ${JSON.stringify(expected)}`,
    },
  );
}

// The Auto option of an open surface popover, found by all of its text: the option is named by
// its content, and the picker's trigger (whose text is "Auto" while Auto is in use) is not in the
// dialog.
const AUTO_OPTION = '//*[@role="dialog"]//button[normalize-space(.)="Auto Match contrast"]';

// The Auto option's height and whether its muted "Match contrast" stays within its box.
function readAutoOption() {
  const option = [...document.querySelectorAll('[role="dialog"] button')].find(
    (button) => button.textContent === 'Auto Match contrast',
  );
  if (!option) return null;
  const outer = option.getBoundingClientRect();
  const muted = option.querySelector('span:not([aria-hidden])').getBoundingClientRect();
  return {
    height: outer.height,
    mutedWithin:
      muted.top >= outer.top && muted.bottom <= outer.bottom && muted.left >= outer.left && muted.right <= outer.right,
  };
}

// The open colour popover when the window is too short for it. `popover` is the element react-aria
// caps the height of, and the dialog is what scrolls in it; `scrollTo` ('start' or 'last') is
// applied first. A control counts as reachable when its box is inside both the popover and the
// part of the dialog a scroll bar leaves free, and a pointer at its centre hits it. `below` says
// whether the dialog can be hit just under the popover's bottom edge, which is where it showed
// when it ran past the surface.
function readPopoverScroll(scrollTo) {
  const dialog = document.querySelector('[role="dialog"]');
  const popover = dialog?.closest('[data-placement]');
  if (!popover) return null;
  if (scrollTo === 'start') dialog.scrollTop = 0;
  if (scrollTo === 'last') dialog.scrollTop = dialog.scrollHeight;
  const outer = popover.getBoundingClientRect();
  const inner = dialog.getBoundingClientRect();
  const free = {
    left: Math.max(outer.left, inner.left + dialog.clientLeft),
    top: Math.max(outer.top, inner.top + dialog.clientTop),
    right: Math.min(outer.right, inner.left + dialog.clientLeft + dialog.clientWidth),
    bottom: Math.min(outer.bottom, inner.top + dialog.clientTop + dialog.clientHeight),
  };
  const reachable = (element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    return (
      box.top >= free.top &&
      box.bottom <= free.bottom &&
      box.left >= free.left &&
      box.right <= free.right &&
      element.contains(hit)
    );
  };
  return {
    viewport: window.innerHeight,
    maxHeight: popover.style.maxHeight,
    popoverHeight: popover.clientHeight,
    popoverWidth: outer.width,
    dialogWidth: inner.width,
    contentHeight: dialog.scrollHeight,
    clientWidth: dialog.clientWidth,
    scrollWidth: dialog.scrollWidth,
    scrollTop: dialog.scrollTop,
    below: dialog.contains(document.elementFromPoint((outer.left + outer.right) / 2, outer.bottom + 4)),
    firstControl: reachable(dialog.querySelector('button')),
    hueStrip: reachable(dialog.querySelector('.color-well .color-slider__track')),
  };
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
    const inlineStyle = await browser.execute((element) => element.getAttribute('style'), input);
    try {
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
    } finally {
      await browser.execute(
        (element, style) => {
          if (style === null) element.removeAttribute('style');
          else element.setAttribute('style', style);
        },
        input,
        inlineStyle,
      );
    }
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
      await h.seedSettings(settings(rule('left', 'left'), rule('base', 'old-id'), rule('right', 'right')));
      const browser = await panel(h);
      await openDetail(browser, 1);
      await fill(browser, await browser.$('input[aria-label="Project ID"]'), 'edited-id');
      await chooseMatchType(browser, browser, 'prefix');
      await waitStored(
        h,
        (value) => value.projectRules?.[1]?.pattern === 'edited-id' && value.projectRules[1].matchType === 'prefix',
      );
      await click(browser, 'button[aria-label="Back"]');
      await (await rowAt(browser, 1)).$('button[aria-label="Duplicate"]').click();
      const duplicated = await waitStored(h, (value) => value.projectRules?.length === 4);
      assert.deepEqual(
        duplicated.projectRules.map((item) => item.pattern),
        ['left', 'edited-id', 'edited-id', 'right'],
      );
      assert.deepEqual(
        [duplicated.projectRules[0].id, duplicated.projectRules[1].id, duplicated.projectRules[3].id],
        ['left', 'base', 'right'],
      );
      assert.equal(new Set(duplicated.projectRules.map((item) => item.id)).size, 4);
      assert.notEqual(duplicated.projectRules[1].id, duplicated.projectRules[2].id);
      await openDetail(browser, 2);
      await fill(browser, await browser.$('input[aria-label="Project ID"]'), 'copy-id');
      const independentlyEdited = await waitStored(h, (value) => value.projectRules?.[2]?.pattern === 'copy-id');
      assert.equal(independentlyEdited.projectRules[1].pattern, 'edited-id');
      await click(browser, 'button[aria-label="Back"]');

      await (await rowAt(browser, 2)).$('button[aria-label="Delete"]').click();
      await dialog(browser);
      await browser.keys('Escape');
      await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });
      assert.equal((await stored(h)).projectRules.length, 4);
      await (await rowAt(browser, 2)).$('button[aria-label="Delete"]').click();
      const confirmation = await dialog(browser);
      await confirmation.$('button=Delete').click();
      const remaining = await waitStored(h, (value) => value.projectRules?.length === 3);
      assert.deepEqual(
        remaining.projectRules.map((item) => item.pattern),
        ['left', 'edited-id', 'right'],
      );
      // The deleted row stays mounted, inert, while it fades and collapses, which jsdom cannot show
      // (it runs no transitions). Once the motion is over the row must be gone, and no wrapper may be
      // left inert, transparent or collapsed.
      await motionIdle(browser);
      assert.deepEqual(
        await browser.execute(() => ({
          rows: document.querySelectorAll('[data-rule-row]').length,
          inert: document.querySelectorAll('[inert]').length,
          hidden: [...document.querySelectorAll('.reveal')].filter(
            (element) => getComputedStyle(element).opacity !== '1' || element.getBoundingClientRect().height === 0,
          ).length,
        })),
        { rows: 3, inert: 0, hidden: 0 },
        'a deleted row should have left the document, with the remaining rows fully shown',
      );

      await openDetail(browser, 1);
      await chooseMatchType(browser, browser, 'regex');
      const pattern = await browser.$('input[aria-label="Pattern"]');
      await fill(browser, pattern, '[');
      // The span itself: the wrappers Presence puts around it have the same text.
      const invalidPattern = await browser.$('//span[normalize-space(.)="Invalid regular expression"]');
      await invalidPattern.waitForDisplayed();
      await waitStored(
        h,
        (value) => value.projectRules?.[1]?.matchType === 'regex' && value.projectRules[1].pattern === '[',
      );
      await fill(browser, pattern, '^edited-id$');
      await waitStored(
        h,
        (value) => value.projectRules?.[1]?.matchType === 'regex' && value.projectRules[1].pattern === '^edited-id$',
      );
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
      await dragThrough(browser, await reorderPath(browser, await first.$('[data-reorder-grip]'), third));
      const reordered = await waitStored(h, (value) => value.projectRules?.[0]?.matchType === 'prefix');
      assert.deepEqual(
        reordered.projectRules.map((item) => item.pattern),
        ['a', 'prod', 'alpha'],
      );

      const before = reordered.projectRules.map((item) => item.pattern);
      const fromText = await (await rowAt(browser, 0)).$(`.//span[normalize-space(.)="${before[0]}"]`);
      await dragThrough(browser, await reorderPath(browser, fromText, await rowAt(browser, 2)));
      let afterTextDrag;
      const unchangedSince = Date.now();
      await browser.waitUntil(
        async () => {
          afterTextDrag = (await stored(h)).projectRules.map((item) => item.pattern);
          return JSON.stringify(afterTextDrag) !== JSON.stringify(before) || Date.now() - unchangedSince >= 400;
        },
        { timeout: 5000, interval: 50, timeoutMsg: 'text drag did not settle within the stability window' },
      );
      assert.deepEqual(afterTextDrag, before, 'dragging from rule text must not change rule order');
      await browser.waitUntil(async () => (await h.snapshotConsole()).topBar.backgroundColor === 'rgb(0, 204, 0)', {
        timeout: 8000,
        interval: 100,
        timeoutMsg: 'reordered priority did not select the new first matching rule',
      });
    });

    test('selects rules from checkboxes that show on hover, drags the selection as one block, and deletes it in one confirmation', async () => {
      await h.seedSettings(settings(rule('a', 'alpha'), rule('b', 'beta'), rule('c', 'gamma'), rule('d', 'delta')));
      const browser = await panel(h);
      await rowAt(browser, 3);

      // Nothing selected: a row's checkbox is transparent until the pointer is over that row (it
      // stays in the layout and the Tab order either way).
      await pointTo(browser, await rowAt(browser, 1));
      let opacities;
      await browser.waitUntil(
        async () => {
          opacities = await ruleSelectOpacities(browser);
          return opacities[1] === '1' && opacities[3] === '0';
        },
        { timeout: 5000, interval: 50, timeoutMsg: 'the hovered row did not reveal only its own checkbox' },
      );
      assert.equal(opacities.length, 4);
      // Once shown, it moves with the pointer instead of fading: on the next row it is fully shown
      // at the first read, and gone from the row it left.
      await pointTo(browser, await rowAt(browser, 3));
      opacities = await ruleSelectOpacities(browser);
      assert.equal(opacities[3], '1', 'the checkbox faded in on the next row instead of moving there');
      assert.equal(opacities[1], '0', 'the checkbox faded out of the row it left instead of moving away');
      // The checkboxes' column counts as the list, gaps included: in the gap above the last row,
      // left of the rows, the pointer has not left the list, so the checkbox stays where it is.
      const gap = await browser.execute(() => {
        const rows = document.querySelectorAll('[data-rule-row]');
        const box = rows[3].querySelector('.rule-select').getBoundingClientRect();
        return {
          x: Math.round(box.left + box.width / 2),
          y: Math.round((rows[2].getBoundingClientRect().bottom + rows[3].getBoundingClientRect().top) / 2),
        };
      });
      await browser.performActions([
        {
          type: 'pointer',
          id: 'e2e-mouse',
          parameters: { pointerType: 'mouse' },
          actions: [{ type: 'pointerMove', duration: 0, x: gap.x, y: gap.y }],
        },
      ]);
      assert.deepEqual(
        await browser.execute(() =>
          [...document.querySelectorAll('[data-rule-row]')].map((row) => row.hasAttribute('data-select-hint')),
        ),
        [false, false, false, true],
        'the pointer in the gap of the checkboxes column left the list',
      );

      for (const index of [0, 2]) {
        const row = await rowAt(browser, index);
        await pointTo(browser, row);
        await browser.waitUntil(async () => (await ruleSelectOpacities(browser))[index] === '1', {
          timeout: 5000,
          interval: 50,
          timeoutMsg: `row ${index}'s checkbox did not show under the pointer`,
        });
        await (await row.$('.rule-select label')).click();
        // The first selection brings every row's checkbox inside the card, and the rows' content
        // slides right to make room: the next row is measured once that is over.
        await motionIdle(browser);
      }
      await browser.$('//div[@data-select-row]/div[normalize-space(.)="2 selected"]').waitForDisplayed();
      // A selection keeps every row's checkbox shown, hovered or not, inside the card: in line
      // with the header's select-all checkbox, and the grip moved right to make room.
      await browser.waitUntil(async () => (await ruleSelectOpacities(browser)).every((opacity) => opacity === '1'), {
        timeout: 5000,
        interval: 50,
        timeoutMsg: 'a selection did not show every row checkbox',
      });
      const placement = await browser.execute(() => {
        const card = document.querySelector('[data-rule-row]').closest('.card').getBoundingClientRect();
        const all = document.querySelector('input[aria-label="Select all rules"]').closest('.checkbox__content');
        const header = all.querySelector('.checkbox__control').getBoundingClientRect();
        return [...document.querySelectorAll('[data-rule-row]')].map((row) => {
          const control = row.querySelector('.rule-select .checkbox__control').getBoundingClientRect();
          return {
            inside: control.left >= card.left,
            inLine: Math.abs(control.left - header.left) < 0.5,
            beforeGrip: control.right < row.querySelector('[data-reorder-grip]').getBoundingClientRect().left,
          };
        });
      });
      assert.ok(
        placement.every(({ inside, inLine, beforeGrip }) => inside && inLine && beforeGrip),
        `every row's checkbox should sit inside the card, in line with select-all and before the grip: ${JSON.stringify(placement)}`,
      );

      // Grabbing a selected row drags the whole selection: alpha and gamma land together after delta.
      const first = await rowAt(browser, 0);
      const last = await rowAt(browser, 3);
      await dragThrough(browser, await reorderPath(browser, await first.$('[data-reorder-grip]'), last));
      const moved = await waitStored(h, (value) => value.projectRules?.[0]?.pattern === 'beta');
      assert.deepEqual(
        moved.projectRules.map((item) => item.pattern),
        ['beta', 'delta', 'alpha', 'gamma'],
      );

      // The confirmation lists every selected rule on its own row; Cancel keeps them.
      await click(browser, 'button[aria-label="Delete selected"]');
      let confirmation = await dialog(browser);
      assert.deepEqual(
        await browser.execute(() =>
          [...document.querySelectorAll('[role="dialog"] ul[aria-label="Rules to delete"] li')].map(
            (item) => item.textContent,
          ),
        ),
        ['alphaexact', 'gammaexact'],
      );
      await confirmation.$('button=Cancel').click();
      await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });
      assert.equal((await stored(h)).projectRules.length, 4);

      await click(browser, 'button[aria-label="Delete selected"]');
      confirmation = await dialog(browser);
      await confirmation.$('button=Delete 2 rules').click();
      const remaining = await waitStored(h, (value) => value.projectRules?.length === 2);
      assert.deepEqual(
        remaining.projectRules.map((item) => item.pattern),
        ['beta', 'delta'],
      );
      await motionIdle(browser);
      assert.deepEqual(
        await browser.execute(() => ({
          rows: document.querySelectorAll('[data-rule-row]').length,
          selecting: document.querySelectorAll('[data-selecting]').length,
        })),
        { rows: 2, selecting: 0 },
        'the deleted selection should have left the list, with nothing selected',
      );

      // Duplicate selected copies each selected rule right after its original, in one change.
      for (const index of [0, 1]) {
        const row = await rowAt(browser, index);
        await pointTo(browser, row);
        await (await row.$('.rule-select label')).click();
        await motionIdle(browser);
      }
      await click(browser, 'button[aria-label="Duplicate selected"]');
      const duplicated = await waitStored(h, (value) => value.projectRules?.length === 4);
      assert.deepEqual(
        duplicated.projectRules.map((item) => item.pattern),
        ['beta', 'beta', 'delta', 'delta'],
      );
      assert.equal(new Set(duplicated.projectRules.map((item) => item.id)).size, 4);
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
      const initialSettings = projectSettings({
        topBar: { enabled: false, color: { paletteId: null, custom: '#123456' }, height: 7, stripes: false },
      });
      await h.seedSettings(
        settings(
          rule('first', 'project-a', 'exact', initialSettings),
          rule('second', 'project-b', 'exact', otherSettings),
        ),
      );
      const browser = await panel(h);
      await openDetail(browser);
      const paletteSwitch = await switchByLabel(browser, 'Color palette');
      await paletteSwitch.click();
      await click(browser, 'button[aria-label="Add color"]');
      await waitStored(h, (value) => value.projectRules?.[0]?.settings.palette.entries.length === 1);
      await motionIdle(browser); // the new row is clipped while it opens
      const name = await browser.$('input[aria-label="Color name"]');
      await fill(browser, name, 'Brand');
      await waitStored(h, (value) => value.projectRules?.[0]?.settings.palette.entries[0]?.name === 'Brand');
      await click(browser, 'button[aria-label="Brand color"]');
      await typeHex(browser, 'Hex', '#cc3366');
      await waitStored(h, (value) => value.projectRules?.[0]?.settings.palette.entries[0]?.color === '#cc3366');
      await browser.keys('Escape');
      await browser.waitUntil(() => dialogIsClosed(browser), {
        timeout: 5000,
        timeoutMsg: 'the palette row colour popover did not close on Escape',
      });

      await (await switchByLabel(browser, 'Top bar')).click();
      await click(browser, 'button[aria-label="Top bar color"]');
      await click(browser, 'button[aria-label="Brand"]');
      await browser.keys('Escape');
      await waitStored(h, (value) => Boolean(value.projectRules?.[0]?.settings.topBar.color.paletteId));
      const height = await browser.$('input[aria-label="Top bar height"]');
      await waitForPopoverClosed(browser);
      await height.waitForClickable({
        timeout: 5000,
        timeoutMsg: 'top bar height control remained blocked after closing its color picker',
      });
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
      await waitForHeightToStay(7, '0');
      assert.equal((await stored(h)).projectRules[0].settings.topBar.height, 7);
      await browser.execute(
        (element, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(element, value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
        },
        height,
        '1.5',
      );
      await waitForHeightToStay(7, '1.5');
      assert.equal((await stored(h)).projectRules[0].settings.topBar.height, 7);
      await fill(browser, height, '40');
      await waitStored(h, (value) => value.projectRules?.[0]?.settings.topBar.height === 40);
      await fill(browser, height, '1');
      await waitStored(h, (value) => value.projectRules?.[0]?.settings.topBar.height === 1);
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
      await motionIdle(browser); // the Platform Bar section is still opening; its last row is clipped
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
      await click(browser, AUTO_OPTION);
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
      await typeHex(browser, 'Custom color', '#223344');
      await browser.keys('Escape');
      const saved = await waitStored(
        h,
        (value) =>
          value.projectRules?.[0]?.settings.platformBarText.auto === false &&
          value.projectRules[0].settings.platformBarText.color.custom === '#223344',
      );
      assert.equal(saved.projectRules[1].settings.palette.entries[0].name, 'Other');

      await waitForPopoverClosed(browser);
      await (await browser.$('button[aria-label="Platform Bar color"]')).waitForClickable({
        timeout: 5000,
        timeoutMsg: 'text color popover did not close before opening the platform color picker',
      });
      await click(browser, 'button[aria-label="Platform Bar color"]');
      await click(browser, 'button[aria-label="Brand"]');
      await browser.keys('Escape');
      await waitForPopoverClosed(browser);
      await browser.$('button[aria-label="Platform Bar text color"]').waitForClickable({
        timeout: 5000,
        timeoutMsg: 'platform color popover did not close before reopening the text color picker',
      });
      await click(browser, 'button[aria-label="Platform Bar text color"]');
      await click(browser, 'button[aria-label="Brand"]');
      await browser.keys('Escape');
      await waitForPopoverClosed(browser);
      let referenced = await waitStored(
        h,
        (value) =>
          value.projectRules?.[0]?.settings.platformBar.color.paletteId === brandId &&
          value.projectRules[0].settings.platformBarText.color.paletteId === brandId,
      );
      assert.equal(referenced.projectRules[0].settings.topBar.color.paletteId, brandId);

      for (const label of ['Top bar', 'Platform Bar', 'Platform Bar text color']) {
        await motionIdle(browser); // the section the previous click toggled moves the switches below it
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
        await motionIdle(browser); // the section the previous click toggled moves the switches below it
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

    test('applies the theme from a blocking head script and keeps its first-paint hint in step', async () => {
      const browser = await panel(h);
      const radio = (label) => `[role="radio"][aria-label="${label}"]`;
      const checked = async (label) => (await browser.$(radio(label))).getAttribute('aria-checked');
      const darkClass = () => browser.execute(() => document.documentElement.classList.contains('dark'));
      const systemDark = await browser.execute(() => matchMedia('(prefers-color-scheme: dark)').matches);
      const hint = () => browser.execute((key) => localStorage.getItem(key), THEME_HINT_KEY);
      const setHint = (value) => browser.execute((key, next) => localStorage.setItem(key, next), THEME_HINT_KEY, value);
      // The Settings tab only exists once the stored settings are in place, so a theme read after
      // this is the stored one, not the hinted one the panel shows while it loads.
      const openSettings = async () => {
        await selectTab(browser, 'Settings');
        await (await browser.$(radio('Auto'))).waitForDisplayed();
      };

      // The built page loads the script as a classic one ahead of the React bundle. A classic
      // script in <head> blocks parsing, so it has run before <body> exists and anything is painted.
      const headScripts = await browser.execute(() =>
        [...document.head.querySelectorAll('script[src]')].map((script) => ({
          path: new URL(script.src).pathname,
          type: script.type,
          async: script.async,
          defer: script.defer,
        })),
      );
      assert.deepEqual(
        headScripts[0],
        { path: '/theme-init.js', type: '', async: false, defer: false },
        'the first script in <head> should be the classic, blocking theme-init.js',
      );
      assert.equal(headScripts[1]?.type, 'module', 'the React bundle should be the module script after it');

      // The panel repeats the stored theme as the hint for its next open.
      await openSettings();
      assert.equal(await hint(), 'auto', 'the default theme should be hinted once settings have loaded');

      // The built script itself, run again by hand: it turns the hint, or without one the system
      // scheme, into the class on <html>. The page's own run is over before WebDriver can look, so
      // this is what shows the shipped file loads under the extension's CSP and does its job.
      const rerunThemeInit = (value) =>
        browser.execute(
          (key, next) =>
            new Promise((resolve) => {
              if (next === null) localStorage.removeItem(key);
              else localStorage.setItem(key, next);
              const script = document.createElement('script');
              script.src = '/theme-init.js';
              script.onload = () => resolve({ dark: document.documentElement.classList.contains('dark') });
              script.onerror = () => resolve({ error: 'theme-init.js failed to load' });
              document.head.append(script);
            }),
          THEME_HINT_KEY,
          value,
        );
      assert.deepEqual(await rerunThemeInit('dark'), { dark: true }, 'a dark hint should add the dark class');
      assert.deepEqual(await rerunThemeInit('light'), { dark: false }, 'a light hint should remove the dark class');
      assert.deepEqual(await rerunThemeInit(null), { dark: systemDark }, 'no hint should follow the system scheme');

      await click(browser, radio('Dark'));
      await waitStored(h, (value) => value.theme === 'dark');
      assert.equal(await hint(), 'dark', 'picking Dark should update the hint');

      // A hint that disagrees with storage is only a wrong first paint: the stored theme wins once
      // it has loaded, and the hint is corrected for the next open. Both ways round.
      await setHint('light');
      await h.seedSettings({ ...settings(), theme: 'dark' });
      await openSettings();
      assert.equal(await checked('Dark'), 'true', 'the stored Dark theme should be checked after reload');
      assert.equal(await darkClass(), true, 'a stale light hint should not survive a stored dark theme');
      assert.equal(await hint(), 'dark', 'the stale light hint should be corrected to dark');

      await h.seedSettings(settings());
      await openSettings();
      assert.equal(await checked('Auto'), 'true', 'the stored Auto theme should be checked after reload');
      assert.equal(await darkClass(), systemDark, 'a stale dark hint should give way to the system scheme');
      assert.equal(await hint(), 'auto', 'the stale dark hint should be corrected to auto');
    });

    test('switches the side panel theme from the Settings tab and saves the choice', async () => {
      const browser = await panel(h);
      await selectTab(browser, 'Settings');
      const radio = (label) => `[role="radio"][aria-label="${label}"]`;
      const checked = async (label) => (await browser.$(radio(label))).getAttribute('aria-checked');
      await (await browser.$(radio('Auto'))).waitForDisplayed();
      assert.equal(await checked('Auto'), 'true', 'Auto should be the checked theme by default');
      const darkClass = () => browser.execute(() => document.documentElement.classList.contains('dark'));
      // Auto follows the browser's own color scheme, whichever the runner reports.
      assert.equal(
        await darkClass(),
        await browser.execute(() => matchMedia('(prefers-color-scheme: dark)').matches),
        'Auto should mirror prefers-color-scheme',
      );
      // The thumb is the group's ::before, moved by :has() rules in style.css that jsdom cannot
      // evaluate. Its translate is a percentage of its own width: 0, 100 or 200.
      const thumbOffset = async () => {
        const translate = await browser.execute(
          () => getComputedStyle(document.querySelector('.theme-switch'), '::before').translate,
        );
        return Number.parseFloat(translate) || 0;
      };
      // The thumb slides for 250ms, so a moved thumb is waited for rather than read once.
      const waitThumbOffset = (expected, label) =>
        browser.waitUntil(async () => (await thumbOffset()) === expected, {
          timeout: 5000,
          interval: 100,
          timeoutMsg: `the thumb did not settle under ${label} (translate ${expected}%)`,
        });
      assert.equal(await thumbOffset(), 100, 'the thumb should sit under Auto by default');

      // The colours fade through the registered theme tokens (style.css, html.theme-transitions),
      // which jsdom cannot evaluate. The fade lasts 300ms, shorter than a WebDriver round trip, so
      // it is not sampled in time: it is stretched to 20s, then its transitions are paused at their
      // midpoint and finished by hand.
      const bodyBackground = () => browser.execute(() => getComputedStyle(document.body).backgroundColor);
      const slowFade = () =>
        browser.execute(() => {
          const style = document.createElement('style');
          style.id = 'e2e-slow-theme-fade';
          style.textContent = 'html.theme-transitions { transition-duration: 20s !important; }';
          document.head.append(style);
        });
      const probeFade = () =>
        browser.execute(() => {
          const background = () => getComputedStyle(document.body).backgroundColor;
          const fades = document.documentElement
            .getAnimations()
            .filter((animation) => animation.transitionProperty?.startsWith('--'));
          for (const fade of fades) {
            fade.pause();
            fade.currentTime = fade.effect.getComputedTiming().duration / 2;
          }
          const midpoint = background();
          for (const fade of fades) fade.finish();
          document.getElementById('e2e-slow-theme-fade')?.remove();
          return { tokens: fades.map((fade) => fade.transitionProperty), midpoint, end: background() };
        });
      const assertFaded = (start, fade, label) => {
        for (const token of ['--background', '--foreground']) {
          assert.ok(fade.tokens.includes(token), `${label}: ${token} should be transitioning on <html>`);
        }
        assert.notEqual(fade.midpoint, start, `${label}: the page background should have left its old colour`);
        assert.notEqual(fade.midpoint, fade.end, `${label}: the page background should be between the two themes`);
        assert.notEqual(fade.end, start, `${label}: the page background should end on the new theme's colour`);
      };

      // Under a dark system scheme Auto already shows the dark theme, so picking Dark changes no
      // colour; the fade is then only checked on the way to Light below.
      const autoIsDark = await darkClass();
      const beforeDark = await bodyBackground();
      await slowFade();
      await click(browser, radio('Dark'));
      await waitThumbOffset(200, 'Dark');
      await waitStored(h, (value) => value.theme === 'dark');
      const toDark = await probeFade();
      if (!autoIsDark) assertFaded(beforeDark, toDark, 'Auto to Dark');
      assert.equal(await darkClass(), true, 'Dark should add the dark class to <html>');
      assert.equal(await checked('Dark'), 'true', 'Dark should be the checked theme after picking it');

      const beforeLight = await bodyBackground();
      await slowFade();
      await click(browser, radio('Light'));
      await waitThumbOffset(0, 'Light');
      await waitStored(h, (value) => value.theme === 'light');
      assertFaded(beforeLight, await probeFade(), 'Dark to Light');
      assert.equal(await darkClass(), false, 'Light should remove the dark class from <html>');
      assert.equal(await checked('Light'), 'true', 'Light should be the checked theme after picking it');
    });

    test('keeps a leaving tab panel and a closing section mounted and inert until their exit has finished', async () => {
      const topBar = { enabled: true, color: { paletteId: null, custom: '#123456' }, height: 4, stripes: false };
      await h.seedSettings(settings(rule('first', 'project-a', 'exact', projectSettings({ topBar }))));
      const browser = await panel(h);
      // A leaving node outlives the change that removed it only while its transitions run (style.css,
      // components/Presence.tsx), which jsdom cannot show. The exits last 100 to 200ms, so like the
      // theme fade above they are not sampled in time: the transitions are stretched to 20s, then
      // finished by hand. The next test starts from a reloaded panel, without this style.
      await browser.execute(() => {
        const style = document.createElement('style');
        style.textContent =
          '.reveal, .tabs__panel { transition-duration: 20s !important; transition-delay: 0s !important; }';
        document.head.append(style);
      });
      const leaving = '.reveal[data-exiting], .tabs__panel[data-exiting]';
      const inertWhileLeaving = () =>
        browser.execute(
          (selector) => [...document.querySelectorAll(selector)].map((element) => element.inert),
          leaving,
        );
      // Repeated until nothing is left to finish and the leaving node is gone: the node is removed in
      // a later task than the end of its transitions, and the entering side may start after the
      // first pass.
      const finishMotion = (what) =>
        browser.waitUntil(
          () =>
            browser.execute((selector) => {
              const running = document
                .getAnimations()
                .filter(
                  (animation) =>
                    animation.transitionProperty &&
                    animation.playState !== 'finished' &&
                    animation.effect?.target?.matches('.reveal, .tabs__panel'),
                );
              for (const animation of running) animation.finish();
              return running.length === 0 && document.querySelector(selector) === null;
            }, leaving),
          { timeout: 5000, interval: 50, timeoutMsg: `${what} was not removed after its exit had finished` },
        );

      await selectTab(browser, 'Settings');
      assert.deepEqual(
        await inertWhileLeaving(),
        [true],
        'the Rules panel should stay mounted and inert while it leaves',
      );
      // HeroUI takes the leaving panel out of the flow (absolute, top: 0). Inside the `.tab-panels`
      // box that is where the entering panel is; without the box it is the top of the page.
      const panelTops = await browser.execute(() => ({
        leaving: document.querySelector('.tabs__panel[data-exiting]').getBoundingClientRect().top,
        entering: document.querySelector('.tabs__panel:not([data-exiting])').getBoundingClientRect().top,
      }));
      assert.equal(
        panelTops.leaving,
        panelTops.entering,
        'the leaving Rules panel should sit where the Settings panel is, not at the top of the page',
      );
      await finishMotion('the Rules panel');
      assert.equal(
        await browser.execute(() => getComputedStyle(document.querySelector('.tabs__panel')).opacity),
        '1',
        'the Settings panel should be fully shown once the tab change is over',
      );

      await selectTab(browser, 'Rules');
      await finishMotion('the Settings panel');
      await openDetail(browser);
      await (await switchByLabel(browser, 'Top bar')).click();
      assert.deepEqual(
        await inertWhileLeaving(),
        [true],
        'the Top bar section should stay mounted and inert while it closes',
      );
      await finishMotion('the Top bar section');
    });

    test('gives dark controls a stronger edge than dividers, on the card and in the colour popover, and leaves picked colours a 20px bead with a translucent rim', async () => {
      const themed = (theme) => ({
        ...settings(
          rule(
            'edges',
            'project-a',
            'exact',
            projectSettings({
              palette: { enabled: true, entries: [{ id: 'red', name: 'Red', color: '#d50000' }] },
              topBar: { enabled: true, color: { paletteId: 'red', custom: '#d50000' }, height: 4, stripes: false },
            }),
          ),
        ),
        theme,
      });
      // These rules live in style.css, which jsdom cannot evaluate. Computed colours come back as
      // oklch(), oklab() or rgb() depending on the engine, so the page paints each one on a 1x1
      // canvas and returns its sRGB channels. The canvas starts transparent, so a colour the
      // canvas could not parse reads as alpha 0.
      const probe = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const channels = (colour) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = 'rgba(0, 0, 0, 0)';
          context.fillStyle = colour;
          context.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
          return { r, g, b, a: a / 255 };
        };
        const edge = (element) => channels(getComputedStyle(element).borderTopColor);
        const button = document.querySelector('button[aria-label="Remove color"]');
        const bead = document.querySelector('button[aria-label="Red color"] .color-chip').getBoundingClientRect();
        return {
          fading: document.documentElement
            .getAnimations()
            .some((animation) => animation.transitionProperty?.startsWith('--')),
          card: channels(getComputedStyle(button.closest('.card')).backgroundColor),
          button: edge(button),
          nameInput: edge(document.querySelector('input[aria-label="Color name"]')),
          select: edge(document.querySelector('.select__trigger')),
          outlined: [...document.querySelectorAll('.outlined-control')].map(edge),
          divider: edge(document.querySelector('.card .border-t')),
          chip: edge(document.querySelector('button[aria-label="Top bar color"] .color-chip')),
          rowChip: edge(document.querySelector('button[aria-label="Red color"] .color-chip')),
          bead: { width: bead.width, height: bead.height },
        };
      };
      // The colour popover's own edges, on the popover's surface instead of the card: the hex
      // control's border, the well's rim (a pseudo-element) and the surface they sit on, which is
      // the nearest painted background at or above the dialog.
      const probePopover = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const channels = (colour) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = 'rgba(0, 0, 0, 0)';
          context.fillStyle = colour;
          context.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
          return { r, g, b, a: a / 255 };
        };
        const dialog = document.querySelector('[role="dialog"]');
        let surface = { r: 0, g: 0, b: 0, a: 0 };
        for (let element = dialog; element && surface.a === 0; element = element.parentElement) {
          surface = channels(getComputedStyle(element).backgroundColor);
        }
        return {
          fading: document.documentElement
            .getAnimations()
            .some((animation) => animation.transitionProperty?.startsWith('--')),
          surface,
          hexControl: channels(getComputedStyle(dialog.querySelector('.hex-control')).borderTopColor),
          wellRim: channels(getComputedStyle(dialog.querySelector('.color-well'), '::after').borderTopColor),
        };
      };
      // A theme change fades the tokens over 300ms and a control's own colour transition trails it
      // by about 150ms, so colours are read only once no token is transitioning on <html> and two
      // reads 200ms apart agree.
      const openEditorAndProbe = async (theme) => {
        await h.seedSettings(themed(theme));
        const browser = await panel(h);
        await browser.waitUntil(
          async () =>
            (await browser.execute(() => document.documentElement.classList.contains('dark'))) === (theme === 'dark'),
          { timeout: 5000, interval: 100, timeoutMsg: `<html> did not take the stored ${theme} theme` },
        );
        await openDetail(browser);
        await (await browser.$('button[aria-label="Top bar color"]')).waitForDisplayed();
        let previous;
        let current;
        await browser.waitUntil(
          async () => {
            previous = current;
            current = await browser.execute(probe);
            return !current.fading && previous !== undefined && JSON.stringify(previous) === JSON.stringify(current);
          },
          { timeout: 5000, interval: 200, timeoutMsg: `${theme}: the editor's colours did not settle` },
        );
        // The Top bar picker's popover: its hex control and well are read the same way.
        await click(browser, 'button[aria-label="Top bar color"]');
        await dialog(browser);
        let popover;
        let earlier;
        await browser.waitUntil(
          async () => {
            earlier = popover;
            popover = await browser.execute(probePopover);
            return !popover.fading && earlier !== undefined && JSON.stringify(earlier) === JSON.stringify(popover);
          },
          { timeout: 5000, interval: 200, timeoutMsg: `${theme}: the colour popover's colours did not settle` },
        );
        await browser.keys('Escape');
        await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });
        return { ...current, popover };
      };
      const luminance = ({ r, g, b }) => {
        const [red, green, blue] = [r, g, b].map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const contrast = (a, b) => {
        const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (lighter + 0.05) / (darker + 0.05);
      };
      // The palette row's bead is the same object as the surface trigger's: 20px, with a rim that
      // lets the fill show through. The well is that bead opened up and wears the same rim.
      const assertBead = (edges, theme) => {
        assert.deepEqual(edges.bead, { width: 20, height: 20 }, `${theme}: the palette row's bead`);
        for (const [label, rim] of [
          ["the surface trigger's bead", edges.chip],
          ["the palette row's bead", edges.rowChip],
          ['the colour well', edges.popover.wellRim],
        ]) {
          assert.ok(rim.a > 0 && rim.a < 1, `${theme}: the rim of ${label} should be translucent, got alpha ${rim.a}`);
        }
        assert.deepEqual(edges.popover.wellRim, edges.chip, `${theme}: the well should wear the bead's rim`);
        assert.equal(edges.popover.surface.a, 1, `${theme}: the popover surface should be an opaque colour`);
        assert.equal(edges.popover.hexControl.a, 1, `${theme}: the hex control should have an opaque border colour`);
      };

      const dark = await openEditorAndProbe('dark');
      assert.equal(dark.card.a, 1, 'dark: the card background should be an opaque colour');
      assert.ok(
        dark.outlined.length >= 3,
        `dark: expected the editor's outlined controls, got ${dark.outlined.length}`,
      );
      const darkControls = [
        ['the outline button', dark.button],
        ['the Color name input', dark.nameInput],
        ['the Match type select trigger', dark.select],
        ...dark.outlined.map((edge, index) => [`outlined control ${index}`, edge]),
      ];
      for (const [label, edge] of darkControls) {
        assert.equal(edge.a, 1, `dark: ${label} should have an opaque border colour`);
        const ratio = contrast(dark.card, edge);
        assert.ok(ratio >= 1.6, `dark: ${label} has contrast ${ratio.toFixed(2)} on the card, expected >= 1.6`);
      }
      assert.equal(dark.divider.a, 1, 'dark: the divider should have an opaque border colour');
      const dividerRatio = contrast(dark.card, dark.divider);
      assert.ok(dividerRatio >= 1.45, `dark: the divider has contrast ${dividerRatio.toFixed(2)}, expected >= 1.45`);
      assert.ok(
        dividerRatio < contrast(dark.card, dark.button),
        'dark: controls should sit one step above the dividers',
      );
      assertBead(dark, 'dark');
      const hexRatio = contrast(dark.popover.surface, dark.popover.hexControl);
      assert.ok(
        hexRatio >= 1.6,
        `dark: the hex control has contrast ${hexRatio.toFixed(2)} on the popover surface, expected >= 1.6`,
      );

      // In light, controls and dividers share --border: the dark-only rules must not leak.
      const light = await openEditorAndProbe('light');
      assert.equal(light.divider.a, 1, 'light: the divider should have an opaque border colour');
      assert.deepEqual(light.button, light.divider, 'light: the outline button should share the divider colour');
      assert.deepEqual(light.nameInput, light.divider, 'light: the Color name input should share the divider colour');
      assert.deepEqual(
        light.select,
        light.divider,
        'light: the Match type select trigger should share the divider colour',
      );
      for (const [index, edge] of light.outlined.entries()) {
        assert.deepEqual(edge, light.divider, `light: outlined control ${index} should share the divider colour`);
      }
      assertBead(light, 'light');
      assert.deepEqual(
        light.popover.hexControl,
        light.divider,
        'light: the hex control should share the divider colour',
      );
    });

    // The colour editor's layout, its CSS and its pointer handling exist only in a browser: jsdom
    // has no boxes, evaluates no style.css and gives react-aria no pointer geometry.
    test('lays the colour well out as one 200 by 160 shape whose thumbs stay on it for white, black and red', async () => {
      await h.seedSettings(pickerSettings());
      const browser = await panel(h);
      await openDetail(browser);
      const near = (a, b) => Math.abs(a - b) <= 0.5;
      // Where each colour's face thumb must sit flush: saturation runs left to right, brightness
      // bottom to top. All three have hue 0, so the hue thumb is flush at the strip's left end.
      const corners = {
        Paper: ['left', 'top'],
        Ink: ['left', 'bottom'],
        Red: ['right', 'top'],
      };
      for (const [name, [horizontal, vertical]] of Object.entries(corners)) {
        await click(browser, `button[aria-label="${name} color"]`);
        await dialog(browser);
        const boxes = await settled(browser, readColorPopover, `${name}: the colour popover`);
        const { well, face, strip, faceThumb, hueThumb } = boxes;
        const where = `${name}: ${JSON.stringify(boxes)}`;
        assert.deepEqual([well.width, well.height], [200, 160], `the well should be 200 by 160. ${where}`);
        assert.deepEqual([face.width, face.height], [200, 140], `the face should be 200 by 140. ${where}`);
        assert.deepEqual([strip.width, strip.height], [200, 20], `the hue strip should be 200 by 20. ${where}`);
        assert.ok(
          near(face.top, well.top) && near(face.bottom, strip.top) && near(strip.bottom, well.bottom),
          `the face should sit on top of the hue strip and the two should fill the well. ${where}`,
        );
        assert.ok(near(face.left, well.left) && near(strip.left, well.left), `the well's parts should align. ${where}`);
        for (const [label, thumb] of [
          ['face thumb', faceThumb],
          ['hue thumb', hueThumb],
        ]) {
          assert.deepEqual([thumb.width, thumb.height], [20, 20], `the ${label} should be a 20px bead. ${where}`);
          assert.ok(
            thumb.left >= well.left - 0.5 &&
              thumb.top >= well.top - 0.5 &&
              thumb.right <= well.right + 0.5 &&
              thumb.bottom <= well.bottom + 0.5,
            `the ${label} should not leave the well. ${where}`,
          );
        }
        assert.ok(
          near(faceThumb[horizontal], face[horizontal]) && near(faceThumb[vertical], face[vertical]),
          `the face thumb should sit flush in the face's ${vertical} ${horizontal} corner. ${where}`,
        );
        assert.ok(
          near(hueThumb.left, strip.left) && near(hueThumb.top, strip.top) && near(hueThumb.bottom, strip.bottom),
          `the hue thumb should sit flush at the strip's left end. ${where}`,
        );
        await browser.keys('Escape');
        await browser.waitUntil(() => dialogIsClosed(browser), {
          timeout: 5000,
          timeoutMsg: `${name}: the colour popover did not close on Escape`,
        });
      }
    });

    test('changes a colour by dragging on the face and on the hue strip, and keeps the well painted through every edit', async () => {
      await h.seedSettings(pickerSettings());
      const browser = await panel(h);
      await openDetail(browser);
      const redEntry = (value) => value.projectRules?.[0]?.settings.palette.entries.find((entry) => entry.id === 'red');
      await click(browser, 'button[aria-label="Red color"]');
      await dialog(browser);
      const opened = await settled(browser, readColorPopover, 'the colour popover');
      assertWellCss(await browser.execute(readWellCss), 'on opening');

      // A press inside the face and a drag down and to the right: less saturation and less
      // brightness than #ff0000, the hue untouched.
      const { face } = opened;
      await dragThrough(browser, [
        { x: face.left + 60, y: face.top + 50 },
        { x: face.left + 85, y: face.top + 70 },
        { x: face.left + 110, y: face.top + 95 },
      ]);
      const afterFace = await settled(browser, readColorPopover, 'the face thumb');
      const faceColor = await chipColor(browser, 'Red color');
      assert.notEqual(faceColor, '#ff0000', "the trigger's bead should follow a drag on the face");
      await waitStored(h, (value) => redEntry(value)?.color === faceColor);
      const [faceRed, faceGreen, faceBlue] = hexChannels(faceColor);
      assert.ok(
        faceGreen === faceBlue && faceRed > faceGreen && faceRed < 255,
        `a drag on the face should change saturation and brightness but keep the red hue, got ${faceColor}`,
      );
      assert.notDeepEqual(afterFace.faceThumb, opened.faceThumb, 'the face thumb should have moved');
      // The press alone would leave the thumb about 50px short of here (it trails the pointer by
      // a few pixels: its travel is inset by half a bead).
      const faceEnd = centerOf(afterFace.faceThumb);
      assert.ok(
        Math.abs(faceEnd.x - (face.left + 110)) <= 12 && Math.abs(faceEnd.y - (face.top + 95)) <= 12,
        `the face thumb should have followed the pointer to where the drag ended, got ${JSON.stringify(afterFace.faceThumb)} in ${JSON.stringify(face)}`,
      );
      assert.deepEqual(afterFace.hueThumb, opened.hueThumb, 'a drag on the face should not move the hue thumb');
      assertWellCss(await browser.execute(readWellCss), 'after a drag on the face');

      // The hue thumb, dragged from red at the strip's left end to the middle of the strip.
      const start = centerOf(afterFace.hueThumb);
      await dragThrough(browser, [start, { x: start.x + 45, y: start.y }, { x: opened.strip.left + 100, y: start.y }]);
      const afterHue = await settled(browser, readColorPopover, 'the hue thumb');
      const hueColor = await chipColor(browser, 'Red color');
      await waitStored(h, (value) => redEntry(value)?.color === hueColor);
      const [, hueGreen, hueBlue] = hexChannels(hueColor);
      assert.ok(
        hueColor !== faceColor && hueGreen !== hueBlue,
        `a drag on the hue thumb should leave the red hue, got ${hueColor} after ${faceColor}`,
      );
      assert.ok(
        afterHue.hueThumb.left - afterFace.hueThumb.left > 50,
        `the hue thumb should have followed the pointer, moved ${afterHue.hueThumb.left - afterFace.hueThumb.left}px`,
      );
      assert.deepEqual(afterHue.faceThumb, afterFace.faceThumb, 'a drag on the hue should not move the face thumb');
      assertWellCss(await browser.execute(readWellCss), 'after a drag on the hue thumb');

      await typeHex(browser, 'Hex', '#336699');
      await waitStored(h, (value) => redEntry(value)?.color === '#336699');
      const afterHex = await settled(browser, readColorPopover, 'the thumbs after a typed hex');
      assert.notDeepEqual(afterHex.faceThumb, afterHue.faceThumb, 'the face thumb should follow a typed hex');
      assert.equal(await chipColor(browser, 'Red color'), '#336699', "the trigger's bead should follow a typed hex");
      assertWellCss(await browser.execute(readWellCss), 'after a typed hex');
      assert.deepEqual(afterHex.dialog, opened.dialog, "editing should not change the popover's box");
    });

    test('commits a complete hex, rejects a draft on Enter and drops it on leaving in a palette row popover', async () => {
      await h.seedSettings(pickerSettings());
      const browser = await panel(h);
      await openDetail(browser);
      const redColor = (value) =>
        value.projectRules?.[0]?.settings.palette.entries.find((entry) => entry.id === 'red')?.color;
      const closed = (label) =>
        browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000, timeoutMsg: `${label}: still open` });
      // Storage is written through an asynchronous chain, so "nothing was written" is a value that
      // holds for 400ms, not a single read.
      const colorStays = async (expected, label) => {
        let stableSince;
        await browser.waitUntil(
          async () => {
            if (redColor(await stored(h)) !== expected) {
              stableSince = undefined;
              return false;
            }
            stableSince ??= Date.now();
            return Date.now() - stableSince >= 400;
          },
          { timeout: 5000, interval: 100, timeoutMsg: `${label}: the stored colour did not stay ${expected}` },
        );
      };

      // A complete hex is saved as it is typed; Enter then only says "done".
      await click(browser, 'button[aria-label="Red color"]');
      await typeHex(browser, 'Hex', '#336699');
      await waitStored(h, (value) => redColor(value) === '#336699');
      await browser.keys('Enter');
      await closed('Enter after a complete hex');
      await waitFocused(browser, 'Red color', 'Enter should return focus to the trigger');

      // A draft that cannot become a colour is marked, and Escape drops it.
      await click(browser, 'button[aria-label="Red color"]');
      const input = await typeHex(browser, 'Hex', '12zz');
      assert.equal(await input.getAttribute('aria-invalid'), 'true', 'a draft that is not a hex should be marked');
      await browser.keys('Escape');
      await closed('Escape with a draft');
      await colorStays('#336699', 'Escape with a draft');
      await waitFocused(browser, 'Red color', 'Escape should return focus to the trigger');
      assert.equal(await chipColor(browser, 'Red color'), '#336699', "the trigger's bead should be unchanged");

      // Only six digits are a colour: Enter on three keeps the popover open with the draft marked,
      // and writes nothing. The next key clears the mark; Escape then drops the draft.
      await click(browser, 'button[aria-label="Red color"]');
      const short = await typeHex(browser, 'Hex', 'abc');
      assert.equal(await short.getAttribute('aria-invalid'), null, 'a draft still being typed should not be marked');
      await browser.keys('Enter');
      await browser.waitUntil(async () => (await short.getAttribute('aria-invalid')) === 'true', {
        timeout: 5000,
        timeoutMsg: 'Enter on a three-digit draft should mark it as wrong',
      });
      await colorStays('#336699', 'Enter on a three-digit draft');
      assert.equal(await dialogIsClosed(browser), false, 'Enter on a draft should keep the popover open');
      assert.equal(await short.getValue(), 'abc', 'Enter on a draft should keep it as typed');
      await browser.keys('d');
      assert.equal(await short.getAttribute('aria-invalid'), null, 'the next edit should clear the mark');
      await browser.keys('Escape');
      await closed('Escape after a rejected draft');
      await colorStays('#336699', 'Escape after a rejected draft');

      // A press on the page beside the popover closes it. Focus leaves the field first, so the
      // draft is dropped whatever it holds. The popover keeps 12px clear of the window's edges, so
      // this point is never on it.
      const pressOutside = () => dragThrough(browser, [{ x: 4, y: 4 }]);
      for (const draft of ['12', 'fff']) {
        await click(browser, 'button[aria-label="Red color"]');
        await typeHex(browser, 'Hex', draft);
        await pressOutside();
        await closed(`a press outside with the draft ${draft}`);
        await colorStays('#336699', `a press outside with the draft ${draft}`);
      }
      assert.equal(await chipColor(browser, 'Red color'), '#336699', "the trigger's bead should be unchanged");
      await click(browser, 'button[aria-label="Red color"]');
      const reopened = await browser.$('[role="dialog"] input[aria-label="Hex"]');
      await reopened.waitForDisplayed();
      assert.equal(await reopened.getValue(), '#336699', 'a dropped draft should not come back with the popover');

      // A press on the well takes focus from the field, so a draft, and the mark Enter left on it,
      // are gone: the field shows the colour picked under the pointer.
      await fill(browser, reopened, '12');
      await browser.keys('Enter');
      assert.equal(await reopened.getAttribute('aria-invalid'), 'true', 'Enter on a draft should mark it');
      const { face } = await settled(browser, readColorPopover, 'the colour popover');
      await dragThrough(browser, [{ x: face.left + 60, y: face.top + 50 }]);
      await browser.waitUntil(async () => /^#[0-9a-f]{6}$/.test(await reopened.getValue()), {
        timeout: 5000,
        timeoutMsg: 'a press on the well should replace the draft in the field with the colour picked',
      });
      const picked = await reopened.getValue();
      assert.notEqual(picked, '#336699', 'a press on the well should pick the colour under the pointer');
      assert.equal(await reopened.getAttribute('aria-invalid'), null, 'the mark should not outlive the draft');
      await waitStored(h, (value) => redColor(value) === picked);
      await colorStays(picked, 'a press on the well with a draft');
    });

    test('keeps a surface popover still while the choice changes and returns to the kept custom colour without changing it', async () => {
      await h.seedSettings(pickerSettings());
      const browser = await panel(h);
      await openDetail(browser);
      const text = (value) => value.projectRules?.[0]?.settings.platformBarText;
      const trigger = 'button[aria-label="Platform Bar text color"]';
      const press = async (selector) => (await browser.$(`[role="dialog"] ${selector}`)).click();
      // The dialog's box and the side it was placed on. react-aria places a popover again whenever
      // its size changes, so a row that folded away would move the control just pressed.
      const where = async (label) => {
        const { dialog: box, placement } = await settled(browser, readColorPopover, `the popover after ${label}`);
        return { box, placement };
      };

      await click(browser, trigger);
      await dialog(browser);
      const opened = await where('opening');
      assert.match(String(opened.placement), /^(top|bottom)/, 'the popover should report the side it was placed on');
      // In a wide UI font "Match contrast" gives way on one line; it does not wrap out of the option.
      assert.deepEqual(
        await browser.execute(readAutoOption),
        { height: 32, mutedWithin: true },
        'the Auto option should stay one 32px line with its muted text within it',
      );

      await press('button[aria-label="Blue"]');
      await waitStored(h, (value) => text(value)?.color.paletteId === 'blue');
      assert.equal(await browser.$(trigger).getText(), 'Blue');
      assert.deepEqual(await where('pressing a palette bead'), opened, 'a palette bead should not move the popover');

      // With a palette entry in use, a press on the custom control goes back to the kept custom
      // colour as it is.
      await press('.hex-control');
      const kept = await waitStored(h, (value) => text(value)?.color.paletteId === null);
      assert.deepEqual(
        text(kept),
        { enabled: true, color: { paletteId: null, custom: '#345678' }, auto: false },
        'pressing the custom control should only clear the palette reference',
      );
      assert.equal(await browser.$(trigger).getText(), '#345678');
      assert.deepEqual(await where('pressing the custom control'), opened, 'the custom control should not move it');

      await (await browser.$(AUTO_OPTION)).click();
      const auto = await waitStored(h, (value) => text(value)?.auto === true);
      assert.equal(text(auto).color.custom, '#345678', 'Auto should keep the custom colour');
      assert.equal(await browser.$(trigger).getText(), 'Auto');
      assert.deepEqual(await where('pressing Auto'), opened, 'Auto should not move the popover');
    });

    test('keeps a bar popover still while its gradient stops and the choice change', async () => {
      // pickerSettings() with the top bar's kept custom fill a gradient, while Red is in use.
      const base = pickerSettings();
      const settingsRule = base.projectRules[0];
      const kept = { stops: ['#123456', '#abcdef'] };
      await h.seedSettings({
        ...base,
        projectRules: [
          {
            ...settingsRule,
            settings: {
              ...settingsRule.settings,
              topBar: { ...settingsRule.settings.topBar, color: { paletteId: 'red', custom: kept } },
            },
          },
        ],
      });
      const browser = await panel(h);
      await openDetail(browser);
      const color = (value) => value.projectRules?.[0]?.settings.topBar.color;
      const press = async (selector) => (await browser.$(`[role="dialog"] ${selector}`)).click();
      const where = async (label) => {
        const { dialog: box, placement } = await settled(browser, readColorPopover, `the popover after ${label}`);
        return { box, placement };
      };

      await click(browser, 'button[aria-label="Top bar color"]');
      await dialog(browser);
      const opened = await where('opening');

      // A stop is part of the custom choice: picking one to edit leaves Red for the kept gradient
      // as it is, like a press on the hex control.
      await press('button[aria-label="Stop 2"]');
      let saved = await waitStored(h, (value) => color(value)?.paletteId === null);
      assert.deepEqual(color(saved), { paletteId: null, custom: kept }, 'a stop press should only clear the reference');
      assert.equal(await browser.$('button[aria-label="Top bar color"]').getText(), 'Gradient');
      assert.deepEqual(await where('pressing a stop'), opened, 'a stop press should not move the popover');

      // The beads come before Add stop: once the pointer rests on Add or Remove stop, a tooltip
      // can open over the end of the palette row.
      await press('button[aria-label="Blue"]');
      await waitStored(h, (value) => color(value)?.paletteId === 'blue');
      assert.deepEqual(await where('pressing a palette bead'), opened, 'a palette bead should not move the popover');
      await press('.hex-control');
      saved = await waitStored(h, (value) => color(value)?.paletteId === null);
      assert.deepEqual(color(saved).custom, kept, 'the custom control should keep the gradient as it is');
      assert.deepEqual(await where('pressing the custom control'), opened, 'the custom control should not move it');

      // The stops row keeps its height whether the fill is a gradient or, after the last Remove, a
      // colour again.
      await press('button[aria-label="Add stop"]');
      await waitStored(h, (value) => color(value)?.custom.stops?.length === 3);
      assert.deepEqual(await where('adding a stop'), opened, 'Add stop should not move the popover');
      await press('button[aria-label="Remove stop"]');
      await waitStored(h, (value) => color(value)?.custom.stops?.length === 2);
      await press('button[aria-label="Remove stop"]');
      saved = await waitStored(h, (value) => typeof color(value)?.custom === 'string');
      assert.equal(color(saved).custom, '#123456', 'removing one of two stops should leave the other colour');
      assert.deepEqual(await where('removing the stops'), opened, 'Remove stop should not move the popover');
    });

    test('grows a surface colour into a gradient and back, and lets a palette entry become one that both bars follow and the text picker leaves out', async () => {
      await h.seedSettings(
        settings(
          rule(
            'gradient',
            'project-a',
            'exact',
            projectSettings({
              palette: { enabled: true, entries: [{ id: 'brand', name: 'Brand', color: '#cc3366' }] },
              topBar: { enabled: true, color: { paletteId: null, custom: '#123456' }, height: 4, stripes: false },
              platformBar: { enabled: true, color: { paletteId: 'brand', custom: '#234567' }, stripes: false },
              platformBarText: { enabled: true, color: { paletteId: 'brand', custom: '#345678' }, auto: false },
            }),
          ),
        ),
      );
      const browser = await panel(h);
      await openDetail(browser);
      const surface = (value, name) => value.projectRules?.[0]?.settings[name];
      const brand = (value) => value.projectRules?.[0]?.settings.palette.entries[0]?.color;
      const chip = (label) =>
        browser.execute((name) => {
          const style = getComputedStyle(document.querySelector(`button[aria-label="${name}"] .color-chip`));
          return { color: style.backgroundColor, image: style.backgroundImage };
        }, label);
      const gradient = /linear-gradient\(to right,\s*rgb\(204,\s*51,\s*102\)(?:\s+\d+%)?,\s*rgb\(26,\s*115,\s*232\)/;

      // Add stop repeats the colour, so the bar does not change until the new stop is edited.
      await click(browser, 'button[aria-label="Top bar color"]');
      await dialog(browser);
      await click(browser, '[role="dialog"] button[aria-label="Add stop"]');
      await waitStored(h, (value) => surface(value, 'topBar')?.color.custom.stops?.[1] === '#123456');
      await waitFocused(browser, 'Stop 2', 'Add stop should focus the new stop');
      await typeHex(browser, 'Custom color, stop 2', '#1a73e8');
      let saved = await waitStored(h, (value) => surface(value, 'topBar')?.color.custom.stops?.[1] === '#1a73e8');
      assert.deepEqual(surface(saved, 'topBar').color, { paletteId: null, custom: { stops: ['#123456', '#1a73e8'] } });
      assert.equal(await browser.$('button[aria-label="Top bar color"]').getText(), 'Gradient');
      await click(browser, '[role="dialog"] button[aria-label="Remove stop"]');
      saved = await waitStored(h, (value) => typeof surface(value, 'topBar')?.color.custom === 'string');
      assert.equal(surface(saved, 'topBar').color.custom, '#123456', 'Remove stop should leave the first colour');
      await waitFocused(browser, 'Add stop', 'with no stop left to pick, focus should move to Add stop');
      await click(browser, '[role="dialog"] button[aria-label="Brand"]');
      await waitStored(h, (value) => surface(value, 'topBar')?.color.paletteId === 'brand');
      await waitForPopoverClosed(browser);

      // The palette row's own popover grows the entry the same way.
      await click(browser, 'button[aria-label="Brand color"]');
      await dialog(browser);
      await click(browser, '[role="dialog"] button[aria-label="Add stop"]');
      await waitStored(h, (value) => brand(value)?.stops?.length === 2);
      await typeHex(browser, 'Hex, stop 2', '#1a73e8');
      saved = await waitStored(h, (value) => brand(value)?.stops?.[1] === '#1a73e8');
      assert.deepEqual(brand(saved), { stops: ['#cc3366', '#1a73e8'] });
      await waitForPopoverClosed(browser);

      // Both bars follow the entry; the text keeps its reference but paints its own colour.
      for (const label of ['Top bar color', 'Platform Bar color']) {
        assert.equal(await browser.$(`button[aria-label="${label}"]`).getText(), 'Brand');
        const { color, image } = await chip(label);
        assert.equal(color, 'rgb(204, 51, 102)', `${label} chip should sit on the first stop`);
        assert.match(image, gradient, `${label} chip should show the Brand gradient`);
      }
      assert.equal(surface(saved, 'platformBarText').color.paletteId, 'brand');
      assert.equal(await browser.$('button[aria-label="Platform Bar text color"]').getText(), '#345678');
      assert.deepEqual(await chip('Platform Bar text color'), { color: 'rgb(52, 86, 120)', image: 'none' });

      // The text picker lists no gradient entry and no stops, and its custom control drops the
      // reference that no entry honours any more.
      await click(browser, 'button[aria-label="Platform Bar text color"]');
      await dialog(browser);
      await (await browser.$('[role="dialog"] input[aria-label="Custom color"]')).waitForDisplayed();
      assert.equal((await browser.$$('[role="dialog"] button[aria-label="Brand"]')).length, 0);
      assert.equal((await browser.$$('[role="dialog"] fieldset')).length, 0);
      await (await browser.$('[role="dialog"] .hex-control')).click();
      saved = await waitStored(h, (value) => surface(value, 'platformBarText')?.color.paletteId === null);
      assert.deepEqual(surface(saved, 'platformBarText').color, { paletteId: null, custom: '#345678' });
      await waitForPopoverClosed(browser);
    });

    test('scrolls a surface popover that a short window cannot fit on either side of its trigger', async () => {
      await h.seedSettings(pickerSettings());
      const browser = await panel(h);
      const windowSize = await browser.getWindowSize();
      try {
        // Short enough that the tallest popovers (312px: the text picker's Auto, palette beads,
        // custom control and well, and a bar picker's palette beads, stops row, custom control
        // and well) fit neither above nor below their trigger, wherever the trigger is.
        await browser.setWindowSize(windowSize.width, 420);
        await openDetail(browser);
        for (const trigger of ['Platform Bar text color', 'Top bar color']) {
          await waitForPopoverClosed(browser);
          await click(browser, `button[aria-label="${trigger}"]`);
          await dialog(browser);

          const top = await settled(browser, readPopoverScroll, `the capped ${trigger} popover`, 'start');
          assert.ok(
            top.maxHeight !== '' && top.contentHeight > top.popoverHeight,
            `setup: the window should be too short for the ${trigger} popover, got ${JSON.stringify(top)}`,
          );
          assert.equal(
            top.below,
            false,
            `${trigger}: the dialog should not show past the popover: ${JSON.stringify(top)}`,
          );
          assert.ok(top.firstControl, `${trigger}: the first control should be reachable: ${JSON.stringify(top)}`);
          assert.ok(
            top.scrollWidth <= top.clientWidth && top.dialogWidth <= top.popoverWidth,
            `${trigger}: the capped popover should not scroll sideways: ${JSON.stringify(top)}`,
          );
          // The dialog gives up height by scrolling, not by squeezing what is in it. Only the
          // text picker has an Auto option.
          if (trigger === 'Platform Bar text color') {
            assert.deepEqual(
              await browser.execute(readAutoOption),
              { height: 32, mutedWithin: true },
              'the Auto option should keep its 32px in a capped popover',
            );
          }
          assert.equal(
            (await browser.execute(readColorPopover)).well.height,
            160,
            `${trigger}: the well should keep its height in a capped popover`,
          );

          const last = await settled(browser, readPopoverScroll, `the ${trigger} popover scrolled to its end`, 'last');
          assert.ok(last.scrollTop > 0, `${trigger}: the capped popover should scroll: ${JSON.stringify(last)}`);
          // Reachable also means clear of a scroll bar, which takes its width out of the dialog.
          assert.ok(last.hueStrip, `${trigger}: the hue strip should be reachable: ${JSON.stringify(last)}`);
          assert.equal(
            last.below,
            false,
            `${trigger}: the dialog should not show past the popover: ${JSON.stringify(last)}`,
          );
        }
      } finally {
        await browser.keys('Escape');
        await browser.setWindowSize(windowSize.width, windowSize.height);
      }
    });

    test('downloads a real JSON backup and imports selected rules while replacing duplicates in place', async () => {
      const initial = settings(
        rule(
          'keep',
          'same',
          'exact',
          projectSettings({
            // Gradients in an entry and in a kept custom fill travel through the file as { stops }.
            palette: {
              enabled: true,
              entries: [
                { id: 'brand', name: 'Brand', color: '#cc3366' },
                { id: 'sunrise', name: 'Sunrise', color: { stops: ['#ff6d00', '#e91e63', '#3f51b5'] } },
              ],
            },
            topBar: {
              enabled: true,
              color: { paletteId: 'brand', custom: { stops: ['#ff6d00', '#1a73e8'] } },
              height: 13,
              stripes: true,
            },
            platformBar: {
              enabled: true,
              color: { paletteId: 'sunrise', custom: '#234567' },
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
      let exportedName;
      await browser.execute(() => {
        const NativeDate = window.Date;
        const actualNow = NativeDate.now.bind(NativeDate);
        const fixedTime = NativeDate.UTC(2024, 0, 1, 23, 30);
        Object.defineProperty(window, '__gcpTintOriginalDate', { value: NativeDate, configurable: true });
        window.Date = class extends NativeDate {
          constructor(...args) {
            super(...(args.length === 0 ? [fixedTime] : args));
          }
          static now() {
            return actualNow();
          }
        };
      });
      try {
        await click(browser, 'button=Export');
        await browser.waitUntil(
          async () => {
            exportedName = (await readdir(h.downloadDir)).find((name) =>
              /^gcp-console-tint-settings-\d{4}-\d{2}-\d{2}\.json$/.test(name),
            );
            return Boolean(exportedName);
          },
          { timeout: 10000, timeoutMsg: 'Export did not produce a downloaded JSON file' },
        );
        const dates = await browser.execute(() => {
          // Firefox's WebDriver script global has its own Date; inspect the page's constructor.
          const now = new window.Date();
          const pad = (value) => String(value).padStart(2, '0');
          return {
            localDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
            utcDate: now.toISOString().slice(0, 10),
          };
        });
        assert.deepEqual(dates, { localDate: '2024-01-02', utcDate: '2024-01-01' });
        assert.equal(exportedName, 'gcp-console-tint-settings-2024-01-02.json');
      } finally {
        await browser.execute(() => {
          window.Date = window.__gcpTintOriginalDate;
          delete window.__gcpTintOriginalDate;
        });
      }
      const exported = JSON.parse(await readFile(join(h.downloadDir, exportedName), 'utf8'));
      assert.equal(exported.schemaVersion, SCHEMA_VERSION);
      assert.deepEqual(exported, { ...initial, schemaVersion: SCHEMA_VERSION });

      await h.seedSettings(settings());
      await selectTab(browser, 'Settings');
      const backupInput = await browser.$('input[aria-label="Import settings file"]');
      await setFileInput(browser, backupInput, join(h.downloadDir, exportedName));
      await dialog(browser);
      await click(browser, 'button=Import 2 rules');
      await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });
      const addedNotice = await statusText(browser, /Imported 2 rules/);
      assert.ok(addedNotice.includes(`2 added from ${exportedName}`));
      const roundTripped = await waitStored(h, (value) => value.projectRules?.length === 2);
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
      const warning = await browser.$(
        '//*[@role="dialog"]//*[@data-slot="alert-title" and normalize-space(.)="Replaces 1 existing rule"]',
      );
      await warning.waitForDisplayed();
      assert.equal(await warning.isDisplayed(), true);
      const selectAll = await browser.$('//label[.//input[@type="checkbox"] and contains(., "Select all")]');
      const skip = await browser.$('//label[.//input[@type="checkbox" and @aria-label="File row 4, exact, skip"]]');
      await skip.click();
      await browser.$('//span[normalize-space(.)="3 of 4 selected"]').waitForDisplayed();
      const selectAllState = await browser.execute((label) => {
        const checkbox = label.querySelector('input[type="checkbox"]');
        return {
          checked: checkbox.checked,
          indeterminate: checkbox.indeterminate,
          ariaChecked:
            checkbox.getAttribute('aria-checked') ??
            label.getAttribute('aria-checked') ??
            label.querySelector('[role="checkbox"]')?.getAttribute('aria-checked'),
        };
      }, selectAll);
      assert.equal(selectAllState.checked, false);
      assert.ok(selectAllState.indeterminate || selectAllState.ariaChecked === 'mixed');
      await selectAll.click();
      await browser.$('//span[normalize-space(.)="4 of 4 selected"]').waitForDisplayed();
      assert.equal(await (await selectAll.$('input[type="checkbox"]')).isSelected(), true);
      await skip.click();
      await browser.$('//span[normalize-space(.)="3 of 4 selected"]').waitForDisplayed();
      await click(browser, 'button=Import 3 rules');
      await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });
      const duplicateNotice = await statusText(browser, /Imported 3 rules/);
      assert.ok(duplicateNotice.includes('2 added and 1 replaced from incoming.json'));
      const imported = await waitStored(h, (value) => value.projectRules?.some((item) => item.pattern === 'new'));
      assert.deepEqual(
        imported.projectRules.map((item) => item.pattern),
        ['same', 'tail', 'same', 'new'],
      );
      assert.equal(imported.projectRules[0].id, 'keep');
      assert.equal(imported.projectRules[0].settings.topBar.color.custom, '#aabbcc');
      assert.equal(imported.projectRules[0].settings.topBar.height, 4);
      assert.equal(imported.projectRules[2].matchType, 'exact');
      assert.equal(imported.projectRules[2].settings.topBar.color.custom, '#ddeeff');
      assert.equal(imported.projectRules[2].settings.topBar.height, 9);
      assert.equal(imported.projectRules[2].settings.topBar.stripes, true);
      assert.notEqual(imported.projectRules[2].id, 'file-duplicate-id');
      assert.notEqual(imported.projectRules[2].id, 'keep');
      assert.equal(new Set(imported.projectRules.map((item) => item.id)).size, imported.projectRules.length);
      assert.equal(
        imported.projectRules.some((item) => item.pattern === 'skip'),
        false,
      );
    });

    test('restores distinct settings to two existing duplicate rules from a full backup', async () => {
      const backup = settings(
        rule(
          'restore-first',
          'same',
          'exact',
          projectSettings({
            topBar: { enabled: true, color: { paletteId: null, custom: '#aabbcc' }, height: 4, stripes: false },
            platformBar: { enabled: true, color: { paletteId: null, custom: '#123456' }, stripes: true },
          }),
        ),
        rule(
          'restore-second',
          'same',
          'exact',
          projectSettings({
            topBar: { enabled: true, color: { paletteId: null, custom: '#ddeeff' }, height: 9, stripes: true },
            platformBarText: { enabled: true, color: { paletteId: null, custom: '#345678' }, auto: false },
          }),
        ),
      );
      const changed = settings(
        rule(
          'restore-first',
          'same',
          'exact',
          projectSettings({
            topBar: { enabled: true, color: { paletteId: null, custom: '#112233' }, height: 17, stripes: true },
            platformBar: { enabled: true, color: { paletteId: null, custom: '#445566' }, stripes: false },
          }),
        ),
        rule(
          'restore-second',
          'same',
          'exact',
          projectSettings({
            topBar: { enabled: true, color: { paletteId: null, custom: '#778899' }, height: 23, stripes: false },
            platformBarText: { enabled: true, color: { paletteId: null, custom: '#abcdef' }, auto: false },
          }),
        ),
      );
      await h.seedSettings(backup);
      const browser = await panel(h);
      await selectTab(browser, 'Settings');
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
      assert.deepEqual(exported, { ...backup, schemaVersion: SCHEMA_VERSION });

      await h.seedSettings(changed);
      const seeded = await waitStored(
        h,
        (value) =>
          value.projectRules?.[0]?.settings.topBar.color.custom === '#112233' &&
          value.projectRules[1].settings.topBar.color.custom === '#778899',
      );
      assert.deepEqual(seeded, changed);
      await selectTab(browser, 'Settings');
      const input = await browser.$('input[aria-label="Import settings file"]');
      await setFileInput(browser, input, join(h.downloadDir, exportedName));
      await dialog(browser);
      const warning = await browser.$(
        '//*[@role="dialog"]//*[@data-slot="alert-title" and normalize-space(.)="Replaces 2 existing rules"]',
      );
      await warning.waitForDisplayed();
      assert.equal(await warning.isDisplayed(), true);
      await click(browser, 'button=Import 2 rules');
      await browser.waitUntil(() => dialogIsClosed(browser), { timeout: 5000 });
      const restoredNotice = await statusText(browser, /Imported 2 rules/);
      assert.ok(restoredNotice.includes(`2 replaced from ${exportedName}`));
      assert.equal(restoredNotice.includes(' added '), false);
      const matchesBackup = (value) =>
        value.projectRules?.length === 2 &&
        value.projectRules[0].id === 'restore-first' &&
        value.projectRules[0].settings.topBar.color.custom === '#aabbcc' &&
        value.projectRules[1].id === 'restore-second' &&
        value.projectRules[1].settings.topBar.color.custom === '#ddeeff';
      const restored = await waitStored(h, matchesBackup);
      assert.deepEqual(restored, backup);

      await h.reloadPanel();
      const reloaded = await waitStored(h, matchesBackup);
      assert.deepEqual(reloaded, backup);
    });

    test('shows each reachable parser refusal reason and invalid field path without changing stored rules', async () => {
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
          content: JSON.stringify(settings()),
          message: /no-rules\.json contains no rules\./,
        },
      ];
      for (let index = 0; index < failures.length; index++) {
        const failure = failures[index];
        const path = join(h.downloadDir, failure.name);
        await writeFile(path, failure.content);
        await setFileInput(browser, input, path);
        const currentAlert = await alertText(browser, failure.message);
        assert.match(currentAlert, /Couldn’t import this file/);
        // The detail is rendered outside the live region, in its own labelled section.
        const detailSection = await browser.$('section[aria-label="Error details"]');
        assert.equal(await detailSection.isExisting(), failure.detail !== undefined);
        const currentDetail = failure.detail ? await detailSection.getText() : '';
        if (failure.detail) assert.match(currentDetail, failure.detail);
        const copyDetails = await browser.$('button=Copy details');
        assert.equal(await copyDetails.isExisting(), failure.detail !== undefined);
        if (index === 0) {
          const expectedDetails = await browser.execute((content) => {
            try {
              JSON.parse(content);
            } catch (error) {
              return `${error.name}: ${error.message}`;
            }
          }, failure.content);
          assert.match(expectedDetails, /^SyntaxError: .+/);
          assert.ok(currentDetail.includes(expectedDetails), 'the browser JSON parser detail should be visible');

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
          await writeFile(path, '[]');
          await setFileInput(browser, input, path);
          await alertText(browser, /invalid-json\.json isn’t a GCP Console Tint settings file\./);
          assert.deepEqual(
            (await stored(h)).projectRules.map((item) => item.pattern),
            ['safe-project'],
          );
        }
      }
    });
  });
}
