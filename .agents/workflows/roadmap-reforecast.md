# Workflow: roadmap reforecast

Use when an accepted delivery, blocker or scope decision materially changes timing.

1. Preserve `Baseline start` and `Baseline target` unless the owner explicitly orders a formal re-baseline.
2. Update `Forecast start`/`Forecast target` from current dependency and capacity evidence.
3. Record `Actual start` at first substantive work and `Actual completion` only on accepted completion.
4. Calculate schedule variance against baseline target in working days where tooling permits:
   - negative = ahead;
   - zero = on baseline;
   - positive = behind.
5. Follow native dependency edges forward. Update successor forecasts only where the changed predecessor actually constrains them.
6. Recompute/report critical or near-critical status when float changes materially. Never rewrite dependencies to make the schedule look better.
7. Add a short reason for every material forecast movement.
8. Treat roadmap dates as forecasts, not production commitments.
