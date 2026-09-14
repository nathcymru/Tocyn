import { defineConfig } from '@pandacss/dev';

/** Shared build-time stylesheet configuration for every Tocyn surface. */
export default defineConfig({
  preflight: false,
  prefix: 'tocyn',
  include: [
    './packages/ui/src/**/*.{ts,tsx}',
    './apps/dashboard/src/**/*.{ts,tsx}',
    './apps/portal/src/**/*.{ts,tsx}',
    './apps/widget/src/**/*.{ts,tsx}',
  ],
  outdir: './packages/ui/styled-system',
  theme: {
    extend: {
      semanticTokens: {
        colors: {
          'bg.canvas': { value: 'var(--tocyn-color-surface)' },
          'bg.panel': { value: 'var(--tocyn-color-surface-panel)' },
          'bg.muted': { value: 'var(--tocyn-color-surface-muted)' },
          'bg.selected': { value: 'var(--tocyn-color-selected)' },
          'fg.default': { value: 'var(--tocyn-color-text)' },
          'fg.muted': { value: 'var(--tocyn-color-text-muted)' },
          'fg.selected': { value: 'var(--tocyn-color-text)' },
          'border.default': { value: 'var(--tocyn-color-divider)' },
          'accent.default': { value: 'var(--tocyn-color-focus)' },
          'accent.contrast': { value: 'var(--tocyn-color-surface)' },
          'focus.ring': { value: 'var(--tocyn-color-focus)' },
          'danger.default': { value: 'var(--tocyn-color-critical)' },
          'success.default': { value: 'var(--tocyn-color-focus)' },
        },
      },
    },
  },
  recipes: {
    button: {
      className: 'button',
      base: {
        minBlockSize: 'var(--tocyn-target-min)',
        borderRadius: '0.375rem',
        border: '1px solid var(--tocyn-color-divider)',
        paddingInline: '0.875rem',
        paddingBlock: '0.5rem',
        color: 'var(--tocyn-color-text)',
        background: 'var(--tocyn-color-surface-panel)',
      },
    },
    input: {
      className: 'input',
      base: {
        minBlockSize: 'var(--tocyn-target-min)',
        borderRadius: '0.375rem',
        border: '1px solid var(--tocyn-color-divider)',
        paddingInline: '0.75rem',
        paddingBlock: '0.5rem',
        color: 'var(--tocyn-color-text)',
        background: 'var(--tocyn-color-surface)',
      },
    },
  },
});
