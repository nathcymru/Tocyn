// Development-only navigation. Never import this module from application code.
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Normalize a symlinked checkout root once; still exclude symlinks inside the checkout.
export const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const output = path.join(root, '.agent-context/index.json');
const hash = text => createHash('sha256').update(text).digest('hex');
const version = 1;

export function extract(file, content) {
  const extension = path.extname(file).toLowerCase();
  const kind = extension === '.tsx' ? ts.ScriptKind.TSX : extension === '.jsx' ? ts.ScriptKind.JSX : ['.js', '.mjs', '.cjs'].includes(extension) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind);
  const symbols = [], imports = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) imports.push(node.arguments[0].text);
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isMethodDeclaration(node) || ts.isVariableDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
      // Only identifiers and locations: no bodies, comments or literal values.
      symbols.push({ name: node.name.text, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { file, symbols, imports: [...new Set(imports)].sort() };
}

function inventory() {
  const names = execFileSync('git', ['ls-files', '-z', '--', 'apps', 'packages', 'scripts'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).split('\0').filter(Boolean).sort();
  const files = [];
  for (const file of names) {
    if (!/\.(?:[cm]?[jt]sx?)$/.test(file) || /(?:^|\/)(?:node_modules|dist|build|coverage|vendor|\.wrangler)(?:\/|$)/.test(file)) continue;
    const absolute = path.join(root, file);
    let stat;
    try { stat = lstatSync(absolute); } catch { continue; } // Deleted worktree files.
    if (!stat.isFile() || stat.size > 1024 * 1024 || realpathSync(absolute) !== absolute) continue;
    files.push({ file, content: readFileSync(absolute, 'utf8') });
  }
  return files;
}

export function resolveEdges(nodes, optionsFor = () => ({})) {
  const files = new Set(nodes.map(n => n.file));
  for (const node of nodes) {
    node.dependencies = [];
    node.unresolved = [];
    for (const specifier of node.imports) {
      const resolved = ts.resolveModuleName(specifier, path.join(root, node.file), optionsFor(node.file), ts.sys).resolvedModule;
      const relative = resolved && path.relative(root, resolved.resolvedFileName).split(path.sep).join('/');
      if (relative && files.has(relative)) node.dependencies.push(relative);
      else node.unresolved.push(specifier); // Includes external packages and computed/unsupported resolution.
    }
    node.dependencies = [...new Set(node.dependencies)].sort();
    delete node.imports;
  }
  return nodes;
}

export function build() {
  const files = inventory();
  const fingerprint = hash(JSON.stringify(files.map(f => [f.file, hash(f.content)])) + readFileSync(fileURLToPath(import.meta.url), 'utf8') + ts.version + configurationFingerprint());
  try {
    const cached = JSON.parse(readFileSync(output, 'utf8'));
    if (cached.version === version && cached.fingerprint === fingerprint) return cached;
  } catch { /* Missing or invalid derived data: rebuild. */ }
  const configs = new Map();
  const optionsFor = file => {
    const config = ts.findConfigFile(path.dirname(path.join(root, file)), ts.sys.fileExists);
    if (!config || !config.startsWith(root + path.sep)) return {};
    if (!configs.has(config)) {
      const loaded = ts.readConfigFile(config, ts.sys.readFile);
      configs.set(config, ts.parseJsonConfigFileContent(loaded.config || {}, ts.sys, path.dirname(config)).options);
    }
    return configs.get(config);
  };
  const nodes = resolveEdges(files.map(f => extract(f.file, f.content)), optionsFor);
  const index = { version, fingerprint, typescript: ts.version, nodes };
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(index));
  return index;
}
function configurationFingerprint() {
  const configs = execFileSync('git', ['ls-files', '-z', '--', '*tsconfig*.json', '*package.json'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  return configs.map(f => { try { const p=path.join(root,f); return realpathSync(p) === p ? f + readFileSync(p,'utf8') : ''; } catch { return ''; } }).join('\n');
}
export function select(index, command, term, limit = 8) {
  if (!term || term.length > 200) throw new Error('Supply a file path or symbol query (1–200 characters).');
  const query = term.toLowerCase();
  const matches = command === 'impact'
    ? index.nodes.filter(n => n.file === term || n.dependencies.includes(term))
    : index.nodes.filter(n => n.file.toLowerCase().includes(query) || n.symbols.some(s => s.name.toLowerCase().includes(query)));
  return { fingerprint: index.fingerprint, total: matches.length, shown: Math.min(limit, matches.length), results: matches.slice(0, limit).map(n => ({ file: n.file, symbols: n.symbols.filter(s => command === 'impact' || s.name.toLowerCase().includes(query)).slice(0, 12), dependencies: n.dependencies.slice(0, 12), unresolved: n.unresolved.slice(0, 6) })) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command = 'help', term, rawLimit = '8'] = process.argv.slice(2);
    if (command === 'help') console.log('node tools/agent-context/index.mjs build | query <symbol-or-path> [limit] | impact <exact-path> [limit]\nOnly tracked TS/JS is indexed; git add new source files before querying them.');
    else {
      if (!['build', 'query', 'impact'].includes(command)) throw new Error('Unknown command; use help.');
      const limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Limit must be an integer from 1 to 20.');
      const index = build();
      const result = command === 'build' ? { files: index.nodes.length, fingerprint: index.fingerprint, output: '.agent-context/index.json' } : select(index, command, term, limit);
      const text = JSON.stringify(result, null, 2);
      if (text.length > 16000) throw new Error('Result exceeds context budget; use a lower limit.');
      console.log(text);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
