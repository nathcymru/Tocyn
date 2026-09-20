import { p } from '../portalStyles';
import { ParkAlert, ParkButton, ParkEmptyState, ParkField, ParkFileUpload, ParkScrollArea, ParkTextarea } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';
import { attachmentSize } from '../utils/attachment-size';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { portalApi } from '../api/client';
import type { Ticket, Article } from '../types';
import {
  IconSpinner,
  IconArrowLeft,
  IconPaperclip,
  IconPaperPlane,
  IconXmark
} from '@luminatick/ui/icons';
import { formatDistanceToNow, format } from 'date-fns';
import { utcTimestamp } from '../utils/utcTimestamp';
import { ticketReference } from '../utils/ticket-reference';
import { TicketSlaStatus } from '../components/TicketSlaStatus';
import { PortalLoadingSkeleton } from '../components/RouteContent';

type UploadedAttachment = { filename: string; size: number; contentType: string; storageKey: string };

type DetailPage = { ticket: Ticket; articles: Article[]; pagination?: { next_cursor: string | null; has_more: boolean } };

const messageArea = css({ h: 'clamp(12rem, 40dvh, 24rem)', minW: '0' });
const messageViewport = css({ h: 'full', minH: '0' });
const messageContent = css({ display: 'flex', minW: '0', flexDirection: 'column', gap: '4', p: '4' });

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <TicketDetail key={id} id={id} />;
}

