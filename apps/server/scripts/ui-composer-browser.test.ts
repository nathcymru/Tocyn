import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { chromium, type Route } from 'playwright';
import { withTwoTenantFixture, type LocalTenantFixture } from './local-tenant-fixture';
import { initializeLocalBetaFixture } from './local-beta-fixture';

const root = resolve(import.meta.dirname, '../../..');
const maxBody = 1024 * 1024;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const csp = "default-src 'self'; base-uri 'none'; object-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; worker-src 'none'; form-action 'self'; frame-ancestors 'none'";

async function body(request: IncomingMessage) { const parts: Buffer[] = []; let bytes = 0; for await (const chunk of request) { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += value.length; if (bytes > maxBody) throw new Error('bounded composer browser body exceeded'); parts.push(value); } return parts.length ? Buffer.concat(parts) : undefined; }
async function startServer(fixture: LocalTenantFixture) {
  let uploadFailures = 0; let downloadFailures = 0;
  const dist = resolve(root, 'apps/dashboard/dist'); await readFile(join(dist, 'index.html'));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        const candidate = url.pathname.includes('.') ? url.pathname.slice(1) : 'index.html'; const path = resolve(dist, normalize(candidate));
        if (!path.startsWith(dist + sep)) return void response.writeHead(403).end();
        try { const bytes = await readFile(path); const ext = path.slice(path.lastIndexOf('.')); response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string,string>)[ext] ?? 'application/octet-stream', 'Content-Security-Policy': csp, 'Cache-Control': 'no-store' }).end(bytes); } catch { response.writeHead(404).end(); }
        return;
      }
      if (url.pathname.startsWith('/api/') && url.pathname.includes('/attachments/') && url.pathname.endsWith('/download') && request.method === 'GET' && downloadFailures > 0) { downloadFailures--; return void response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"error":"Synthetic protected download failure"}'); }
      if (url.pathname === '/api/attachments/upload' && request.method === 'POST' && uploadFailures > 0) { uploadFailures--; return void response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"error":"Synthetic authenticated upload failure"}'); }
      const headers: Record<string,string> = {}; for (const [key, value] of Object.entries(request.headers)) if (typeof value === 'string' && ['authorization','content-type'].includes(key.toLowerCase())) headers[key] = value;
      const result = await fixture.request(url.pathname + url.search, { method: request.method, rawBody: await body(request), contentType: request.headers['content-type'] ?? null, headers });
      response.writeHead(result.status, { 'Cache-Control': 'no-store', ...(result.headers.get('content-type') ? { 'Content-Type': result.headers.get('content-type')! } : {}) }).end(Buffer.from(await result.arrayBuffer()));
    } catch { response.writeHead(502, { 'Content-Type': 'application/json' }).end('{"error":"local composer forwarding failed"}'); }
  });
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  return { origin: `http://127.0.0.1:${(server.address() as {port:number}).port}`, failUploadOnce: () => { uploadFailures = 1; }, failDownloadOnce: () => { downloadFailures = 1; }, close: () => new Promise<void>(ok => server.close(() => ok())) };
}
async function contrast(locator: import('playwright').Locator, label: string) {
  const evaluate = Function('element', 'label', `
    const rgb = value => { const values = value.match(/^rgb\\((\\d+), (\\d+), (\\d+)\\)$/); if (!values) throw new Error('Unsupported rendered colour ' + value); return values.slice(1).map(Number); };
    const luminance = value => value.map(channel => { const c = channel / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, index) => sum + c * [.2126,.7152,.0722][index],0);
    const fg = getComputedStyle(element).color; let node = element; let background = 'rgb(255, 255, 255)'; while (node) { const candidate = getComputedStyle(node).backgroundColor; if (candidate !== 'rgba(0, 0, 0, 0)') { background = candidate; break; } node = node.parentElement; }
    const ratio = (Math.max(luminance(rgb(fg)),luminance(rgb(background)))+.05)/(Math.min(luminance(rgb(fg)),luminance(rgb(background)))+.05); return {label,fg,background,ratio};
  `) as (element: unknown,label:string) => {label:string;fg:string;background:string;ratio:number};
  const result = await locator.evaluate(evaluate,label); assert.ok(result.ratio >= 4.5, `${label} contrast ${result.ratio.toFixed(2)}:1 (${result.fg} on ${result.background})`); return result;
}
async function session(fixture: LocalTenantFixture) { const login = await fixture.login('operatorA'); assert.equal(login.status, 200); const challenge = await login.json<{token:string}>(); const verified = await fixture.request('/api/auth/mfa/verify', { method:'POST', token:challenge.token, body:{code:fixture.currentMfaCode('operatorA')} }); assert.equal(verified.status,200); const result = await verified.json<{token:string;user:unknown}>(); return result; }

