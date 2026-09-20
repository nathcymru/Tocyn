export const globalCss = {
  extend: {
    '*': {
      '--global-color-border': 'colors.border',
      '--global-color-placeholder': 'colors.fg.subtle',
      '--global-color-selection': 'colors.colorPalette.subtle.bg',
      '--global-color-focus-ring': 'colors.border.focus',
      '--focus-ring-width': '2px',
    },
    'html, :host': {
      colorPalette: 'gray',
    },
    body: {
      background: 'canvas',
      color: 'fg.default',
    },
  },
}
