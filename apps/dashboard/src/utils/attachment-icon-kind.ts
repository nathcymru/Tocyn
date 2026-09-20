export type AttachmentIconKind = 'pdf' | 'image' | 'archive' | 'text' | 'generic';

/** Presentation only: the server's authorised download and preview rules remain authoritative. */
export function attachmentIconKind(filename: string, contentType?: unknown): AttachmentIconKind {
  const mime = typeof contentType === 'string' ? (contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '') : '';
  if (mime === 'application/pdf') return 'pdf';
  if (/^image\/[\w.+-]+$/.test(mime)) return 'image';
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed') return 'archive';
  if (/^text\/[\w.+-]+$/.test(mime)) return 'text';
  // A specific, conflicting MIME should not be relabelled from a filename.
  if (mime && mime !== 'application/octet-stream') return 'generic';

  const name = filename.trim().toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp)$/.test(name)) return 'image';
  if (name.endsWith('.zip')) return 'archive';
  if (/\.(txt|md)$/.test(name)) return 'text';
  return 'generic';
}
