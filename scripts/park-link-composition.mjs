import ts from 'typescript';

/** Check rendered JSX links without granting file-wide exemptions. */
export function parkLinkCompositionFailures(relative, content) {
  const file = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const routerLinks = new Set();
  const routerNamespaces = new Set();
  const parkLinks = new Set();
  const parkButtons = new Set();
  const parkMenus = new Set();

  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (module === 'react-router-dom' && bindings && ts.isNamespaceImport(bindings)) routerNamespaces.add(bindings.name.text);
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      const local = element.name.text;
      if (module === 'react-router-dom' && (imported === 'Link' || imported === 'NavLink')) routerLinks.add(local);
      if (module === '@luminatick/ui/components' && imported === 'Link') parkLinks.add(local);
      if (module === '@luminatick/ui/park' && imported === 'ParkButton') parkButtons.add(local);
      if (module === '@luminatick/ui/park' && imported === 'ParkMenu') parkMenus.add(local);
    }
  }

  // A local alias still renders the imported Router component. Resolve simple
  // const aliases to a fixed point so chains cannot sidestep the JSX check.
  const aliases = [];
  function collectAliases(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      aliases.push([node.name.text, node.initializer]);
    }
    ts.forEachChild(node, collectAliases);
  }
  collectAliases(file);
  let changed;
  do {
    changed = false;
    for (const [name, initializer] of aliases) {
      const target = initializer.getText(file);
      if (!routerLinks.has(name) && (routerLinks.has(target)
        || [...routerNamespaces].some(namespace => target === `${namespace}.Link` || target === `${namespace}.NavLink`))) {
        routerLinks.add(name);
        changed = true;
      }
    }
  } while (changed);

  const hasAsChild = opening => opening.attributes.properties.some(attribute =>
    ts.isJsxAttribute(attribute) && attribute.name.text === 'asChild' &&
    (!attribute.initializer || ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword));
  const attribute = (opening, name) => opening.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.text === name);
  const composed = node => {
    // Ark's asChild forwards only to its direct JSX child. An ancestor wrapper
    // cannot make a nested native anchor or router link a Park component.
    const element = ts.isJsxOpeningElement(node) ? node.parent : node;
    const parent = element?.parent;
    if (!parent || !ts.isJsxElement(parent) || !hasAsChild(parent.openingElement)) return false;
    const children = parent.children.filter(child =>
      !ts.isJsxText(child) || child.getText(file).trim().length > 0).filter(child =>
      !ts.isJsxExpression(child) || child.expression);
    if (children.length !== 1 || children[0] !== element) return false;
    const tag = parent.openingElement.tagName.getText(file);
    return parkLinks.has(tag) || parkButtons.has(tag)
      || [...parkMenus].some(name => tag === `${name}.Item`);
  };
  const isRouterLink = tag => routerLinks.has(tag) || [...routerNamespaces].some(name => tag === `${name}.Link` || tag === `${name}.NavLink`);
  const inboxParentFocusedLink = (node, tag) => {
    if (relative !== 'apps/dashboard/src/pages/InboxWorkspacePage.tsx' || !isRouterLink(tag)) return false;
    const tabIndex = attribute(node, 'tabIndex')?.initializer;
    const value = tabIndex && ts.isJsxExpression(tabIndex) && tabIndex.expression;
    if (!value || !ts.isPrefixUnaryExpression(value) || value.operator !== ts.SyntaxKind.MinusToken
      || !ts.isNumericLiteral(value.operand) || value.operand.text !== '1') return false;
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
      if (!ts.isJsxElement(ancestor) || ancestor.openingElement.tagName.getText(file) !== 'article') continue;
      const opening = ancestor.openingElement;
      const role = attribute(opening, 'role')?.initializer;
      return Boolean(role && ts.isStringLiteral(role) && role.text === 'option'
        && attribute(opening, 'tabIndex') && attribute(opening, 'onKeyDown'));
    }
    return false;
  };
  const failures = [];
  function inspect(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      if ((tag === 'a' || isRouterLink(tag)) && !composed(node) && !inboxParentFocusedLink(node, tag)) {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        failures.push(`Uncomposed ${tag === 'a' ? 'native anchor' : 'router link'} in active application source: ${relative}:${line}`);
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(file);
  return failures;
}
