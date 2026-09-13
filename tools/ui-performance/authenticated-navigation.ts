import { navigationArticle, navigationProfile, type NavigationProfile } from './navigation-profile';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, normalize, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, type Browser, type Route } from 'playwright';
import type { LocalTenantFixture } from '../../apps/server/scripts/local-tenant-fixture';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const maximumBodyBytes = 1024 * 1024;

type Client = 'dashboard' | 'portal';
type Timing = Readonly<{ listToDetailMs: number }>;
type Sample = Readonly<{ client: Client; sample: number; timing: Timing }>;
type RecoverySample = Readonly<{ client: Client; timing: Readonly<{ failedDetailRetryMs: number }> }>;
type WarmSample = Readonly<{ cycle: number; leg: 'A-to-B' | 'B-to-A'; usefulRenderMs: number; detailReads: readonly { status: number; completionFromClickDriverMs: number }[] }>;
type WarmReceipt = Readonly<{ profile: NavigationProfile; setupReplyPacing: 'at-most-10-per-61-seconds'; condition: 'same-context-previsited'; warmupVisits: 3; cycles: number; tickets: readonly { id: string; articles: number; bodyBytes: number }[]; samples: readonly WarmSample[]; returnToA: { p50: number; p95: number }; hardware: string; power: string; thresholdEvaluated: false }>;
type Sessions = Readonly<{ dashboard: Readonly<{ token: string; user: unknown }>; portal: Readonly<{ token: string }> }>;

export type AuthenticatedNavigationReceipt = Readonly<{
  version: 1;
  kind: 'tocyn-local-authenticated-ticket-navigation';
  revision: string;
  dirty: boolean;
  environment: Readonly<{ node: string; platform: string; browser: string; playwright: string; headless: true; viewport: Readonly<{ width: 1280; height: 800 }>; reducedMotion: 'reduce'; remoteBindings: 0; synthetic: true }>;
  tenantIsolation: Readonly<{ dashboardForeignTicketDenied: true; portalForeignTicketDenied: true }>;
  configuration: Readonly<{ samplesPerClient: number; maximumSamples: 20; warmupsPerClient: 0 }>;
  artifacts: Readonly<Record<Client, string>>;
  sourceHashes: Readonly<Record<string, string>>;
  measurements: readonly Sample[];
  recovery: readonly RecoverySample[];
  warmSwitches?: WarmReceipt;
  limitations: readonly string[];
}>;

function boundedSamples(samples: number): number {
  if (!Number.isInteger(samples) || samples < 1 || samples > 20) throw new Error('Samples must be an integer from 1 to 20');
  return samples;
}

function revision(): { revision: string; dirty: boolean } {
  const run = (args: string[]) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  return { revision: run(['rev-parse', 'HEAD']), dirty: run(['status', '--porcelain']).length > 0 };
}

async function digestDirectory(directory: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(path: string): Promise<void> {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else { hash.update(child.slice(directory.length)); hash.update(await readFile(child)); }
    }
  }
  await visit(directory);
  return hash.digest('hex');
}

async function sourceHashes(): Promise<Record<string, string>> {
  const paths = ['tools/ui-performance/authenticated-navigation.ts', 'tools/ui-performance/navigation-profile.ts', 'apps/server/scripts/ui-authenticated-navigation.test.ts', 'apps/dashboard/src/pages/InboxWorkspacePage.tsx', 'apps/dashboard/src/pages/TicketDetailPage.tsx', 'apps/portal/src/pages/TicketListPage.tsx', 'apps/portal/src/pages/TicketDetailPage.tsx'];
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(join(repositoryRoot, path))).digest('hex')])));
}

async function requestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBodyBytes) throw new Error('Request body exceeds local harness limit');
    chunks.push(bytes);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function requestHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string' && ['authorization', 'content-type', 'x-widget-key'].includes(name.toLowerCase())) headers[name] = value;
  }
  return headers;
}

async function staticResponse(root: string, pathname: string, response: ServerResponse): Promise<void> {
  const candidate = pathname === '/' || pathname === '/tickets' || pathname.startsWith('/tickets/') || pathname.startsWith('/inbox') ? 'index.html' : pathname.slice(1);
  const path = resolve(root, normalize(candidate));
  if (!path.startsWith(root + sep) && path !== root) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(path);
    const extension = path.slice(path.lastIndexOf('.'));
    const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string, string>)[extension] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }).end(bytes);
  } catch { response.writeHead(404).end(); }
}

