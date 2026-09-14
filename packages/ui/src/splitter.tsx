import { Splitter } from '@ark-ui/react/splitter';
import type { ComponentProps } from 'react';

/** Park UI shaped splitter primitives backed by Ark's splitter state machine. */
export function TocynSplitterRoot(props: ComponentProps<typeof Splitter.Root>) {
  return <Splitter.Root {...props} className={`tocyn-splitter-root ${props.className ?? ''}`} />;
}

export function TocynSplitterPanel(props: ComponentProps<typeof Splitter.Panel>) {
  return <Splitter.Panel {...props} className={`tocyn-splitter-panel ${props.className ?? ''}`} />;
}

export function TocynSplitterResizeTrigger(props: ComponentProps<typeof Splitter.ResizeTrigger>) {
  return <Splitter.ResizeTrigger {...props} className={`tocyn-splitter-resize-trigger ${props.className ?? ''}`} />;
}

export const TocynSplitter = {
  Root: TocynSplitterRoot,
  Panel: TocynSplitterPanel,
  ResizeTrigger: TocynSplitterResizeTrigger,
};
