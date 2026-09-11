import { describe, expect, it } from 'vitest';
import { normalizeCollaborationMentionIds } from '@luminatick/shared';

const actor = '11111111-1111-4111-8111-111111111111';
const recipient = '22222222-2222-4222-8222-222222222222';

describe('collaboration mention contract', () => {
  it('deduplicates and orders internal recipients', () => {
    expect(normalizeCollaborationMentionIds([recipient, recipient], 'internal', actor)).toEqual([recipient]);
  });

  it('rejects public notes, the author, malformed IDs, and more than 16 recipients', () => {
    expect(normalizeCollaborationMentionIds([recipient], 'public', actor)).toBeNull();
    expect(normalizeCollaborationMentionIds([actor], 'internal', actor)).toBeNull();
    expect(normalizeCollaborationMentionIds(['staff'], 'internal', actor)).toBeNull();
    const many = Array.from({ length: 17 }, (_, index) =>
      `${String(index + 3).padStart(8, '0')}-0000-4000-8000-000000000000`);
    expect(normalizeCollaborationMentionIds(many, 'internal', actor)).toBeNull();
  });
});
