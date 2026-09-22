import ts from 'typescript';

const activeTsx = /^(?:apps\/(?:dashboard|portal|widget)|packages\/ui)\/src\/.+\.tsx$/;
const utility = /^(?:(?:sm|md|lg|xl|2xl|dark|hover|focus|focus-visible|disabled|group-hover):)*(?:block|inline-block|flex|inline-flex|grid|hidden|absolute|relative|sticky|fixed|truncate|sr-only|not-sr-only|items-(?:start|end|center|baseline|stretch)|justify-(?:start|end|center|between|around|evenly)|overflow-(?:hidden|auto|scroll)|flex-(?:col|row|wrap|nowrap|1)|[mp][trblxy]?-(?:\d+(?:\.\d+)?|px|auto)|gap-\d+(?:\.\d+)?|space-[xy]-\d+(?:\.\d+)?|(?:min-|max-)?[wh]-(?:\d+(?:\.\d+)?|full|screen)|text-(?:xs|sm|base|lg|xl|[2-9]xl)|bg-(?:slate|gray|zinc|neutral|stone|blue|red|green|amber)-(?:\d{2,3}|950)|rounded-(?:sm|md|lg|xl|2xl|3xl|full)|shadow-(?:sm|md|lg|xl|2xl)|font-(?:normal|medium|semibold|bold))$/;

/** Catch reintroduced Tailwind utility strings on rendered controls and layouts. */
export function parkTailwindClassFailure(relative, node, sourceFile) {
  if (!activeTsx.test(relative) || relative.includes('/__tests__/') || /\.(?:test|spec)\.tsx$/.test(relative)
    || !ts.isJsxAttribute(node) || node.name.text !== 'className' || !node.initializer) return null;

  let matched;
  const resolved = new Set();
  function constInitializer(reference) {
    const name = reference.text;
    for (let scope = reference.parent; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope) && scope.parameters.some(parameter => ts.isIdentifier(parameter.name) && parameter.name.text === name)) return null;
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
          // A nearer non-const binding shadows an outer const too. Only follow
          // simple immutable string aliases, never arbitrary computed values.
          return statement.declarationList.flags & ts.NodeFlags.Const && declaration.initializer
            && (ts.isStringLiteral(declaration.initializer) || ts.isNoSubstitutionTemplateLiteral(declaration.initializer)
              || ts.isIdentifier(declaration.initializer)) ? declaration : null;
        }
      }
    }
    return null;
  }
  function inspect(current) {
    if (matched) return;
    // Panda object values such as css({ display: 'grid' }) are style values,
    // not class tokens. Still inspect sibling literals in clsx(css(...), 'px-4').
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === 'css') return;
    if (ts.isIdentifier(current)) {
      const parent = current.parent;
      if (!ts.isPropertyAccessExpression(parent) || parent.name !== current) {
        if (!ts.isPropertyAssignment(parent) || parent.name !== current) {
          const declaration = constInitializer(current);
          if (declaration && !resolved.has(declaration)) {
            resolved.add(declaration);
            inspect(declaration.initializer);
          }
        }
      }
      return;
    }
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current) || ts.isTemplateHead(current)
      || ts.isTemplateMiddle(current) || ts.isTemplateTail(current)) {
      matched = current.text.split(/\s+/).find(name => utility.test(name));
    }
    ts.forEachChild(current, inspect);
  }
  inspect(node.initializer);
  if (!matched) return null;
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  return `Tailwind utility ${matched} in active application className: ${relative}:${line}`;
}
