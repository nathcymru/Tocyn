import * as React from 'react';
import { WorkspaceRegion } from './primitives';

export interface WorkspaceShellProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}
export function WorkspaceShell({ children, ...props }: WorkspaceShellProps) {
  return <div {...props} data-tocyn-workspace="true">{children}</div>;
}

export interface WorkViewNavigatorProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
}
export function WorkViewNavigator(props: WorkViewNavigatorProps) {
  return <WorkspaceRegion {...props} label="Work views" data-tocyn-region="work-views" />;
}

export interface ConversationListProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
}
export function ConversationList(props: ConversationListProps) {
  return <WorkspaceRegion {...props} label="Conversations" data-tocyn-region="conversations" />;
}

export interface ActiveConversationProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
}
export function ActiveConversation(props: ActiveConversationProps) {
  return <WorkspaceRegion {...props} label="Active conversation" data-tocyn-region="active-conversation" />;
}

export interface ContextPanelProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
}
export function ContextPanel(props: ContextPanelProps) {
  return <WorkspaceRegion {...props} label="Context" data-tocyn-region="context" />;
}
