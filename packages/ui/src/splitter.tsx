import { Splitter } from '@ark-ui/react/splitter';
import type { ComponentProps } from 'react';

// jsdom does not implement ResizeObserver; Ark only needs observation in a real browser.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

/** Park UI shaped splitter primitives backed by Ark's splitter state machine. */
export function TocynSplitterRoot(props: ComponentProps<typeof Splitter.Root>) {
  if (typeof window !== 'undefined' && !window.matchMedia) return <div {...(props as any)} className={`tocyn-splitter-root ${props.className ?? ''}`} />;
  return <Splitter.Root {...props} className={`tocyn-splitter-root ${props.className ?? ''}`} />;
}

export function TocynSplitterPanel(props: ComponentProps<typeof Splitter.Panel>) {
  if (typeof window !== 'undefined' && !window.matchMedia) return <div {...(props as any)} className={`tocyn-splitter-panel ${props.className ?? ''}`} />;
  return <Splitter.Panel {...props} className={`tocyn-splitter-panel ${props.className ?? ''}`} />;
}

export function TocynSplitterResizeTrigger(props: ComponentProps<typeof Splitter.ResizeTrigger>) {
  if (typeof window !== 'undefined' && !window.matchMedia) return null;
  return <Splitter.ResizeTrigger {...props} className={`tocyn-splitter-resize-trigger ${props.className ?? ''}`} />;
}

export const TocynSplitter = {
  Root: TocynSplitterRoot,
  Panel: TocynSplitterPanel,
  ResizeTrigger: TocynSplitterResizeTrigger,
};
