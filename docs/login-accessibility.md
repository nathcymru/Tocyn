# Login accessibility — partial #21 implementation

This slice covers the existing dashboard password/MFA pages and portal login/code
verification pages. It adds associated labels, selected login-method state, input
completion hints, inline error associations and live progress/status semantics.
Pending portal requests retain their submitted email and login method: the email
is read-only and method controls remain focusable with guarded handlers. The portal moves focus to its success heading when the request form is replaced.
Submit controls stay native and focusable while unavailable; matching handler
guards prevent invalid or repeated pending requests. Styling remains static CSS.

The existing credential submission, password-to-MFA navigation, single-use magic
link handling, OTP challenge state, cookie/token persistence and authenticated
navigation remain the owning authentication implementations. No API Worker,
authentication-store, app-shell, queue or conversation detail change is included.

## Executable evidence

From the repository root with Node 22:

```sh
npm exec --workspace=apps/dashboard -- vitest run src/__tests__/LoginAccessibility.test.tsx
npm run test --workspace=apps/portal
npm run lint --workspace=apps/portal
npm run build --workspace=apps/dashboard
npm run build --workspace=apps/portal
```

At this source checkpoint, four new dashboard cases and all 19 portal cases pass,
including six new portal accessibility cases and existing real-router magic-link,
OTP and login regressions. Both frontend builds and portal lint pass. Component
checks assert accessible names, selected states, associated errors, pending status,
focusable submit controls, retained form data and one request while pending. They
also preserve the successful password-to-MFA route. They do not prove actual
browser focus, speech, human screen-reader usability or final computed contrast.
The dashboard test command is explicit until #93 PR115's package test
script is integrated; no competing package or workflow edit is made in this slice.

No live API/provider requests, fixture rows or R2 objects are created by these
component tests. Mock request assertions verify repeat-pending activation adds no
request and rejected authentication retains the entered data for recovery. This
is component resource evidence, not a live runtime measurement.

## Remaining acceptance

Issue #21 remains partial. Integrate accepted #61 session/verification changes and
#62 operator workflow changes, preserve their navigation tests, then check the
whole included login/session, create/history/reply, queue/detail/composer,
assignment/state, error/dialog and required security-configuration journey.

Actual browser keyboard/focus, computed state-specific contrast and actual
screen-reader observations are still required. A live region in DOM/AX is not
proof that a reader announced it. The separate #93 new-pagination reader criterion
also remains open until evidenced; it cannot be closed by deferring it to #21.
No native OS permission or VoiceOver setting was changed for this slice.

Before final acceptance, exercise successful and failed login/MFA/OTP, expired or
revoked sessions, captured-mail failure, and two-tenant isolation on the integrated
local revision. Record actual announcement/focus outcomes, resource counters and
recovery behavior without credentials or message contents. Existing broad workflow,
production and beta gates remain applicable.