function TicketDetail({ id }: { id: string | undefined }) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [ticketPrefix, setTicketPrefix] = useState<string>('#');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [paginationVisible, setPaginationVisible] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageStatus, setPageStatus] = useState('');
  const loadedPages = useRef(1);
  const requestGeneration = useRef(0);
  const interactiveRead = useRef<number | null>(null);

  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyStatus, setReplyStatus] = useState('');
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const attachButton = useRef<HTMLButtonElement>(null);
  const conversationHeading = useRef<HTMLHeadingElement>(null);
  const messagesRegion = useRef<HTMLDivElement>(null);
  const recovering = useRef(false);

  useEffect(() => {
    if (!loading && !error && recovering.current) {
      conversationHeading.current?.focus();
      recovering.current = false;
    }
  }, [loading, error]);

  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const completedUploads = useRef(new Map<File, UploadedAttachment>());

  const fetchTicket = useCallback(async (mode: 'initial' | 'interactive' | 'background' = 'initial') => {
    const background = mode === 'background';
    // Polling must not replace an interactive page/read or its live feedback.
    if (background && interactiveRead.current !== null) return 'skipped';
    const generation = ++requestGeneration.current;
    if (!background) {
      interactiveRead.current = generation;
      setRefreshing(true);
      setLoadingMore(false);
      setPageStatus('Refreshing messages…');
      if (mode === 'initial') setLoading(true);
    }
    try {
      let data = await portalApi.get<DetailPage>(`/tickets/${id}`);
      if (generation !== requestGeneration.current) return 'superseded';
      const accumulated = [...data.articles];
      for (let page = 1; page < loadedPages.current && data.pagination?.next_cursor; page++) {
        data = await portalApi.get<DetailPage>(`/tickets/${id}?article_cursor=${encodeURIComponent(data.pagination.next_cursor)}`);
        if (generation !== requestGeneration.current) return 'superseded';
        accumulated.push(...data.articles);
      }
      if (generation !== requestGeneration.current) return 'superseded';
      data = { ...data, articles: accumulated };
      setTicket(data.ticket);
      if (!background) {
        setError(null);
        setRefreshError(null);
      }
      setArticles(data.articles);
      setNextCursor(data.pagination?.next_cursor ?? null);
      setPaginationVisible(Boolean(data.pagination));
      if (!background) setPageStatus(`Showing ${data.articles.length} messages.${data.pagination?.has_more ? ' More messages are available.' : ''}`);
      return 'updated';
    } catch (err: unknown) {
      if (generation !== requestGeneration.current) return 'superseded';
      const message = err instanceof Error ? err.message : 'Failed to load ticket details';
      if (!background) {
        if (mode === 'initial') setError(message);
        else setRefreshError(message);
        setPageStatus('Could not refresh messages. Try again.');
      }
      return 'failed';
    } finally {
      if (!background && generation === requestGeneration.current) {
        interactiveRead.current = null;
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, [id]);

  const invalidateReads = useCallback(() => { requestGeneration.current++; }, []);

  useEffect(() => {
    let active = true;
    const generation = ++requestGeneration.current;
    interactiveRead.current = generation;
    portalApi.get<{ TICKET_PREFIX: string }>('/config')
      .then(res => { if (active) setTicketPrefix(res.TICKET_PREFIX); })
      .catch(err => console.error('Failed to fetch config', err));
    // Initial loading already has visible state; later reads use fetchTicket.
    portalApi.get<DetailPage>(`/tickets/${id}`)
      .then(data => {
        if (!active || generation !== requestGeneration.current) return;
        setTicket(data.ticket);
        setArticles(data.articles);
        setNextCursor(data.pagination?.next_cursor ?? null);
        setPaginationVisible(Boolean(data.pagination));
        setPageStatus(`Showing ${data.articles.length} messages.${data.pagination?.has_more ? ' More messages are available.' : ''}`);
        setError(null);
      })
      .catch((err: unknown) => {
        if (active && generation === requestGeneration.current) {
          setError(err instanceof Error ? err.message : 'Failed to load ticket details');
        }
      })
      .finally(() => {
        if (active && generation === requestGeneration.current) {
          interactiveRead.current = null;
          setLoading(false);
        }
      });

    let pollInterval: ReturnType<typeof setInterval>;

    const startPolling = () => {
      clearInterval(pollInterval);
      pollInterval = setInterval(() => {
        fetchTicket('background');
      }, 60000);
    };

    const stopPolling = () => {
      clearInterval(pollInterval);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchTicket('background');
        startPolling();
      } else {
        stopPolling();
      }
    };

    if (document.visibilityState === 'visible') {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      invalidateReads();
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [id, fetchTicket, invalidateReads]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore || interactiveRead.current !== null) return;
    const generation = ++requestGeneration.current;
    interactiveRead.current = generation;
    setLoadingMore(true);
    setRefreshing(false);
    setPageStatus('Loading more messages…');
    try {
      const data = await portalApi.get<DetailPage>(`/tickets/${id}?article_cursor=${encodeURIComponent(nextCursor)}`);
      if (generation !== requestGeneration.current) return 'superseded';
      loadedPages.current++;
      setArticles(previous => [...previous, ...data.articles.filter(article => !previous.some(old => old.id === article.id))]);
      setNextCursor(data.pagination?.next_cursor ?? null);
      setPageStatus(`Loaded ${data.articles.length} more messages.${data.pagination?.has_more ? ' More messages are available.' : ' All messages are loaded.'}`);
    } catch (err: unknown) {
      if (generation !== requestGeneration.current) return 'superseded';
      setPageStatus(err instanceof Error ? err.message : 'Could not load more messages. Try again.');
    } finally {
      if (generation === requestGeneration.current) {
        interactiveRead.current = null;
        setLoadingMore(false);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (sending) return;
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setAttachments(prev => [...prev, ...newFiles]);
      setReplyStatus(`${newFiles.length} attachment${newFiles.length === 1 ? '' : 's'} added.`);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    if (sending) return;
    completedUploads.current.delete(attachments[index]);
    setAttachments(prev => prev.filter((_, i) => i !== index));
    setReplyStatus('Attachment removed.');
    attachButton.current?.focus();
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    if (!newMessage.trim()) {
      setReplyError('Enter reply text before sending attachments.');
      return;
    }
    setReplyError(null);
    setReplyStatus('Sending reply…');

    setSending(true);
    try {
      // Keep the attempt pending until every upload settles. Retain successful
      // references so a later retry only uploads files that still need one.
      const outcomes = await Promise.allSettled(
        [...new Set(attachments)].map(async (file) => {
          if (completedUploads.current.has(file)) return;
          const formData = new FormData();
          formData.append('file', file);
          const uploaded = await portalApi.postForm<{ key: string }>('/attachments/upload', formData);
          completedUploads.current.set(file, {
            filename: file.name,
            size: file.size,
            contentType: file.type || 'application/octet-stream',
            storageKey: uploaded.key
          });
        })
      );
      const failed = outcomes.find(outcome => outcome.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      const uploadedAttachments = attachments.map(file => completedUploads.current.get(file)!);

      // 2. Send message with attachment metadata
      await portalApi.post(`/tickets/${id}/messages`, {
        message: newMessage,
        attachments: uploadedAttachments
      });

      // 3. Reset form and refresh ticket
      setNewMessage('');
      setAttachments([]);
      completedUploads.current.clear();
      const refreshed = await fetchTicket('interactive');
      setReplyStatus(refreshed !== 'failed' ? 'Reply sent.' : 'Reply sent. Refresh messages to retrieve the saved response; do not send it again.');
    } catch (err: unknown) {
      setReplyStatus('');
      setReplyError(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  const downloadAttachment = async (attachmentId: string, filename: string) => {
    if (downloading) return;
    setDownloading(attachmentId);
    setDownloadError(null);
    setDownloadStatus('Preparing attachment download…');
    try {
      await portalApi.download(`/attachments/${attachmentId}/download`, filename);
      setDownloadStatus('Attachment download started.');
    } catch (err: unknown) {
      setDownloadStatus('');
      setDownloadError(err instanceof Error ? err.message : 'Could not download attachment. Try again.');
    } finally { setDownloading(null); }
  };

  const statusColors = {
    open: p.statusOpen,
    pending: p.statusPending,
    resolved: p.statusResolved,
    closed: p.statusClosed,
  };

  if (loading) {
    return <PortalLoadingSkeleton label="Loading conversation…" className={p.emptyState} />;
  }

  if (error || !ticket) {
    return <ParkEmptyState role="alert" title="Conversation could not be loaded." description={error || 'Ticket not found'} headingLevel={false} className={p.emptyError} action={<div className={p.emptyActions}><ParkButton type="button" onClick={() => { recovering.current = true; void fetchTicket(); }} className={p.emptyRetry}>Retry loading conversation</ParkButton><Link to="/tickets" className={p.emptyBack}>Back to Tickets</Link></div>} />;
  }

  return (
    <div className={p.ticketDetail}>
      <div className={p.ticketDetailHeader}>
        <Link to="/tickets" aria-label="Back to Tickets" className={p.ticketDetailBack}>
          <IconArrowLeft className={p.chatBackIcon} aria-hidden="true" />
        </Link>
        <div>
          <h1 ref={conversationHeading} tabIndex={-1} className={p.ticketDetailTitle}>
            {ticket.subject}
            <span className={[p.chatStatusPill, statusColors[ticket.status]].join(' ')}>
              {ticket.status}
            </span>
          </h1>
          <p className={p.ticketDetailMeta}>
            Ticket {ticketReference(ticket, ticketPrefix)} • Created {format(utcTimestamp(ticket.created_at), 'MMM d, yyyy h:mm a')}
          </p>
        </div>
      </div>

      {refreshError && <ParkAlert.Root role="alert" status="error" variant="surface">
        <ParkAlert.Content>
          <ParkAlert.Description>Could not refresh messages: {refreshError}</ParkAlert.Description>
          <div><ParkButton type="button" aria-disabled={refreshing} onClick={async () => { if (!refreshing && await fetchTicket('interactive') === 'updated') messagesRegion.current?.focus(); }}>Refresh messages</ParkButton></div>
        </ParkAlert.Content>
      </ParkAlert.Root>}
      {downloadError && <ParkAlert.Root role="alert" status="error" variant="surface">
        <ParkAlert.Content><ParkAlert.Description>{downloadError}</ParkAlert.Description></ParkAlert.Content>
      </ParkAlert.Root>}
      <p role="status" aria-label="Attachment download status" className={p.chatStatus}>{downloadStatus}</p>
      <TicketSlaStatus ticketId={ticket.id} />
      <div className={[p.surface, p.chatSurface].join(' ')}>
        {/* Messages List */}
        <ParkScrollArea.Root className={messageArea}>
          <ParkScrollArea.Viewport ref={messagesRegion} id="conversation-messages" role="region" aria-label="Conversation messages" tabIndex={0} className={messageViewport}>
            <ParkScrollArea.Content className={messageContent}>
          {articles.length === 0 ? <ParkEmptyState title="No messages yet." description="Your conversation will appear here when a message is added." headingLevel={false} className={p.emptyState} /> : articles.map((article) => {
            const isCustomer = article.sender_type === 'customer';
            return (
              <div key={article.id} className={[p.chatItem, isCustomer ? p.chatItemCustomer : p.chatItemSupport].join(' ')}>
                <div className={p.chatMeta}>
                  <span className={p.chatMetaName}>
                    {isCustomer ? 'You' : 'Support Team'}
                  </span>
                  <span className={p.chatMetaTime}>
                    {formatDistanceToNow(utcTimestamp(article.created_at), { addSuffix: true })}
                  </span>
                </div>
                <div
                  className={[p.message, isCustomer ? p.messageCustomer : p.messageSupport].join(' ')}
                >
                  <div className={p.chatBody}>{article.body_format === 'markdown-v1' && typeof article.body_text === 'string' ? article.body_text : article.body}</div>

                  {article.attachments && article.attachments.length > 0 && (
                    <div className={p.chatAttachments}>
                      {article.attachments.map((att) => (
                        <ParkButton
                          key={att.id}
                          type="button"
                          aria-label={`Download ${att.filename || 'attachment'}`}
                          aria-disabled={Boolean(downloading)}
                          onClick={() => downloadAttachment(att.id, att.filename)}
                          className={[p.chatAttachment, isCustomer ? p.chatAttachmentCustomer : p.chatAttachmentSupport].join(' ')}
                        >
                          <IconPaperclip className={p.chatAttachmentIcon} aria-hidden="true" />
                          <span className={p.chatAttachmentName}>{att.filename || 'Attachment'}</span>
                          <span className={p.chatAttachmentSize}>
                            {attachmentSize(att.size)}
                          </span>
                        </ParkButton>
                      ))}  </div>
                  )}
                </div>
              </div>
            );
          })}
            </ParkScrollArea.Content>
          </ParkScrollArea.Viewport>
          <ParkScrollArea.Scrollbar orientation="vertical" />
        </ParkScrollArea.Root>
        {paginationVisible && <div className={p.chatPagination}>
          <ParkButton type="button" onClick={loadMore} aria-disabled={!nextCursor || loadingMore || refreshing}
            aria-controls="conversation-messages" aria-busy={loadingMore}
            className={p.chatPaginationButton}>
            {loadingMore ? 'Loading messages…' : nextCursor ? 'Load more messages' : 'All messages loaded'}
          </ParkButton>
          <p role="status" aria-label="Message pagination" aria-live="polite" className={p.chatPaginationStatus}>{pageStatus}</p>
        </div>}

        {/* Reply Area */}
        {(ticket.status === 'open' || ticket.status === 'pending') && (
          <div className={p.chatComposer}>
            <form aria-busy={sending} onSubmit={handleReply} className={p.chatComposerForm}>
              <ParkField label="Reply" className={p.chatReplyInput}>
                {replyError && <ParkAlert.Root id="reply-error" role="alert" status="error" variant="surface">
                  <ParkAlert.Content><ParkAlert.Description>{replyError}</ParkAlert.Description></ParkAlert.Content>
                </ParkAlert.Root>}
                <p role="status" aria-label="Reply status" className={p.chatReplyStatus}>{replyStatus}</p>
                <p id="reply-requirement" className={p.chatReplyRequirement}>Reply text is required, including when attaching files.</p>
                <ParkTextarea
                  readOnly={sending}
                  aria-describedby={replyError ? 'reply-requirement reply-error' : 'reply-requirement'}
                  value={newMessage}
                  onChange={(e) => { if (!sending) setNewMessage(e.target.value); }}
                  placeholder="Type your reply here..."
                  className={p.chatReplyInput}
                  rows={3}
                />
              </ParkField>

              {/* Attachment Preview */}
              {attachments.length > 0 && (
                <div className={p.chatAttachmentList}>
                  {attachments.map((file, idx) => (
                    <div key={idx} className={p.chatAttachmentItem}>
                      <IconPaperclip className={p.chatAttachmentIcon} aria-hidden="true" />
                      <span className={[p.chatAttachmentName, p.chatAttachmentNameCompact].join(' ')}>{file.name}</span>
                      <ParkButton
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        aria-disabled={sending}
                        onClick={() => removeAttachment(idx)}
                        className={p.chatAttachmentRemove}
                      >
                        <IconXmark className={p.chatAttachmentRemoveIcon} aria-hidden="true" />
                      </ParkButton>
                    </div>
                  ))}
                </div>
              )}

              <div className={p.chatReplyActions}>
                <ParkFileUpload.Root
                  maxFiles={Number.POSITIVE_INFINITY}
                  acceptedFiles={[]}
                  disabled={sending}
                  preventDocumentDrop={false}
                >
                  <ParkFileUpload.HiddenInput
                    aria-label="Choose reply attachments"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                  />
                  <ParkFileUpload.Trigger asChild>
                    <ParkButton
                      type="button"
                      ref={attachButton}
                      className={p.chatAttachButton}
                      aria-disabled={sending}
                    >
                      <IconPaperclip className={p.chatAttachIcon} aria-hidden="true" />
                      <span className={p.chatAttachLabel}>Attach Files</span>
                    </ParkButton>
                  </ParkFileUpload.Trigger>
                </ParkFileUpload.Root>

                <ParkButton
                  type="submit"
                  aria-disabled={sending || !newMessage.trim()}
                  className={p.chatSendButton}
                >
                  {sending ? <IconSpinner className={p.chatSendIcon} aria-hidden="true" /> : <IconPaperPlane className={p.chatSendIcon} aria-hidden="true" />}
                  Send Reply
                </ParkButton>
              </div>
            </form>
          </div>
        )}

        {ticket.status === 'resolved' || ticket.status === 'closed' ? (
           <div className={p.chatClosed}>
             This ticket is {ticket.status}. You cannot reply to it.
           </div>
        ) : null}
      </div>
    </div>
  );
}
