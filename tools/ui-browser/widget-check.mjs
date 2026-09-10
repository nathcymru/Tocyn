import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const samples=process.argv[2]===undefined?1:Number(process.argv[2]);
if(!Number.isInteger(samples)||samples<1||samples>50)throw new Error('Samples must be an integer from 1 to 50');
const bundle=readFileSync('apps/widget/dist/lumina-widget.js');
const server=createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.url==='/widget.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);return;}
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="en"><title>Local widget check</title><body><button>Host control</button><script data-widget-key="synthetic" src="/widget.js"></script></body></html>');return;}
 res.statusCode=404;res.end();
});
let browser;
try {
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true});
 const results=[];
 for(let sample=0;sample<(samples===1?1:samples+1);sample++) for(const aiChat of [true,false]){
  const context=await browser.newContext({viewport:{width:1200,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(5000);
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.name));
  let submissions=0,external=0;
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());if(url.origin!==origin){external++;return route.abort();}
   if(url.pathname.endsWith('/config'))return route.fulfill({json:{title:'Synthetic support',primaryColor:'#2457d6',features:{aiChat,ticketForm:true}}});
   if(url.pathname.endsWith('/session'))return route.fulfill({json:{user:{email:'tocyn-auth-test-a@example.invalid'}}});
   if(url.pathname.endsWith('/tickets')){submissions++;return route.fulfill({status:submissions===1?503:200,json:{}});}
   return route.continue();
  });
  try {
   await page.addInitScript(() => {
    window.__widgetTiming={};
    document.addEventListener('click', event => {
     const button=event.composedPath().find(node=>node instanceof HTMLButtonElement);
     const key=button?.getAttribute('aria-label')==='Open support'?'openMs':button?.textContent?.trim()==='Send Message'?'recoveryMs':null;
     if(!key || Number.isFinite(window.__widgetTiming[key]))return;
     const root=document.querySelector('#lumina-widget-container')?.shadowRoot;
     if(!root)return;
     const start=performance.now();
     const observer=new MutationObserver(()=>{
      const target=root.querySelector(key==='openMs'?'button[aria-label="Close support"]':'[role="alert"]');
      if(!target?.getClientRects().length)return;
      observer.disconnect();
      requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__widgetTiming[key]=performance.now()-start;}));
     });
     observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true});
    },true);
   });
   await page.goto(origin);const open=page.getByRole('button',{name:'Open support',exact:true});await open.waitFor();
   const startupMs=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now())))));
   await open.click();
   await page.waitForFunction(()=>Number.isFinite(window.__widgetTiming.openMs));
   const focused=locator=>locator.evaluate(el=>el.getRootNode().activeElement===el);
   await page.getByRole('button',{name:'Close support',exact:true}).first().waitFor();
   assert.equal(await focused(page.getByRole('button',{name:'Close support',exact:true}).first()),true,'open focus inside real shadow root');
   const ticket=page.getByRole('tab',{name:'New Ticket',exact:true});
   if(aiChat){const chat=page.getByRole('tab',{name:'AI Chat',exact:true});await chat.focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('#lumina-widget-container')?.shadowRoot?.activeElement?.textContent?.includes('New Ticket'));assert.equal(await focused(ticket),true,'ArrowRight reaches ticket tab in shadow root');assert.equal(await chat.getAttribute('aria-selected'),'true','manual activation retains chat');await page.keyboard.press('Enter');}
   else {assert.equal(await page.getByRole('tab',{name:'AI Chat'}).count(),0);}
   await page.getByLabel('Your Name',{exact:true}).fill('Synthetic tester');await page.getByLabel('Subject',{exact:true}).fill('Local retained draft');await page.getByLabel('Message',{exact:true}).fill('Synthetic body');
   if(aiChat){await page.getByRole('tab',{name:'AI Chat'}).click();await ticket.click();assert.equal(await page.getByLabel('Subject',{exact:true}).inputValue(),'Local retained draft');}
   await page.getByRole('button',{name:'Send Message',exact:true}).click();const error=page.getByRole('alert');await error.waitFor();assert.equal(await focused(error),true,'failed submit focus');assert.equal(await page.getByLabel('Subject',{exact:true}).inputValue(),'Local retained draft');
   await page.waitForFunction(()=>Number.isFinite(window.__widgetTiming.recoveryMs));
   const timing={startupMs,...await page.evaluate(()=>window.__widgetTiming)};
   await page.getByRole('button',{name:'Send Message',exact:true}).click();const success=page.getByRole('heading',{name:'Ticket Submitted!'});await success.waitFor();assert.equal(await focused(success),true,'success focus');assert.equal(submissions,2);
   await page.getByRole('button',{name:'Submit another ticket'}).click();assert.equal(await focused(page.getByLabel('Your Name',{exact:true})),true);
   await page.keyboard.press('Escape');await open.waitFor();assert.equal(await focused(open),true,'Escape returns launcher focus');assert.equal(external,0);assert.deepEqual(pageErrors,[]);
   if(samples===1 || sample>0)results.push({sample:samples===1?0:sample-1,aiChat,timing,result:'passed',submissions,checks:['real legacy shadow-root bootstrap','open/close focus',...(aiChat?['manual keyboard tabs','cross-tab draft retention']:['AI-off ticket path']),'failed-draft retention','failed submit/retry focus','new draft focus']});
  }finally{await context.close();}
 }
 console.log(JSON.stringify({version:1,recordedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),trackedDirty:execFileSync('git',['status','--short','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',workingTreeStatus:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),sourceHashes:Object.fromEntries(['apps/widget/src/main.tsx','apps/widget/src/App.tsx','apps/widget/src/components/TicketForm.tsx','apps/widget/vite.config.ts','packages/ui/src/ark.ts','tools/ui-browser/widget-check.mjs'].map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')])),bundleSha256:createHash('sha256').update(bundle).digest('hex'),node:process.version,browser:browser.version(),samplesPerMode:samples,warmups:samples===1?0:2,timingSummary:Object.fromEntries([true,false].map(mode=>[String(mode),Object.fromEntries(['startupMs','openMs','recoveryMs'].map(key=>{const sorted=results.filter(row=>row.aiChat===mode).map(row=>row.timing[key]).sort((a,b)=>a-b);return [key,Object.fromEntries([50,95,99].map(p=>['p'+p,sorted[Math.ceil(p/100*sorted.length)-1]]))];}))])),results,limitations:['Navigation time origin to observed launcher after two frames; DOM click to open/error observation after two frames. Automation startup latency included; not compositor paint proof.','Fresh contexts, warm browser/OS, reduced motion, serial alternating AI-on/off. No numeric widget timing threshold or valid pre-fix startup baseline claimed.','Fresh production widget build required.','Synthetic intercepted backend; no authentication/tenant or provider integration proof.','Existing legacy CSS/bootstrap only; no theme, visual, wrapper67, multi-instance or screen-reader acceptance.']},null,2));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
