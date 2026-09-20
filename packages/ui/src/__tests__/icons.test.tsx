// @vitest-environment jsdom
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WifiHigh, WifiSlash } from '@phosphor-icons/react';
import { describe, expect, it } from 'vitest';
import { WifiOff } from '../icons';

function paths(markup: string) {
  const svg = new DOMParser().parseFromString(markup, 'image/svg+xml');
  return Array.from(svg.querySelectorAll('path'), path => path.getAttribute('d'));
}

describe('shared semantic icons', () => {
  it('uses the disconnected Phosphor glyph for the offline navbar state', () => {
    const actual = renderToStaticMarkup(<WifiOff />);
    expect(paths(actual)).toEqual(paths(renderToStaticMarkup(<WifiSlash weight="duotone" aria-hidden="true" />)));
    expect(paths(actual)).not.toEqual(paths(renderToStaticMarkup(<WifiHigh weight="duotone" aria-hidden="true" />)));
    expect(actual).toContain('aria-hidden="true"');
  });
});
