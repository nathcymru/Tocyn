# Ownership and Schema Matrix

| Table Name | Ownership | Primary Key | Foreign Keys | Unique Constraints | Notes |
|---|---|---|---|---|---|
| `users` | Tenant | `(tenant_id, id)` | | `UNIQUE(tenant_id, email)` | Canonical tenant entity |
| `tickets` | Tenant | `(tenant_id, id)` | `(tenant_id, customer_id) -> users`, `(tenant_id, assigned_to) -> users`, `(tenant_id, group_id) -> groups` | | Core tenant entity |
| `articles` | Tenant | `(tenant_id, id)` | `(tenant_id, ticket_id) -> tickets`, `(tenant_id, sender_id) -> users` | | Child of tickets |
| `attachments` | Tenant | `(tenant_id, id)` | `(tenant_id, article_id) -> articles` | | Child of articles |
| `groups` | Tenant | `(tenant_id, id)` | | `UNIQUE(tenant_id, name)` | Tenant entity |
| `user_groups` | Tenant | `(tenant_id, user_id, group_id)` | `(tenant_id, user_id) -> users`, `(tenant_id, group_id) -> groups` | | Association table |
| `customer_auth_tokens` | Tenant | `(tenant_id, id)` | `(tenant_id, user_id) -> users` | `UNIQUE(tenant_id, token_hash)` | |
| `knowledge_categories` | Tenant | `(tenant_id, id)` | `(tenant_id, parent_id) -> knowledge_categories` | | Self-referencing |
| `knowledge_docs` | Tenant | `(tenant_id, id)` | `(tenant_id, category_id) -> knowledge_categories` | | |
| `support_emails` | Tenant | `(tenant_id, id)` | `(tenant_id, group_id) -> groups` | `UNIQUE(tenant_id, email_address)` | |
| `ticket_fields` | Tenant | `(tenant_id, id)` | | `UNIQUE(tenant_id, name)` | |
| `ticket_filters` | Tenant | `(tenant_id, id)` | | | |
| `ticket_sequence` | Tenant | `(tenant_id, id)` | | | Auto-increment strategy needs adapting for composite PK. |
| `automation_rules` | Tenant | `(tenant_id, id)` | | | |
| `api_keys` | Tenant | `(tenant_id, id)` | | `UNIQUE(tenant_id, key_hash)` | Keys are tenant-scoped |
| `config` / `settings` | Tenant | `(tenant_id, key)` | | | Re-scoped to per-tenant configuration |

**Schema Rules:**
- All tenant tables must include `tenant_id TEXT NOT NULL`.
- Foreign keys must include `tenant_id` to ensure associations do not cross boundaries.
- No global tables exist in the current architecture; the entire database is partitioned by `tenant_id`.
