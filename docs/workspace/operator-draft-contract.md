# Operator draft and workspace storage contract

Status: #129 implementation in progress, based on accepted main `9cee350`. This server increment does not complete #129 or enable beta.2. The [operator workspace contract](operator-workspace-interaction-contract.md) remains product authority.

All routes are under `/api/workspace` and inherit current dashboard authentication, session-version checks, MFA, staff role and tenant scope. Tenant and operator come from verified scope, never request fields. Ticket access is rechecked, including agent group membership. Workspace responses are marked `Cache-Control: private, no-store`. Responses containing a draft or saved selection do not grant access to the underlying ticket.

| Operation | Contract |
|---|---|
| `GET /drafts/:ticketId` | Authorized operator's current draft, or 204 when absent. |
| `PUT /drafts/:ticketId` | New draft requires `expectedGeneration: null`, `expectedRevision: 0`; replacement requires the exact returned generation/revision. Conflicts return 409. |
| `DELETE /drafts/:ticketId?generation=…&revision=…` | Explicit discard or post-send cleanup removes only that exact instance/version. It does not send an article. |
| `GET /state` | Operator's scoped preferences. Inaccessible selected-ticket hints are cleared with a conditional revision update; concurrent changes receive bounded retry or 409. |
| `PUT /state` | Controlled preference schema with expected revision; no arbitrary JSON or caller-provided tenant/actor identity. |

A draft stores public/internal mode, at most 16,000 UTF-8 body bytes, up to ten validated attachment references, and a server-derived conversation sequence. Existing actor-owned tenant R2 objects are validated; blobs are not copied or deleted by draft cleanup. The base conversation sequence is preserved across autosaves. A zero sequence means no canonical revision was available; it must not be interpreted as proof that no conflicting activity occurred.

Draft generation is a server UUID; numeric revisions increase within it. Delayed save/delete requests cannot affect a recreated draft. Later composer integration must use the confirmed canonical article receipt before conditional draft cleanup. Cleanup failure must not falsely report that a confirmed send failed, and successful sending must not erase a newer draft.

Workspace state includes a bounded list query/anchor, controlled sort/filter fields, selected-ticket hint, panel preference and view identifier. The identifiers for All, Mine, Unassigned, Mentions, Drafts, Snoozed, Needs Action, team and custom views are preferences only: #130 owns their authoritative predicates/counts. Sensitive query/draft content belongs in scoped server storage, not URLs or long-lived browser storage. Referenced filter/group/assignee IDs are tenant-validated when saved.

Mutation bodies use the existing 64 KiB streaming limit and safe JSON parser. Invalid input returns 400, oversize input 413; no raw content is emitted into diagnostics. A save is acknowledged only after a returned database row proves the conditional write completed.

Retention duration remains an owner decision. The server has an explicit injected policy/clock seam; no production expiry duration, scheduler or cleanup activation is assumed. Cleanup is bounded and actor-scoped; cross-operator cleanup requires explicit system scope. No remote migration, database seeding or provider activation is authorized by this implementation.

Remaining full-issue acceptance: dashboard autosave/restore across navigation and reload, visible unsaved/conflict states, Drafts indicator/query, attachment and mode restoration, authority-change clearing, confirmed-send conditional cleanup, approved retention activation and complete end-to-end evidence. Existing UI and server tests do not substitute for those integrations.
