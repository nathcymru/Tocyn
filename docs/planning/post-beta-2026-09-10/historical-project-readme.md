> Historical evidence, superseded by [current master baseline](README.md).

# Tocyn delivery roadmap

The approved planning baseline is preserved: first private beta **21 November 2026**, support email **4 February 2027**, autonomous reference workflow **23 June 2027**, scoped roadmap completion **16 July 2027**. These are forecasts, not releases or production commitments.

## Reading the views

00 shows dependency-critical work; 01 uses the authoritative `beta-blocker` label (exactly #19, #20, #21, #57–#63, #65, #93). Views 02–04 provide detailed, quarterly and overview roadmaps. Views 10–17 show Phase → Milestone → Issue. The original Monthly roadmap, Quarterly roadmap and Backlog views are preserved.

Baseline start and Baseline target retain the original approved schedule exactly. Roadmap bars use Forecast start and Forecast target; forecasts currently remain the approved baseline except for the separately tracked unbaselined #96. Planning effort (h) is the accepted baseline estimate multiplied by three. Workstream W1/W2 is a capacity forecast, not ownership or a requirement for concurrent review queues. #49 is Shared / Tracker and Cross-roadmap with no milestone. Closed #13 and #15 retain historical status and milestone context, with no invented dates or effort.

## Critical-path calculation

Snapshot: 8 September 2026. All 125 native blocked-by edges across the 58 scheduled open issues were read back and verified against the approved schedule. No dependencies were modified. Each issue duration is its approved 3× planning hours. A forward pass computes earliest start/finish; a backward pass computes latest start/finish against a common zero-duration analysis-only terminal joining all terminal roadmap outcomes. No synthetic GitHub issue is created. Total float = latest start minus earliest start. Critical = zero float; Near-critical = positive float at most 48 productive hours (one Monday–Saturday planning week); Supporting = greater float. Already completed #13/#15 are historical and outside the remaining-work calculation.

The dependency-only longest path is **852 productive hours**. This is an analytical duration, not a replacement completion forecast: the approved calendar incorporates two bounded workstreams, shared review/integration capacity and integration holds. Critical-path fields do not remove these resource constraints or imply that supporting work can be delayed without checking capacity. Optional integration holds are not invented native edges. Beta readiness remains separate.

### Exact critical network

Common prefix: #20 → #57 → #58 → #19 → #59.

Two equal-length branches then converge at #80:
- #59 → #60 → #93 → #64 → #80
- #59 → #63 → #79 → #80

Common suffix: #80 → #81 → #83 → #82 → #84 → #85.

Thus both complete prefix/branch/suffix sequences are critical. Native transitive prerequisites are retained even where omitted from this minimal path presentation. Near-critical: **#78**, 48 productive hours of total float. All other scheduled issues are Supporting.

## Baseline and hierarchy

The [approved architectural roadmap](https://github.com/nathcymru/Tocyn/wiki/Approved-architectural-roadmap) remains the detailed schedule and policy record. Native parent/sub-issue relationships are preserved. Group counts and hours are not percentage completion. Do not drag bars to revise dates without a separately approved reforecast.

GitHub has Month, Quarter and Year zoom, with no dedicated six-month zoom. The 6M Overview uses Year as the native low-detail approximation; no external Gantt, fake beta issue, release or tag is created. The first-beta milestone target already supplies the 21 November 2026 marker.


## Living delivery state — issue #96 finalisation

The existing Project was already public when this handover began. It contains only real issues from the public nathcymru/Tocyn repository and Tocyn-safe metadata. The isolated uploaded-assets PR #94 Project item was removed from the roadmap; the PR and its history are untouched. No private repository was linked and no repository visibility or collaborator permission was changed.

Baseline start/target are the renamed original Start date/Target date fields. They remain immutable planning evidence. Forecast start/target are current expectations. Actual start/completion require substantive-start and accepted-completion evidence. Progress is acceptance-based, never commit or elapsed-time based. Closed historical #13/#15 have 100% and verified closure dates; unknown actual starts stay blank. The original 58 scheduled issues retain their approved estimates and baselines.

**#22 evidence discrepancy:** GitHub records this issue closed on 8 September, but its latest substantive receipt explicitly calls PR #95 partial and says remaining launch acceptance keeps the issue open. This handover does not change its closure or dependencies. Project status records the evidenced In progress state, with Progress %, Actual start and Actual completion blank pending reconciliation of its multiple historical work periods and remaining acceptance. Forecast dates stay approved and variance is zero. Closure alone is not used to fabricate 100% completion.

**#96:** created after the baseline migration; no approved baseline or planning estimate exists. Leave Baseline start/target, Planning effort and Schedule variance blank. Actual start is 8 September 2026. Its forecast target is 8 September; final completion fields are applied only after Wiki and Project verification. It is outside duration-based CPM until an estimate is approved, rather than receiving a fabricated duration/classification.

Schedule variance is measured in signed Monday–Saturday working days, excluding Sundays, with no holiday calendar. Count working dates after the baseline target through the comparison date; reverse the sign when early. Use Actual completion only after accepted completion, otherwise Forecast target. No baseline means blank variance. Same date is zero. Eight productive hours constitute a working day; the approved 3× effort is unchanged.

CPM was recalculated against the current native graph: all 125 accepted edges remain unchanged; #22's recorded closure is not treated as accepted delivery without evidence. The two equal 852-hour dependency paths and #78's 48-hour float remain unchanged. Anchored to 8 September 2026 at 8h/day Monday–Saturday, the unconstrained dependency-only lower bound is **9 January 2027** (four hours on the last day). It differs from the approved **16 July 2027** scoped forecast because CPM does not model shared review/integration capacity, contention between two bounded implementation workstreams, or approved integration-only holds. No edges or dates were changed to force equality. Two workstreams are a capacity forecast, not continuous parallel review queues.

The added **05 — Schedule Variance** table groups by Critical path and sorts Schedule variance descending, so positive variance appears first within each class. Unbaselined/unknown acceptance remains visibly blank. Phase tables show progress, immutable baseline, forecast and actual evidence alongside the original roadmap fields. Dates are never changed by dragging bars during setup.

