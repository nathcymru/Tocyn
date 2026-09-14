/**
 * Build-time Panda configuration for the shared Park-compatible layer.
 * Keep this file dependency-light so consumers can import the UI contract
 * without loading a styling runtime.
 */
export default {
  preflight: false,
  jsxFramework: 'react',
  include: ['./src/**/*.{ts,tsx}'],
  outdir: './src/styles/generated',
  theme: {
    extend: {
      semanticTokens: {
        colors: {
          canvas: { value: 'var(--tocyn-color-surface)' },
          panel: { value: 'var(--tocyn-color-surface-panel)' },
          muted: { value: 'var(--tocyn-color-surface-muted)' },
          text: { value: 'var(--tocyn-color-text)' },
          textMuted: { value: 'var(--tocyn-color-text-muted)' },
          focus: { value: 'var(--tocyn-color-focus)' },
          selected: { value: 'var(--tocyn-color-selected)' },
          divider: { value: 'var(--tocyn-color-divider)' },
          critical: { value: 'var(--tocyn-color-critical)' },
          'bg.canvas': { value: 'var(--tocyn-color-surface)' },
          'bg.default': { value: 'var(--tocyn-color-surface-panel)' },
          'bg.subtle': { value: 'var(--tocyn-color-surface-muted)' },
          'fg.default': { value: 'var(--tocyn-color-text)' },
          'fg.muted': { value: 'var(--tocyn-color-text-muted)' },
          'border.default': { value: 'var(--tocyn-color-divider)' },
        },
      },
      tokens: {
        radii: { control: { value: '0.5rem' }, panel: { value: '0.75rem' } },
        sizes: { target: { value: 'var(--tocyn-target-min)' } },
      },
    },
  },
  staticCss: { css: [{ properties: { color: ['canvas', 'panel', 'muted', 'text', 'textMuted', 'focus', 'selected', 'divider', 'critical'] } }] },
};
