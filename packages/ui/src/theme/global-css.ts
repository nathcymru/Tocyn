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
    'html[data-tocyn-motion="reduced"] *, html[data-tocyn-motion="reduced"] *::before, html[data-tocyn-motion="reduced"] *::after': {
      animationDuration: '0.01ms !important',
      animationIterationCount: '1 !important',
      scrollBehavior: 'auto !important',
      transitionDuration: '0.01ms !important',
    },
    '@media (prefers-reduced-motion: reduce)': {
      'html:not([data-tocyn-motion="full"]) *, html:not([data-tocyn-motion="full"]) *::before, html:not([data-tocyn-motion="full"]) *::after, :host *, :host *::before, :host *::after': {
        animationDuration: '0.01ms !important',
        animationIterationCount: '1 !important',
        scrollBehavior: 'auto !important',
        transitionDuration: '0.01ms !important',
      },
    },
  },
}
