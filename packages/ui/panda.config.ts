import { absoluteCenter, badge, button, code, group, heading, icon, input, inputAddon, kbd, link, skeleton, spinner, text, textarea, accordion, alert, avatar, breadcrumb, card, carousel, checkbox, clipboard, collapsible, colorPicker, combobox, datePicker, dialog, drawer, editable, field, fieldset, fileUpload, hoverCard, inputGroup, menu, numberInput, pagination, pinInput, popover, progress, radioCardGroup, radioGroup, ratingGroup, scrollArea, segmentGroup, select, slider, splitter, switchRecipe, table, tabs, tagsInput, toast, toggleGroup, tooltip } from './src/theme/recipes/index';

const parkRegistryRecipes = { absoluteCenter: absoluteCenter, badge: badge, button: button, code: code, group: group, heading: heading, icon: icon, input: input, inputAddon: inputAddon, kbd: kbd, link: link, skeleton: skeleton, spinner: spinner, text: text, textarea: textarea };
const parkRegistrySlotRecipes = { accordion: accordion, alert: alert, avatar: avatar, breadcrumb: breadcrumb, card: card, carousel: carousel, checkbox: checkbox, clipboard: clipboard, collapsible: collapsible, colorPicker: colorPicker, combobox: combobox, datePicker: datePicker, dialog: dialog, drawer: drawer, editable: editable, field: field, fieldset: fieldset, fileUpload: fileUpload, hoverCard: hoverCard, inputGroup: inputGroup, menu: menu, numberInput: numberInput, pagination: pagination, pinInput: pinInput, popover: popover, progress: progress, radioCardGroup: radioCardGroup, radioGroup: radioGroup, ratingGroup: ratingGroup, scrollArea: scrollArea, segmentGroup: segmentGroup, select: select, slider: slider, splitter: splitter, switchRecipe: switchRecipe, table: table, tabs: tabs, tagsInput: tagsInput, toast: toast, toggleGroup: toggleGroup, tooltip: tooltip };

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
          'bg.canvas': { value: { base: '#f8fafc', _dark: '#0f1115' } },
          'bg.surface': { value: { base: '#ffffff', _dark: '#1a1d23' } },
          'bg.input': { value: { base: '#f1f5f9', _dark: '#1e293b' } },
          'text.primary': { value: { base: '#1e293b', _dark: '#e2e8f0' } },
          'text.muted': { value: { base: '#64748b', _dark: '#94a3b8' } },
          'border.input': { value: { base: '#cbd5e1', _dark: '#334155' } },
          'border.focus': { value: { base: '#3b82f6', _dark: '#60a5fa' } },
          'accent.primary': { value: { base: '#334155', _dark: '#cbd5e1' } },
          'icon.primary': { value: { base: '#1e293b', _dark: '#e2e8f0' } },
          'icon.muted': { value: { base: '#64748b', _dark: '#94a3b8' } },
          'icon.disabled': { value: { base: '#94a3b8', _dark: '#475569' } },
          'icon.selected': { value: { base: '#3b82f6', _dark: '#60a5fa' } },
          'icon.critical': { value: { base: '#b91c1c', _dark: '#fca5a5' } },
          'icon.inverse': { value: { base: '#f8fafc', _dark: '#0f1115' } },
          canvas: { value: 'var(--tocyn-color-surface)' },
          panel: { value: 'var(--tocyn-color-surface-panel)' },
          muted: { value: 'var(--tocyn-color-surface-muted)' },
          text: { value: 'var(--tocyn-color-text)' },
          textMuted: { value: 'var(--tocyn-color-text-muted)' },
          focus: { value: 'var(--tocyn-color-focus)' },
          selected: { value: 'var(--tocyn-color-selected)' },
          divider: { value: 'var(--tocyn-color-divider)' },
          critical: { value: 'var(--tocyn-color-critical)' },
          'critical.surface': { value: 'var(--tocyn-color-critical-surface)' },
          'critical.border': { value: 'var(--tocyn-color-critical-border)' },
          warning: { value: 'var(--tocyn-color-warning-text)' },
          'warning.surface': { value: 'var(--tocyn-color-warning-surface)' },
          'warning.border': { value: 'var(--tocyn-color-warning-border)' },
          'info.surface': { value: 'var(--tocyn-color-info-surface)' },
          'info.text': { value: 'var(--tocyn-color-info-text)' },
          inverse: { value: 'var(--tocyn-color-inverse)' },
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
        radii: {
          l1: { value: '0.25rem' },
          l2: { value: '0.5rem' },
          l3: { value: '0.75rem' },
          control: { value: '{radii.l2}' },
          panel: { value: '{radii.l3}' },
        },
        shadows: {
          xs: { value: '0 1px 2px rgb(15 23 42 / 6%)' },
          sm: { value: '0 2px 6px rgb(15 23 42 / 8%)' },
          md: { value: '0 8px 20px rgb(15 23 42 / 10%)' },
          lg: { value: '0 16px 32px rgb(15 23 42 / 12%)' },
          xl: { value: '0 20px 40px rgb(15 23 42 / 14%)' },
          '2xl': { value: '0 24px 48px rgb(15 23 42 / 16%)' },
        },
        sizes: { target: { value: 'var(--tocyn-target-min)' } },
      },
      textStyles: {
        body: { value: { fontFamily: 'primary', fontSize: '1rem', lineHeight: '1.5' } },
        tabular: { value: { fontFamily: 'tabular', fontFeatureSettings: '"tnum" 1, "cv01" 1', fontVariantNumeric: 'tabular-nums', lineHeight: '1.4' } },
      },
      slotRecipes: {
        ...parkRegistrySlotRecipes,
        shell: {
          className: 'shell',
          slots: ['root', 'sidebar', 'main', 'header', 'content', 'navigation', 'navigationLink'],
          base: {
            root: { display: 'flex', width: '100%', minHeight: '100dvh', background: 'bg.canvas', color: 'text.primary', fontFamily: 'primary' },
            sidebar: { display: 'flex', flexDirection: 'column', flexShrink: '0', width: '4rem', minHeight: '100dvh', background: 'bg.surface', borderRight: '1px solid', borderColor: 'border.default', padding: '1rem 0.5rem' },
            main: { display: 'flex', flex: '1', minWidth: '0', minHeight: '100dvh', flexDirection: 'column', background: 'bg.canvas' },
            header: { display: 'flex', flexShrink: '0', minHeight: '4rem', alignItems: 'center', gap: '1rem', borderBottom: '1px solid', borderColor: 'border.default', background: 'bg.surface', padding: '0.5rem 1rem' },
            content: { display: 'flex', flex: '1', minWidth: '0', minHeight: '0', flexDirection: 'column' },
            navigation: { display: 'flex', flex: '1', width: '100%', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginTop: '1.5rem' },
            navigationLink: { display: 'inline-flex', minWidth: '2.75rem', minHeight: '2.75rem', alignItems: 'center', justifyContent: 'center', borderRadius: 'l2', color: 'icon.muted', padding: '0.5rem', transition: 'colors', _hover: { background: 'bg.subtle', color: 'icon.primary' }, _focusVisible: { outline: '2px solid', outlineColor: 'border.focus', outlineOffset: '2px' } },
          },
        },
        tabs: {
          className: 'tabs', slots: ['root', 'list', 'trigger', 'content', 'indicator'],
          base: { root: { display: 'flex', flexDirection: 'column', minWidth: '0' }, list: { display: 'flex', alignItems: 'center', gap: '0.25rem', borderBottom: '1px solid', borderColor: 'border.default' }, trigger: { minHeight: '2.5rem', border: '0', borderBottom: '2px solid transparent', background: 'transparent', color: 'fg.muted', padding: '0.5rem 0.75rem', fontFamily: 'primary', cursor: 'pointer', _hover: { color: 'fg.default' }, _selected: { color: 'fg.default', borderColor: 'accent.primary' }, _focusVisible: { outline: '2px solid', outlineColor: 'border.focus', outlineOffset: '2px' } }, content: { minWidth: '0', paddingBlock: '1rem' }, indicator: { display: 'none' } },
        },
        splitter: {
          className: 'splitter', slots: ['root', 'panel', 'resizeTrigger'],
          base: { root: { display: 'flex', minWidth: '0', minHeight: '0', width: '100%', height: '100%' }, panel: { minWidth: '0', minHeight: '0', overflow: 'auto' }, resizeTrigger: { flex: '0 0 0.25rem', width: '0.25rem', cursor: 'col-resize', background: 'border.default', transition: 'background 150ms ease', _hover: { background: 'border.focus' }, _focusVisible: { outline: '2px solid', outlineColor: 'border.focus', outlineOffset: '2px' } } },
        },
        scrollArea: {
          className: 'scrollArea', slots: ['root', 'viewport', 'content', 'scrollbar', 'thumb'],
          base: { root: { position: 'relative', overflow: 'hidden' }, viewport: { width: '100%', height: '100%', overflow: 'auto' }, content: { minWidth: '0' }, scrollbar: { display: 'flex', width: '0.5rem', padding: '0.125rem', background: 'bg.subtle' }, thumb: { flex: '1', borderRadius: 'full', background: 'border.default' } },
        },
        avatar: {
          className: 'avatar', slots: ['root', 'image', 'fallback'],
          base: { root: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', width: '2.5rem', height: '2.5rem', borderRadius: 'l2', background: 'bg.subtle', color: 'fg.default', fontFamily: 'primary', fontWeight: '600' }, image: { width: '100%', height: '100%', objectFit: 'cover' }, fallback: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' } },
        },
        emptyState: {
          className: 'emptyState', slots: ['root', 'title', 'description', 'action'],
          base: { root: { display: 'flex', minHeight: '10rem', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', border: '1px dashed', borderColor: 'border.default', borderRadius: 'l2', background: 'bg.subtle', color: 'fg.default', padding: '1.5rem', textAlign: 'center' }, title: { margin: '0', fontFamily: 'primary', fontWeight: '600' }, description: { margin: '0', color: 'fg.muted', fontFamily: 'primary' }, action: { display: 'flex', marginTop: '0.5rem' } },
        },
        select: {
          className: 'select',
          slots: ['root', 'label', 'control', 'trigger', 'valueText', 'indicatorGroup', 'indicator', 'positioner', 'content', 'list', 'item', 'itemText', 'itemIndicator'],
          base: {
            root: { display: 'flex', flexDirection: 'column', gap: '0.375rem', width: '100%' },
            label: { color: 'text.muted', fontSize: '0.75rem', fontWeight: '600', userSelect: 'none' },
            control: { position: 'relative', display: 'flex', alignItems: 'center', width: '100%' },
            trigger: { display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', width: '100%', minHeight: '2.75rem', minWidth: '0', border: '1px solid', borderColor: 'border.input', borderRadius: '0.5rem', background: 'bg.input', color: 'text.primary', padding: '0.625rem 2.5rem 0.625rem 0.75rem', fontFamily: 'primary', textAlign: 'start', cursor: 'pointer', userSelect: 'none', _focusVisible: { outline: '2px solid', outlineColor: 'border.focus', outlineOffset: '2px' }, _disabled: { opacity: '0.6', cursor: 'not-allowed' } },
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
        ...parkRegistryRecipes,
        button: {
          className: 'button',
          base: { appearance: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', minHeight: '2.75rem', minWidth: '2.75rem', flexShrink: '0', isolation: 'isolate', position: 'relative', verticalAlign: 'middle', whiteSpace: 'nowrap', border: '1px solid', borderColor: 'border.input', borderRadius: 'l2', background: 'bg.surface', color: 'text.primary', padding: '0.5rem 0.875rem', fontFamily: 'primary', fontWeight: '600', cursor: 'pointer', userSelect: 'none', outline: '0', transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease, box-shadow 150ms ease', _hover: { background: 'bg.subtle' }, _focusVisible: { outline: '2px solid', outlineColor: 'border.focus', outlineOffset: '2px' }, _disabled: { opacity: '0.6', cursor: 'not-allowed' }, '& svg': { flexShrink: '0' } },
          variants: {
            variant: {
              solid: { background: 'accent.primary', borderColor: 'accent.primary', color: 'bg.surface', _hover: { background: 'text.primary', borderColor: 'text.primary' } },
              subtle: { background: 'bg.subtle', borderColor: 'border.default', color: 'text.primary', _hover: { background: 'bg.input' } },
              surface: { background: 'bg.surface', borderColor: 'border.input', color: 'text.primary', _hover: { background: 'bg.subtle' } },
              outline: { background: 'transparent', borderColor: 'border.input', color: 'text.primary', _hover: { background: 'bg.subtle' } },
              plain: { background: 'transparent', borderColor: 'transparent', color: 'text.primary', _hover: { background: 'bg.subtle', borderColor: 'transparent' } },
              ghost: { background: 'transparent', borderColor: 'transparent', color: 'text.primary', _hover: { background: 'bg.subtle', borderColor: 'border.input' } },
              destructive: { background: 'critical', borderColor: 'critical', color: 'bg.surface', _hover: { filter: 'brightness(0.92)' } },
            },
            size: {
              xs: { minHeight: '2rem', minWidth: '2rem', padding: '0.375rem 0.625rem', fontSize: '0.75rem' },
              sm: { minHeight: '2.25rem', minWidth: '2.25rem', padding: '0.5rem 0.75rem', fontSize: '0.875rem' },
              md: { minHeight: '2.5rem', minWidth: '2.5rem', padding: '0.5rem 0.875rem', fontSize: '0.9375rem' },
              lg: { minHeight: '2.75rem', minWidth: '2.75rem', padding: '0.625rem 1rem', fontSize: '1rem' },
              xl: { minHeight: '3rem', minWidth: '3rem', padding: '0.75rem 1.125rem', fontSize: '1.125rem' },
              '2xl': { minHeight: '4rem', minWidth: '4rem', padding: '1rem 1.5rem', fontSize: '1.25rem' },
            },
          },
          defaultVariants: { variant: 'surface', size: 'md' },
        },
        input: {
          className: 'input',
          base: { boxSizing: 'border-box', width: '100%', minHeight: '2.75rem', border: '1px solid', borderColor: 'border.input', borderRadius: '0.5rem', background: 'bg.input', color: 'text.primary', padding: '0.625rem 0.75rem', fontFamily: 'primary', _focusVisible: { outline: '2px solid', outlineColor: 'border.focus', outlineOffset: '2px' }, _disabled: { opacity: '0.6' } },
        },
        textarea: {
          className: 'textarea',
          base: { boxSizing: 'border-box', width: '100%', minHeight: '6rem', border: '1px solid', borderColor: 'border.input', borderRadius: '0.5rem', background: 'bg.input', color: 'text.primary', padding: '0.625rem 0.75rem', fontFamily: 'primary', resize: 'vertical', _focusVisible: { outline: '2px solid', outlineColor: 'border.focus', outlineOffset: '2px' }, _disabled: { opacity: '0.6' } },
        },
        icon: {
          className: 'icon',
          base: { display: 'inline-block', flexShrink: '0', width: '1.25rem', height: '1.25rem', color: 'icon.primary', verticalAlign: 'middle' },
        },
      },
    },
  },
  staticCss: { css: [{ properties: { color: ['canvas', 'panel', 'muted', 'text', 'textMuted', 'focus', 'selected', 'divider', 'critical', 'icon.primary', 'icon.muted', 'icon.disabled', 'icon.selected', 'icon.critical', 'icon.inverse'] } }] },
};
