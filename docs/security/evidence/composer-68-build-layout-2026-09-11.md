# Composer build layout — 11 September 2026

The production dashboard retains the full editor, language grammars and safe preview. Native Rolldown chunk priorities give the static application entry and its dependencies first ownership; icons and workspace hooks remain shared, and related administration pages share a lazy chunk. This prevents shared login/query dependencies from pulling administration pages into the initial download.

Measured from freshly built clients with Node 22.19.0 and the repository snapshot tool (gzip level 9):

| Dashboard resource | Measured bytes | Existing ceiling |
| --- | ---: | ---: |
| All JavaScript | 567,028 | 570,000 |
| Initial JavaScript | 99,178 | 135,000 |
| All CSS | 15,603 | Unchanged policy; final CI verifies |

The initial graph consists of the entry, runtime and static entry closure. Ticket detail, Markdown editor and administration page code remain lazy. All three client builds succeeded. The combined production browser suite passed 5/5 in 46.43 seconds: composer, two durable-draft scenarios, SLA and support-state recovery. No feature, grammar, target-browser or budget changes were made. Final browser and required CI timing/resource evidence must be read against the submitted revision before integration; the table alone is not full acceptance.

Rejected approaches included minifier settings, broad vendor/route grouping, partial ownership of shared authentication dependencies and an editor entry-point substitution. Some improved total bytes while worsening initial bytes. The lighter editor entry would remove highlighting behavior and was not adopted. The retained layout assigns the entire static dependency closure, rather than selecting shared dependencies individually.

Earlier 569,508-byte measurements used Node 26 gzip and must not be compared with Node 22 CI. The pre-correction Node 22 artifact measured 573,414 bytes. Build and compression runtime must match when comparing evidence.
