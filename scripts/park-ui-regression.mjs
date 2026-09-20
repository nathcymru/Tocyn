import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = path.join(root, 'packages/ui');
const source = fs.readFileSync(path.join(ui, 'panda.config.ts'), 'utf8');
const css = fs.readFileSync(path.join(ui, 'src/styles/panda.css'), 'utf8');
const failures = [];
const parkRecipeKeys = new Set(['button', 'input', 'textarea']);
const parkSlotKeys = new Set(['avatar', 'card', 'checkbox', 'dialog', 'field', 'menu', 'pinInput', 'popover', 'scrollArea', 'select', 'splitter', 'switchRecipe', 'table', 'tabs']);

function prop(object, name) {
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  const member = object.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(ast) === name);
  return member?.initializer;
}

const ast = ts.createSourceFile('panda.config.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const rootObject = ast.statements.find(statement => ts.isExportAssignment(statement))?.expression;
const extend = prop(prop(rootObject, 'theme'), 'extend');
const recipes = prop(extend, 'recipes');
const slotRecipes = prop(extend, 'slotRecipes');
for (const [object, names, section] of [[recipes, parkRecipeKeys, 'recipes'], [slotRecipes, parkSlotKeys, 'slotRecipes']]) {
  if (!object || !ts.isObjectLiteralExpression(object)) {
    failures.push(`Panda theme.${section} is missing`);
    continue;
  }
  for (const member of object.properties) {
    if (!ts.isPropertyAssignment(member)) continue;
    const name = member.name.getText(ast).replace(/^['"]|['"]$/g, '');
    if (names.has(name)) failures.push(`Local override of official Park ${section}.${name}`);
  }
}
if (!source.includes('...parkRegistryRecipes') || !source.includes('...parkRegistrySlotRecipes')) {
  failures.push('Panda must register the installed Park recipe source');
}

const required = {
  button: ['button.tsx', '.button--variant_solid', '.button--variant_surface', '.button--variant_subtle', '.button--variant_outline', '.button--variant_plain'],
  select: ['select.tsx', '.select__trigger', '.select__content', '.select__item'],
  field: ['field.tsx', '.field__label', '.field__errorText'],
  pinInput: ['pin-input.tsx', '.pin-input__control', '.pin-input__input'],
  dialog: ['dialog.tsx', '.dialog__content', '.dialog__backdrop'],
  checkbox: ['checkbox.tsx', '.checkbox__control'],
  switch: ['switch.tsx', '.switch__control'],
  tabs: ['tabs.tsx', '.tabs__trigger', '.tabs__content'],
  splitter: ['splitter.tsx', '.splitter__panel', '.splitter__resizeTrigger'],
  scrollArea: ['scroll-area.tsx', '.scroll-area__viewport'],
};
for (const [name, [file, ...classes]] of Object.entries(required)) {
  const componentPath = path.join(ui, 'src/components/ui', file);
  if (!fs.existsSync(componentPath)) failures.push(`Installed Park ${name} source is missing: ${file}`);
  else if (!fs.readFileSync(componentPath, 'utf8').includes("../../styles/generated")) failures.push(`Park ${name} source does not use generated Panda styling`);
  for (const className of classes) if (!css.includes(className)) failures.push(`Generated CSS lacks ${className}`);
}

const unresolved = [...css.matchAll(/:\s*((?:colors\.)?(?:colorPalette|gray|blue|red|green)\.[\w.-]+)\s*(?=[;}])/g)];
for (const [, value] of unresolved.slice(0, 20)) failures.push(`Generated CSS has unresolved token ${value}`);
if (unresolved.length > 20) failures.push(`${unresolved.length - 20} more unresolved token declarations`);

// Follow only application imports reachable from app entries. Historical and
// test-only files are deliberately outside this rendered-surface check.
const entries = ['apps/dashboard/src/App.tsx', 'apps/portal/src/App.tsx', 'apps/widget/src/App.tsx', 'packages/ui/src/auth-layout.tsx', 'packages/ui/src/park.tsx', 'packages/ui/src/dialog.tsx', 'packages/ui/src/icons.tsx'];
const loadedCss = [css, 'packages/ui/src/styles/app-layout.css']
  .map(value => value.endsWith('.css') ? fs.readFileSync(path.join(root, value), 'utf8') : value).join('\n');
const visited = new Set();
function visit(relative) {
  const absolute = path.join(root, relative);
  if (visited.has(absolute) || !fs.existsSync(absolute)) return;
  visited.add(absolute);
  const content = fs.readFileSync(absolute, 'utf8');
  if (absolute.endsWith('.tsx')) {
    if (/data-park\s*=/.test(content)) failures.push(`Pseudo-Park marker in active application source: ${relative}`);
    if (/<ParkSelect\s*(?:>|\b(?!\.))/.test(content)) failures.push(`Callable ParkSelect remains in active application source: ${relative}`);
    if (/<select(?:\s|>)/i.test(content)) failures.push(`Native Select remains in active application source: ${relative}`);
    const jsx = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const classes = new Set();
    function inspect(node) {
      if (ts.isJsxAttribute(node) && node.name.text === 'className' && node.initializer) {
        const literals = current => {
          if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
            for (const name of current.text.split(/\s+/)) if (name.startsWith('tocyn-')) classes.add(name);
          }
          ts.forEachChild(current, literals);
        };
        literals(node.initializer);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(jsx);
    for (const className of classes) if (!loadedCss.includes(`.${className}`)) failures.push(`Unmatched legacy class ${className} in active source: ${relative}`);
  }
  for (const match of content.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
    const base = path.resolve(path.dirname(absolute), match[1]);
    const target = [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (target && target.startsWith(path.join(root, 'apps') + path.sep)) visit(path.relative(root, target));
  }
}
entries.forEach(visit);

// The temporary native-control compatibility API must not be reintroduced.
// Historical markdown and generated artifacts are intentionally outside this guard.
const retiredPrimitives = /\bTocyn(?:Button|Input|Select|Textarea|Panel|EmptyState)(?:Props)?\b/;
for (const directory of ['apps/dashboard/src', 'apps/portal/src', 'apps/widget/src', 'packages/ui/src', 'tools/ui-browser']) {
  const pending = [path.join(root, directory)];
  while (pending.length) {
    const current = pending.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, item.name);
      if (item.isDirectory()) {
        if (!['dist', 'generated', 'node_modules'].includes(item.name)) pending.push(target);
      } else if (/\.(?:ts|tsx|mjs)$/.test(item.name) && retiredPrimitives.test(fs.readFileSync(target, 'utf8'))) {
        failures.push(`Retired Tocyn compatibility primitive in active source: ${path.relative(root, target)}`);
      }
    }
  }
}
const uiExports = JSON.parse(fs.readFileSync(path.join(ui, 'package.json'), 'utf8')).exports;
if (Object.hasOwn(uiExports, './primitives')) failures.push('Retired @luminatick/ui/primitives package entry returned');

if (failures.length) {
  console.error(`Park UI regression guard failed (${failures.length}):\n${failures.map(item => `- ${item}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Park UI regression guard passed: installed components, recipes, CSS, and ${visited.size} active application files checked.`);
}