async function startServer(fixture: LocalTenantFixture, client: Client): Promise<{ origin: string; failTicketDetailReads: (count: number) => void; close: () => Promise<void> }> {
  const root = resolve(repositoryRoot, 'apps', client, 'dist');
  let failedDetailReadsRemaining = 0;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return await staticResponse(root, url.pathname, response);
      if (failedDetailReadsRemaining > 0 && request.method === 'GET' && /\/tickets\/fixture-ticket$/.test(url.pathname)) {
        failedDetailReadsRemaining--;
        response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"error":"Synthetic local detail read failure"}');
        return;
      }
      const body = await requestBody(request);
      const fixtureResponse = await fixture.request(`${url.pathname}${url.search}`, {
        method: request.method,
        rawBody: body,
        contentType: request.headers['content-type'] ?? null,
        headers: requestHeaders(request),
      });
      const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
      const contentType = fixtureResponse.headers.get('content-type');
      if (contentType) headers['Content-Type'] = contentType;
      response.writeHead(fixtureResponse.status, headers).end(Buffer.from(await fixtureResponse.arrayBuffer()));
    } catch { response.writeHead(502, { 'Content-Type': 'application/json' }).end('{"error":"Local fixture forwarding failed"}'); }
  });
  await new Promise<void>((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise); });
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, failTicketDetailReads: (count: number) => {
    assert.ok(Number.isInteger(count) && count >= 1 && count <= 4, 'Synthetic detail fault count must stay bounded');
    failedDetailReadsRemaining = count;
  }, close: () => new Promise(resolvePromise => server.close(() => resolvePromise())) };
}

async function operatorToken(fixture: LocalTenantFixture, operator: 'operatorA' | 'operatorB' = 'operatorA'): Promise<{ token: string; user: unknown }> {
  const login = await fixture.login(operator);
  assert.equal(login.status, 200, 'Fixture operator login must succeed');
  const challenge = await login.json<{ mfa_required?: boolean; token?: string }>();
  assert.equal(challenge.mfa_required, true, 'Fixture operator login must require MFA');
  assert.equal(typeof challenge.token, 'string', 'Fixture operator challenge must contain a token');
  const response = await fixture.request('/api/auth/mfa/verify', { method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode(operator) } });
  assert.equal(response.status, 200, 'Fixture operator MFA verification must succeed');
  const completed = await response.json<{ token?: string; user?: unknown }>();
  assert.equal(typeof completed.token, 'string', 'Fixture MFA completion must create a session');
  assert.equal(await fixture.tokenTenant(completed.token!), fixture.principals[operator].tenantId);
  return { token: completed.token!, user: completed.user };
}

async function customerToken(fixture: LocalTenantFixture, customer: 'customerA' | 'customerB' = 'customerA'): Promise<string> {
  const principal = fixture.principals[customer];
  const requested = await fixture.request('/api/v1/customer/auth/request', { method: 'POST', body: { email: principal.email, type: 'magic_link', widgetKey: principal.widgetKey } });
  assert.equal(requested.status, 200, 'Fixture customer auth request must succeed');
  const messages = await (await fixture.request('/__local/auth-capture/messages')).json<Array<{ to?: string; loginLink?: string }>>();
  const link = [...messages].reverse().find(message => message.to === principal.email)?.loginLink;
  assert.ok(link, 'Fixture customer auth capture must contain its generated local link');
  const challenge = new URL(link).searchParams.get('token');
  assert.ok(challenge, 'Fixture customer link must contain a challenge token');
  const response = await fixture.request('/api/v1/customer/auth/verify', { method: 'POST', body: { token: challenge, widgetKey: principal.widgetKey } });
  assert.equal(response.status, 200, 'Fixture customer verification must succeed');
  const completed = await response.json<{ token?: string }>();
  assert.equal(typeof completed.token, 'string', 'Fixture customer verification must create a session');
  assert.equal(await fixture.widgetTokenTenant(completed.token!), principal.tenantId);
  return completed.token!;
}

