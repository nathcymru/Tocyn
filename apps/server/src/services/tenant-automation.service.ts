import { RE2JS } from 're2js';
import { TenantRequestDeps } from '../middleware/tenant.middleware';
import { Ticket, Article } from '../types';
import { KnowledgeIndexRepository } from '../repositories/knowledge-index.repository';
import { RetentionAdmissionRepository, RETENTION_EXTERNAL_BATCH } from '../repositories/retention-admission.repository';
import { admitRetentionStep } from '../budgets/retention-admission.service';
import { apiTicketBudgetCache } from '../middleware/budget-admission.middleware';
import type { Env } from '../bindings';

interface AutomationCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'regex';
  value: string;
}

interface RetentionConfig {
  days_to_keep?: number;
  delete_attachments?: boolean;
}

interface WebhookConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

/**
 * Tenant-scoped automation service. All operations are confined to
 * the tenant established by the VerifiedTenantScope in deps.
 * Rule payloads never establish tenant authority.
 * No raw ATTACHMENTS_BUCKET or VECTOR_INDEX access.
 */
export class TenantAutomationService {
  constructor(private deps: TenantRequestDeps, private webhookOrigins: readonly string[] = []) {}

  async getActiveRules(eventType: string): Promise<any[]> {
    return this.deps.repositories.automations.getActiveRules(eventType);
  }

  async runRulesForEvent(eventType: string, payload: { ticket: Ticket; article?: Article }): Promise<void> {
    const rules = await this.getActiveRules(eventType);

    for (const rule of rules) {
      if (this.evaluateConditions(rule.conditions, payload)) {
        await this.executeAction(rule, payload);
      }
    }
  }

  evaluateConditions(conditionsJson: string | undefined, payload: { ticket: Ticket; article?: Article }): boolean {
    if (!conditionsJson) return true;

    try {
      const conditions: AutomationCondition[] = JSON.parse(conditionsJson);
      if (conditions.length === 0) return true;

      return conditions.every(condition => {
        const valueToTest = this.getPropertyValue(payload, condition.field);
        if (valueToTest === undefined) return false;

        switch (condition.operator) {
          case 'equals':
            return String(valueToTest) === condition.value;
          case 'not_equals':
            return String(valueToTest) !== condition.value;
          case 'contains':
            return String(valueToTest).includes(condition.value);
          case 'regex':
            try {
              if (condition.value.length > 100) {
                console.error('Regex too long, skipping for safety');
                return false;
              }
              const regex = RE2JS.compile(condition.value, RE2JS.CASE_INSENSITIVE);
              const stringToTest = String(valueToTest);
              if (stringToTest.length > 1000) return false;
              return regex.matcher(stringToTest).find();
            } catch (e) {
              console.error('Unsupported automation regular expression');
              return false;
            }
          default:
            return false;
        }
      });
    } catch (e) {
      console.error('Invalid automation conditions');
      return false;
    }
  }

  private getPropertyValue(payload: { ticket: Ticket; article?: Article }, field: string): any {
    if (field.startsWith('ticket.')) {
      const ticketField = field.replace('ticket.', '') as keyof Ticket;
      return payload.ticket[ticketField];
    }
    if (field.startsWith('article.') && payload.article) {
      const articleField = field.replace('article.', '') as keyof Article;
      return payload.article[articleField];
    }
    if (payload.article && field in payload.article) return (payload.article as any)[field];
    if (field in payload.ticket) return (payload.ticket as any)[field];
    return undefined;
  }

  async executeAction(rule: any, payload: any): Promise<void> {
    switch (rule.action_type) {
      case 'webhook':
        await this.executeWebhook(rule.action_config, payload);
        break;
      case 'retention':
        // Retention is usually triggered by scheduled events, not per-ticket events
        break;
      default:
        console.warn(`Unknown action type: ${rule.action_type}`);
    }
  }

