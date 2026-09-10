import * as React from 'react';
import { WorkspaceRegion } from './primitives';

export interface WorkspaceShellProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>;
  children?: React.ReactNode;
}
export const WorkspaceShell = React.forwardRef<HTMLDivElement, WorkspaceShellProps>(function WorkspaceShell({ children, ...props }, ref) {
  return <div {...props} ref={ref} data-tocyn-workspace="true">{children}</div>;
});

export interface WorkViewNavigatorProps extends React.HTMLAttributes<HTMLElement> {
  ref?: React.Ref<HTMLElement>;
  children?: React.ReactNode;
}
export const WorkViewNavigator = React.forwardRef<HTMLElement, WorkViewNavigatorProps>(function WorkViewNavigator(props, ref) {
  return <WorkspaceRegion {...props} ref={ref} label="Work views" data-tocyn-region="work-views" />;
});

export interface ConversationListProps extends React.HTMLAttributes<HTMLElement> {
  ref?: React.Ref<HTMLElement>;
  children?: React.ReactNode;
}
export const ConversationList = React.forwardRef<HTMLElement, ConversationListProps>(function ConversationList(props, ref) {
  return <WorkspaceRegion {...props} ref={ref} label="Conversations" data-tocyn-region="conversations" />;
});

export interface ActiveConversationProps extends React.HTMLAttributes<HTMLElement> {
  ref?: React.Ref<HTMLElement>;
  children?: React.ReactNode;
}
export const ActiveConversation = React.forwardRef<HTMLElement, ActiveConversationProps>(function ActiveConversation(props, ref) {
  return <WorkspaceRegion {...props} ref={ref} label="Active conversation" data-tocyn-region="active-conversation" />;
});

export interface ContextPanelProps extends React.HTMLAttributes<HTMLElement> {
  ref?: React.Ref<HTMLElement>;
  children?: React.ReactNode;
}
export const ContextPanel = React.forwardRef<HTMLElement, ContextPanelProps>(function ContextPanel(props, ref) {
  return <WorkspaceRegion {...props} ref={ref} label="Context" data-tocyn-region="context" />;
});
