import { css } from '@luminatick/ui/styled-system/css';

// The shared Panda sheet is injected into the widget ShadowRoot. These styles
// compose Park controls and read the validated tenant colour from one CSS var.
export const w = {
  host: css({ position: 'fixed', bottom: '5', right: '5', zIndex: 'modal', fontFamily: 'primary', color: 'text.primary', colorPalette: 'gray' }),
  launcherWrap: css({ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }),
  panel: css({ w: { base: 'calc(100vw - 2.5rem)', sm: '24rem' }, maxH: 'min(600px, calc(100dvh - 7.5rem))', overflow: 'hidden', borderTopWidth: '3px', borderTopColor: 'var(--widget-brand-color)' }),
  panelHeader: css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: '4', bg: 'bg.surface', color: 'fg.default', borderBottomWidth: '1px', borderColor: 'border.default' }),
  panelTitle: css({ m: '0', minW: '0', overflowWrap: 'anywhere', fontSize: 'lg', fontWeight: 'semibold' }),
  close: css({ display: 'grid', minW: '11', minH: '11', placeItems: 'center' }),
  closeIcon: css({ w: '6', h: '6' }),
  launcher: css({ display: 'grid', minW: '14', minH: '14', placeItems: 'center', rounded: 'full', boxShadow: 'lg' }),
  launcherIcon: css({ w: '8', h: '8' }),
  tabRoot: css({ display: 'flex', minH: '0', flex: '1', flexDirection: 'column' }),
  tabs: css({ display: 'flex', flexShrink: '0', borderBottomWidth: '1px', borderColor: 'border.default' }),
  tab: css({ flex: '1', minH: '11', justifyContent: 'center', rounded: 'none' }),
  panelBody: css({ flex: '1', minH: '0', h: 'auto' }),
  panelViewport: css({ minH: '0', flex: '1', h: 'full' }),
  panelContent: css({ p: '4' }),
  attribution: css({ flexShrink: '0', p: '2', borderTopWidth: '1px', borderColor: 'border.default', color: 'text.muted', fontSize: 'xs', textAlign: 'center' }),

  form: css({ display: 'flex', flexDirection: 'column', gap: '4', m: '0', p: '0', border: '0' }),
  formControl: css({ w: 'full' }),
  textarea: css({ minH: '24' }),
  submit: css({ w: 'full', minH: '11', justifyContent: 'center' }),
  successAction: css({ mt: '3', alignSelf: 'flex-start' }),

  aiChat: css({ display: 'flex', h: '25rem', flexDirection: 'column' }),
  aiMessages: css({ minH: '0', flex: '1', h: 'auto', mb: '4' }),
  aiMessagesViewport: css({ minH: '0', flex: '1', h: 'full' }),
  aiMessagesContent: css({ display: 'flex', flexDirection: 'column', gap: '4', pe: '1' }),
  aiMessageRow: css({ display: 'flex', justifyContent: 'flex-start' }),
  aiMessageRowUser: css({ justifyContent: 'flex-end' }),
  aiMessage: css({ maxW: '85%', overflowWrap: 'break-word', whiteSpace: 'pre-wrap', px: '3', py: '2', rounded: 'lg', fontSize: 'sm' }),
  aiMessageUser: css({ bg: 'bg.input', color: 'fg.default', borderWidth: '1px', borderColor: 'border.default' }),
  aiMessageAssistant: css({ bg: 'bg.surface', color: 'fg.default', borderWidth: '1px', borderColor: 'border.default' }),
  aiWaiting: css({ display: 'flex', justifyContent: 'flex-start' }),
  aiWaitingBubble: css({ display: 'grid', gap: '2', px: '3', py: '2', rounded: 'lg', bg: 'bg.input' }),
  aiWaitingLabel: css({ color: 'text.muted', fontSize: 'sm' }),
  aiComposer: css({ display: 'flex', gap: '2' }),
  chatInput: css({ minW: '0', flex: '1' }),
  aiSend: css({ display: 'grid', minW: '11', minH: '11', placeItems: 'center' }),
  aiSendIcon: css({ w: '5', h: '5' }),
} as const;

export function widgetBrandColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#334155';
}
