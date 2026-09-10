import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { withTwoTenantFixture } from './local-tenant-fixture';
import { measureOperations } from './operational-performance';
const require = createRequire(import.meta.url);
async function main() {
  const revision = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const status = execFileSync('git',['status','--porcelain'],{encoding:'utf8'});
  const sourceFiles = ['scripts/run-operational-performance.ts','scripts/operational-performance.ts','scripts/local-tenant-fixture.ts'];
  const sources = Object.fromEntries(sourceFiles.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
  const measured = await withTwoTenantFixture(async fixture => {
    const challenge = await (await fixture.login('operatorA')).json<{mfa_required:boolean;token:string}>();
    assert.equal(challenge.mfa_required,true);
    const mfa = await fixture.request('/api/auth/mfa/verify',{method:'POST',token:challenge.token,body:{code:fixture.currentMfaCode('operatorA')}});
    assert.equal(mfa.status,200);
    const {token} = await mfa.json<{token:string}>();
    assert.equal(typeof token,'string');
    const scenarios = [
      {name:'health',expectedStatus:200,run:()=>fixture.request('/health')},
      {name:'unauthenticated-metadata',expectedStatus:401,run:()=>fixture.request('/api/api-keys')},
      {name:'authenticated-metadata',expectedStatus:200,run:()=>fixture.request('/api/api-keys',{token})},
    ];
    const measurements = [];
    for (const scenario of scenarios) {
      const warmup = await scenario.run();
      assert.equal(warmup.status,scenario.expectedStatus);
      await warmup.arrayBuffer();
      measurements.push({scenario:scenario.name,warmupRequests:1,...await measureOperations({samples:20,concurrency:2,expectedStatus:scenario.expectedStatus,run:async()=>{
        const response = await scenario.run();
        await response.arrayBuffer();
        return {status:response.status};
      }})});
    }
    return {measurements,fixtureResources:await fixture.resourceUsage()};
  });
  const passed = measured.measurements.every(result=>result.expectedResponses===result.samples);
  console.log(JSON.stringify({version:1,result:passed?'passed':'failed',kind:'tocyn-local-performance',recordedAt:new Date().toISOString(),revision,dirty:status.length>0,sources,
    tools:{node:process.version,miniflare:require('miniflare/package.json').version,tsx:require('tsx/package.json').version},
    environment:{mode:'disposable-miniflare',synthetic:true,remoteBindings:0,telemetry:'off',cleanup:'disposed'},
    configuration:{samplesPerScenario:20,concurrency:2,warmupPerScenario:1},...measured,
    limitations:['Local Node-hosted application with real Miniflare bindings; not deployed Worker latency.','Three HTTP scenarios only; no canonical-write, R2, DO, Workflow, AI or Queue benchmark.','Stored-row/object counts are fixture inventory, not D1 read/write billing counts.','No global SLO ratified; ingress issue51 retains its separate measured target.']
  }));
  if (!passed) process.exitCode=1;
}
void main().catch(()=>{console.error('Local performance harness failed; no acceptance receipt produced.');process.exitCode=1;});
