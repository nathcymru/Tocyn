import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=resolve(process.argv[2]??'.');
const localRequire=createRequire(join(root,'package.json'));
const {createServer}=await import(pathToFileURL(localRequire.resolve('vite')).href);
const {chromium}=createRequire(import.meta.url)('playwright');
const server=await createServer({logLevel:"error",root:join(root,'tools/ui-browser/fixture'),configFile:false,server:{host:'127.0.0.1',port:0,fs:{allow:[root]}},plugins:[{name:'local-shared-style',configureServer(server){server.middlewares.use('/tocyn.css',(_req,res)=>{res.setHeader('Content-Type','text/css');res.end(readFileSync(join(root,'packages/ui/src/styles/tocyn.css')));});}}]});
let browser;
try{
 await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 browser=await chromium.launch({headless:true});const results=[];
 for(const style of ['default','radical','none']){
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce',serviceWorkers:'block'});const page=await context.newPage();page.setDefaultTimeout(5000);
  let external=0;await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external++;return route.abort();}return route.continue();});
  try{
   await page.goto(`${origin}/?style=${style}`);await page.getByRole('heading',{name:'Primitive interaction fixture'}).waitFor();
   await page.getByLabel('Subject',{exact:true}).fill('Synthetic subject');await page.getByLabel('Priority',{exact:true}).selectOption('high');await page.getByRole('textbox',{name:'Details',exact:true}).fill('Synthetic body');
   await page.getByRole('button',{name:'Save form',exact:true}).focus();await page.keyboard.press('Enter');
   assert.deepEqual(JSON.parse(await page.getByLabel('Form result',{exact:true}).textContent()),{subject:'Synthetic subject',priority:'high',body:'Synthetic body'});
   await page.getByRole('button',{name:'Cancel internal action'}).click();assert.equal(await page.getByLabel('Internal calls',{exact:true}).textContent(),'0');assert.equal(await page.getByRole('button',{name:'Busy action'}).isDisabled(),true);
   const opener=page.getByRole('button',{name:'Open confirmation'});await opener.click();const dialog=page.getByRole('dialog',{name:'Confirm synthetic action'});await dialog.waitFor();
   const cancel=dialog.getByRole('button',{name:'Cancel',exact:true});await page.waitForFunction(()=>document.activeElement?.textContent==='Cancel');
   await page.keyboard.press('Shift+Tab');assert.equal(await dialog.getByRole('button',{name:'Confirm action'}).evaluate(el=>el===document.activeElement),true);
   await page.keyboard.press('Enter');await page.keyboard.press('Escape');assert.equal(await dialog.count(),1);await dialog.getByRole('alert').waitFor();assert.equal(await page.getByLabel('Confirmation calls',{exact:true}).textContent(),'1');
   await cancel.click();await dialog.waitFor({state:'detached'});await page.waitForFunction(()=>document.activeElement?.textContent==='Open confirmation');
   await page.getByRole('tab',{name:'First pane'}).focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.activeElement?.textContent==='Second pane');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('[role=tab][aria-selected=true]')?.textContent==='Second pane');assert.equal(await page.getByRole('tab',{name:'Second pane'}).getAttribute('aria-selected'),'true');
   await page.getByRole('listbox',{name:'Views'}).focus();await page.keyboard.press('End');await page.keyboard.press('Enter');assert.equal(await page.getByLabel('Selected view',{exact:true}).textContent(),'Needs Action');
   await page.getByRole('button',{name:'Open details'}).click();await page.getByRole('button',{name:'Close details'}).waitFor();await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.textContent==='Open details');
   const sizes=await page.locator('[data-tocyn-primitive]').evaluateAll(elements=>elements.filter(el=>!el.closest('[hidden]')).map(el=>({kind:el.getAttribute('data-tocyn-primitive'),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
   let presentation='not asserted without CSS';
   if(style!=='none'){const minimum=style==='radical'?48:44;for(const size of sizes)assert.ok(size.height>=minimum,`${style} ${size.kind} target height ${size.height} < ${minimum}`);const motion=await page.locator('[data-motion-probe]').evaluate(el=>({transition:getComputedStyle(el).transitionDuration,animation:getComputedStyle(el).animationDuration}));assert.deepEqual(motion,{transition:'0.001s',animation:'0.001s'});presentation='target height and reduced motion passed';}
   assert.equal(external,0);results.push({style,behavior:'passed',presentation,sizes});
  }catch(error){throw new Error(`Style ${style}: ${error.message}`,{cause:error});}finally{await context.close();}
 }
 console.log(JSON.stringify({version:1,recordedAt:new Date().toISOString(),node:process.version,sourceHashes:Object.fromEntries(['tools/ui-browser/check.mjs','tools/ui-browser/fixture/main.tsx','tools/ui-browser/fixture/index.html','tools/ui-browser/fixture/radical.css','packages/ui/src/styles/tocyn.css','packages/ui/src/primitives.tsx','packages/ui/src/dialog.tsx'].map(path=>[path,createHash('sha256').update(readFileSync(join(root,path))).digest('hex')])),workingTreeStatus:execFileSync('git',['-C',root,'status','--short'],{encoding:'utf8'}).trim(),revision:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),browser:browser.version(),scenario:'Real browser shared-control interaction independence with default/radical/no presentation CSS; synthetic local fixture, not application or theme66 acceptance.',results},null,2));
}finally{if(browser)await browser.close();await server.close();}
