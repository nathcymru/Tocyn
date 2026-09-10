import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TocynButton, TocynInput, WorkspaceShell, WorkViewNavigator, ConversationList, ActiveConversation, ContextPanel } from '../index';
import type { TocynButtonProps } from '../primitives';

describe('named primitive contracts', () => {
  it('preserves native props and state markers for downstream composition', () => {
    const props: TocynButtonProps = { type: 'button', 'aria-label': 'Open work views', state: 'idle', children: 'Views' };
    const html = renderToStaticMarkup(<TocynButton {...props} />);
    expect(html).toContain('aria-label="Open work views"');
    expect(html).toContain('Views');
  });

  it('exposes stable labelled workspace regions without owning application state', () => {
    const html = renderToStaticMarkup(
      <WorkspaceShell><WorkViewNavigator /><ConversationList /><ActiveConversation /><ContextPanel /></WorkspaceShell>,
    );
    expect(html).toContain('aria-label="Work views"');
    expect(html).toContain('aria-label="Conversations"');
    expect(html).toContain('aria-label="Active conversation"');
    expect(html).toContain('aria-label="Context"');
  });

  it('keeps native input affordances available', () => {
    const html = renderToStaticMarkup(<TocynInput aria-label="Filter this view" placeholder="Filter" />);
    expect(html).toContain('aria-label="Filter this view"');
    expect(html).toContain('placeholder="Filter"');
  });
});
