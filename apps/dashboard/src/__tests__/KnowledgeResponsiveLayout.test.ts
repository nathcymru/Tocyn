import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), '../../packages/ui/src/styles/panda.css'), 'utf8');
const recipe = readFileSync(resolve(process.cwd(), '../../packages/ui/src/styles/generated/recipes/page.mjs'), 'utf8');

it('keeps Knowledge single-column below md and two-column from md without a variant override', () => {
  expect(css).toMatch(/\.page__knowledgeWorkspace\s*\{[^}]*grid-template-columns:\s*1fr;/);
  expect(css).toMatch(/@media screen and \(min-width: 48rem\)[\s\S]*?\.page__knowledgeWorkspace\s*\{[^}]*grid-template-columns:\s*minmax\(16rem, 20rem\) minmax\(0, 1fr\);/);
  const compoundVariants = recipe.split('const pageSlotNames')[0];
  expect(compoundVariants).not.toMatch(/"kind": "knowledge"/);
});

it('keeps the Knowledge empty description readable and rows near the heading', () => {
  expect(css).toMatch(/\.page__knowledgeContent \.emptyState__description\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
  expect(css).toMatch(/\.page__content--kind_knowledge\s*\{[^}]*align-content:\s*start;/);
});

it('wraps the Knowledge editor heading on narrow screens and restores a single desktop line', () => {
  expect(css).toMatch(/\.knowledgeEditor__title\s*\{[^}]*white-space:\s*normal;/);
  expect(css).toMatch(/@media screen and \(min-width: 48rem\)[\s\S]*?\.knowledgeEditor__title\s*\{[^}]*white-space:\s*nowrap;/);
});
