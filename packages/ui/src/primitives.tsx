import * as React from 'react';

export interface WorkspaceRegionProps extends React.HTMLAttributes<HTMLElement> {
  ref?: React.Ref<HTMLElement>;
  label: string;
  children?: React.ReactNode;
}
export const WorkspaceRegion = React.forwardRef<HTMLElement, WorkspaceRegionProps>(function WorkspaceRegion(
  { label, children, ...props }, ref,
) {
  return <section {...props} ref={ref} aria-label={label}>{children}</section>;
});