test('proves production composer versioned markdown, literal plain text, safe preview and keyboard paths', async () => {
  await withTwoTenantFixture(async fixture => {
    const server = await startServer(fixture); const browser = await chromium.launch({headless:true}); const external:string[]=[]; const errors:string[]=[]; const expectedRealtimeErrors:string[]=[]; const expectedInjected503Errors:string[]=[];
    try {
      const auth = await session(fixture);
      const initialized = await fixture.request('/api/tickets/fixture-ticket/sla/initialize',{method:'POST',token:auth.token,body:{}}); assert.equal(initialized.status,201,'The real authorized SLA initialize route must prepare the fixture before strict dashboard reads');
    await initializeLocalBetaFixture(fixture, { runId:'composer-browser', tenants:[fixture.principals.customerA.tenantId, fixture.principals.customerB.tenantId], invitations:Object.values(fixture.principals).map(p => ({ tenantId:p.tenantId, id:p.localId, kind:p.role === 'customer' ? 'customer' as const : 'staff' as const })), limits:{ticketLimit:1,mutationLimit:12,recoveryReserve:2,uploadLimit:2} });
      const capability = await fixture.request('/api/tickets/fixture-ticket/reply-capability', {token:auth.token}); assert.equal(capability.status,200); const contract = await capability.json() as { version:number; modes:Array<{ visibility:string; channel:string; body:{ acceptedFormats:string[] } }> }; assert.equal(contract.version,1); assert.deepEqual(contract.modes.map(mode => `${mode.visibility}:${mode.channel}`).sort(), ['internal:internal','public:email']); assert.deepEqual(contract.modes[0].body.acceptedFormats.sort(), ['markdown-v1','plain']);
      const context = await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce',serviceWorkers:'block'}); await context.route('**/*', (route:Route) => new URL(route.request().url()).origin === server.origin ? route.continue() : (external.push(route.request().resourceType()), route.abort()));
      const page = await context.newPage(); page.on('console', message => { if (message.type() === 'error') { const text = message.text().replace(/([?&]token=)[^'\s]+/g, '$1<redacted>'); if (text === 'WebSocket error: Event' || text.includes('WebSocket connection to') && text.includes('Unexpected response code: 426')) expectedRealtimeErrors.push(text); else if (text === 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)') expectedInjected503Errors.push(text); else errors.push(text); } }); page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({token,user}) => localStorage.setItem('lumina-auth', JSON.stringify({state:{token,user,mfaRequired:false},version:0})), auth);
      const navigation = await page.goto(`${server.origin}/tickets/fixture-ticket`); assert.equal(navigation?.headers()['content-security-policy'],csp);
      const format = page.getByLabel('Message format'); await format.waitFor();
      server.failUploadOnce(); await page.getByLabel('Reply attachments',{exact:true}).setInputFiles({ name:'synthetic-image.png', mimeType:'image/png', buffer:png });
      await page.getByText('Upload failed.',{exact:true}).waitFor(); const feedback = page.getByText('Upload failed.',{exact:true}); const lightContrast = [await contrast(page.getByLabel('Reply message'), 'light editor'), await contrast(page.getByText('Safe preview',{exact:true}), 'light preview'), await contrast(feedback, 'light upload feedback')];
      await page.getByRole('button',{name:'Retry upload',exact:true}).click(); await page.getByText('synthetic-image.png',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Internal Note',exact:true}).click(); assert.equal(await page.getByRole('button',{name:'Internal Note',exact:true}).getAttribute('aria-pressed'),'true');
      await format.selectOption('markdown-v1'); const editor = page.getByLabel('Reply message'); await editor.waitFor();
      assert.equal(await page.getByRole('button', { name: /^(Edit|Live|Preview) code/ }).count(), 0, 'Safe Preview must be the only composer rendering route; uiw editor preview controls must not be reachable');
      await editor.fill('/g'); await page.getByRole('listbox',{name:'Slash command suggestions'}).waitFor(); await page.keyboard.press('Enter'); assert.match(await editor.inputValue(),/Hello,/);
      await editor.fill(':ch'); await page.getByRole('listbox',{name:'Emoji suggestions'}).waitFor(); await page.keyboard.press('Enter'); assert.equal(await editor.inputValue(),'✅');
      const markdown = '```ts\nconst safe = true;\n```\n\n[bad](javascript:alert(1))\n\n![remote](https://tracker.invalid/pixel)'; await editor.fill(markdown);
      await page.getByText('Safe preview',{exact:true}).click(); await page.locator('.token.keyword').first().waitFor(); assert.equal(await page.getByRole('link',{name:'bad'}).count(),0); await page.getByText('[Image omitted: remote]',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Add Note',exact:true}).click(); await page.getByText('Internal note added.',{exact:false}).waitFor(); await page.locator('code.language-ts').last().waitFor();
      const downloads:Array<{status:number;type:string|null;bytes:number}> = []; page.on('response', async response => { if (new URL(response.url()).pathname.includes('/attachments/') && new URL(response.url()).pathname.endsWith('/download')) downloads.push({status:response.status(),type:response.headers()['content-type'] ?? null,bytes:(await response.body()).byteLength}); }); server.failDownloadOnce(); const preview = page.getByRole('button',{name:'Preview image synthetic-image.png',exact:true}); await preview.click(); await page.getByText('Image preview could not be loaded.',{exact:false}).waitFor(); await page.getByRole('button',{name:'Retry image preview synthetic-image.png',exact:true}).click(); const image = page.getByAltText('Preview of synthetic-image.png',{exact:true}); await image.waitFor(); assert.equal(await image.evaluate(node => { const image = node as unknown as { complete: boolean; naturalWidth: number; naturalHeight: number }; return image.complete && image.naturalWidth === 1 && image.naturalHeight === 1; }),true,'The authenticated inline image must decode as the uploaded 1×1 PNG'); assert.deepEqual(downloads.map(download => [download.status,download.type,download.bytes]), [[503,'application/json',48],[200,'image/png',png.byteLength]],'The protected download retry must return the exact PNG bytes after one classified failure'); const hide = page.getByRole('button',{name:'Hide image preview synthetic-image.png',exact:true}); await hide.waitFor(); await hide.click(); assert.equal(await image.count(),0); const restoredPreview = page.getByRole('button',{name:'Preview image synthetic-image.png',exact:true}); await restoredPreview.waitFor(); assert.equal(await restoredPreview.evaluate((node: HTMLElement) => (globalThis as unknown as { document: { activeElement: unknown } }).document.activeElement === node),true,'Hiding the inline image must retain focus on its control');
      const plain = await fixture.request('/api/tickets/fixture-ticket/articles',{method:'POST',token:auth.token,body:{body:'**legacy literal**\n<img src=x>',body_format:'plain',is_internal:true,attachments:[]}}); assert.equal(plain.status,201);
      await page.reload(); await page.getByText('**legacy literal**',{exact:false}).waitFor(); assert.equal(await page.locator('img[src="x"]').count(),0);
      const preference = await fixture.request('/api/workspace/theme-preference',{token:auth.token}); assert.equal(preference.status,200); const theme = await preference.json<{revision:number}>();
      const dark = await fixture.request('/api/workspace/theme-preference',{method:'PUT',token:auth.token,body:{expectedRevision:theme.revision,mode:'dark'}}); assert.equal(dark.status,200); await page.reload(); await page.locator('[data-tocyn-theme-mode="dark"]').waitFor(); const darkEditor = page.getByLabel('Reply message'); await darkEditor.waitFor(); const darkContrast = [await contrast(darkEditor,'dark editor'), await contrast(page.getByText('Safe preview',{exact:true}),'dark preview')];
      assert.equal(lightContrast.length + darkContrast.length,5);
      assert.equal(external.length,0,'production composer must make no external request'); assert.ok(expectedRealtimeErrors.length > 0,'The isolated loopback fixture must record its explicit unsupported realtime 426 condition'); assert.equal(expectedInjected503Errors.length,2,'The two injected upload/download failures must be the only classified 503 console errors'); assert.deepEqual(errors,[],'production composer must have no unexpected console/page errors');
      await context.close();
    } finally { await browser.close(); await server.close(); }
  });
});
