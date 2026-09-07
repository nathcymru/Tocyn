import { TenantRequestDeps } from '../middleware/tenant.middleware';
import { Ticket, Article } from '../types';

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
  constructor(private deps: TenantRequestDeps) {}

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
              const regex = new RegExp(condition.value, 'i');
              const stringToTest = String(valueToTest);
              if (stringToTest.length > 1000) return false;
              return regex.test(stringToTest);
            } catch (e) {
              console.error(`Invalid regex in automation rule: ${condition.value}`, e);
              return false;
            }
          default:
            return false;
        }
      });
    } catch (e) {
      console.error('Failed to parse automation conditions', e);
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
      if (!config.url.startsWith('http')) {
        console.error('Invalid webhook URL protocol');
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(config.url, {
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

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`Webhook failed with status ${response.status}: ${await response.text()}`);
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.error('Webhook request timed out');
      } else {
        console.error('Failed to execute webhook', e);
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
        const days = config.days_to_keep || 365;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const cutoffStr = cutoffDate.toISOString();

        // Find qualifying tickets within this tenant's scope
        const toDelete = await this.deps.repositories.tickets.findTicketsForRetention(cutoffStr);

        for (const ticket of toDelete) {
          try {
            // 1. Get articles for this ticket
            const articles = await this.deps.repositories.articles.listByTicket(ticket.id);

            // 2. For each article, clean up attachments (R2 + metadata)
            for (const article of articles) {
              const attachments = await this.deps.repositories.attachments.findByArticle(article.id);
              for (const attachment of attachments) {
                if (config.delete_attachments) {
                  try {
                    await this.deps.attachmentStorage.deleteAttachment(attachment.r2_key);
                    totalDeletedAttachments++;
                  } catch (e) {
                    console.error(`Failed to delete R2 object: ${attachment.r2_key}`, e);
                  }
                }
                await this.deps.repositories.attachments.delete(attachment.id);
              }

              // 3. Clean up vectors for QA articles
              if (article.qa_type && this.deps.vectorStorage) {
                const count = article.chunk_count || 10;
                const vectorIds: string[] = [];
                for (let i = 0; i < count; i++) {
                  vectorIds.push(`qa_${article.id}_${i}`);
                }
                try {
                  await this.deps.vectorStorage.deleteByIds(vectorIds);
                } catch (e) {
                  console.error('Failed to delete vectors during retention:', e);
                }
              }

              // 4. Delete the article
              await this.deps.repositories.articles.delete(article.id);
            }

            // 5. Delete the ticket
            await this.deps.repositories.tickets.delete(ticket.id);
            totalDeletedTickets++;
          } catch (e) {
            console.error(`Error cleaning up ticket ${ticket.id}:`, e);
          }
        }
      } catch (e) {
        console.error('Error running retention rule:', e);
      }
    }

    return { deleted_tickets: totalDeletedTickets, deleted_attachments: totalDeletedAttachments };
  }
}
