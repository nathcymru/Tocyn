export const OPERATOR_WORKSPACE_VIEWS = ['all', 'mine', 'unassigned', 'mentions', 'drafts', 'snoozed', 'needs_action', 'team', 'custom'] as const;
export type OperatorWorkspaceView = typeof OPERATOR_WORKSPACE_VIEWS[number];

export const OPERATOR_WORKSPACE_SORTS = ['updated_desc', 'updated_asc', 'created_desc', 'created_asc', 'priority_desc', 'priority_asc'] as const;
export type OperatorWorkspaceSort = typeof OPERATOR_WORKSPACE_SORTS[number];

export type OperatorDraftMode = 'public' | 'internal';
export type OperatorThemeMode = 'light' | 'dark' | 'system';
export type OperatorThemePreference = Readonly<{ revision: number; mode: OperatorThemeMode; updatedAt: string | null }>;
export type OperatorDraftAttachment = Readonly<{ storageKey: string; filename: string; size: number; contentType: string }>;

export type OperatorDraft = Readonly<{
  ticketId: string;
  generation: string;
  revision: number;
  mode: OperatorDraftMode;
  body: string;
  bodyFormat: ArticleBodyFormat;
  attachments: readonly OperatorDraftAttachment[];
  /** Ordered only for presentation; canonical mention semantics are normalized IDs. */
  mentionedUserIds: readonly string[];
  /** Server-derived canonical event sequence; zero means no canonical event exists yet. */
  baseConversationRevision: number;
  expiresAt: string | null;
  updatedAt: string;
}>;

export type OperatorWorkspaceFilters = Readonly<{
  status?: 'open' | 'pending' | 'resolved' | 'closed';
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  assignedTo?: string | null;
  groupId?: string | null;
  filterId?: string | null;
}>;

export type OperatorWorkspaceState = Readonly<{
  revision: number;
  view: OperatorWorkspaceView;
  sort: OperatorWorkspaceSort;
  filters: OperatorWorkspaceFilters;
  /** Authenticated server-held current-view query; never a browser authority boundary. */
  listQuery: string;
  /** Opaque client list position, bounded and scoped to the authenticated operator. */
  listAnchor: string;
  selectedTicketId: string | null;
  panel: 'conversation' | 'details';
  updatedAt: string;
}>;
import type { ArticleBodyFormat } from '@luminatick/shared';
