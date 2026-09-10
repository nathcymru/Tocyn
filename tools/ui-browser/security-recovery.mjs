import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const requestedOrigin = new URL(process.env.TOCYN_SECURITY_ORIGIN ?? 'http://127.0.0.1:5190');
assert.ok(requestedOrigin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(requestedOrigin.hostname) && requestedOrigin.pathname === '/' && !requestedOrigin.username && !requestedOrigin.password && !requestedOrigin.search && !requestedOrigin.hash, 'Only a loopback HTTP fixture origin is allowed');
const origin = requestedOrigin.origin;
const receiptPath = '/tmp/tocyn-security-recovery.json';
const code = '123456';
const sourcePaths = [
  'tools/ui-browser/security-recovery.mjs',
  'apps/dashboard/src/pages/SecurityProfilePage.tsx',
  'apps/dashboard/src/pages/MfaPage.tsx',
  'apps/dashboard/src/store/authStore.ts',
  'apps/dashboard/src/__tests__/SecurityProfileAccessibility.test.tsx',
  'apps/dashboard/src/__tests__/MfaSetupAccessibility.test.tsx',
];
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [
  path,
  createHash('sha256').update(await readFile(path)).digest('hex'),
])));

function installUiOnlySession(page) {
  return page.addInitScript(() => {
    localStorage.setItem('lumina-auth', JSON.stringify({
      state: {
        token: 'ui-only-token',
        user: { id: 'ui-only-user', tenant_id: 'ui-only-tenant', email: 'ui-only@example.invalid', full_name: 'UI only operator', role: 'agent', mfa_enabled: false },
        mfaRequired: false,
      },
      version: 0,
    }));
  });
}

function deferred() {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve: () => resolve() };
}

