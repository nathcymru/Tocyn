import { TocynButton } from '@luminatick/ui/primitives';
import { useEffect, useRef, useState } from 'react';
import { dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';

const MAXIMUM_PREVIEW_BYTES = 10 * 1024 * 1024;
const RASTER_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

let activePreviewRequest: AbortController | null = null;
let activeLoadedPreview: { owner: object; clear: () => void } | null = null;

function mediaType(value: string | undefined | null): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() || '';
}

function permittedAttachment(contentType: string | undefined, size: number | undefined): contentType is typeof RASTER_CONTENT_TYPES[number] {
  return RASTER_CONTENT_TYPES.includes(mediaType(contentType) as typeof RASTER_CONTENT_TYPES[number])
    && (size === undefined || (Number.isFinite(size) && size >= 0 && size <= MAXIMUM_PREVIEW_BYTES));
}

/**
 * Fetches a preview only after an explicit user action. The URL is a local blob
 * built from the existing tenant-authorized download endpoint, never sender text.
 */
export function AuthenticatedAttachmentImage({
  ticketId,
  attachmentId,
  filename,
  contentType,
  size,
}: {
  ticketId: string;
  attachmentId: string;
  filename: string;
  contentType?: string;
  size?: number;
}) {
  const sessionGeneration = useAuthStore(state => state.sessionGeneration);
  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewOwnerRef = useRef({});
  const ticketRef = useRef(ticketId);
  const generationRef = useRef(sessionGeneration);
  ticketRef.current = ticketId;
  generationRef.current = sessionGeneration;

  const clearPreview = (nextStatus?: PreviewStatus) => {
    if (previewUrlRef.current) window.URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    if (activeLoadedPreview?.owner === previewOwnerRef.current) activeLoadedPreview = null;
    setPreviewUrl(null);
    if (nextStatus) setStatus(nextStatus);
  };

  const hidePreview = () => clearPreview('idle');
  const previewError = () => clearPreview('error');

  const cancelRequest = () => {
    requestRef.current?.abort();
    if (activePreviewRequest === requestRef.current) activePreviewRequest = null;
    requestRef.current = null;
  };

  useEffect(() => () => {
    cancelRequest();
    clearPreview();
  }, []);

  useEffect(() => {
    cancelRequest();
    clearPreview();
    setStatus('idle');
  }, [ticketId, sessionGeneration]);

  if (!permittedAttachment(contentType, size)) return null;
  const expectedType = mediaType(contentType);
  const label = filename || 'attachment image';

  const preview = async () => {
    activePreviewRequest?.abort();
    activeLoadedPreview?.clear();
    clearPreview();
    const controller = new AbortController();
    const requestTicket = ticketId;
    const requestGeneration = sessionGeneration;
    requestRef.current = controller;
    activePreviewRequest = controller;
    setStatus('loading');
    try {
      const result = await dashboardApi.boundedBlob(
        `/attachments/${encodeURIComponent(attachmentId)}/download`,
        MAXIMUM_PREVIEW_BYTES,
        RASTER_CONTENT_TYPES,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || requestRef.current !== controller || ticketRef.current !== requestTicket || generationRef.current !== requestGeneration) return;
      if (result.contentType !== expectedType || mediaType(result.blob.type) !== expectedType || result.blob.size > MAXIMUM_PREVIEW_BYTES) {
        throw new Error('Attachment preview did not pass validation.');
      }
      const nextUrl = window.URL.createObjectURL(result.blob);
      if (controller.signal.aborted || requestRef.current !== controller || ticketRef.current !== requestTicket || generationRef.current !== requestGeneration) {
        window.URL.revokeObjectURL(nextUrl);
        return;
      }
      previewUrlRef.current = nextUrl;
      activeLoadedPreview = { owner: previewOwnerRef.current, clear: hidePreview };
      setPreviewUrl(nextUrl);
      setStatus('ready');
    } catch (error) {
      if (requestRef.current !== controller || ticketRef.current !== requestTicket || generationRef.current !== requestGeneration) return;
      if (controller.signal.aborted) {
        setStatus('idle');
        return;
      }
      setStatus('error');
    } finally {
      if (activePreviewRequest === controller) activePreviewRequest = null;
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (controller.signal.aborted && ticketRef.current === requestTicket && generationRef.current === requestGeneration) setStatus('idle');
      }
    }
  };

  return <div className="mt-2 space-y-2">
    <TocynButton type="button" onClick={() => status === 'ready' ? hidePreview() : void preview()} aria-label={status === 'ready' ? `Hide image preview ${label}` : `Preview image ${label}`} aria-busy={status === 'loading'} disabled={status === 'loading'} className="min-h-11 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-wait">
      {status === 'ready' ? 'Hide image preview' : status === 'loading' ? 'Loading image preview…' : 'Preview image'}
    </TocynButton>
    {status === 'error' && <p role="alert" className="text-sm text-red-700">Image preview could not be loaded. <TocynButton type="button" onClick={() => void preview()} aria-label={`Retry image preview ${label}`} className="underline">Retry preview</TocynButton></p>}
    {previewUrl && <img src={previewUrl} alt={`Preview of ${label}`} onError={previewError} className="max-h-80 max-w-full rounded border border-slate-200 object-contain" />}
  </div>;
}
