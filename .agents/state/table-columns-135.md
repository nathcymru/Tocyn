# #135 table column preferences — partial delivery

This checkpoint ports the per-operator table-column work from stale PR #313 onto the current Park/Panda foundation at `6b53ad5793f89218d54d7420e8e5e9aba0863670`. It does not carry the old PR tree or its pre-Park presentation code.

Operators can choose the visible Table-view columns and their order. Reference remains mandatory at any position and always links to the conversation, including when Subject is hidden. The controls use the current Park Button and Checkbox components, Panda layout tokens and Phosphor duotone icons. Keyboard reordering retains focus and announces the new position.

Migration `0083_operator_table_columns.sql` adds bounded `table_columns` JSON to existing version 2 presentation rows. The existing tenant/user key, foreign key, revision, timestamp and scalar preferences remain intact. Legacy version 2 writes omit the field without replacing an existing selection; old responses without the field receive the six-column default. Malformed present values fail validation. Presentation writes reserve an additional 512 D1 storage bytes for this field; other resource dimensions are unchanged.

Verification on 22 September 2026:

- dashboard preferences, column control and persistent Inbox: 79 tests passed;
- Node 22 migration and presentation/theme fixtures: 16 tests passed;
- Park foundation guard: 8 tests passed;
- icon and Phosphor accessibility guard: 14 tests passed;
- dashboard, server and shared UI typechecks passed.

Browser configuration/persistence and spoken accessibility acceptance remain pending. Bounded multi-select and bulk assignment/state/snooze/tag actions, mixed-authority results and retry/idempotency acceptance remain outstanding. This partial checkpoint does not complete #135.