const browser = await chromium.launch({ headless: true });
let receipt;
try {
  const profileContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const mfaContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  try {
    let profileExternal = 0;
    let profileBlockedApiRequests = 0;
    let profileSetupRequests = 0;
    let profileConfirmRequests = 0;
    const profileSetupHeld = deferred();
    let profileSetupSeen;
    const profileSetupSeenPromise = new Promise(resolve => { profileSetupSeen = resolve; });
    await profileContext.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) { profileExternal++; await route.abort(); return; }
      if (url.pathname === '/api/auth/mfa/setup' && request.method() === 'POST') {
        profileSetupRequests++;
        profileSetupSeen();
        await profileSetupHeld.promise;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provisioning_uri: 'otpauth://totp/UI-only?secret=UI_ONLY_SECRET' }) });
        return;
      }
      if (url.pathname === '/api/auth/mfa/confirm' && request.method() === 'POST') {
        profileConfirmRequests++;
        const payload = JSON.parse(request.postData() ?? '{}');
        assert.equal(payload.code, code, 'Only the synthetic UI code may be confirmed');
        if (profileConfirmRequests === 1) {
          await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic code rejected' }) });
        } else {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'ui-only-replacement-token', user: { id: 'ui-only-user', tenant_id: 'ui-only-tenant', email: 'ui-only@example.invalid', full_name: 'UI only operator', role: 'agent', mfa_enabled: true } }) });
        }
        return;
      }
      if (url.pathname.startsWith('/api/')) { profileBlockedApiRequests++; await route.abort(); return; }
      await route.continue();
    });
    const profilePage = await profileContext.newPage();
    profilePage.setDefaultTimeout(10_000);
    await installUiOnlySession(profilePage);
    await profilePage.goto(`${origin}/profile/security`);
    const setup = profilePage.getByRole('button', { name: 'Set up 2FA', exact: true });
    await setup.click();
    await profileSetupSeenPromise;
    assert.equal(await setup.isDisabled(), true, 'Security Profile must disable setup while its request is pending');
    await setup.evaluate(button => button.click());
    assert.equal(profileSetupRequests, 1, 'Security Profile must guard duplicate enrollment requests');
    profileSetupHeld.resolve();
    const profileCode = profilePage.getByRole('textbox', { name: 'Authentication Code', exact: true });
    await profileCode.waitFor({ state: 'visible' });
    assert.equal(await profileCode.evaluate(element => element === element.ownerDocument.activeElement), true, 'Security Profile must focus the enrollment code after setup');
    await profileCode.fill(code);
    await profilePage.getByRole('button', { name: 'Verify & Enable', exact: true }).click();
    const profileAlert = profilePage.getByRole('alert');
    await profileAlert.waitFor({ state: 'visible' });
    assert.match(await profileAlert.innerText(), /could not be confirmed/);
    assert.equal(await profileCode.inputValue(), code, 'Security Profile must retain a rejected confirmation code');
    await profilePage.getByRole('button', { name: 'Verify & Enable', exact: true }).click();
    await profilePage.getByText('2FA is currently enabled', { exact: true }).waitFor({ state: 'visible' });
    const profileStatus = profilePage.getByRole('status');
    const profileSuccessStatusObserved = await profileStatus.isVisible().catch(() => false);
    const profileHeading = profilePage.getByRole('heading', { name: 'Security Profile', exact: true });
    await profilePage.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Security Profile');
    const profileSuccessFocusObserved = await profileHeading.evaluate(element => element === element.ownerDocument.activeElement);
    const replacementState = await profilePage.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('lumina-auth') ?? '{}');
      return { hasToken: typeof stored.state?.token === 'string', mfaEnabled: stored.state?.user?.mfa_enabled === true };
    });
    assert.deepEqual(replacementState, { hasToken: true, mfaEnabled: true }, 'Security Profile must adopt the synthetic replacement session state');
    assert.equal(profileSuccessStatusObserved, true, 'Security Profile replacement-session success must retain its status announcement');
    assert.equal(profileSuccessFocusObserved, true, 'Security Profile replacement-session success must focus its heading');

    let mfaExternal = 0;
    let mfaBlockedApiRequests = 0;
    let mfaSetupRequests = 0;
    const retrySetupHeld = deferred();
    let retrySetupSeen;
    const retrySetupSeenPromise = new Promise(resolve => { retrySetupSeen = resolve; });
    await mfaContext.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) { mfaExternal++; await route.abort(); return; }
      if (url.pathname === '/api/auth/mfa/setup' && request.method() === 'POST') {
        mfaSetupRequests++;
        if (mfaSetupRequests === 1) {
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic setup unavailable' }) });
        } else {
          retrySetupSeen();
          await retrySetupHeld.promise;
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provisioning_uri: 'otpauth://totp/UI-only?secret=UI_ONLY_SECRET' }) });
        }
        return;
      }
      if (url.pathname.startsWith('/api/')) { mfaBlockedApiRequests++; await route.abort(); return; }
      await route.continue();
    });
    const mfaPage = await mfaContext.newPage();
    mfaPage.setDefaultTimeout(10_000);
    await installUiOnlySession(mfaPage);
    await mfaPage.goto(`${origin}/mfa`);
    const mfaAlert = mfaPage.getByRole('alert');
    await mfaAlert.waitFor({ state: 'visible' });
    assert.match(await mfaAlert.innerText(), /Synthetic setup unavailable/);
    const retry = mfaPage.getByRole('button', { name: 'Retry authenticator setup', exact: true });
    await retry.focus();
    await retry.click();
    await retrySetupSeenPromise;
    assert.equal(await retry.getAttribute('aria-disabled'), 'true', 'MFA setup retry must expose its pending state');
    await retry.evaluate(button => button.click());
    assert.equal(mfaSetupRequests, 2, 'MFA setup retry must guard duplicate requests while pending');
    retrySetupHeld.resolve();
    const mfaCode = mfaPage.getByRole('textbox', { name: 'Authentication Code', exact: true });
    await mfaCode.waitFor({ state: 'visible' });
    await mfaPage.waitForFunction(() => document.activeElement?.getAttribute('id') === 'mfa-code');
    const mfaRetryFocusObserved = await mfaCode.evaluate(element => element === element.ownerDocument.activeElement);
    assert.equal(mfaRetryFocusObserved, true, 'MFA setup retry must focus its ready code input');
    assert.equal(profileExternal + mfaExternal, 0, 'Security recovery browser evidence must not contact external origins');
    assert.equal(profileBlockedApiRequests + mfaBlockedApiRequests, 0, 'All non-synthetic API requests must remain blocked');

    receipt = Object.freeze({
      version: 1,
      kind: 'tocyn-local-security-ui-recovery',
      recordedAt: new Date().toISOString(),
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
      environment: Object.freeze({ node: process.version, browser: browser.version(), headless: true, viewport: Object.freeze({ width: 1280, height: 800 }), reducedMotion: 'reduce', dashboardOrigin: origin, externalRequests: profileExternal + mfaExternal, blockedUnmatchedApiRequests: profileBlockedApiRequests + mfaBlockedApiRequests }),
      sourceHashes: Object.freeze(sourceHashes),
      syntheticApi: Object.freeze({ setup: Object.freeze({ route: '/api/auth/mfa/setup', responses: [200, 503, 200] }), confirm: Object.freeze({ route: '/api/auth/mfa/confirm', responses: [400, 200] }), backendCredentialsReached: false, persistedRecords: 0 }),
      evidence: Object.freeze({
        securityProfile: Object.freeze({ pendingEnrollmentGuard: profileSetupRequests === 1, rejectedConfirmationRetainedDraft: true, retryAdoptedSyntheticReplacementSession: replacementState.mfaEnabled, successfulConfirmationStatusObserved: profileSuccessStatusObserved, successfulConfirmationFocusObserved: profileSuccessFocusObserved, setupRequests: profileSetupRequests, confirmRequests: profileConfirmRequests }),
        mfaSetup: Object.freeze({ initialSetupRejected: true, pendingRetryGuard: mfaSetupRequests === 2, retryFocusedCodeInput: mfaRetryFocusObserved, setupRequests: mfaSetupRequests }),
      }),
      limitations: Object.freeze([
        'Pure dashboard UI evidence: all API requests except the intercepted MFA setup and confirmation responses are blocked, and fake credentials never reach a backend.',
        'No MFA enrollment, account mutation, authentication proof, provider contact, or fixture record persistence is claimed.',
        'Full-app focus and status checks are limited to the documented Security Profile confirmation and MfaPage retry contracts.',
        'Receipt excludes tokens, provisioning URIs, secret keys, and request bodies.',
      ]),
    });
  } finally {
    await profileContext.close();
    await mfaContext.close();
  }
} finally {
  await browser.close();
}
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
