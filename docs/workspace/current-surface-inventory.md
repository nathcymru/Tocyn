# Current beta surface inventory

This inventory is based on the current dashboard implementation. “Migrate” means preserve the underlying capability while changing its workspace location or interaction. “Replace” means the current composition is not the target. “Context” means it remains available behind an explicit contextual surface. “Retire” is after compatibility and acceptance parity.

| Current evidence | Disposition | Target contract / owner |
|---|---|---|
| `Layout.tsx`: 64px desktop icon-only rail and mobile navigation dialog | Migrate | Labelled expandable Global navigation with persistent preference; #128/#132/#71. |
| `Layout.tsx`: global `Search tickets...` input routes to `/tickets?search=` | Migrate | Search everywhere command/search; safe deep links and explicit scope; #131/#71. |
| `TicketListPage.tsx`: second `Search tickets...` input and seven-column table | Replace default; retain Table mode | Conversation list is primary; Table remains secondary for overview, bulk, audit and administration; #128/#135. |
| `TicketListPage.tsx`: filter chips, pagination, copy reference, row actions, loading/error/retry/empty states | Retain and migrate | Work-view/list contracts; copy and actions become labelled row/work actions; recovery behavior is a non-regression gate; #128/#130/#135/#140. |
| `TicketListPage.tsx`: `Link` to `/tickets/:id` | Compatibility-only, then retire | Opens `/inbox/:viewId/:conversationId` without losing view/query/anchor; #127/#128. |
| `TicketDetailPage.tsx`: full-page ticket header and “Back to Tickets” | Replace composition; retain data | Active conversation header plus compact work/action bar; Back follows workspace history and does not require reacquiring the queue; #128. |
| `TicketDetailPage.tsx`: message thread, pagination and attachment download | Retain and migrate | Active conversation surface; preserve channel semantics, pagination and authorization; #48/#68/#128. |
| `TicketDetailPage.tsx`: public reply/internal note toggle, attachments, send and visible retry | Retain and migrate | Shared Composer with durable drafts, explicit mode, status/retry and focus recovery; #68/#129/#140. |
| `TicketDetailPage.tsx`: per-message QA controls | Move to context | Knowledge/QA context or explicit moderation mode; keep attribution and authorization; #134/#63. |
| `TicketDetailPage.tsx`: duplicated presence/header viewers | Move to context; consolidate | One Collaboration context region; no duplicate presence or attention pulse; #134/#133/#70. |
| `TicketDetailPage.tsx`: `AI Suggestion` and separate `AI Auto-Draft` card | Migrate, then retire card | Human-led AI inserts previewed output into the existing composer/context; AI-off flow remains complete; ADR-0020/#68/#76/#77. |
| `Layout.tsx`: green healthy `Real-time` chip and latency/reconnect diagnostics | Context/diagnostics | Healthy transport is quiet; degraded state provides durable actionable recovery; #133/#159. |
| `Layout.tsx`: transient ticket toasts with 8-second timeout | Replace | Durable Activity projection; toast can mirror only; #133. |
| `DashboardPage.tsx`: “Welcome back to Luminatick” and pulsing Operational status | Replace/move | Tocyn workspace orientation and operator work/attention links; technical health belongs in diagnostics; #128/#133/#85. |
| `TicketDetailPage.tsx`: status `Pending` | Migrate terminology | Stable lifecycle plus explicit waiting reason, due/SLA and responsible handler; #136/#73/#137. |
| Existing error alerts, retry controls, public/internal distinction, attachment and audit paths | Retain | Required positive/negative recovery and tenant/actor isolation evidence; #60/#63/#70/#140. |

Migration rule: compatibility routes may remain until workspace parity, deep-link/back, draft, focus and failure evidence pass. No source surface is deleted as a shortcut for missing acceptance.
