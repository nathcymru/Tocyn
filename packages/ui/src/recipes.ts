/** Park UI-inspired recipes shared by native Tocyn controls. Values are emitted
 * into the static stylesheet by Panda; DOM and event contracts stay native. */
export const tocynControlRecipes = {
  button: {
    minBlockSize: 'var(--tocyn-target-min)',
    borderRadius: '0.375rem',
    border: '1px solid var(--tocyn-color-divider)',
    paddingInline: '0.875rem',
    paddingBlock: '0.5rem',
    color: 'var(--tocyn-color-text)',
    background: 'var(--tocyn-color-surface-panel)',
  },
  input: {
    minBlockSize: 'var(--tocyn-target-min)',
    borderRadius: '0.375rem',
    border: '1px solid var(--tocyn-color-divider)',
    paddingInline: '0.75rem',
    paddingBlock: '0.5rem',
    color: 'var(--tocyn-color-text)',
    background: 'var(--tocyn-color-surface)',
  },
} as const;
