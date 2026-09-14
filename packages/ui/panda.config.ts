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
          'bg.canvas': { value: 'var(--tocyn-color-canvas)' },
          'bg.surface': { value: 'var(--tocyn-color-surface)' },
          'bg.input': { value: 'var(--tocyn-color-input)' },
          'text.primary': { value: 'var(--tocyn-color-text)' },
          'text.muted': { value: 'var(--tocyn-color-text-muted)' },
          'border.input': { value: 'var(--tocyn-color-divider)' },
          'border.focus': { value: 'var(--tocyn-color-focus)' },
          'accent.primary': { value: 'var(--tocyn-color-accent)' },
          'icon.primary': { value: 'var(--tocyn-icon-primary)' },
          'icon.muted': { value: 'var(--tocyn-icon-muted)' },
          'icon.disabled': { value: 'var(--tocyn-icon-disabled)' },
          'icon.selected': { value: 'var(--tocyn-icon-selected)' },
          'icon.critical': { value: 'var(--tocyn-icon-critical)' },
          'icon.inverse': { value: 'var(--tocyn-icon-inverse)' },
          canvas: { value: 'var(--tocyn-color-surface)' },
          panel: { value: 'var(--tocyn-color-surface-panel)' },
          muted: { value: 'var(--tocyn-color-surface-muted)' },
          text: { value: 'var(--tocyn-color-text)' },
          textMuted: { value: 'var(--tocyn-color-text-muted)' },
          focus: { value: 'var(--tocyn-color-focus)' },
          selected: { value: 'var(--tocyn-color-selected)' },
          divider: { value: 'var(--tocyn-color-divider)' },
          critical: { value: 'var(--tocyn-color-critical)' },
          'bg.default': { value: 'var(--tocyn-color-surface-panel)' },
          'bg.subtle': { value: 'var(--tocyn-color-surface-muted)' },
          'fg.default': { value: 'var(--tocyn-color-text)' },
          'fg.muted': { value: 'var(--tocyn-color-text-muted)' },
          'border.default': { value: 'var(--tocyn-color-divider)' },
        },
      },
      tokens: {
        fonts: {
          primary: { value: "'Atkinson Hyperlegible', sans-serif" },
          tabular: { value: "'Inter', sans-serif" },
        },
        radii: { control: { value: '0.5rem' }, panel: { value: '0.75rem' } },
        sizes: { target: { value: 'var(--tocyn-target-min)' } },
      },
      textStyles: {
        body: { value: { fontFamily: 'fonts.primary', fontSize: '1rem', lineHeight: '1.5' } },
        tabular: { value: { fontFamily: 'fonts.tabular', fontFeatureSettings: '"tnum" 1, "cv01" 1', fontVariantNumeric: 'tabular-nums', lineHeight: '1.4' } },
      },
    },
  },
  staticCss: { css: [{ properties: { color: ['canvas', 'panel', 'muted', 'text', 'textMuted', 'focus', 'selected', 'divider', 'critical', 'icon.primary', 'icon.muted', 'icon.disabled', 'icon.selected', 'icon.critical', 'icon.inverse'] } }] },
};
