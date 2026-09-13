# #130 funded unattended due preparation — partial

Owning issue #130; root-approved local-only conservative contract. Source base20d396de. New repository/adapter has no application caller, timer, public route or production scheduled activation. Existing index.ts guard remains unchanged. Fixed trusted synthetic tenant catalogue composition is pending. Original due functional2case acceptance remains separate; no rerun claimed.

## Implemented draft

0078 creates one monotonic checkpoint per tenant; no TTL/reset and no ticket-delete cascade. Same expected generation can advance once. Original candidate revision/deadline and exact original grant identity commit with canonical support_state_events, stateCAS and existing budget_grant_operations. Fresh funded read returns latest checkpoint/counter; superseded generations never repeat old mutation. Lost/unknown original work remains fully charged: no reconstructed terminal certificate or refund.

Read intent binds tenant/readUUID/purpose; advance binds tenant/generation/stepUUID/dueThrough/activeSnoozeSnapshot. Repository independently verifies exact fingerprint, operationId, purpose and candidate operation envelope including existing warm controls before SQL. Input and envelope overflow reject before database work. Adapter fails closed absent combined admission; systemprincipal is exact scheduled-snooze-resurface, not a session impersonation. Generic BudgetGrantRecoveryService credential-object authorization accepts that principal and exact tenant/key/snapshot; callback only receives cache-produced quiescent sealed proof. It never constructs proof from restart journal. Existing2operationattempts/2grantrecoveryattempts retained. One-operation block selection retains full liability; no scope eviction.

## Candidate resource inventory — not accepted numeric clearance

Checkpoint/counter sizing read:2tenantPKqueries under an independent already-admitted read, plus currentpolicy assertion and exact2-statement ledger. No unmetered pre-admission counter read, global catalogue discovery or arbitrary tenant sponsorship. Initially new-work; explicitly classified retry read recovery-purpose. Recovery-purpose reads do not mutate snoozes. A later initial/advance admission remains new-work.

Advance: policy assertion +ledger; population/generation assertion; one indexed duecandidate/checkpointupsert; checkpointchanges assertion; one canonical audit; auditchanges assertion; exactticketPKstateupdate; statechanges assertion; finalcheckpointPKread. UPDATE includes ticketPK restriction so nonsnoozed/legacy ticket population is not scanned. Current0067 COUNT trigger visits all active snoozes, and the guard funds/checks that actualN.

Dynamic guard: PKcounter exactlysnapshotN, actualtenant/snooze index probe LIMIT N+1 equalsN in samebatch before mutation. Under/overcount or concurrentgrowth rollsback; no total-ticket20 or invented active100/256cap. Validatedsafeinteger N and checkedN+1; candidate readcost5380+8N rejects overflow beforeSQL. Owner/tenant finite allocations must fund this amount beforeactualprobe.

Derivation:4096fixedpolicy/snapshot margin +2deliveries×(512fixedassertion/indexmargin +2(N+1)sentinelindex/rowvisits +2Ntriggercount +128candidate/checkpoint/auditFK/resultmargin). Candidate128writes=2×64 allowing assertionjournal/checkpoint/audit+indexes/stateindexreplacement/schedulerprojection work. Candidate8192d1StorageBytes allows bounded160byteIDs,24byteclocks, checkpointdelta/audit/journal/index overhead. It is provisional: exact nativeD1 read/write/index and byte inventory must validate before root approves activation. Checkpoint overwrite does not erase ledger/audit storage liability. Readcandidate4096reads/16writes/8192storage retains conservative journalgrowth.2detachedcompositions reserve128diagnosticevents; worker2 plus existingwarmcontrols, existingcoldallocation/recovery charged separately. Whole-stateDO/control bound remains an explicit native gate, not proven by these SQL units.

## Actual checks and limitations

Node22 focused validator+intent27/27 passed.18validator cases include root-reviewed corrections to truncated free-cloud proposal (uppercaseUUID needsletters; invalid leap date/offset/overflow). Cloud605in800out plus572in650out were proposals, not executed evidence or independent approval. Local worker refused3.23GiB available vs4GiB guard; no override.

PureSQLite8population/index proposal cases passed, followed by6actualrepositorySQL/0078 cases with real0067trigger in simplified relational fixture; latter preserved as opt-in scripts/snooze-due-checkpoint-sql.test.py. These do not claim nativeD1/currentpolicy/ledger/restart acceptance. Servertypes and scopedlint recorded at intermediate source; final draft checks reported in PR.

Remaining essential work: root final resource/security review; actualnativeD1+DO admission/rollback/chargedrestart proof; bounded fixedcatalogue composition and unattended localtimer only after approval; same-store migration rehearsal and actual dueUI acceptance. Production schedule guard, providers, release and full #64 clearance unchanged. No Closes/#130completion or Beta2 issuance claim. No Copilot requested; maintain manual-only triggers. Progress/baselines preserved pending defensible complete acceptance weighting.

