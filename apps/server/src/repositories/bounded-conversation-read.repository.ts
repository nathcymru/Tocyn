import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { Article, Attachment } from '../types';
import {
  boundedInteger, decodeArticleCursor, encodeArticleCursor, ConversationReadError,
} from '../services/conversation-read-bounds';

type ArticleMetadata = {
  id: string; created_at: string; body_bytes: number; legacy_body: number; metadata_bytes: number;
};
type PageOptions = { customerEmail?: string; publicOnly?: boolean; limit?: string; cursor?: string };
const RAW_PAGE_BUDGET = 256 * 1024;

// SQLite's default BINARY collation compares UTF-8 bytes, unlike localeCompare
// (which can be locale-sensitive and puts lower case before upper case).
const compareSqliteBinaryText = (left: string, right: string): number => {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index++) {
    const difference = leftBytes[index] - rightBytes[index];
    if (difference) return difference;
  }
  return leftBytes.length - rightBytes.length;
};
export type BoundedArticlePage = {
  articles: (Article & { attachments: Attachment[] })[];
  pagination: { limit: number; next_cursor: string | null; has_more: boolean };
};

/** Visibility is applied before LIMIT; metadata is measured before body materialization. */
export class BoundedConversationReadRepository {
  constructor(private db: D1Database, private scope: VerifiedTenantScope) {}

  async page(ticketId: string, options: PageOptions = {}): Promise<BoundedArticlePage> {
    const limit = boundedInteger(options.limit, 50, 50);
    const cursor = decodeArticleCursor(options.cursor);
    const publicOnly = options.publicOnly || options.customerEmail !== undefined;
    const owner = options.customerEmail !== undefined ? ` AND EXISTS (SELECT 1 FROM tickets t
      WHERE t.tenant_id=a.tenant_id AND t.id=a.ticket_id AND t.customer_email=?)` : '';
    const visibility = publicOnly ? ' AND a.is_internal=0' : '';
    const scopeWhere = `a.tenant_id=? AND a.ticket_id=?${visibility}${owner}`;
    const baseValues = [this.scope.tenantId, ticketId, ...(options.customerEmail !== undefined ? [options.customerEmail] : [])];
    const cursorWhere = cursor ? ' AND (a.created_at>? OR (a.created_at=? AND a.id>?))' : '';
    const metadata = await this.db.prepare(`SELECT a.id,a.created_at,
      length(CAST(COALESCE(a.body,'') AS BLOB)) AS body_bytes,
      CASE WHEN a.body_r2_key IS NOT NULL THEN 1 ELSE 0 END AS legacy_body,
      length(CAST(COALESCE(a.snippet,'')||COALESCE(a.raw_email_id,'')||COALESCE(a.body_r2_key,'') AS BLOB)) AS metadata_bytes
      FROM articles a WHERE ${scopeWhere}${cursorWhere} ORDER BY a.created_at,a.id LIMIT ?`)
      .bind(...baseValues, ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []), limit + 1)
      .all<ArticleMetadata>();
    const selected: ArticleMetadata[] = [];
    let bytes = 0;
    for (const article of metadata.results.slice(0, limit)) {
      const cost = article.body_bytes + article.metadata_bytes + 2048;
      if (cost > RAW_PAGE_BUDGET || article.legacy_body) {
        if (!selected.length) {
          throw new ConversationReadError(413, 'conversation_page_too_large',
            'An article requires operator review before bounded retrieval. No articles have been omitted.');
        }
        break;
      }
      if (bytes + cost > RAW_PAGE_BUDGET) break;
      selected.push(article);
      bytes += cost;
    }
    if (!selected.length) {
      return { articles: [], pagination: { limit, next_cursor: null, has_more: false } };
    }
    const ids = selected.map(article => article.id);
    const placeholders = ids.map(() => '?').join(',');
    // Fetch the only attachment projection once, with a sentinel. Aggregates
    // over all attachments would make a maliciously large article bypass the
    // read bound even if its response was later rejected.
    const attachments = await this.db.prepare(`SELECT x.* FROM attachments x
      WHERE x.tenant_id=? AND x.article_id IN (${placeholders}) LIMIT 501`)
      .bind(this.scope.tenantId, ...ids).all<Attachment>();
    const attachmentBytes = attachments.results.reduce((total, attachment) => total +
      new TextEncoder().encode(`${attachment.file_name}${attachment.content_type}${attachment.r2_key}`).byteLength + 512, 0);
    if (attachments.results.length > 500 || attachmentBytes > RAW_PAGE_BUDGET) {
      throw new ConversationReadError(413, 'conversation_page_too_large',
        'Attachment metadata exceeds the local beta page limit. Request fewer articles or contact the operator.');
    }
    const articles = await this.db.prepare(`SELECT a.* FROM articles a
      WHERE ${scopeWhere} AND a.id IN (${placeholders})`)
      .bind(...baseValues, ...ids).all<Article>();
    // SQL ordering over an IN list can require a full temporary sort. These
    // sets are independently bounded (50 articles, 500 attachments), so keep
    // the stable public response order in memory instead.
    attachments.results.sort((left, right) => compareSqliteBinaryText(left.article_id, right.article_id)
      || compareSqliteBinaryText(left.created_at, right.created_at)
      || compareSqliteBinaryText(left.id, right.id));
    const articleById = new Map(articles.results.map(article => [article.id, article]));
    const byArticle = new Map<string, Attachment[]>();
    for (const attachment of attachments.results) {
      byArticle.set(attachment.article_id, [...(byArticle.get(attachment.article_id) ?? []), attachment]);
    }
    const hasMore = metadata.results.length > selected.length;
    const last = selected.at(-1)!;
    return {
      articles: selected.map(metadata => articleById.get(metadata.id)).filter((article): article is Article => !!article).map(article => ({
        ...article,
        is_internal: Boolean(article.is_internal),
        attachments: byArticle.get(article.id) ?? [],
      })),
      pagination: {
        limit,
        has_more: hasMore,
        next_cursor: hasMore ? encodeArticleCursor({ createdAt: last.created_at, id: last.id }) : null,
      },
    };
  }
}
