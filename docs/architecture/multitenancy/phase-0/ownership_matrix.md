# Ownership and schema matrix

This matrix describes the unreleased Phase 1 migration chain through `0019`.
Production migration and cutover remain tracked separately in #42.

| Table | Ownership and key | Constraints / routing |
|---|---|---|
| `users` | Tenant, `(tenant_id, id)` | Tenant email uniqueness plus globally unique `lower(trim(email))` for login routing |
| `tickets` | Tenant, `(tenant_id, id)` | Composite customer, assignee and group foreign keys |
| `articles` | Tenant, `(tenant_id, id)` | Composite ticket and sender foreign keys |
| `attachments` | Tenant, `(tenant_id, id)` | Composite article foreign key |
| `groups` | Tenant, `(tenant_id, id)` | Tenant name uniqueness |
| `user_groups` | Tenant, `(tenant_id, user_id, group_id)` | Composite user and group foreign keys |
| `customer_auth_tokens` | Tenant, globally unique challenge `id` | Mandatory tenant ownership, composite user FK; token hash is indexed, not unique |
| `knowledge_categories` | Tenant, `(tenant_id, id)` | Composite parent FK |
| `knowledge_docs` | Tenant, `(tenant_id, id)` | Composite category FK |
| `support_emails` | Tenant, `(tenant_id, id)` | Globally unique normalized address; historical group references are retained without an FK |
| `ticket_fields` | Tenant, `(tenant_id, id)` | Tenant field-name uniqueness |
| `ticket_filters` | Tenant, `(tenant_id, id)` | Tenant name uniqueness; no user ownership column |
| `automation_rules` | Tenant, `(tenant_id, id)` | Scheduled composition enumerates active tenants |
| `api_keys` | Tenant, `(tenant_id, id)` | Globally unique key hash for pre-scope routing; explicit permissions |
| `tenant_config` | Tenant, `(tenant_id, key)` | Globally unique public widget key where configured |
| `ticket_sequence` | Historical global sequence | Retained migration artifact; not tenant data authority |
| `config`, `settings` | Historical global tables | Retained for migration provenance; active tenant config uses `tenant_config` |

`0014` explicitly backfills historical single-tenant records into `default-tenant`.
This is a migration decision, never a runtime tenant fallback. `0019` resolves historical
challenge ownership from user rows and aborts on missing or ambiguous ownership.
The local D1 integration suite loads the real migration chain, including legacy sample data.
