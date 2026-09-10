# Tocyn approved master baseline — 10 September 2026

[Authoritative package](https://github.com/nathcymru/Tocyn/blob/main/docs/planning/post-beta-2026-09-10/README.md) · [calculated graph/forecast](https://github.com/nathcymru/Tocyn/blob/main/docs/planning/post-beta-2026-09-10/forecast.json) · [handover](https://github.com/nathcymru/Tocyn/blob/main/docs/planning/post-beta-2026-09-10/handover.md).

Beta.1 was accepted 9 September and published 10 September at signed `049ea82a02571681f834bcd87d43253603edf71f`, local-only synthetic two-tenant operation with captured mail. Production remains #42. Beta.2 requires #140, full #73 SLA and #137 ownership/routing.

Remaining calculated forecasts begin 11 September 2026: beta.2 18 February 2027; expanded roadmap 9 February 2028. Two reference lanes, 8h/day Monday–Saturday, 2.5× implementation + 0.5× shared review/integration at 4h/day. External waits are unknown. Actual agent concurrency may exceed two when independent. Historical baselines remain unchanged; Remaining planning effort (h) separates revised/split remaining scope from original Planning effort (h). #162 receives 8h base effort transferred from #85; #85 retains 16h remaining, while its old 24h base/72h planning history remains.

## Reading the views

00 is dependency-only criticality (zero float; near-critical ≤48h); resource contention is separately captured in forecast dates. 01 preserves the historical first-beta blocker view. 06 shows the beta.2 gate and its outstanding prerequisites. 02–04 are current remaining roadmap dates. 05 shows signed working-day variance. Phase views cover M0–M9. Group counts are not acceptance progress.

#22 is reopened because its substantive receipt records remaining administration acceptance. Completed beta issues stay closed. #141 is a capability-extension tracker, not duplicate implementation ownership. #126 owns this alignment; feature execution waits for its acceptance. Baseline and actual fields are evidence, not editable forecast substitutes.

Zero default Copilot requests. Standing owner PR-only review bypass applies after required CI/security/signing and substantive findings are satisfied. No production/provider activation or extra spending is authorized.

[Historical Project README](https://github.com/nathcymru/Tocyn/blob/main/docs/planning/post-beta-2026-09-10/historical-project-readme.md) preserves the preceding baseline and critical-path analysis; it is superseded for active sequencing.
