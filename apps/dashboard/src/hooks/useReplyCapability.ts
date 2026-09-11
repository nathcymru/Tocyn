import { useQuery } from '@tanstack/react-query';
import type { ArticleBodyFormat, ReplyCapabilityV1 } from '@luminatick/shared';
import { dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const boundedInteger = (value: unknown, maximum: number) => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= maximum;
const formats = new Set<ArticleBodyFormat>(['plain', 'markdown-v1']);
const contentTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv']);

export function parseReplyCapability(value: unknown, ticketId: string): ReplyCapabilityV1 {
  const invalid = () => { throw new Error('Reply options are unavailable.'); };
  if (!record(value) || value.version !== 1 || value.ticketId !== ticketId || !Array.isArray(value.modes) || value.modes.length !== 2) return invalid();
  const seen = new Set<string>();
  for (const mode of value.modes) {
    if (!record(mode) || (mode.visibility !== 'public' && mode.visibility !== 'internal') || seen.has(mode.visibility)
      || mode.record !== 'ticket_article' || !record(mode.body) || !record(mode.attachments)) return invalid();
    seen.add(mode.visibility);
    if (mode.visibility === 'public' ? mode.channel !== 'email' || mode.delivery !== 'email_attempted' || mode.recipient !== 'ticket_customer'
      : mode.channel !== 'internal' || mode.delivery !== 'recorded_only' || mode.recipient !== null) return invalid();
    const body = mode.body, attachments = mode.attachments;
    if (!boundedInteger(body.maxCharacters, 16_000) || !Array.isArray(body.acceptedFormats) || !body.acceptedFormats.length
      || body.acceptedFormats.length > 2 || new Set(body.acceptedFormats).size !== body.acceptedFormats.length
      || body.acceptedFormats.some(format => !formats.has(format as ArticleBodyFormat))
      || !boundedInteger(attachments.maxCount, 10) || !boundedInteger(attachments.maxBytesPerFile, 10 * 1024 * 1024)
      || !Array.isArray(attachments.contentTypes) || !attachments.contentTypes.length || attachments.contentTypes.length > contentTypes.size
      || attachments.contentTypes.some(type => typeof type !== 'string' || !contentTypes.has(type))) return invalid();
  }
  if (value.collision !== undefined) {
    const collision = value.collision;
    if (!record(collision) || collision.version !== 1 || collision.protocol !== 'draft-precondition-v1'
      || !Number.isSafeInteger(collision.conversationRevision) || Number(collision.conversationRevision) < 0) return invalid();
  }
  if (value.internalMentions !== undefined) {
    const internalMentions = value.internalMentions;
    if (!record(internalMentions) || internalMentions.version !== 1 || internalMentions.protocol !== 'internal-activity-v1'
      || internalMentions.maxRecipients !== 16) return invalid();
  }
  return value as unknown as ReplyCapabilityV1;
}

export function useReplyCapability(ticketId: string) {
  const generation = useAuthStore(state => state.sessionGeneration);
  return useQuery({
    queryKey: ['reply-capability', generation, ticketId],
    queryFn: async () => parseReplyCapability(await dashboardApi.get<unknown>(`/tickets/${encodeURIComponent(ticketId)}/reply-capability`), ticketId),
    enabled: Boolean(ticketId), retry: false,
  });
}
