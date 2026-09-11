export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Ticket {
  id: string;
  ticket_no: number | null;
  subject: string;
  status: 'open' | 'pending' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  customer_email: string;
  created_at: string;
  updated_at: string;
}

export interface Article {
  id: string;
  ticket_id: string;
  body: string;
  sender_type: 'customer' | 'agent' | 'system';
  sender_id?: string;
  is_internal: boolean;
  created_at: string;
  attachments?: Attachment[];
}

export interface Attachment {
  id: string;
  article_id: string;
  filename: string;
  content_type: string;
  size: number;
  storage_key: string;
  url?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}

export interface SlaTargetProjection {
  state: 'unavailable' | 'on-track' | 'breached';
  phase: 'unavailable' | 'running' | 'paused' | 'completed';
  completedAt: string | null;
  dueAt: string | null;
  remainingWorkingMilliseconds: number | null;
  targetWorkingMilliseconds: number | null;
}

/** Customer-safe SLA response returned only after the ticket ownership check. */
export interface TicketSlaProjection {
  response: SlaTargetProjection;
  resolution: SlaTargetProjection;
  handlerName: string | null;
}
