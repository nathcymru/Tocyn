# Operator capacity UI — partial #137 evidence

Scope: approved follow-up to [PR273](https://github.com/nathcymru/Tocyn/pull/273), based on merged `2d7c5c121f08dac62804fce58d5541bb2194bb6d`. Progresses #137; the issue remains open.

The existing account menu opens a read-only Current work dialog. Administrators can open one selected operator's capacity editor in Team Management; listing cards does not fetch individual capacity. Both use the existing admitted capacity API. No new self-write endpoint, presence inference, automatic assignment, historical scoring or routing algorithm is introduced.

The controller binds responses to authentication generation, tenant, actor and selected operator. A changed identity discards old reads/writes; selected dialog labels and forms are synchronously gated by captured identity, before passive cleanup. A conflict or unconfirmed write preserves entered values, requires a fresh policy read and requires explicit resubmission against its revision. Reload failure retains the form and exposes Retry. Count overflow is displayed as unavailable, including when the policy is unconfigured; 1001 is never presented as an exact total. Administrators may still configure a policy when the count is unavailable.

## Executed synthetic validation

- Dashboard suite: 49 files / 339 tests passed on Node22.19.0. Dashboard TypeScript/build passed. Existing Vite configuration/chunk warnings and unrelated simulator navigation warnings remain.
- Focused controller/panel tests cover old-auth GET, old-target GET, old-auth PUT, target/schema rejection, configured and unconfigured overflow, conflict plus failed reload and explicit fresh-revision save.
- Actual Layout and UsersPage integration exercises selected-only reads, read-only own view, admin controls, initial close focus, Tab/ShiftTab containment, Escape and opener return, and synchronous removal of selected content on direct tenant or actor change without a generation increment. These run in JSDOM with mocked API/users and visible-rectangle shims; they are not browser or spoken screen-reader evidence.

The new UsersPage test additionally scopes and restores a selector-order shim. An independent Node22/installed JSDOM29 reproduction with `button#first`, `select#second`, `input#third`, `button#last` returned `[third, second, first, last]` for Ark's mixed focusable comma selector rather than document order `[first, second, third, last]`. The shim sorts only comma-selector results by `compareDocumentPosition`, restoring the browser's document-order guarantee. Production Ark focus logic is unchanged. Actual browser validation remains necessary.

## Remaining acceptance

Explicit availability leases/presence rules, automatic routing, fairness/tie-breaks/fallback, complete queue/SLA integration, real browser/assistive-technology acceptance and local B2 release acceptance remain. Backend migration/backfill and inherited storage-admission release gaps from PR273 remain separate. This UI does not establish overall #137 completion or remote production readiness.
