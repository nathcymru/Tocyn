import { css } from '@luminatick/ui/styled-system/css';

// The shared Panda sheet is injected into the widget ShadowRoot. These styles
// compose Park controls and read the validated tenant colour from one CSS var.
export const w = {
  host: css({ position: 'fixed', bottom: '5', right: '5', zIndex: 'modal', fontFamily: 'primary', color: 'text.primary' }),
  launcherWrap: css({ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }),
  panel: css({ display: 'flex', w: { base: 'calc(100vw - 2.5rem)', sm: '24rem' }, maxH: 'min(600px, calc(100dvh - 7.5rem))', flexDirection: 'column', mb: '4', bg: 'bg.surface', rounded: 'lg', boxShadow: 'xl', overflow: 'hidden', borderWidth: '1px', borderColor: 'border.default' }),
  panelHeader: css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: '4', bg: 'var(--widget-brand-color)', color: 'white' }),
  panelTitle: css({ m: '0', fontSize: 'lg', fontWeight: 'semibold' }),
  close: css({ display: 'grid', minW: '11', minH: '11', placeItems: 'center', color: 'white', _hover: { bg: 'rgba(255,255,255,0.16)' } }),
  closeIcon: css({ w: '6', h: '6' }),
  launcher: css({ display: 'grid', minW: '14', minH: '14', placeItems: 'center', rounded: 'full', bg: 'var(--widget-brand-color)', color: 'white', boxShadow: 'lg', _hover: { transform: 'scale(1.05)' } }),
  launcherIcon: css({ w: '8', h: '8' }),
  tabRoot: css({ display: 'flex', minH: '0', flex: '1', flexDirection: 'column' }),
  tabs: css({ display: 'flex', flexShrink: '0', borderBottomWidth: '1px', borderColor: 'border.default' }),
  tab: css({ flex: '1', minH: '11', justifyContent: 'center', rounded: 'none' }),
  panelBody: css({ flex: '1', minH: '0', overflowY: 'auto', p: '4' }),
  signIn: css({ m: '0', fontSize: 'sm', lineHeight: 'relaxed' }),
  portalLink: css({ color: 'accent.primary', textDecoration: 'underline', _focusVisible: { outline: '2px solid', outlineColor: 'border.focus' } }),
  attribution: css({ flexShrink: '0', p: '2', borderTopWidth: '1px', borderColor: 'border.default', color: 'text.muted', fontSize: 'xs', textAlign: 'center' }),

  form: css({ display: 'flex', flexDirection: 'column', gap: '4', m: '0', p: '0', border: '0' }),
  label: css({ display: 'block', mb: '1', fontSize: 'sm', fontWeight: 'medium' }),
  formControl: css({ w: 'full' }),
  textarea: css({ minH: '24' }),
  submit: css({ w: 'full', minH: '11', justifyContent: 'center', bg: 'var(--widget-brand-color)', color: 'white' }),
  error: css({ p: '3', rounded: 'md', bg: 'critical.surface', color: 'critical', fontSize: 'sm' }),
  success: css({ py: '8', textAlign: 'center' }),
  successIcon: css({ display: 'grid', w: '16', h: '16', placeItems: 'center', mx: 'auto', mb: '4', rounded: 'full', bg: 'info.surface', color: 'info.text' }),
  successMark: css({ w: '10', h: '10' }),
  successTitle: css({ mb: '2', fontSize: 'lg', fontWeight: 'semibold' }),
  successCopy: css({ mb: '6', color: 'text.muted', fontSize: 'sm' }),
  successAction: css({}),

  aiChat: css({ display: 'flex', h: '25rem', flexDirection: 'column' }),
  aiMessages: css({ display: 'flex', minH: '0', flex: '1', flexDirection: 'column', gap: '4', mb: '4', overflowY: 'auto', pe: '1' }),
  aiMessageRow: css({ display: 'flex', justifyContent: 'flex-start' }),
  aiMessageRowUser: css({ justifyContent: 'flex-end' }),
  aiMessage: css({ maxW: '85%', overflowWrap: 'break-word', whiteSpace: 'pre-wrap', px: '3', py: '2', rounded: 'lg', fontSize: 'sm' }),
  aiMessageUser: css({ bg: 'var(--widget-brand-color)', color: 'white' }),
  aiMessageAssistant: css({ bg: 'bg.subtle', color: 'text.primary' }),
  aiWaiting: css({ display: 'flex', justifyContent: 'flex-start' }),
  aiWaitingBubble: css({ px: '3', py: '2', rounded: 'lg', bg: 'bg.subtle' }),
  aiDots: css({ display: 'flex', gap: '1' }),
  aiDot: css({ w: '1.5', h: '1.5', rounded: 'full', bg: 'text.muted', animation: 'pulse 1s ease-in-out infinite', _motionReduce: { animation: 'none' } }),
  aiError: css({ mb: '2', p: '2', rounded: 'md', bg: 'critical.surface', color: 'critical', fontSize: 'sm' }),
  aiComposer: css({ display: 'flex', gap: '2' }),
  chatInput: css({ minW: '0', flex: '1' }),
  aiSend: css({ display: 'grid', minW: '11', minH: '11', placeItems: 'center', bg: 'var(--widget-brand-color)', color: 'white' }),
  aiSendIcon: css({ w: '5', h: '5' }),
} as const;

export function widgetBrandColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#334155';
}
