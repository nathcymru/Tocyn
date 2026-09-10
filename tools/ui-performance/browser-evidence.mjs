/** Local production-build UI measurement; no provider or application backend is contacted. */
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { snapshot } from './bundle-evidence.mjs';
const require = createRequire(import.meta.url);
export function quantiles(values) {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid timing sample');
  const sorted = [...values].sort((a,b) => a-b);
  return Object.fromEntries([50,95,99].map(p => [`p${p}`, sorted[Math.ceil(p / 100 * sorted.length)-1]]));
}
async function serve(dist) {
  const root = await realpath(dist);
  const server = createServer(async(req,res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path.startsWith('/api/')) {
        const config = path === '/api/v1/customer/config';
        res.writeHead(config ? 200 : 401, {'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(JSON.stringify(config ? {} : {error:'Synthetic authentication denial'}));
        return;
      }
      if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405).end();return;}
      const file = await realpath(join(root, path === '/login' || path === '/' ? 'index.html' : decodeURIComponent(path)));
      if (!file.startsWith(root + sep)) {res.writeHead(403).end();return;}
      const body = await readFile(file);
      const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'}[extname(file)] || 'application/octet-stream';
      res.writeHead(200, {'Content-Type':mime,'Cache-Control':'no-store'});res.end(req.method === 'HEAD' ? undefined : body);
    } catch {res.writeHead(404).end();}
  });
  await new Promise((yes,no) => {server.once('error',no);server.listen(0,'127.0.0.1',yes);});
  return {origin:`http://127.0.0.1:${server.address().port}`,close:() => new Promise(resolve => server.close(resolve))};
}
async function measure(browser, origin, client) {
  const context = await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce',serviceWorkers:'block'});
  let blockedExternal = 0;
  await context.route('**/*', route => {
    if(new URL(route.request().url()).origin !== origin){blockedExternal++;return route.abort();}
    return route.continue();
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.addInitScript(() => {
      window.__tocynTiming = {};
      document.addEventListener('click', event => {
        if (!event.target.closest('button[type="submit"]')) return;
        const start = performance.now();
        const observer = new MutationObserver(() => {
          const alert = document.querySelector('[role="alert"]');
          if (!alert?.textContent?.trim()) return;
          observer.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => {window.__tocynTiming.recovery = performance.now()-start;}));
        });
        observer.observe(document,{subtree:true,childList:true,characterData:true});
      },true);
    });
    await page.goto(origin+'/login');
    const submit=page.locator('button[type="submit"]');
    await submit.waitFor({state:'visible'});
    await page.waitForFunction(() => {const button=document.querySelector('button[type="submit"]');return button && !button.disabled;});
    const startupMs=await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))));
    await page.locator('input[type="email"]').fill('performance-test@example.invalid');
    if (client==='dashboard') await page.locator('input[type="password"]').fill('synthetic-never-accepted');
    await submit.click();
    await page.waitForFunction(() => Number.isFinite(window.__tocynTiming.recovery));
    const recoveryMs=await page.evaluate(() => window.__tocynTiming.recovery);
    if(blockedExternal)throw new Error('Scenario attempted an external resource; requests were blocked');
    return {startupMs,recoveryMs};
  } finally {await context.close();}
}
export async function run(baselineRoot,candidateRoot,samples=20) {
  if(!Number.isInteger(samples)||samples<2||samples>100)throw new Error('Samples must be an integer from 2 to 100');
  const {chromium}=require('playwright');
  const baseline=snapshot(baselineRoot),candidate=snapshot(candidateRoot);
  const browser=await chromium.launch({headless:true});
  const clients={};
  try {
    for(const client of ['dashboard','portal']) {
      const before=await serve(join(baselineRoot,'apps',client,'dist'));
      let after;
      try {
        after=await serve(join(candidateRoot,'apps',client,'dist'));
        // Warm browser/process/filesystem once per side; each recorded sample has a fresh browser context.
        await measure(browser,before.origin,client);await measure(browser,after.origin,client);
        const values={baseline:[],candidate:[]};
        for(let i=0;i<samples;i++) {
          // Alternate order to reduce directional drift from a shared development machine.
          for(const side of i%2?['candidate','baseline']:['baseline','candidate'])
            values[side].push(await measure(browser,side==='baseline'?before.origin:after.origin,client));
        }
        clients[client]=Object.fromEntries(Object.entries(values).map(([side,raw])=>[side,{samples:raw,startupMs:quantiles(raw.map(x=>x.startupMs)),recoveryMs:quantiles(raw.map(x=>x.recoveryMs))}]));
      } finally {await before.close();if(after)await after.close();}
    }
    return {version:1,generatedAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,architecture:process.arch,playwright:require('playwright/package.json').version,browser:browser.version(),headless:true,viewport:{width:1280,height:800},reducedMotion:'reduce'},scenario:'Production login route: navigation time origin to usable submit observed after two animation frames; native submit click to synthetic denial rendered after two animation frames.',baseline,candidate,clients,limitations:['Fresh contexts and no-store responses; browser process and OS caches are warm. No cold-process or production-network claim.','Local static assets, no compression, no throttling, serial alternating samples; shared machine load is uncontrolled.','Authentication responses are fixed local denials; no real authentication, provider, delivery or backend performance acceptance.','Startup includes automation observation latency. Recovery starts at DOM click; two animation frames approximate rendering, not a compositor paint proof.','Only login startup/recovery is measured. Authenticated workspace, widget, full-motion interactions and numeric CI budgets remain required.','Caller must freshly build the supplied trees; artifact hashes are captured but build provenance is not independently attested.']};
  } finally {await browser.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [baseline,candidate,count]=process.argv.slice(2);
 if(!baseline||!candidate)throw new Error('Usage: node tools/ui-performance/browser-evidence.mjs BASELINE_ROOT CANDIDATE_ROOT [SAMPLES]');
 console.log(JSON.stringify(await run(resolve(baseline),resolve(candidate),count===undefined?20:Number(count)),null,2));
}