async function measure(client: Client, origin: string, browser: Browser, fixture: LocalTenantFixture, sessions: Sessions, sample: number, injectDetailFault?: () => void): Promise<number> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  let pageRoute = '';
  const apiResponses: Array<{ path: string; status: number }> = [];
  const pageErrorNames: string[] = [];
  try {
    let external = 0;
    await context.route('**/*', (route: Route) => {
      if (new URL(route.request().url()).origin !== origin) { external++; return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin === origin && url.pathname.startsWith('/api/')) {
        apiResponses.push({ path: url.pathname, status: response.status() });
        if (apiResponses.length > 12) apiResponses.shift();
      }
    });
    page.on('pageerror', error => {
      pageErrorNames.push(error.name);
      if (pageErrorNames.length > 4) pageErrorNames.shift();
    });
    page.setDefaultTimeout(10_000);
    await page.addInitScript(`document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest('a[href^="/inbox/"], a[href="/tickets/fixture-ticket"], button') : null;
      if (!target) return;
      if (target.matches('a[href^="/inbox/"], a[href="/tickets/fixture-ticket"]')) window.__tocynTicketNavigationStart = performance.now();
      if (/^Retry loading (ticket|conversation)$/.test(target.textContent.trim())) window.__tocynTicketRetryStart = performance.now();
    }, true);`);
    if (client === 'dashboard') {
      const session = sessions.dashboard;
      await page.addInitScript(({ token, user }: { token: string; user: unknown }) => localStorage.setItem('lumina-auth', JSON.stringify({ state: { token, user, mfaRequired: false }, version: 0 })), session);
    } else {
      const token = sessions.portal.token;
      const key = fixture.principals.customerA.widgetKey;
      await page.addInitScript(({ token: suppliedToken, widgetKey }: { token: string; widgetKey: string }) => {
        localStorage.setItem('lumina_customer_token', suppliedToken); sessionStorage.setItem('tocyn_widget_key', widgetKey);
      }, { token, widgetKey: key });
    }
    const listPath = client === 'dashboard' ? '/inbox/all' : '/tickets';
    await page.goto(`${origin}${listPath}${client === 'portal' ? `?key=${fixture.principals.customerA.widgetKey}` : ''}`);
    pageRoute = new URL(page.url()).pathname;
    const subject = 'Fixture ticket A';
    const ticketTarget = (client === 'dashboard'
      ? page.getByRole('option', { name: new RegExp(subject) })
      : page.getByRole('link', { name: new RegExp(subject) })).first();
    await ticketTarget.waitFor({ state: 'visible' });
    const href = await ticketTarget.getAttribute('href');
    assert.ok(href?.startsWith('/'), 'Authenticated ticket list must use a local route');
    const detailPath = new URL(href!, origin).pathname;
    assert.equal(detailPath, client === 'dashboard' ? '/inbox/all/fixture-ticket' : '/tickets/fixture-ticket',
      'Each client must retain its approved detail route');
    injectDetailFault?.();
    await ticketTarget.click();
    await page.waitForURL(url => new URL(url).pathname === detailPath);
    pageRoute = new URL(page.url()).pathname;
    if (injectDetailFault) {
      const retryName = client === 'dashboard' ? 'Retry loading ticket' : 'Retry loading conversation';
      await page.getByRole('alert').waitFor({ state: 'visible' });
      const retry = page.getByRole('button', { name: retryName, exact: true });
      await retry.waitFor({ state: 'visible' });
      await retry.click();
    }
    // The portal heading also includes its visible status; requiring a heading prevents a stale list link from satisfying recovery.
    const detailHeading = page.getByRole('heading', { name: subject });
    await detailHeading.waitFor({ state: 'visible' });
    if (injectDetailFault && client === 'portal') {
      assert.equal(await detailHeading.evaluate(heading => (heading as unknown as { ownerDocument: { activeElement: unknown } }).ownerDocument.activeElement === heading), true, 'Portal retry must focus its recovered conversation heading');
    }
    const observed = await page.evaluate(`(async () => {
      const started = window.${injectDetailFault ? '__tocynTicketRetryStart' : '__tocynTicketNavigationStart'};
      if (!Number.isFinite(started)) throw new Error('Browser click timestamp was not recorded');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return performance.now() - started;
    })()`);
    if (typeof observed !== 'number' || !Number.isFinite(observed) || observed < 0) throw new Error('Browser navigation timing was invalid');
    const elapsed = observed;
    assert.equal(external, 0, 'Authenticated navigation must not request external origins');
    return elapsed;
  } catch (error) {
    // Keep CI diagnostics bounded and token-free: only local path/status and error class.
    const diagnostic = JSON.stringify({ client, sample, route: pageRoute, apiResponses, pageErrorNames });
    throw new Error(`Authenticated navigation did not reach its detail readiness target: ${diagnostic}`, { cause: error });
  } finally { await context.close(); }
}

