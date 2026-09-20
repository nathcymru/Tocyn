import ts from 'typescript';

/** Static JSX guard for explicit vendor glyph settings and unlabelled icon-only controls. */
export function iconJsxFailures(relative, content) {
  const source = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const vendorIcons = new Set();
  const vendorNamespaces = new Set();
  const appIcons = new Set();
  const appIconNamespaces = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    const names = statement.importClause?.namedBindings;
    if (module === '@phosphor-icons/react' && names && ts.isNamespaceImport(names)) {
      vendorNamespaces.add(names.name.text);
    }
    if ((module === '@luminatick/ui/icons' || /(?:^|\/)icons$/.test(module) || /(?:^|\/)phosphor-icons$/.test(module))
      && names && ts.isNamespaceImport(names)) appIconNamespaces.add(names.name.text);
    if (!names || !ts.isNamedImports(names)) continue;
    for (const name of names.elements) {
      if (name.isTypeOnly) continue;
      if (module === '@phosphor-icons/react') vendorIcons.add(name.name.text);
      if (module === '@luminatick/ui/icons' || /(?:^|\/)icons$/.test(module) || /(?:^|\/)phosphor-icons$/.test(module)) appIcons.add(name.name.text);
    }
  }

  const attribute = (opening, name) => opening.attributes.properties.find(property =>
    ts.isJsxAttribute(property) && property.name.text === name);
  const meaningfulName = value => {
    if (!value) return false;
    if (ts.isStringLiteral(value)) return Boolean(value.text.trim());
    if (!ts.isJsxExpression(value) || !value.expression) return false;
    const expression = value.expression;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return Boolean(expression.text.trim());
    }
    if (ts.isIdentifier(expression) && expression.text === 'undefined') return false;
    return ![ts.SyntaxKind.NullKeyword, ts.SyntaxKind.FalseKeyword].includes(expression.kind);
  };
  const hasName = opening => meaningfulName(attribute(opening, 'aria-label')?.initializer)
    || meaningfulName(attribute(opening, 'aria-labelledby')?.initializer);
  const nonInteractiveAs = opening => {
    const value = attribute(opening, 'as')?.initializer;
    const role = attribute(opening, 'role')?.initializer;
    const interactiveRole = role && ts.isStringLiteral(role) && ['button', 'link'].includes(role.text);
    const handler = opening.attributes.properties.some(property => ts.isJsxAttribute(property)
      && ['onClick', 'onKeyDown', 'onKeyUp', 'onPointerDown'].includes(property.name.text));
    return Boolean(value && ts.isStringLiteral(value) && ['span', 'div', 'p'].includes(value.text)
      && !interactiveRole && !handler && !attribute(opening, 'tabIndex'));
  };
  const isTrue = value => Boolean(value && (ts.isStringLiteral(value) && value.text === 'true'
    || ts.isJsxExpression(value) && value.expression?.kind === ts.SyntaxKind.TrueKeyword));
  const tag = node => node.tagName.getText(source);
  const isVendor = name => vendorIcons.has(name) || [...vendorNamespaces].some(namespace => name.startsWith(`${namespace}.`));
  const isIcon = name => isVendor(name) || appIcons.has(name)
    || [...appIconNamespaces].some(namespace => name.startsWith(`${namespace}.`))
    || name === 'svg' || /^Icon[A-Z]/.test(name);
  const isButtonLike = name => name === 'button' || name === 'a' || /(?:^|\.)(?:Park)?(?:Icon)?Button$/.test(name)
    || /\.Trigger$/.test(name);
  const opening = node => ts.isJsxElement(node) ? node.openingElement : node;

  // Return 'icon' only when the subtree contains one or more glyphs and no
  // visible text or unknown expressions. Uncertain dynamic children are skipped.
  function expressionKind(value) {
    if (!value) return 'empty';
    if (ts.isParenthesizedExpression(value)) return expressionKind(value.expression);
    if (ts.isConditionalExpression(value)) {
      const yes = expressionKind(value.whenTrue);
      const no = expressionKind(value.whenFalse);
      return ((yes === 'icon' && (no === 'icon' || no === 'empty'))
        || (no === 'icon' && yes === 'empty')) ? 'icon' : 'unknown';
    }
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const right = expressionKind(value.right);
      return right === 'icon' ? 'icon' : 'unknown';
    }
    if (ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value) || ts.isJsxFragment(value)) return childKind(value);
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text.trim() ? 'text' : 'empty';
    if (value.kind === ts.SyntaxKind.NullKeyword || value.kind === ts.SyntaxKind.FalseKeyword) return 'empty';
    return 'unknown';
  }
  function childKind(node) {
    if (ts.isJsxText(node)) return node.getText(source).trim() ? 'text' : 'empty';
    if (ts.isJsxExpression(node)) return expressionKind(node.expression);
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (isIcon(tag(opening(node)))) return 'icon';
      if (ts.isJsxSelfClosingElement(node)) return 'unknown';
      if (!['span', 'div', 'strong', 'em'].includes(tag(node.openingElement))) return 'unknown';
      return childrenKind(node.children);
    }
    if (ts.isJsxFragment(node)) return childrenKind(node.children);
    return 'unknown';
  }
  function childrenKind(children) {
    const kinds = children.map(childKind).filter(kind => kind !== 'empty');
    return kinds.length && kinds.every(kind => kind === 'icon') ? 'icon' : 'unknown';
  }
  function asChildTarget(node) {
    const children = node.children.filter(child => !(ts.isJsxText(child) && !child.getText(source).trim()));
    if (children.length !== 1) return null;
    const child = children[0];
    if (ts.isJsxElement(child)) return { kind: childrenKind(child.children), named: hasName(child.openingElement) };
    if (ts.isJsxSelfClosingElement(child)) return { kind: childKind(child), named: hasName(child) };
    return null;
  }

  const failures = [];
  function inspect(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = tag(node);
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (isVendor(name)) {
        const weight = attribute(node, 'weight')?.initializer;
        if (!weight || !ts.isStringLiteral(weight) || weight.text !== 'duotone') {
          failures.push(`${relative}:${line}: direct Phosphor icon ${name} requires weight="duotone"`);
        }
        const hidden = attribute(node, 'aria-hidden')?.initializer;
        const labelled = hasName(node);
        const boundaryConditional = relative.startsWith('packages/ui/src/components/phosphor-icons.')
          && hidden && ts.isJsxExpression(hidden)
          && hidden.expression?.getText(source) === "props['aria-label'] ? undefined : true";
        const inNamedControl = (() => {
          for (let parent = node.parent; parent; parent = parent.parent) {
            if (ts.isJsxElement(parent) && isButtonLike(tag(parent.openingElement))) {
              if (hasName(parent.openingElement)) return true;
            }
          }
          return false;
        })();
        if (!isTrue(hidden) && !boundaryConditional && (!labelled || inNamedControl)) {
          failures.push(`${relative}:${line}: direct Phosphor icon ${name} requires aria-hidden="true" or its own aria-label`);
        }
      }
      const target = ts.isJsxOpeningElement(node) && attribute(node, 'asChild') ? asChildTarget(node.parent) : null;
      const iconOnly = target ? target.kind === 'icon' : ts.isJsxOpeningElement(node) && childrenKind(node.parent.children) === 'icon';
      const namedAsChildParent = ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent)
        && ts.isJsxElement(node.parent.parent)
        && isButtonLike(tag(node.parent.parent.openingElement))
        && Boolean(attribute(node.parent.parent.openingElement, 'asChild'))
        && hasName(node.parent.parent.openingElement);
      if (ts.isJsxOpeningElement(node) && isButtonLike(name) && !nonInteractiveAs(node) && !hasName(node)
        && !target?.named && !namedAsChildParent && iconOnly) {
        failures.push(`${relative}:${line}: icon-only ${name} requires aria-label or aria-labelledby`);
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  return failures;
}
