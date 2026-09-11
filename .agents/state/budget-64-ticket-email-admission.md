# #64 ticket email admission — PR #214

Base: accepted main 70b75aba7de8876328691d1c7f80664d34494974. Partial delivery only; #64 remains open.

One-shot public staff reply email is separately admitted after canonical persistence. Failure preserves the canonical reply, replay and internal notes do not resend, and local capture uses no external provider. Durable outbox/retries remain #88.

Coordinator review corrected two defects: a same-article attachment manifest could scan unbounded post-reservation growth; its actual SQL now uses the retention index and an eleven-entry rejection sentinel. A 6,000-attachment native regression failed before the correction and passes afterward. Send exceptions now settle the reservation as unknown, not committed.

Validation: dedicated native suite 9/9 and dedicated runtime typecheck passed after both corrections. Required CI now explicitly includes this suite and typecheck. Exact-head CI/security, review-thread resolution and signed accepted integration remain necessary. No Copilot review requested.

The ten-attachment successful delivery fixture observed 138 D1 reads, 94 writes and 20 R2 operations; these are local synthetic operation measurements, not provider billing evidence. No remote services were activated.
