export interface WidgetTenantResolution {
  tenantId: string;
}

export class WidgetTenantResolver {
  constructor(private db: D1Database) {}

  async resolveTenantByKey(widgetKey: string): Promise<WidgetTenantResolution | null> {
    if (!widgetKey || typeof widgetKey !== "string") return null;

    const config = await this.db
      .prepare("SELECT tenant_id FROM tenant_config WHERE key = 'widget.public_key' AND value = ?")
      .bind(widgetKey.trim())
      .first<{ tenant_id: string }>();

    if (!config) return null;

    return {
      tenantId: config.tenant_id,
    };
  }
}