## Native checkpoint evidence

One isolated realD1/DO fixture passed in2.47s, all migrations including0078 and0067COUNT trigger,37active tenantA snoozes and same-ID tenantB sentinel. Funded read observed34reads/5writes; one advance atN37 observed128reads/17writes; post-isolate-reload recovery read36reads/4writes. These include instrumented returned D1 metadata, not CPU/provider billing. All fit provisional read/write amounts. ActualN37 demonstrates no invented20ticket cap.

Stale generation and changedN roll back with no extra event; other tenant remains snoozed; current allocation revocation between admission/batch writes no operation journal. Synthetic lost response marks original unknown, then Miniflare reload preservesD1/DO but loses cache; fresh recovery-purpose read returns samecompletedstep with distinctreservation. Original centralreservation remains accounted exactlyfullenvelope and has no reconciliation/certifiedstatus. Two canonical events remain, no duplicate from replayread. This proves conservative retained liability, not no-charge replay.

Fixture corrections: neutralbuild needed existingnodecryptoexternal; diagnostic uses inspectForTrustedRuntime; D1stub reacquired afterMiniflare reload. D1 rejects page_count diagnostic, so it was removed without changing application guards.8192storage amount and whole-stateDO control bounds remain unmeasured/unaccepted; empty/future functionalSQL cases are priorSQL evidence, not additional nativeclaims. No expensive exhaustive matrix, productioncaller, timer, provider or sharedpreview request. Specialist script is opt-in only, no routineCI job added.


## Root-reviewed local resource contract

Due-only assertion now enforces160UTF8bytes for journaled identities and rejects envelope keys outside29catalogue dimensions. Bounded JSON maximum992bytes; logical record/index inventory6322bytes leaves1870margin in8192 allowance. This is logical retainedstock, not physicalpage/providerbilling clearance. Two sameoperation deliveries cannot add duplicate committedcheckpoint/event/journal; separately admitted restartread pays its ownstock. Production42 remains separate.

Duebusiness adds512doRowsRead+512doRowsWritten as deliberate conservative overreservation for atmost4coldRPCs withmaxblock1, retaining genericcold8extra. Existing catalogue dimensions continue to mean rows; no new1KiBunit is declared. Existing aggregate120KiBencodedcap+8KiBheadroom and generic recovery768allowance remain unchanged. SQLiteKVbilling must not be conflated with legacyKVbyte-unit pricing. Root approved this isolatedlocalcontract; timer/catalogue invocation and activation still await review. NativefunctionalSQL unchanged; only focusedbyte/key/supplement tests and types rerun.

## Trusted local runner preparation

Added trusted runFundedLocalSnoozeStep composition (local+LOCAL_BETA_ENABLED true only), private scripts/snooze-due-local-entry WorkerEntrypoint RPC and host-only local-snooze-controller. No app proxy route, production scheduled change or sharedpreview activation. Private HTTP always404; host gets serviceRPC through Miniflare getWorker. Catalogue comes only from frozen privateharness binding and host configuration, not publicrequest identity. Eachcycle fundsread, skipsadvance onlyN0, otherwise funds atmostoneadvance. Initialfreshread newwork; same-store restartfirstread recovery. Workerfunction has no HTTPmiddleware/completionlogging; deliberateWorker/diagnostic allowances remain conservative, notprovidertransportusage.

Controller has oneglobalflight; schedules60000ms AFTERcompletion with no catchup and fixedtenantorder. It persists bounded running/purpose/status beforeRPC. Unknown newwork permitsone nextfundedrecovery read; failed/unknownrecovery pauses. Pausedmarker survivesrestart; unreadable/missingrestartmarker pauseswithoutoverwrite/reset. Explicitresume is serialized and selectsrecoverypurpose. Dispose cancelstimer, waitsownedflight, andpreventsnewRPC. Hostmarker isprivateboundedmetadata, no ticketcontent/credentials. Root reviewed entry/marker/error logic with no blocking finding. A recovery-purpose read may be followed by a separately new-work-admitted fresh advance after its known snapshot; this never replays an old intent or certifies unknown work.

Actualtests:3hostcontroller tests pass (flight/schedule/dispose; unknown→recovery→persistedpause/restart/explicitresume; unreadablemarker); one newnativeprivateRPCtimer fixture passes2.48s withrealD1/DO: HTTP404, outsidecataloguedenial, futureemptytick thenone dueevent/one remaining snooze, disposalblocksnextcallback. No new ordinaryCI nativejob. ExistingSQLrace nativeproof reused. Final same-store0078rehearsal/rootUI/promotions remain separate andunexecuted.

Latest-main integration on0d687c applies the exact reviewed17-file packet without conflicts. Integrated server/runtime types pass; both native fixtures rerun serially and pass2/2 (5.45s total). Guard30units and host3tests remain distinct passing checks, not part of the native count. Same-store rehearsal/activation and browser acceptance remain pending.
