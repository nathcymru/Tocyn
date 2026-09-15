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
      slotRecipes: {
        select: {
          className: 'select',
          slots: ['root', 'label', 'control', 'trigger', 'valueText', 'indicatorGroup', 'indicator', 'positioner', 'content', 'list', 'item', 'itemText', 'itemIndicator'],
          base: {
            root: { display: 'flex', flexDirection: 'column', gap: '0.375rem', width: '100%' },
            label: { color: 'text.muted', fontSize: '0.75rem', fontWeight: '600', userSelect: 'none' },
            control: { position: 'relative', display: 'flex', alignItems: 'center', width: '100%' },
            trigger: { display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', width: '100%', minHeight: '2.75rem', minWidth: '0', border: '1px solid', borderColor: 'border.input', borderRadius: '0.5rem', background: 'bg.input', color: 'text.primary', padding: '0.625rem 2.5rem 0.625rem 0.75rem', fontFamily: 'fonts.primary', textAlign: 'start', cursor: 'pointer', userSelect: 'none', _focusVisible: { outline: '2px solid', outlineColor: 'border.focus', outlineOffset: '2px' }, _disabled: { opacity: '0.6', cursor: 'not-allowed' } },
            valueText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', _placeholderShown: { color: 'text.muted' } },
            indicatorGroup: { position: 'absolute', insetInlineEnd: '0.75rem', insetBlock: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
            indicator: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'text.muted', pointerEvents: 'none' },
            positioner: { zIndex: 70 },
            content: { minWidth: 'var(--reference-width)', maxHeight: 'min(var(--available-height), 24rem)', overflowY: 'auto', border: '1px solid', borderColor: 'border.input', borderRadius: '0.5rem', background: 'bg.surface', padding: '0.25rem', boxShadow: '0 0.75rem 1.5rem rgb(15 23 42 / 12%)' },
            list: { display: 'flex', flexDirection: 'column', gap: '0.125rem' },
            item: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', minHeight: '2.5rem', borderRadius: '0.375rem', padding: '0.5rem 0.625rem', color: 'text.primary', cursor: 'pointer', userSelect: 'none', _hover: { background: 'bg.subtle' }, _highlighted: { background: 'bg.subtle' }, _disabled: { opacity: '0.6', cursor: 'not-allowed' } },
            itemText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            itemIndicator: { color: 'accent.primary', display: 'inline-flex', alignItems: 'center' },
          },
        },
      },
      recipes: {
        button: {
          className: 'button',
          base: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', minHeight: '2.75rem', minWidth: '2.75rem', border: '1px solid', borderColor: 'border.input', borderRadius: '0.5rem', background: 'bg.surface', color: 'text.primary', padding: '0.5rem 0.875rem', fontFamily: 'fonts.primary', cursor: 'pointer', userSelect: 'none', _hover: { background: 'bg.subtle' }, _focusVisible: { outline: '2px solid', outlineColor: 'border.focus', outlineOffset: '2px' }, _disabled: { opacity: '0.6', cursor: 'not-allowed' } },
        },
        input: {
          className: 'input',
          base: { boxSizing: 'border-box', width: '100%', minHeight: '2.75rem', border: '1px solid', borderColor: 'border.input', borderRadius: '0.5rem', background: 'bg.input', color: 'text.primary', padding: '0.625rem 0.75rem', fontFamily: 'fonts.primary', _focusVisible: { outline: '2px solid', outlineColor: 'border.focus', outlineOffset: '2px' }, _disabled: { opacity: '0.6' } },
        },
        textarea: {
          className: 'textarea',
          base: { boxSizing: 'border-box', width: '100%', minHeight: '6rem', border: '1px solid', borderColor: 'border.input', borderRadius: '0.5rem', background: 'bg.input', color: 'text.primary', padding: '0.625rem 0.75rem', fontFamily: 'fonts.primary', resize: 'vertical', _focusVisible: { outline: '2px solid', outlineColor: 'border.focus', outlineOffset: '2px' }, _disabled: { opacity: '0.6' } },
        },
      },
    },
  },
  staticCss: { css: [{ properties: { color: ['canvas', 'panel', 'muted', 'text', 'textMuted', 'focus', 'selected', 'divider', 'critical', 'icon.primary', 'icon.muted', 'icon.disabled', 'icon.selected', 'icon.critical', 'icon.inverse'] } }] },
};
