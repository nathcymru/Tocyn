import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

const css = readFileSync(resolve(import.meta.dirname, '../../packages/ui/src/styles/panda.css'), 'utf8');

test('keyboard focus outlines the whole global search without outlining its inner input', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [320, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 640 } });
      try {
        await page.setContent(`<div class="globalSearch__root">
          <div class="globalSearch__inputShell">
            <span class="globalSearch__icon" aria-hidden="true">⌕</span>
            <input class="input input--size_md input--variant_outline globalSearch__input" aria-label="Search all tickets">
            <span class="globalSearch__shortcut" aria-hidden="true">⌘K</span>
          </div>
          <span class="globalSearch__divider" aria-hidden="true"></span>
          <div class="globalSearch__scope"></div>
        </div>`);
        await page.addStyleTag({ content: css });
        await page.keyboard.press('Tab');
        const result = await page.evaluate(() => {
          const input = document.querySelector('input');
          const root = document.querySelector('.globalSearch__root');
          const rootBox = root.getBoundingClientRect();
          const inside = selector => {
            const box = document.querySelector(selector).getBoundingClientRect();
            return box.left >= rootBox.left && box.right <= rootBox.right && box.top >= rootBox.top && box.bottom <= rootBox.bottom;
          };
          return {
            focusVisible: input.matches(':focus-visible'),
            innerOutline: getComputedStyle(input).outlineWidth,
            outerOutline: getComputedStyle(root).outlineWidth,
            iconInside: inside('.globalSearch__icon'),
            shortcutInside: inside('.globalSearch__shortcut'),
          };
        });
        assert.equal(result.focusVisible, true, `${width}px keyboard focus`);
        assert.equal(result.innerOutline, '0px', `${width}px inner outline`);
        assert.equal(result.outerOutline, '2px', `${width}px outer outline`);
        assert.equal(result.iconInside, true, `${width}px icon placement`);
        assert.equal(result.shortcutInside, true, `${width}px shortcut placement`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
