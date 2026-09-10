import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const origin = 'http://127.0.0.1:5190';
const browser = await chromium.launch({headless:true});
let attempts=0; const payloads=[];
let releaseFirst; const firstHeld=new Promise(resolve=>{releaseFirst=resolve;});
try {
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.addInitScript(()=>localStorage.setItem('lumina-auth',JSON.stringify({state:{token:'ui-only-token',user:{id:'ui-only-user',tenant_id:'ui-only-tenant',email:'ui-only@example.invalid',full_name:'Synthetic operator',role:'agent',mfa_enabled:true},mfaRequired:false},version:0})));
  await context.route('**/*',async route=>{
    const request=route.request(), url=new URL(request.url());
    if(url.origin!==origin)return route.abort();
    if(url.pathname==='/api/knowledge/categories')return route.fulfill({json:[]});
    if(url.pathname==='/api/knowledge/articles'&&request.method()==='POST'){
      attempts++;payloads.push(request.postDataJSON());
      if(attempts===1)await firstHeld;
      return route.fulfill({status:503,json:{error:'Synthetic save unavailable'}});
    }
    if(url.pathname.startsWith('/api/'))return route.abort();
    return route.continue();
  });
  const page=await context.newPage();
  await page.goto(origin+'/knowledge/new');
  await page.getByRole('heading',{name:'New Article'}).waitFor();
  const title=page.getByRole('textbox',{name:'Title *',exact:true});
  const category=page.getByRole('combobox',{name:'Category',exact:true});
  const tier=page.getByRole('combobox',{name:'Tier',exact:true});
  const content=page.getByRole('textbox',{name:'Content (Markdown)',exact:true});
  assert.equal(await page.getByRole('button',{name:'Back to knowledge base'}).count(),1);
  await title.fill('Synthetic knowledge draft');
  await category.selectOption('');await tier.selectOption('sop');
  await content.fill('Synthetic internal procedure');
  await content.focus();assert.equal(await content.evaluate(e=>e===document.activeElement),true);
  await page.getByRole('button',{name:'Save Article',exact:true}).click();
  assert.equal(await title.isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Back to knowledge base'}).isDisabled(),true);
  assert.equal(await content.getAttribute('readonly'),'');
  await page.getByRole('button',{name:'Add bold text (ctrl + b)',exact:true}).evaluate(button=>button.click());
  assert.equal(await content.inputValue(),'Synthetic internal procedure');
  releaseFirst();
  await page.getByRole('alert').waitFor();
  assert.equal(await title.inputValue(),'Synthetic knowledge draft');
  assert.equal(await content.inputValue(),'Synthetic internal procedure');
  assert.equal(await tier.inputValue(),'sop');
  await page.getByRole('button',{name:'Save Article',exact:true}).click();
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Processing')));
  assert.equal(attempts,2);assert.deepEqual(payloads[0],payloads[1]);
  await page.screenshot({path:'/tmp/tocyn-knowledge-editor.png',fullPage:true});
  const path='apps/dashboard/src/pages/KnowledgeEditorPage.tsx';
  const receipt={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),scenario:'Local real Markdown editor: labels, input, SOP selection, synthetic failed save and unchanged retry',sourceSha256:createHash('sha256').update(await readFile(path)).digest('hex'),browser:browser.version(),passed:true,attempts,limitations:['All API requests intercepted or blocked; no server persistence, real provider, or complete editor toolbar/VoiceOver attestation.']};
  await writeFile('/tmp/tocyn-knowledge-editor.json',JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
}finally{await browser.close();}
