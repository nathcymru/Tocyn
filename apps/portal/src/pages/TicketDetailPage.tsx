import { TocynButton, TocynInput, TocynTextarea } from '@luminatick/ui/primitives';
import { attachmentSize } from '../utils/attachment-size';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { portalApi } from '../api/client';
import type { Ticket, Article } from '../types';
import { Loader2, ArrowLeft, Paperclip, Send, X } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { utcTimestamp } from '../utils/utcTimestamp';
import { ticketReference } from '../utils/ticket-reference';

type UploadedAttachment = { filename: string; size: number; contentType: string; storageKey: string };

type DetailPage = { ticket: Ticket; articles: Article[]; pagination?: { next_cursor: string | null; has_more: boolean } };

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
    open: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    resolved: 'bg-gray-100 text-gray-800',
    closed: 'bg-gray-100 text-gray-800',
  };

  if (loading) {
    return <div role="status" className="flex justify-center py-12"><Loader2 aria-hidden="true" className="w-8 h-8 animate-spin text-brand-600" /><span className="sr-only">Loading conversation…</span></div>;
  }

  if (error || !ticket) {
    return (
      <div className="bg-red-50 text-red-700 p-4 rounded-lg">
        <p role="alert">{error || 'Ticket not found'}</p>
        <TocynButton type="button" onClick={() => { recovering.current = true; void fetchTicket(); }} className="mt-3 rounded border border-red-700 px-3 py-2 focus-visible:outline focus-visible:outline-2">Retry loading conversation</TocynButton>
        <Link to="/tickets" className="block mt-4 text-brand-600 hover:underline">Back to Tickets</Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/tickets" aria-label="Back to Tickets" className="p-2 hover:bg-gray-100 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </Link>
        <div>
          <h1 ref={conversationHeading} tabIndex={-1} className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            {ticket.subject}
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${statusColors[ticket.status]}`}>
              {ticket.status}
            </span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Ticket {ticketReference(ticket, ticketPrefix)} • Created {format(utcTimestamp(ticket.created_at), 'MMM d, yyyy h:mm a')}
          </p>
        </div>
      </div>

      {refreshError && <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">
        <p role="alert">Could not refresh messages: {refreshError}</p>
        <TocynButton type="button" aria-disabled={refreshing} onClick={async () => { if (!refreshing && await fetchTicket('interactive') === 'updated') messagesRegion.current?.focus(); }} className="mt-2 rounded border border-red-700 px-3 py-2 focus-visible:outline focus-visible:outline-2">Refresh messages</TocynButton>
      </div>}
      {downloadError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{downloadError}</p>}
      <p role="status" aria-label="Attachment download status" className="text-sm text-gray-700">{downloadStatus}</p>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col">
        {/* Messages List */}
        <div ref={messagesRegion} id="conversation-messages" role="region" aria-label="Conversation messages" tabIndex={0} className="flex-1 overflow-y-auto p-6 space-y-6 max-h-[600px] bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">
          {articles.map((article) => {
            const isCustomer = article.sender_type === 'customer';
            return (
              <div key={article.id} className={`flex flex-col ${isCustomer ? 'items-end' : 'items-start'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-gray-600">
                    {isCustomer ? 'You' : 'Support Team'}
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatDistanceToNow(utcTimestamp(article.created_at), { addSuffix: true })}
                  </span>
                </div>
                <div
                  className={`max-w-[85%] rounded-2xl px-5 py-3 ${
                    isCustomer
                      ? 'bg-brand-600 text-white rounded-tr-sm'
                      : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'
                  }`}
                >
                  <div className="whitespace-pre-wrap break-words text-sm">{article.body_format === 'markdown-v1' && typeof article.body_text === 'string' ? article.body_text : article.body}</div>

                  {article.attachments && article.attachments.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {article.attachments.map((att) => (
                        <TocynButton
                          key={att.id}
                          type="button"
                          aria-label={`Download ${att.filename || 'attachment'}`}
                          aria-disabled={Boolean(downloading)}
                          onClick={() => downloadAttachment(att.id, att.filename)}
                          className={`flex w-full cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 items-center gap-2 p-2 rounded-lg text-sm ${
                            isCustomer ? 'bg-brand-700/50 text-white' : 'bg-gray-50 text-gray-700 border border-gray-100'
                          }`}
                        >
                          <Paperclip className="w-4 h-4" />
                          <span className="truncate flex-1">{att.filename || 'Attachment'}</span>
                          <span className="text-xs opacity-75">
                            {attachmentSize(att.size)}
                          </span>
                        </TocynButton>
                      ))}  </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {paginationVisible && <div className="border-t border-gray-200 bg-white p-4 space-y-2">
          <TocynButton type="button" onClick={loadMore} aria-disabled={!nextCursor || loadingMore || refreshing}
            aria-controls="conversation-messages" aria-busy={loadingMore}
            className="rounded-md border border-gray-400 bg-white px-4 py-2 text-sm font-medium text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 aria-disabled:cursor-default">
            {loadingMore ? 'Loading messages…' : nextCursor ? 'Load more messages' : 'All messages loaded'}
          </TocynButton>
          <p role="status" aria-label="Message pagination" aria-live="polite" className="text-sm text-gray-700">{pageStatus}</p>
        </div>}

        {/* Reply Area */}
        {(ticket.status === 'open' || ticket.status === 'pending') && (
          <div className="p-4 bg-white border-t border-gray-200">
            <form aria-busy={sending} onSubmit={handleReply} className="flex flex-col gap-3">
              <label htmlFor="reply-message" className="text-sm font-medium text-gray-700">Reply</label>
              {replyError && <p id="reply-error" role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{replyError}</p>}
              <p role="status" aria-label="Reply status" className="text-sm text-gray-700">{replyStatus}</p>
              <p id="reply-requirement" className="text-sm text-gray-700">Reply text is required, including when attaching files.</p>
              <TocynTextarea
                id="reply-message"
                readOnly={sending}
                aria-describedby={replyError ? 'reply-requirement reply-error' : 'reply-requirement'}
                value={newMessage}
                onChange={(e) => { if (!sending) setNewMessage(e.target.value); }}
                placeholder="Type your reply here..."
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500 resize-none"
                rows={3}
              />

              {/* Attachment Preview */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-gray-100 px-3 py-1.5 rounded-full text-sm border border-gray-200">
                      <Paperclip className="w-3 h-3 text-gray-500" />
                      <span className="max-w-[150px] truncate">{file.name}</span>
                      <TocynButton
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        aria-disabled={sending}
                        onClick={() => removeAttachment(idx)}
                        className="rounded text-gray-700 hover:text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
                      >
                        <X className="w-3 h-3" />
                      </TocynButton>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <TocynInput
                    type="file"
                    aria-label="Choose reply attachments"
                    multiple
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                  />
                  <TocynButton
                    type="button"
                    ref={attachButton}
                    onClick={() => { if (!sending) fileInputRef.current?.click(); }}
                    className="flex items-center gap-2 rounded text-gray-700 hover:text-brand-600 transition-colors px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
                    aria-disabled={sending}
                  >
                    <Paperclip className="w-5 h-5" />
                    <span className="text-sm font-medium">Attach Files</span>
                  </TocynButton>
                </div>

                <TocynButton
                  type="submit"
                  aria-disabled={sending || !newMessage.trim()}
                  className="flex items-center gap-2 bg-brand-600 text-white px-6 py-2 rounded-lg hover:bg-brand-700 transition-colors aria-disabled:bg-brand-700 aria-disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 font-medium"
                >
                  {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  Send Reply
                </TocynButton>
              </div>
            </form>
          </div>
        )}

        {ticket.status === 'resolved' || ticket.status === 'closed' ? (
           <div className="p-4 bg-gray-50 border-t border-gray-200 text-center text-sm text-gray-500">
             This ticket is {ticket.status}. You cannot reply to it.
           </div>
        ) : null}
      </div>
    </div>
  );
}
