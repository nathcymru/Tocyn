# Operator draft and workspace storage contract

Status: partial #129 delivery accepted in PR #173, signed main `33dfe0b`. Server storage, composer integration, list preferences and Draft indicators are integrated; selected-ticket/panel interactions and retention remain pending. This increment does not complete #129 or enable beta.2. The [operator workspace contract](operator-workspace-interaction-contract.md) remains product authority.

All routes are under `/api/workspace` and inherit current dashboard authentication, session-version checks, MFA, staff role and tenant scope. Tenant and operator come from verified scope, never request fields. Ticket access is rechecked, including agent group membership. Workspace responses are marked `Cache-Control: private, no-store`. Responses containing a draft or saved selection do not grant access to the underlying ticket.

The authentication user response includes the server-verified `tenant_id` needed to partition transient client controllers. Existing browser sessions created before this response correction need a fresh sign-in; automatic refresh of older persisted profile payloads is not implemented by this increment. A client tenant field never authorizes a server request.

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

PR #173 integrates the composer and a body-free Draft indicator, with server-backed list search/filter/page preferences. Selected-ticket, panel and future view/sort fields are preserved by the preference contract; preserving fields is not evidence that every corresponding workspace interaction is implemented. Full Drafts-view predicates and layout remain #130 ownership.

The [local browser receipt](../evidence/operator-drafts-local-2026-09-11.tap) covers body/internal-mode/attachment restoration after reload and ticket navigation, visible save failure, blocked navigation and retry, plus wrong-tenant absence through the application routes. The harness runs the application in Node with real locally issued MFA sessions and disposable Miniflare D1/R2 resources; it is not a workerd-hosted application or deployed-runtime test. It initializes the guarded local-beta policy with exactly two tenants, four invitations and bounded ticket/mutation/upload limits. Save failures are explicitly injected at the loopback forwarding boundary. The receipt preserves its actual dirty-source revision and built artifact hash; required CI reruns this harness against the submitted revision.

The local-beta profile admits only the specified workspace route/method combinations. Successful draft/state CAS writes and versioned deletes use atomic admission and mutation-budget statements. Same-content saves advance revision and therefore charge; stale CAS attempts do not write or charge. Stopped writes remain denied. This does not activate an external environment or remove other beta restrictions.

After an acknowledged article creation, a failed draft deletion offers a cleanup-only retry and prevents a second send from that mounted composer. It does not provide durable article idempotency across reload or resolve an uncertain article response; collision/retry work remains required under #131. Conditional cleanup cannot erase a newer draft. Remaining full-issue acceptance includes complete preference interactions, final candidate browser/CI evidence and the explicit retention decision/activation. No retention default is assumed.


## Drafts-view query input

`GET /api/workspace/drafts?after=<ticketId>&limit=<1..50>` returns only `{items:[{ticketId,updatedAt}],next}`. It uses stable ticket-ID keyset pagination; the continuation is the last returned authorized ticket ID. No message body, attachment metadata or other operator state is included. The query joins tenant-qualified tickets and checks current group membership for agents before returning rows, in addition to the enclosing live authenticated dashboard boundary. Empty results do not reveal hidden drafts. This supplies #129's query input; #130 still owns the complete workspace view semantics and UI.

Repository integration covers two tenants with colliding identifiers, two operators, revoked group access and bounded pages. Real local Worker route tests cover no-store responses, body-free shape, missing/revoked credentials and wrong-tenant empty results. No remote resource is used.