/** Optional synthetic UI measurement; never a budgeted-runtime acceptance claim. */
async function measureWarmSwitches(fixture: LocalTenantFixture, origin: string, browser: Browser, sessions: Sessions, cycles: number, profile: NavigationProfile): Promise<WarmReceipt> {
  const targets: Array<{id:string; subject:string; marker:string; articles:number; bodyBytes:number}> = [];
  let repliesInWindow=0;
  for (const suffix of ['A', 'B'] as const) {
    const subject = `Warm navigation synthetic ${suffix}`;
    const bodies=Array.from({length:profile.articlesPerTicket},(_,index)=>navigationArticle(profile,suffix,index));
    const marker=bodies[bodies.length-1];
    const created = await fixture.request('/api/tickets', {method:'POST', token:sessions.dashboard.token,
      idempotencyKey:`performance139-warm-${suffix}`, body:{subject,body:bodies[0],customer_email:fixture.principals.customerA.email}});
    assert.equal(created.status, 201, 'Warm fixture must use the canonical same-tenant create route');
    const {id} = await created.json<{id:string}>();
    for(let index=1;index<bodies.length;index++) {
      // Real route permits ten replies/minute across tickets for this identity.
      // Setup pacing is outside every measured interval; no guard/IP changes.
      if(repliesInWindow===10){await new Promise(resolve=>setTimeout(resolve,61_000));repliesInWindow=0;}
      const reply=await fixture.request(`/api/tickets/${id}/articles`,{method:'POST',token:sessions.dashboard.token,
        idempotencyKey:`performance139-warm-${profile.name}-${suffix}-article-${index}`,body:{body:bodies[index],is_internal:false}});
      assert.equal(reply.status,201,'Canonical synthetic article creation must succeed');await reply.body?.cancel();repliesInWindow++;
    }
    const response = await fixture.request(`/api/tickets/${id}`, {token:sessions.dashboard.token});
    assert.equal(response.status, 200);
    const detail = await response.json<{articles:Array<{body:string}>}>();
    assert.equal(detail.articles.length, profile.articlesPerTicket, 'All declared articles must be returned in the bounded first page');
    assert.deepEqual(detail.articles.map(article=>article.body).sort(),[...bodies].sort(),'Canonical bodies match declared UTF-8 fixture');
    assert.ok(detail.articles.every(article=>Buffer.byteLength(article.body)===profile.bytesPerArticle));
    targets.push({id,subject,marker,articles:detail.articles.length,bodyBytes:Buffer.byteLength(detail.articles[0].body)});
  }
  const context = await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce',serviceWorkers:'block'});
  try {
    let external = 0;
    await context.route('**/*', route => {if(new URL(route.request().url()).origin!==origin){external++;return route.abort();}return route.continue();});
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    await page.addInitScript(({token,user})=>localStorage.setItem('lumina-auth',JSON.stringify({state:{token,user,mfaRequired:false},version:0})),sessions.dashboard);
    await page.goto(`${origin}/inbox/all`);
    for (const target of targets) {
      await page.getByRole('option',{name:new RegExp(target.subject)}).click();
      await page.getByRole('heading',{name:target.subject,exact:true}).waitFor();
      await page.getByText(target.marker,{exact:true}).first().waitFor();
    }
    // End warmup on A; this return is unmeasured and is recorded separately.
    await page.getByRole('option',{name:new RegExp(targets[0].subject)}).click();
    await page.getByRole('heading',{name:targets[0].subject,exact:true}).waitFor();
    const samples: WarmSample[] = [];
    for(let cycle=0;cycle<cycles;cycle++) for(const index of [1,0]) {
      const target=targets[index];
      const detailReads: Array<{status:number;completionFromClickDriverMs:number}> = [];
      let driverStart=0;
      const networkCompletions: Promise<void>[] = [];
      const onResponse=(response: import('playwright').Response)=>{
        if(new URL(response.url()).pathname===`/api/tickets/${target.id}` && response.request().method()==='GET') {
          assert.ok(networkCompletions.length<64,'Bounded per-switch network diagnostics');
          networkCompletions.push(response.finished().then(error=>{
            assert.equal(error,null,'Observed detail response must finish successfully');
            assert.equal(response.status(),200,'Failed detail reads cannot count as healthy warm performance');
            detailReads.push({status:response.status(),completionFromClickDriverMs:performance.now()-driverStart});
          }));
        }
      };
      // Browser-side observation avoids including the driver's heading-poll round trip.
      await page.evaluate(`(() => {
        const {subject,marker} = ${JSON.stringify({subject:target.subject,marker:target.marker})};
        const state = window; state.__warmResult=null;
        const start=(event)=>{
          if(!(event.target instanceof Element) || !event.target.closest('a'))return;
          document.removeEventListener('click',start,true);
          const started=performance.now();
          const observer=new MutationObserver(check);
          function check(){
            const visible = node => {
              const rect=node.getBoundingClientRect(); const style=getComputedStyle(node);
              return rect.width>0 && rect.height>0 && style.display!=='none' && style.visibility!=='hidden' && style.visibility!=='collapse';
            };
            const heading=Array.from(document.querySelectorAll('h1,h2')).find(node=>node.textContent===subject && visible(node));
            if(!heading)return;
            const scope=heading.closest('article') || heading.closest('main') || document.body;
            const walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT); let found=false;
            while(walker.nextNode()) {const node=walker.currentNode;if(node.textContent.trim()===marker && node.parentElement && visible(node.parentElement)){found=true;break;}}
            if(!found)return;
            observer.disconnect();requestAnimationFrame(()=>requestAnimationFrame(()=>{state.__warmResult=performance.now()-started;}));
          }
          observer.observe(document.body,{childList:true,subtree:true,characterData:true});check();
        };
        document.addEventListener('click',start,true);
      })()`);
      page.on('response',onResponse);driverStart=performance.now();
      try {
        await page.getByRole('option',{name:new RegExp(target.subject)}).click();
        await page.waitForFunction('Number.isFinite(window.__warmResult)');
        page.off('response',onResponse);
        const usefulRenderMs=await page.evaluate<number>('window.__warmResult');
        assert.ok(Number.isFinite(usefulRenderMs)&&usefulRenderMs>=0);
        // Finish responses observed before useful render, outside its timing.
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([Promise.all(networkCompletions),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Warm detail response timed out')),10_000);})]); }
        finally {clearTimeout(timeout);}
        samples.push({cycle,leg:index===1?'A-to-B':'B-to-A',usefulRenderMs,detailReads});
      } finally {page.off('response',onResponse);}
    }
    assert.equal(external,0);
    const returns=samples.filter(row=>row.leg==='B-to-A').map(row=>row.usefulRenderMs).sort((a,b)=>a-b);
    const percentile=(p:number)=>returns[Math.max(0,Math.ceil(returns.length*p)-1)];
    return {profile,setupReplyPacing:'at-most-10-per-61-seconds',condition:'same-context-previsited',warmupVisits:3,cycles,tickets:targets.map(({id,articles,bodyBytes})=>({id,articles,bodyBytes})),samples,
      returnToA:{p50:percentile(.5),p95:percentile(.95)},hardware:process.env.TOCYN_UI_HARDWARE_LABEL??'unspecified',power:process.env.TOCYN_UI_POWER_STATE??'unspecified',thresholdEvaluated:false};
  } finally {await context.close();}
}

/** Real fixture authentication plus built-client ticket navigation; no mocks or remote resources. */
export async function runAuthenticatedNavigation(fixture: LocalTenantFixture, samples = 20, options: { warmSwitches?: boolean; warmProfile?: string } = {}): Promise<AuthenticatedNavigationReceipt> {
  boundedSamples(samples);
  const profile=navigationProfile(options.warmProfile);
  if(options.warmProfile && !options.warmSwitches)throw new Error('Warm profile requires explicit warm-switch opt-in');
  const browser = await chromium.launch({ headless: true });
  let dashboardServer: Awaited<ReturnType<typeof startServer>> | undefined;
  let portalServer: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    dashboardServer = await startServer(fixture, 'dashboard');
    portalServer = await startServer(fixture, 'portal');
    const dashboard = dashboardServer;
    const portal = portalServer;
    const sessions: Sessions = Object.freeze({ dashboard: await operatorToken(fixture), portal: Object.freeze({ token: await customerToken(fixture) }) });
    const dashboardForeign = await fixture.request('/api/tickets/fixture-b-only', { token: sessions.dashboard.token });
    const portalForeign = await fixture.request('/api/v1/customer/tickets/fixture-b-only', { token: sessions.portal.token, headers: { 'X-Widget-Key': fixture.principals.customerA.widgetKey } });
    assert.equal(dashboardForeign.status, 404, 'Tenant A dashboard session must not read tenant B-only ticket');
    assert.equal(portalForeign.status, 404, 'Tenant A customer session must not read tenant B-only ticket');
    const dashboardOwner = await fixture.request('/api/tickets/fixture-b-only', { token: (await operatorToken(fixture, 'operatorB')).token });
    const portalOwner = await fixture.request('/api/v1/customer/tickets/fixture-b-only', { token: await customerToken(fixture, 'customerB'), headers: { 'X-Widget-Key': fixture.principals.customerB.widgetKey } });
    assert.equal(dashboardOwner.status, 200, 'Tenant B dashboard session must read its own ticket');
    assert.equal(portalOwner.status, 200, 'Tenant B customer session must read its own ticket');
    assert.equal((await fixture.request('/api/auth/me', { token: sessions.dashboard.token })).status, 200, 'Fixture dashboard session must resolve its identity');
    assert.equal((await fixture.request('/api/v1/customer/auth/me', { token: sessions.portal.token, headers: { 'X-Widget-Key': fixture.principals.customerA.widgetKey } })).status, 200, 'Fixture customer session must resolve its identity');
    const measurements: Sample[] = [];
    for (let sample = 0; sample < samples; sample++) {
      measurements.push(Object.freeze({ client: 'dashboard', sample, timing: Object.freeze({ listToDetailMs: await measure('dashboard', dashboard.origin, browser, fixture, sessions, sample) }) }));
      measurements.push(Object.freeze({ client: 'portal', sample, timing: Object.freeze({ listToDetailMs: await measure('portal', portal.origin, browser, fixture, sessions, sample) }) }));
    }
    const recovery: RecoverySample[] = [];
    recovery.push(Object.freeze({ client: 'dashboard', timing: Object.freeze({ failedDetailRetryMs: await measure('dashboard', dashboard.origin, browser, fixture, sessions, samples, () => dashboard.failTicketDetailReads(2)) }) }));
    recovery.push(Object.freeze({ client: 'portal', timing: Object.freeze({ failedDetailRetryMs: await measure('portal', portal.origin, browser, fixture, sessions, samples, () => portal.failTicketDetailReads(1)) }) }));
    const warmSwitches = options.warmSwitches ? await measureWarmSwitches(fixture,dashboard.origin,browser,sessions,samples,profile) : undefined;
    const source = revision();
    return Object.freeze({
      version: 1, kind: 'tocyn-local-authenticated-ticket-navigation', revision: source.revision, dirty: source.dirty,
      environment: Object.freeze({ node: process.version, platform: process.platform, browser: browser.version(), playwright: require('playwright/package.json').version, headless: true, viewport: Object.freeze({ width: 1280, height: 800 }), reducedMotion: 'reduce', remoteBindings: 0, synthetic: true }),
      tenantIsolation: Object.freeze({ dashboardForeignTicketDenied: true, portalForeignTicketDenied: true }),
      configuration: Object.freeze({ samplesPerClient: samples, maximumSamples: 20, warmupsPerClient: 0 }),
      artifacts: Object.freeze({ dashboard: await digestDirectory(resolve(repositoryRoot, 'apps/dashboard/dist')), portal: await digestDirectory(resolve(repositoryRoot, 'apps/portal/dist')) }),
      sourceHashes: Object.freeze(await sourceHashes()),
      measurements: Object.freeze(measurements),
      ...(warmSwitches ? {warmSwitches} : {}),
      recovery: Object.freeze(recovery),
      limitations: Object.freeze(['Local disposable Miniflare fixture and loopback static servers only; not deployed-worker or provider timing.', 'Fixture-issued sessions prove only this synthetic tenant/auth flow; no production authentication or customer data.', 'Synthetic 503 detail faults are injected only by this loopback forwarding boundary; initial authentication and recovered reads use the real fixture.', 'No numeric threshold is evaluated.', 'Warm switches use one previsited context; request observations do not prove cache hits. Network observation ends at useful render and may omit later revalidation. The synthetic fixture does not establish sustained budgeted runtime performance.']),
    });
  } finally { await portalServer?.close(); await dashboardServer?.close(); await browser.close(); }
}
