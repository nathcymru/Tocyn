import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, select, build } from './index.mjs';
test('extracts navigation without comments, bodies or secret literals', () => {
 const node = extract('example.ts', `// SECRET_COMMENT\nimport { X } from './x';\nexport class Service { run() { return 'SECRET_BODY'; } }\nconst secret = 'SECRET_VALUE';`);
 assert.deepEqual(node.imports, ['./x']);
 assert.ok(node.symbols.some(s => s.name === 'Service' && s.line === 3));
 assert.ok(node.symbols.some(s => s.name === 'run'));
 assert.doesNotMatch(JSON.stringify(node), /SECRET_/);
});
test('impact follows incoming imports, query output is bounded', () => {
 const nodes = Array.from({length:30}, (_,i) => ({file:`${i}.ts`,symbols:[{name:'Service',line:1}],dependencies:['target.ts'],unresolved:[]}));
 assert.equal(select({nodes},'query','Service',3).results.length,3);
 assert.equal(select({nodes},'impact','target.ts',3).total,30);
 assert.equal(select({nodes},'impact','other.ts',3).total,0);
});
test('real repository graph resolves customer auth dependencies and ignores deployment outputs', () => {
 const index=build();
 const handler=index.nodes.find(n=>n.file==='apps/server/src/handlers/customer.handler.ts');
 assert.ok(handler, 'Expected the tracked customer handler to be indexed');
 assert.ok(handler.dependencies.includes('apps/server/src/services/customer-auth.service.ts'));
 assert.ok(index.nodes.every(n=>!n.file.startsWith('tools/') && !n.file.includes('/dist/')));
 assert.equal(build().fingerprint,index.fingerprint);
});

test('CLI refreshes changed sources and excludes untracked files and symlinks', async () => {
 const fs=await import('node:fs');
 const os=await import('node:os');
 const path=await import('node:path');
 const {execFileSync}=await import('node:child_process');
 const {root}=await import('./index.mjs');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'tocyn-context-'));
 try {
  fs.mkdirSync(path.join(temporary,'tools/agent-context'),{recursive:true});
  fs.mkdirSync(path.join(temporary,'apps/demo'),{recursive:true});
  fs.copyFileSync(path.join(root,'tools/agent-context/index.mjs'),path.join(temporary,'tools/agent-context/index.mjs'));
  fs.symlinkSync(path.join(root,'node_modules'),path.join(temporary,'node_modules'),'dir');
  fs.writeFileSync(path.join(temporary,'apps/demo/a.ts'),'export const Original = 1;');
  fs.writeFileSync(path.join(temporary,'apps/demo/tsconfig.json'),'{}');
  fs.writeFileSync(path.join(temporary,'apps/demo/untracked.ts'),'export const Untracked = 1;');
  fs.symlinkSync(path.join(temporary,'apps/demo/untracked.ts'),path.join(temporary,'apps/demo/link.ts'));
  execFileSync('git',['init','-q'],{cwd:temporary});
  execFileSync('git',['add','apps/demo/a.ts','apps/demo/link.ts','apps/demo/tsconfig.json'],{cwd:temporary});
  const query=term=>JSON.parse(execFileSync(process.execPath,['tools/agent-context/index.mjs','query',term],{cwd:temporary,encoding:'utf8'}));
  const before=query('Original');assert.equal(before.total,1);
  const alias=path.join(temporary,'checkout-alias');
  fs.symlinkSync(temporary,alias,'dir');
  const throughAlias=JSON.parse(execFileSync(process.execPath,['--preserve-symlinks-main',path.join(alias,'tools/agent-context/index.mjs'),'query','Original'],{cwd:alias,encoding:'utf8'}));
  assert.equal(throughAlias.total,1);
  assert.equal(throughAlias.fingerprint,before.fingerprint);
  fs.writeFileSync(path.join(temporary,'apps/demo/tsconfig.json'),'{"compilerOptions":{"allowJs":true}}');
  assert.notEqual(query('Original').fingerprint,before.fingerprint);
  assert.equal(query('Untracked').total,0);
  fs.writeFileSync(path.join(temporary,'apps/demo/a.ts'),'export const Changed = 2;');
  const after=query('Changed');assert.equal(after.total,1);assert.notEqual(after.fingerprint,before.fingerprint);
  assert.equal(query('Original').total,0);
 } finally { fs.rmSync(temporary,{recursive:true,force:true}); }
});

for (const extension of ['tsx', 'jsx']) {
 test(`indexes ${extension} components and declarations after JSX`, () => {
  const node=extract(`component.${extension}`, "import React from 'react';\nexport const View = () => <div>{[1,2].map(x => <span>{x}</span>)}</div>;\nexport function afterJSX() { return 1; }");
  assert.deepEqual(node.imports,['react']);
  assert.ok(node.symbols.some(s=>s.name==='View' && s.line===2));
  assert.ok(node.symbols.some(s=>s.name==='afterJSX' && s.line===3));
 });
}

test('an unchanged cached build does not reread tracked source contents', async () => {
 const {createRequire, syncBuiltinESMExports}=await import('node:module');
 const require=createRequire(import.meta.url);
 const fs=require('node:fs');
 const {root}=await import('./index.mjs');
 build();
 const original=fs.readFileSync;
 let sourceReads=0;
 try {
  fs.readFileSync=function(file,...args) {
   if(typeof file==='string' && file.startsWith(root+'/apps/') && /\.[cm]?[jt]sx?$/.test(file)) sourceReads++;
   return original.call(this,file,...args);
  };
  syncBuiltinESMExports();
  build();
  assert.equal(sourceReads,0,'Cache hits should stat source files without reading their contents');
 } finally { fs.readFileSync=original;syncBuiltinESMExports(); }
});
