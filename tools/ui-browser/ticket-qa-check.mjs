import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const origin='http://127.0.0.1:5190';
function luminance(color){
 const match=color.match(/^rgb\((\d+), (\d+), (\d+)\)$/);assert.ok(match,`Unsupported opaque color: ${color}`);
 return match.slice(1).map(Number).map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
}
function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
const browser=await chromium.launch();
try{
 const rows=[];
 for(const qa_type of [null,'answer','sop','question']){
  const context=await browser.newContext({reducedMotion:'reduce'});const page=await context.newPage();page.setDefaultTimeout(5000);
  let mutations=0,external=0;
  await context.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==origin){external++;return route.abort();}
   if(!['GET','HEAD'].includes(request.method())){mutations++;return route.abort();}
   if(url.pathname==='/api/tickets/synthetic-qa')return route.fulfill({json:{id:'synthetic-qa',subject:'Synthetic QA controls',status:'open',priority:'normal',customer_email:'tocyn-auth-test-a@example.invalid',created_at:'2026-09-10T00:00:00Z',articles:[{id:'synthetic-article',body:'Synthetic message',sender_type:'agent',is_internal:false,qa_type,created_at:'2026-09-10T00:00:00Z'}],pagination:{limit:20,next_cursor:null,has_more:false}}});
   return route.continue();
  });
  try{
   await page.goto(origin+'/__test-login');await page.waitForURL('**/settings/agent-permissions');await page.goto(origin+'/tickets/synthetic-qa');
   for(const [name,value] of [['Mark as SOP (internal procedure)','sop'],['Mark as answer','answer']]){
    const button=page.getByRole('button',{name,exact:true});await button.waitFor();
    assert.equal(await button.getAttribute('aria-pressed'),String(qa_type===value));assert.equal(await button.isDisabled(),qa_type==='question');
    for(const hover of [false,true]){
     if(hover)await button.hover();else await page.mouse.move(0,0);
     // Wait for the actual CSS transition to settle before measuring its final state.
     await button.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
     const style=await button.evaluate(el=>{const s=getComputedStyle(el);return {foreground:s.color,background:s.backgroundColor,height:el.getBoundingClientRect().height,opacity:s.opacity};});
     assert.equal(style.opacity,'1');assert.ok(style.height>=44);const ratio=contrast(style.foreground,style.background);assert.ok(ratio>=4.5,`${name} contrast ${ratio}`);
     rows.push({qa_type,name,hover,...style,contrast:ratio});
    }
    if(qa_type!=='question'){
     await button.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.equal(await button.evaluate(el=>document.activeElement===el),true);
     const focus=await button.evaluate(el=>{const s=getComputedStyle(el);return {visible:el.matches(':focus-visible'),width:s.outlineWidth,style:s.outlineStyle,color:s.outlineColor,offset:s.outlineOffset,parent:getComputedStyle(el.parentElement.parentElement).backgroundColor};});
     assert.equal(focus.visible,true);assert.ok(parseFloat(focus.width)>=2);assert.notEqual(focus.style,'none');assert.ok(contrast(focus.color,focus.parent)>=3);rows.push({qa_type,name,focus});
    }
   }
   if(qa_type==='question')await page.getByText('Legacy Question marker retained. Compatibility review is required before changing this marker.',{exact:true}).waitFor();
   assert.equal(mutations,0);assert.equal(external,0);
  }finally{await context.close();}
 }
 const paths=['apps/dashboard/src/pages/TicketDetailPage.tsx','packages/ui/src/styles/tocyn.css','tools/ui-browser/ticket-qa-check.mjs'];
 console.log(JSON.stringify({version:1,recordedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashes:Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),node:process.version,browser:browser.version(),rows,limitations:['Synthetic intercepted article reads; no server QA mutation, public retrieval or tenant isolation proof.','Default opaque colors and final hover state only; no full theme, widget, screen-reader or visual-layout acceptance.','Legacy disabled controls retain legibility but are not keyboard focus targets.']},null,2));
}finally{await browser.close();}
