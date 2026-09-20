import { css } from '@luminatick/ui/styled-system/css';

/** Page composition around the shared Park controls; AuthLayout owns the outer shell. */
export const authStyles = {
  page: css({ width: '100%', minWidth: '0', display: 'flex', justifyContent: 'center' }),
  card: css({ width: '100%', maxWidth: '30rem', display: 'grid', gap: '1.5rem', padding: 'clamp(1.25rem, 4vw, 2rem)', background: 'bg.surface', color: 'text.primary', borderWidth: '1px', borderStyle: 'solid', borderColor: 'border.input', borderRadius: 'l3', boxShadow: 'sm' }),
  heading: css({ display: 'grid', gap: '0.375rem', textAlign: 'center', '& h1': { margin: '0', fontSize: '1.75rem', lineHeight: '1.2' }, '& p': { margin: '0', color: 'text.muted' } }),
  form: css({ display: 'grid', gap: '1.25rem', minWidth: '0' }),
  submit: css({ width: '100%', minHeight: '2.75rem' }),
  alert: css({ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.875rem 1rem', borderWidth: '1px', borderStyle: 'solid', borderColor: 'critical.border', borderRadius: 'l2', background: 'critical.surface', color: 'critical', overflowWrap: 'anywhere' }),
  status: css({ minHeight: '1.5rem', margin: '0', color: 'text.muted', textAlign: 'center', fontSize: '0.875rem' }),
  iconWrap: css({ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '2.75rem', height: '2.75rem', marginInline: 'auto', marginBottom: '0.5rem', borderRadius: 'full', background: 'bg.input', color: 'icon.primary' }),
  icon: css({ width: '1.5rem', height: '1.5rem' }),
  setup: css({ display: 'grid', justifyItems: 'center', gap: '1rem', minWidth: '0' }),
  qr: css({ maxWidth: '100%', padding: '0.75rem', borderWidth: '1px', borderStyle: 'solid', borderColor: 'border.input', borderRadius: 'l2', background: 'bg.input', '& svg': { maxWidth: '100%', height: 'auto' } }),
  secretHelp: css({ margin: '0', color: 'text.muted', lineHeight: '1.5', textAlign: 'center', overflowWrap: 'anywhere' }),
  secret: css({ display: 'inline-block', marginTop: '0.5rem', padding: '0.375rem 0.625rem', borderRadius: 'l1', background: 'bg.input', color: 'text.primary', fontFamily: 'tabular', fontFeatureSettings: '"tnum" 1, "cv01" 1', fontVariantNumeric: 'tabular-nums', userSelect: 'all' }),
  secondary: css({ justifySelf: 'center' }),
  pinWrap: css({ display: 'flex', justifyContent: 'center', minWidth: '0' }),
  visuallyHidden: css({ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap' }),
};
