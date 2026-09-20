import ts from 'typescript';

const activeAppTsx = /^apps\/(?:dashboard|portal|widget)\/src\/.+\.tsx$/;

/** Reject native labels in rendered app JSX while keeping Park slot labels. */
export function parkRawLabelFailure(relative, node, sourceFile) {
  if (!activeAppTsx.test(relative) || relative.includes('/__tests__/') || /\.(?:test|spec)\.tsx$/.test(relative)
    || !ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)
    || node.tagName.getText(sourceFile) !== 'label') return null;
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  return `Native label remains in active application source: ${relative}:${line}`;
}
