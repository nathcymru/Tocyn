# #64 support-state/SLA admission integration

Coordinator owns this candidate; it is not accepted. Worker a938c7044c87c87c82e5c80e5e480a553e44f12e was merged with PR #199 head6aeadf84 as7cd65cc. Current accepted main is101087423e56e20993342dcdf5934d95e69f3e5c (PR #198).

Six dashboard support-state/SLA writes gain current-authority admission and durable receipts through migration0049. A confirmed deactivation regression is corrected: waiting-to-working remaps atomically resume initialized clocks, close pause intervals and record the event. Indexed101-candidate gating prevents partial writes above the existing100-ticket limit. Native same-/foreign-tenant noise evidence measured5437reads/2810writes for one successful100-ticket remap; canonical1024write ceiling remains unchanged.

Worker validation: focused native11/11, budget127/127 and type checks passed before integration. Integrated server typecheck passed; broader native budget run is active at handle86537, log/private/tmp/tocyn-support-sla-integrated-budget.log.

**Pending correction before acceptance:** the operation reservation must cover both permitted attempts, including a first rolled-back batch. Single-success counts do not prove the complete retry envelope. A focused worker is preparing the correction and native failure/retry proof; root retains tree ownership until explicit transfer. No PR has been created for this candidate yet.

PR #199 remains in required CI run34598242014, watch13846. Expected reviewedhead6aeadf84f672d480ab7ac28fef775985b1918359, testedmerge d732288f765a99502daec54196e045dde1de30d8, identicaltree75981cbb96f697fae69d34984cfd93d1377ee1c6.

PR #198 receipt: https://github.com/nathcymru/Tocyn/issues/64#issuecomment-5634373049. Live Wiki d117ba3 Home matches accepted198source byte-for-byte. Inventory corrections distinguish accepted198 from pending candidates.

Next: complete retry correction, validate integrated source, publish one coherent PR, refresh against accepted199, verify exact required checks and signed integration using standing PR-only review bypass. No Copilot reviews or remote resources. Full64/130/140 remain open. No owner approval pending.
