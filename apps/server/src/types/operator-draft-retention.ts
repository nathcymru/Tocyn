/** Owner-approved local-beta policy; no production scheduler or default is enabled. */
export const LOCAL_DRAFT_RETENTION_MS = 48 * 60 * 60 * 1000;
export const LOCAL_DRAFT_RETENTION = Object.freeze({
  expiresAt: (now: Date) => new Date(now.getTime() + LOCAL_DRAFT_RETENTION_MS).toISOString(),
});
export function legacyDraftCutoff(now: Date): string {
  return new Date(now.getTime() - LOCAL_DRAFT_RETENTION_MS).toISOString();
}

// Older local drafts have no expiry column value. Their last saved timestamp remains authoritative.
export const DRAFT_EXPIRY_SQL = "COALESCE(expires_at,strftime('%Y-%m-%dT%H:%M:%fZ',updated_at,'+48 hours'))";
