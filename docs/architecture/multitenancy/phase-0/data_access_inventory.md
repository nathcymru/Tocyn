# Data-Access Inventory

This concise inventory lists all direct D1, R2, and Vectorize accesses currently bypassing a repository pattern.

| File Path | Resource / Table | Access Type | Tenant Classification |
|---|---|---|---|
| `apps/server/src/handlers/auth.handler.ts` | `users` | Raw D1 Select | Tenant |
| `apps/server/src/handlers/channels.handler.ts` | `support_emails` | Raw D1 Select/Update/Delete | Tenant |
| `apps/server/src/handlers/settings.handler.ts` | `config`, `settings` | Raw D1 Select/Insert | Tenant |
| `apps/server/src/handlers/v1.handler.ts` | `articles` | Raw D1 Select | Tenant |
| `apps/server/src/handlers/customer.handler.ts` | R2 `ATTACHMENTS_BUCKET` | R2 Put | Tenant |
| `apps/server/src/handlers/dashboard.handler.ts` | R2 `ATTACHMENTS_BUCKET` | R2 Put | Tenant |
| `apps/server/src/services/vector.service.ts` | `VECTOR_INDEX` | Vectorize Upsert, Query, Delete | Tenant |
| `apps/server/src/services/automation.service.ts` | `VECTOR_INDEX` | Vectorize Delete | Tenant |
