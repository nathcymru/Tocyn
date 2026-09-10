import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const clients = ['dashboard', 'portal', 'widget'];
function git(root, ...args) { return execFileSync('git', ['-C', root, ...args], {encoding:'utf8'}).trim(); }
function files(root) {
  return readdirSync(root,{withFileTypes:true}).flatMap(entry => entry.isDirectory() ? files(join(root,entry.name)) : [join(root,entry.name)]).sort();
}
export function snapshot(root) {
  root=resolve(root);
  const require=createRequire(join(root,'package.json'));
  const artifacts=Object.fromEntries(clients.map(client=>{
    const dist=join(root,'apps',client,'dist');
    const assets=files(dist).filter(file=>/\.(js|css)$/.test(file)).map(file=>{
      const content=readFileSync(file);
      return {path:relative(dist,file),kind:file.endsWith('.js')?'js':'css',bytes:content.length,gzipBytes:gzipSync(content,{level:9}).length,sha256:createHash('sha256').update(content).digest('hex')};
    });
    if(!assets.some(asset=>asset.kind==='js'))throw new Error(`Missing built JavaScript for ${client}`);
    const totals=Object.fromEntries(['js','css'].map(kind=>[kind,assets.filter(asset=>asset.kind===kind).reduce((sum,asset)=>({bytes:sum.bytes+asset.bytes,gzipBytes:sum.gzipBytes+asset.gzipBytes}),{bytes:0,gzipBytes:0})]));
    return [client,{assets,totals}];
  }));
  return {revision:git(root,'rev-parse','HEAD'),tree:git(root,'rev-parse','HEAD^{tree}'),trackedDirty:git(root,'status','--porcelain','--untracked-files=no')!=='',lockSha256:createHash('sha256').update(readFileSync(join(root,'package-lock.json'))).digest('hex'),vite:require('vite/package.json').version,artifacts};
}
export function compare(baseline,candidate) {
  return Object.fromEntries(clients.map(client=>[client,Object.fromEntries(['js','css'].map(kind=>{
    const before=baseline.artifacts[client].totals[kind],after=candidate.artifacts[client].totals[kind];
    return [kind,{bytesDelta:after.bytes-before.bytes,gzipBytesDelta:after.gzipBytes-before.gzipBytes,gzipPercentChange:before.gzipBytes===0?null:100*(after.gzipBytes-before.gzipBytes)/before.gzipBytes}];
  }))]));
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [baselineRoot,candidateRoot]=process.argv.slice(2);
  if(!baselineRoot||!candidateRoot)throw new Error('Usage: node tools/ui-performance/bundle-evidence.mjs BASELINE_ROOT CANDIDATE_ROOT');
  const baseline=snapshot(baselineRoot),candidate=snapshot(candidateRoot);
  console.log(JSON.stringify({version:1,generatedAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,architecture:process.arch,gzipLevel:9},scenario:'Production client builds; sum of individually compressed JS/CSS assets, not initial-route transfer or browser timing.',baseline,candidate,comparison:compare(baseline,candidate),limitations:['Build outputs must be freshly generated from the stated revision; this tool does not run builds.','No numeric budget or startup/interaction/edge-runtime acceptance is inferred.','Different lockfiles represent actual baseline/candidate dependencies; inspect tool versions before attributing changes.']},null,2));
}
