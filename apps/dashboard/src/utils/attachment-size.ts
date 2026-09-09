/** Attachment sizes from the API and File objects are bytes. */
export function attachmentSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  const divisor = bytes < 1024 * 1024 ? 1024 : 1024 * 1024;
  const unit = divisor === 1024 ? 'KB' : 'MB';
  return `${Number((bytes / divisor).toFixed(1))} ${unit}`;
}
