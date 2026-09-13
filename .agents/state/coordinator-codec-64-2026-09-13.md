# Coordinator amount/proof dictionaries — 13 September 2026

Progresses #64. This bounded storage change preserves the existing grant, authority,
accounting, replay, expiry and recovery contracts. It does not complete #64 or clear
Beta2 release acceptance.

Format 3 interns identical resource maps and certified completion digests separately
inside each owner-ingress/tenant state. There is no cross-tenant dictionary. Amount
keys are sorted for exact value comparison; missing dimensions and explicit zero
remain distinct. Every decoded envelope, remaining and accounted map is a fresh
object. Dictionary and allocation references must be safe, in-range integers; table
sizes, resource keys/units and certified digest syntax are bounded and validated.
The actual raw legacy representation and format 2 remain readable.

The standalone packed grant byte estimate and recovery-headroom calculation are
unchanged and conservative. No grant or accounting field is discarded by this
extension, no TTL is shortened, and no active scope is evicted. Existing format 2
normalizations (including absent compacted becoming false and certified proof
compaction) remain the baseline.

## Evidence

Fourteen codec tests cover raw/format-2 compatibility, state roundtrip, independent
amount objects, tenant-local tables, missing-versus-zero distinctions, malformed
references/maps, reverse-order multi-dimension reservation and reconciliation replay,
certified replay/mismatch/expiry, charge rollups and unchanged standalone grant sizing.
All 877 ordinary server tests pass, together with server types and focused ESLint.
The three existing real coordinator cases and the native byte-capacity/accepted-grant
recovery case pass. These are deliberate specialist checks, not new routine CI gates.

The prior isolated persistent journey on merged #284 completed 20 creates, 20 paced
public replies, 60 navigation reads and shell checks, but refused update 19 after
18 successful updates. At refusal, 60 scopes and 40 empty entries remained, with
20 holders and no unknown/in-flight cache operations. Coordinator state occupied
88,683 bytes plus 33,488 reserved recovery headroom: 122,171 of 122,880 bytes.
A same-envelope pure reservation reconstruction passed resource/count checks but
projected 123,578 bytes including headroom. No compacted record was already expired
at the last authority timestamp; premature pruning was not a valid remedy.

The equivalent codec fixture passed all 20 updates. Support-state changes 1 and 2
also passed; change 3 was refused at the unchanged 64 active-scope ceiling. It had
42 empty entries, 22 holders, 38 committed and zero unknown/in-flight operations.
Coordinator state retained 100 records (78 compacted, 22 unfinished), occupying
74,517 bytes plus 35,545 recovery headroom: 110,062 of 122,880 bytes, leaving 12,818.
This establishes a separate remaining scope boundary; the full twenty-ticket
support-state journey is not accepted.

Both fixtures used separate synthetic persistent storage, unchanged policy/guards
and a local capture transport, and were disposed after the first refusal. User
previews, providers and existing stored liabilities were not changed. Initial test
launcher/config-path errors were corrected without application changes.

GPT retained codec/accounting decisions and actual native execution. A peer supplied
a bounded key-order review and the multi-dimension replay test suggestion; no Copilot,
private cloud disclosure or new graph crawl was used. Progress weighting and release
acceptance remain with the coordinator.
