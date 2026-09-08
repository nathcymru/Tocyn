# Workflow: issue delivery

## Start

1. Read the current issue and dependencies.
2. Confirm the issue is unblocked and inspect active PRs/branches.
3. Record Project `In progress` and `Actual start` if available; do not change baseline dates.
4. Create/reuse one dedicated issue branch.

## Implement

5. Stay within the issue's approved outcome.
6. Run focused tests first, then broader affected checks.
7. Keep commits coherent; do not create progress-only commits.

## Deliver or hand off

8. Full delivery: open/update a ready PR using `Closes #NN` only if all acceptance criteria are expected to be satisfied by the PR.
9. Partial delivery: open/update a draft PR using `Progresses #NN`; state exactly what is done, what remains, checks run and blockers.
10. Do not start a separate PR merely because an agent session is ending if an existing issue PR can carry the work.
11. Do not close the issue until integrated evidence satisfies all acceptance criteria.
