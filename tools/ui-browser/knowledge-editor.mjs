import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const origin = process.env.TOCYN_KNOWLEDGE_ORIGIN ?? 'http://127.0.0.1:5173';
const parsedOrigin = new URL(origin);
assert.equal(parsedOrigin.protocol, 'http:');
assert.ok(['127.0.0.1', 'localhost'].includes(parsedOrigin.hostname));
assert.equal(parsedOrigin.pathname, '/');

const browser = await chromium.launch({ headless: true });
let attempts = 0;
let blockedWrites = 0;
let blockedExternal = 0;
const payloads = [];
const pageErrors = [];
let releaseFirst;
const firstHeld = new Promise(resolve => { releaseFirst = resolve; });

try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => localStorage.setItem('lumina-auth', JSON.stringify({
    state: {
      token: 'synthetic-ui-only-token',
      user: { id: 'synthetic-ui-user', tenant_id: 'synthetic-ui-tenant', email: 'ui-only@example.invalid', full_name: 'Synthetic operator', role: 'admin', mfa_enabled: true },
      mfaRequired: false,
    }, version: 0,
  })));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) { blockedExternal++; return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/knowledge/articles' && request.method() === 'POST') {
      attempts++;
      payloads.push(request.postDataJSON());
      if (attempts === 1) await firstHeld;
      return route.fulfill({ status: 503, json: { error: 'Synthetic save unavailable' } });
    }
    if (request.method() !== 'GET') { blockedWrites++; return route.abort(); }
    if (url.pathname === '/api/knowledge/categories') return route.fulfill({ json: [] });
    if (url.pathname === '/api/knowledge/articles/synthetic-article') {
      await new Promise(resolve => setTimeout(resolve, 400));
      return route.fulfill({ json: { title: 'Synthetic loaded article', category_id: null, tier: 'answer' } });
    }
    if (url.pathname === '/api/knowledge/articles/synthetic-article/content') {
      await new Promise(resolve => setTimeout(resolve, 400));
      return route.fulfill({ json: { content: 'Loaded Markdown body' } });
    }
    if (url.pathname === '/api/workspace/presentation-preference') return route.fulfill({ json: { version: 2, revision: 0, density: 'comfortable', fontScale: 'normal', focusMode: false, motion: 'system', navigation: 'compact', contextDefault: 'remember', shortcutsEnabled: true, interruptionLevel: 'standard', advanceAfterResolve: false, updatedAt: null } });
    if (url.pathname === '/api/workspace/theme-preference') return route.fulfill({ json: { revision: 0, mode: 'system', updatedAt: null } });
    if (url.pathname === '/api/settings/theme') return route.fulfill({ json: { fallback: true, version: '1', light: {}, dark: {} } });
    return route.fulfill({ json: [] });
  });

  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${origin}/knowledge/new`);
  await page.getByRole('heading', { name: 'New Article' }).waitFor();
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  const category = page.getByRole('combobox', { name: 'Category', exact: true });
  const tier = page.getByRole('combobox', { name: 'Tier', exact: true });
  const content = page.getByRole('textbox', { name: 'Content (Markdown)', exact: true });
  const toolbar = page.getByRole('toolbar', { name: 'Formatting controls' });
  const bold = toolbar.getByRole('button', { name: 'Add bold text (ctrl + b)' });
  assert.equal(await page.getByRole('button', { name: 'Back to knowledge base' }).count(), 1);
  assert.equal(await category.getAttribute('data-part'), 'trigger');
  assert.equal(await tier.getAttribute('data-part'), 'trigger');
  assert.equal(await content.getAttribute('contenteditable'), 'true');

  await title.fill('Synthetic knowledge draft');
  await category.click();
  await page.getByRole('option', { name: 'No Category (Root)' }).click();
  await tier.click();
  await page.getByRole('option', { name: 'Internal SOP (Standard Operating Procedure)' }).click();
  assert.match(await tier.textContent(), /Internal SOP/);
  await content.fill('Synthetic internal procedure');
  await content.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await bold.click();
  assert.equal(await bold.getAttribute('aria-pressed'), 'true');
  assert.equal(await content.locator('strong').textContent(), 'Synthetic internal procedure');
  assert.equal(await content.evaluate(element => element === document.activeElement), true);

  await page.getByRole('button', { name: 'Save Article', exact: true }).click();
  await page.getByRole('button', { name: 'Processing...' }).waitFor();
  assert.equal(attempts, 1);
  assert.equal(await title.isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Back to knowledge base' }).isDisabled(), true);
  assert.equal(await content.getAttribute('contenteditable'), 'false');
  assert.equal(await content.getAttribute('aria-readonly'), 'true');
  assert.equal(await bold.isDisabled(), true);
  releaseFirst();

  const error = page.getByRole('alert');
  await error.waitFor();
  assert.match(await error.textContent(), /Article could not be saved/);
  assert.doesNotMatch(await error.textContent(), /editor unavailable/i);
  assert.match(await error.textContent(), /Synthetic save unavailable/);
  assert.equal(await title.inputValue(), 'Synthetic knowledge draft');
  assert.equal(await content.textContent(), 'Synthetic internal procedure');
  assert.match(await tier.textContent(), /Internal SOP/);
  assert.equal(await content.getAttribute('contenteditable'), 'true');
  assert.equal(await content.getAttribute('aria-describedby'), await error.getAttribute('id'));
  await content.focus();
  assert.equal(await content.evaluate(element => element === document.activeElement), true);
  await page.getByRole('button', { name: 'Save Article', exact: true }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).every(button => !button.textContent?.includes('Processing...')));
  assert.equal(attempts, 2);
  assert.deepEqual(payloads[0], payloads[1]);
  assert.equal(payloads[0].tier, 'sop');
  assert.match(payloads[0].content, /\*\*Synthetic internal procedure\*\*/);
  await page.screenshot({ path: '/tmp/tocyn-knowledge-editor.png', fullPage: true });

  const loadingPage = await context.newPage();
  loadingPage.on('pageerror', error => pageErrors.push(error.message));
  await loadingPage.goto(`${origin}/knowledge/edit/synthetic-article`);
  await loadingPage.getByRole('status', { name: 'Loading article' }).waitFor();
  assert.equal(await loadingPage.getByRole('button', { name: 'Save Article' }).isDisabled(), true);
  assert.ok(await loadingPage.locator('.skeleton').count() >= 2);
  assert.equal(await loadingPage.getByRole('textbox', { name: 'Content (Markdown)' }).getAttribute('contenteditable'), 'false');
  await loadingPage.waitForFunction(() => document.querySelector('input[placeholder="e.g., How to reset your password"]')?.value === 'Synthetic loaded article');
  assert.equal(await loadingPage.getByRole('textbox', { name: 'Content (Markdown)' }).getAttribute('contenteditable'), 'true');
  await loadingPage.screenshot({ path: '/tmp/tocyn-knowledge-editor-loaded.png', fullPage: true });

  assert.equal(blockedWrites, 0);
  assert.equal(blockedExternal, 0);
  assert.deepEqual(pageErrors, []);
  const sourcePath = 'apps/dashboard/src/pages/KnowledgeEditorPage.tsx';
  const receipt = {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    scenario: 'Park Select and Tiptap toolbar, loaded and pending read-only state, failed save and unchanged retry',
    sourceSha256: createHash('sha256').update(await readFile(sourcePath)).digest('hex'),
    browser: browser.version(), passed: true, attempts, blockedWrites, blockedExternal,
    screenshots: ['/tmp/tocyn-knowledge-editor.png', '/tmp/tocyn-knowledge-editor-loaded.png'],
    limitations: [
      'All API requests were intercepted; no server persistence, provider or tenant authorization is claimed.',
      'KnowledgeEditor TiptapMarkdownField has no image upload/rejection callback. Image paste/drop belongs to RichComposer and is not asserted here.',
      'A failed save is retried through Save Article; the page has no separate save Retry control.',
      'This checks bold formatting only, not the complete Tiptap Markdown round-trip contract or spoken VoiceOver.',
    ],
  };
  await writeFile('/tmp/tocyn-knowledge-editor.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
} finally {
  releaseFirst?.();
  await browser.close();
}