  private async executeWebhook(configJson: string, payload: any): Promise<void> {
    try {
      const config: WebhookConfig = JSON.parse(configJson);
      const target = new URL(config.url);
      if (target.protocol !== 'https:' || target.username || target.password || !this.webhookOrigins.includes(target.origin)) {
        throw new Error('Webhook origin not permitted');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
      const response = await fetch(target.href, {
        redirect: 'error',
        method: config.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...config.headers
        },
        body: JSON.stringify({
          event: 'automation_trigger',
          timestamp: new Date().toISOString(),
          data: payload
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        console.error(`Webhook failed with status ${response.status}`);
      }
      await response.body?.cancel();
      } finally { clearTimeout(timeoutId); }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.error('Webhook request timed out');
      } else {
        console.error('Failed to execute webhook');
      }
    }
  }

  /**
   * Retention: delete qualifying tickets and all their side effects
   * within this tenant's scope only.
   * Uses scoped repositories and storage - no raw D1/R2/Vectorize.
   */
  async runRetention(): Promise<{ deleted_tickets: number; deleted_attachments: number }> {
    const rules = await this.getActiveRules('scheduled.retention');
    let totalDeletedTickets = 0;
    let totalDeletedAttachments = 0;

    for (const rule of rules) {
      try {
        const config: RetentionConfig = JSON.parse(rule.action_config);
        const days = config.days_to_keep ?? 365;
        if (!Number.isInteger(days) || days < 1 || days > 36500 || (config.delete_attachments !== undefined && typeof config.delete_attachments !== 'boolean')) throw new Error('Invalid retention configuration');
        const cutoffStr = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        // Find qualifying tickets within this tenant's scope
        const toDelete = await this.deps.repositories.tickets.findTicketsForRetention(cutoffStr);

        for (const ticket of toDelete) {
          if (!this.evaluateConditions(rule.conditions, { ticket })) continue;
          try {
            const claim = await this.deps.repositories.tickets.claimRetention(ticket.id, cutoffStr);
            if (!claim) continue;
            const current = await this.deps.repositories.tickets.get(ticket.id);
            if (!current || !this.evaluateConditions(rule.conditions, { ticket: current })) {
              // Preserve the claim: another runner may already be using this manifest.
              continue;
            }
            const articles = await this.deps.repositories.articles.listByTicket(ticket.id);

            let attachmentCount = 0;
            // Keep database ownership records until every external deletion succeeds.
            // A retry can repeat idempotent deletes using those same records.
            for (const article of articles) {
              const attachments = await this.deps.repositories.attachments.findByArticle(article.id);
              attachmentCount += attachments.length;
              if (attachments.length && !config.delete_attachments) {
                throw new Error('Retention requires attachment deletion consent');
              }
              for (const attachment of attachments) {
                await this.deps.attachmentStorage.deleteAttachment(attachment.r2_key);
              }
              if (article.body_r2_key) {
                if (this.deps.legacyArticleStorage && /^tickets\/[a-zA-Z0-9-]+\/articles\/[a-zA-Z0-9-]+\/body\.txt$/.test(article.body_r2_key)) {
                  await this.deps.legacyArticleStorage.deleteLegacyArticleBody(article.body_r2_key);
                } else {
                  await this.deps.attachmentStorage.deleteAttachment(article.body_r2_key);
                }
              }
              if (article.qa_type || article.chunk_count) {
                if (!this.deps.vectorStorage) throw new Error('Vector storage unavailable');
                const index = new KnowledgeIndexRepository(this.deps.database, this.deps.scope);
                if (await index.hasAny(article.id)) {
                  // New versioned QA rows retain vector ids under the existing
                  // ticket retention claim. One bounded batch per run avoids
                  // unbounded cleanup fanout; incomplete work keeps ownership.
                  const chunks = await index.claimArticleCleanup(article.id);
                  if (chunks.length) {
                    try {
                      await this.deps.vectorStorage.deleteByIds(chunks.map(chunk => chunk.vectorId));
                      await index.completeArticleCleanup(article.id, chunks);
                    } catch (error) {
                      await index.releaseArticleCleanup(article.id, chunks);
                      throw error;
                    }
                  }
                  if (await index.hasPendingArticleCleanup(article.id)) throw new Error('Versioned QA vector cleanup remains pending');
                } else {
                  // Historical rows retain the prior bounded ID convention.
                  const count = article.chunk_count;
                  if (!Number.isSafeInteger(count) || !count || count < 1 || count > 10000) throw new Error('Vector cleanup manifest unavailable');
                  await this.deps.vectorStorage.deleteByIds(Array.from({ length: count }, (_, i) => `qa_${article.id}_${i}`));
                }
              }
            }
            if (await this.deps.repositories.tickets.completeRetention(ticket.id, claim.token)) {
              totalDeletedTickets++;
              totalDeletedAttachments += attachmentCount;
            }
          } catch (e) {
            console.error('Tenant retention cleanup failed; ownership retained for retry');
          }
        }
      } catch (e) {
        console.error('Tenant retention rule failed');
      }
    }

    return { deleted_tickets: totalDeletedTickets, deleted_attachments: totalDeletedAttachments };
  }

  /**
   * Cron-only continuation.  It deliberately does one externally visible
   * deletion per retained ticket: all candidate scans are keyset/LIMIT based,
   * and a claim remains in place until a provider acknowledgement is durable.
   * The historic `runRetention` remains for old local callers; scheduler
   * composition exclusively uses this admitted method.
   */
  async runBoundedRetention(input: { env: Env; now?: () => number }): Promise<{ deleted_tickets: number; deleted_attachments: number }> {
    if (!this.deps.scope.roles.includes('system') || this.deps.scope.actorId !== 'scheduled-retention') return { deleted_tickets: 0, deleted_attachments: 0 };
    const now = input.now ?? Date.now;
    let deleted_tickets = 0, deleted_attachments = 0;
    const work = new RetentionAdmissionRepository(this.deps.database, this.deps.scope);
    // Every scheduler turn reserves its bounded cursor/rule/candidate scan
    // before D1 discovery. A missing policy retains the established local
    // scheduler behavior; a configured policy never performs free metadata
    // work before it can decide to deny.
    const discovery = await admitRetentionStep({ env: input.env, deps: this.deps, ticketId: 'scheduler', itemKey: 'discovery', attempt: 1, resource: 'd1', now });
    if (discovery.status === 'rejected') return { deleted_tickets, deleted_attachments };
    let rules: readonly { id: string; conditions?: string; action_config: string }[];
    try {
      const ruleAfter = await work.ruleCursor();
      rules = await work.nextRules(ruleAfter);
      if (!rules.length && ruleAfter) {
        await work.setRuleCursor(null);
        rules = await work.nextRules(null);
      }
      if (discovery.authority) apiTicketBudgetCache.settleOperation(discovery.authority,'committed',now());
    } catch {
      if (discovery.authority) apiTicketBudgetCache.settleOperation(discovery.authority,'unknown',now());
      return { deleted_tickets, deleted_attachments };
    }
    for (const rule of rules) {
      let config: RetentionConfig;
      try {
        config = JSON.parse(rule.action_config);
        const days = config.days_to_keep ?? 365;
        if (!Number.isInteger(days) || days < 1 || days > 36500 || (config.delete_attachments !== undefined && typeof config.delete_attachments !== 'boolean')) throw new Error('Invalid retention configuration');
        const cutoff = new Date(now() - days * 86_400_000).toISOString();
        const resumed = await work.resumableTickets(rule.id);
        const cursor = await work.ticketCursor(rule.id);
        const candidates = resumed.length ? resumed : await work.nextTickets(cutoff, cursor);
        if (!candidates.length) { await work.setTicketCursor(rule.id, null); continue; }
        for (const candidate of candidates) {
          const materialization = await admitRetentionStep({ env: input.env, deps: this.deps, ticketId: candidate.id,
            itemKey: `materialize:${rule.id}`, attempt: 1, resource: 'd1', now });
          if (materialization.status === 'rejected') continue;
          let materialized = true;
          try {
          if (!('token' in candidate)) await work.setTicketCursor(rule.id, candidate);
          // Evaluate the exact source row before asking the repository to
          // atomically compare that snapshot, the cutoff and the current rule
          // while it creates both the claim and its progress authority.
          if (!('token' in candidate)) {
            const beforeClaim = await this.deps.repositories.tickets.get(candidate.id);
            if (!beforeClaim || !this.evaluateConditions(rule.conditions, { ticket: beforeClaim })) continue;
            const claim = await work.claimEligible(beforeClaim,cutoff,rule);
            if (!claim) continue;
            const result = await this.processRetentionWork(work,candidate.id,claim.token,rule,config,input.env,now);
            deleted_attachments += result.deleted_attachments;
            deleted_tickets += result.deleted_tickets;
            continue;
          }
          const current = await this.deps.repositories.tickets.get(candidate.id);
          if (!current || !this.evaluateConditions(rule.conditions, { ticket: current })) continue;
          const result = await this.processRetentionWork(work, candidate.id, candidate.token, rule, config, input.env, now);
          deleted_attachments += result.deleted_attachments;
          deleted_tickets += result.deleted_tickets;
          } catch {
            materialized = false;
            continue;
          } finally {
            if (materialization.authority) apiTicketBudgetCache.settleOperation(materialization.authority,materialized ? 'committed' : 'unknown',now());
          }
        }
      } catch { console.error('Tenant retention rule failed'); }
      await work.setRuleCursor(rule.id);
    }
    return { deleted_tickets, deleted_attachments };
  }

  private async processRetentionWork(work: RetentionAdmissionRepository, ticketId: string, token: string, rule: { id: string; conditions?: string; action_config: string }, config: RetentionConfig,
    env: Env, now: () => number): Promise<{ deleted_attachments: number; deleted_tickets: number }> {
    const nowIso = new Date(now()).toISOString();
    await work.recoverExpired(ticketId, token, nowIso);
    let item = await work.claimNext(ticketId, token, nowIso, new Date(now() + 300_000).toISOString());
    if (!item) { await work.materializeNext(ticketId, token); item = await work.claimNext(ticketId, token, nowIso, new Date(now() + 300_000).toISOString()); }
    if (!item) return { deleted_attachments: 0, deleted_tickets: 0 };
    if (!await work.currentRule(rule.id, rule)) { await work.uncertain(ticketId,item.itemKey,token,item.attemptToken); return { deleted_attachments: 0, deleted_tickets: 0 }; }
    if (item.itemKind === 'attachment' && !config.delete_attachments) { await work.uncertain(ticketId,item.itemKey,token,item.attemptToken); return { deleted_attachments: 0, deleted_tickets: 0 }; }
    const admission = await admitRetentionStep({ env, deps: this.deps, ticketId, itemKey: item.itemKey, attempt: item.attempts,
      resource: item.itemKind === 'legacy_vector' ? 'vector' : item.itemKind === 'finalize' ? 'd1' : 'r2', now });
    // Off/undefined policy preserves the established local scheduler behavior;
    // every configured active policy needs a current paid authority first.
    if (admission.status === 'rejected') { await work.uncertain(ticketId,item.itemKey,token,item.attemptToken); return { deleted_attachments: 0, deleted_tickets: 0 }; }
    if (!await work.recordAdmission(ticketId,item.itemKey,token,item.attemptToken,rule,admission.authority)) {
      // Rule/budget revocation or lease recovery after reservation cannot
      // create an effect. Keep the durable attempt available for recovery.
      await work.uncertain(ticketId,item.itemKey,token,item.attemptToken);
      if (admission.authority) apiTicketBudgetCache.settleOperation(admission.authority,'unknown',now());
      return { deleted_attachments: 0, deleted_tickets: 0 };
    }
    try {
      if (item.itemKind === 'finalize') {
        const outcome = await work.finalizeOne(ticketId,token,item.attemptToken,rule,admission.authority);
        if (outcome === 'stale') throw new Error('Retention finalization lease superseded');
        if (outcome === 'more') {
          if (!await work.continueItem(ticketId,item.itemKey,token,item.attemptToken)) throw new Error('Retention finalization continuation lost');
          if (admission.authority) apiTicketBudgetCache.settleOperation(admission.authority,'committed',now());
          return { deleted_attachments: 0, deleted_tickets: 0 };
        }
        if (admission.authority) apiTicketBudgetCache.settleOperation(admission.authority,'committed',now());
        return { deleted_attachments: 0, deleted_tickets: 1 };
      }
      if (item.itemKind === 'attachment') {
        const id = item.itemKey.slice('attachment:'.length);
        const key = await work.attachmentKey(ticketId,id);
        if (!await work.authorizeEffect(ticketId,item.itemKey,token,item.attemptToken,rule,admission.authority)) throw new Error('Retention authority revoked');
        if (key) await this.deps.attachmentStorage.deleteAttachment(key);
      } else if (item.itemKind === 'article_body') {
        const id = item.itemKey.slice('body:'.length);
        const key = await work.bodyKey(ticketId,id);
        if (!await work.authorizeEffect(ticketId,item.itemKey,token,item.attemptToken,rule,admission.authority)) throw new Error('Retention authority revoked');
        if (key) {
          if (this.deps.legacyArticleStorage && /^tickets\/[a-zA-Z0-9-]+\/articles\/[a-zA-Z0-9-]+\/body\.txt$/.test(key)) await this.deps.legacyArticleStorage.deleteLegacyArticleBody(key);
          else await this.deps.attachmentStorage.deleteAttachment(key);
        }
      } else {
        const match = /^legacy:([^:]+):(\d+)$/.exec(item.itemKey);
        if (!match || !this.deps.vectorStorage) throw new Error('Vector cleanup manifest unavailable');
        const [, articleId, offsetText] = match; const offset = Number(offsetText);
        const index = new KnowledgeIndexRepository(this.deps.database, this.deps.scope);
        if (await index.hasAny(articleId)) {
          // This is an O(1) durable all-version cleanup target (implemented by
          // the indexing prerequisite). It preserves active QA rows until the
          // admitted retention delete claims them in fixed-size batches.
          if (!await work.authorizeEffect(ticketId,item.itemKey,token,item.attemptToken,rule,admission.authority)) throw new Error('Retention authority revoked');
          await index.withdrawAll(articleId);
          const chunks = await index.claimArticleCleanup(articleId, RETENTION_EXTERNAL_BATCH);
          if (chunks.length) {
            try {
              if (!await work.authorizeEffect(ticketId,item.itemKey,token,item.attemptToken,rule,admission.authority)) throw new Error('Retention authority revoked');
              await this.deps.vectorStorage.deleteByIds(chunks.map(chunk => chunk.vectorId)); await index.completeArticleCleanup(articleId,chunks);
            }
            catch (error) { await index.releaseArticleCleanup(articleId,chunks); throw error; }
          }
          // A current article can have more historical versions than its
          // legacy chunk_count. Keep this one durable item pending until the
          // all-version cleanup target reports every vector acknowledged.
          if (await index.hasPendingArticleCleanup(articleId)) {
            if (!await work.continueItem(ticketId,item.itemKey,token,item.attemptToken)) throw new Error('Retention lease superseded');
            if (admission.authority) apiTicketBudgetCache.settleOperation(admission.authority,'committed',now());
            return { deleted_attachments: 0, deleted_tickets: 0 };
          }
        } else {
          const chunkCount = await work.legacyChunkCount(ticketId,articleId);
          if (!Number.isSafeInteger(chunkCount) || !chunkCount || chunkCount < 1 || chunkCount > 10_000) throw new Error('Vector cleanup manifest unavailable');
          const count = Math.min(RETENTION_EXTERNAL_BATCH, chunkCount - offset);
          if (!await work.authorizeEffect(ticketId,item.itemKey,token,item.attemptToken,rule,admission.authority)) throw new Error('Retention authority revoked');
          if (count > 0) await this.deps.vectorStorage.deleteByIds(Array.from({length:count},(_, index) => `qa_${articleId}_${offset + index}`));
        }
      }
      if (!await work.complete(ticketId,item.itemKey,token,item.attemptToken)) throw new Error('Retention lease superseded');
      if (admission.authority) apiTicketBudgetCache.settleOperation(admission.authority,'committed',now());
      return { deleted_attachments: item.itemKind === 'attachment' ? 1 : 0, deleted_tickets: 0 };
    } catch {
      await work.uncertain(ticketId,item.itemKey,token,item.attemptToken);
      if (admission.authority) apiTicketBudgetCache.settleOperation(admission.authority,'unknown',now());
      return { deleted_attachments: 0, deleted_tickets: 0 };
    }
  }
}
