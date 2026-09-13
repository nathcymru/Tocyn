export type NavigationProfile = Readonly<{ name: 'tiny' | 'medium'; articlesPerTicket: number; bytesPerArticle: number }>;

export function navigationProfile(name: string = 'tiny'): NavigationProfile {
  if (name === 'tiny') return Object.freeze({ name, articlesPerTicket: 1, bytesPerArticle: 35 });
  if (name === 'medium') return Object.freeze({ name, articlesPerTicket: 20, bytesPerArticle: 1024 });
  throw new Error('Unknown navigation profile; use tiny or medium');
}

/** Synthetic UTF-8 payloads, bounded before any canonical setup request. */
export function navigationArticle(profile: NavigationProfile, ticket: 'A' | 'B', index: number): string {
  const expected = navigationProfile(profile.name);
  if (profile.articlesPerTicket !== expected.articlesPerTicket || profile.bytesPerArticle !== expected.bytesPerArticle)
    throw new Error('Navigation profile bounds do not match the declared profile');
  if (!Number.isInteger(index) || index < 0 || index >= profile.articlesPerTicket || !['A', 'B'].includes(ticket))
    throw new Error('Invalid navigation article identity');
  const prefix = `Synthetic warm conversation body ${ticket}.`;
  const text = profile.name === 'tiny' ? prefix : `${prefix} Article ${index + 1}: café. `;
  const missing = profile.bytesPerArticle - new TextEncoder().encode(text).length;
  if (!Number.isSafeInteger(missing) || missing < 0) throw new Error('Navigation article exceeds declared bytes');
  return text + 'x'.repeat(missing);
}
