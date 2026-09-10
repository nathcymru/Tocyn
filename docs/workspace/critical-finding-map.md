# Critical finding map

Each source Critical finding is mapped to a named workspace surface and state. A map entry is a test obligation for the later implementation; its presence does not claim the current beta passes.

## Laws

| Finding | Named surface/state and required evidence | Owner links |
|---|---|---|
| LAW-04 Cognitive Load | Default workspace with healthy transport quiet, one global search, progressive context, Focus mode and durable activity; inspect loaded, active, interrupted and degraded states. | #128/#131/#132/#133 |
| LAW-07 Flow | Conversation list + active conversation during select, next/previous, resolve-and-advance, snooze-and-advance and failed mutation; view and anchor remain. | #128/#129/#130/#71 |
| LAW-10 Jakob's Law | Inbox/work-view navigator + conversation list + active conversation + context; Table mode explicitly secondary in mode switch and deep link. | #128/#135 |
| LAW-14 Mental Model | Active conversation header/action bar state presents conversation and next action as principal; metadata is contextual. | #127/#128 |
| LAW-15 Working Memory | Work view, filter/sort, selection, list anchor, panel and draft restoration after switch, reload, interruption and authority change. | #129/#132 |
| LAW-19 Selective Attention | Default healthy state, routine activity, genuine failure/SLA breach and Focus mode; only configured high-value events interrupt and all remain durable. | #133/#132/#73 |

## Competitive gaps

| Finding | Named surface/state and required evidence | Owner links |
|---|---|---|
| COMP-01 Persistent inbox + active conversation | Desktop/medium workspace and mobile list/conversation pane; selection changes conversation without destroying navigator/list. | #128/#48/#66 |
| COMP-02 Queue position/context | Work-view state during selection, deep link, Back, reload and authority change; exact query/sort/anchor restoration. | #127/#129/#71 |
| COMP-05 SLA visibility | Conversation row and compact action bar in normal, near-due, breached, paused and waiting states; full clocks/calendars/pause/resume remain #73/#137 release requirements. | #73/#136/#137 |
| COMP-06 Snooze/resurface | Work actions and Snoozed/Needs Action views across snooze confirmation, scheduled resurface, missed/changed due time and audit. | #130/#63/#73 |
| COMP-13 Customer 360 context | Collapsible Customer context with verified tenant-scoped identity, previous conversations and operational slots; loading, unavailable and unauthorized states do not leak data. | #134/#74/#75 |
| COMP-14 Omnichannel workspace | Active conversation/composer capability states for each authorized channel; channel restrictions are contextual and no channel creates a parallel inbox. | #49/#53-56/#89 |

## Cognitive accessibility

| Finding | Named surface/state and required evidence | Owner links |
|---|---|---|
| COG-01 Persistent orientation | Global nav, work-view navigator and active conversation on desktop; mobile Back returns through panes with exact state. | #128/#132 |
| COG-02 Recognition over recall | Selected work view, inclusion reason, query/sort, selected row and restored anchor visibly identified. | #129 |
| COG-03 Working memory | Conversation header/action bar names who, what, why attention is needed and next due/action; grouped lifecycle/ownership/SLA. | #128/#136 |
| COG-04 Progressive disclosure | Conversation first; Customer, Collaboration, Knowledge, QA, AI and technical details in collapsible named Context regions, with remembered panel state. | #128/#134 |
| COG-05 Low interruption | Activity centre/read state plus configured interruption policy in normal, routine realtime and critical failure states. | #133 |
| COG-09 Clear primary task | State-appropriate primary action in action bar/composer; rare actions under More/context; no equal-weight action wall. | #127/#128 |
| COG-10 Manageable content | Desktop/medium/mobile compositions with one primary reading surface, collapsed context and density modes. | #128/#132 |
| COG-11 Resumability | Drafts, Snoozed and Needs Action views; resume after switch, reload, interruption, send failure and scheduled return. | #129/#130 |
| COG-12 Externalized task management | Work-view navigator, waiting reason, due/next action, SLA and durable Activity states; no future work held only in memory. | #130/#136/#73 |
| COG-21 Sensory hierarchy | Salience states for selection, primary action, error/SLA breach, ordinary metadata, healthy diagnostics and Focus mode; colour/motion are supplementary. | #132/#133/#66 |

The non-critical/high findings remain owned by their explicit successors in the master traceability ledger. COG-22 error tolerance is a strength and is a non-regression requirement, rather than being treated as a closed Critical finding.
