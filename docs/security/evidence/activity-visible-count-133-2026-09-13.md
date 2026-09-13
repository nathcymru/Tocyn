# Activity visible count correction — #133 / #140

## Actual Safari finding

The coordinator observed merged668b6c99 on the preserved isolated candidate: assignment activity for synthetic ticket01 stayed unread across reload. Opening it navigated to ticket01 with heading focus and reduced unread count to0 while retaining the read item. One explicit Dismiss removed the item buttons, but the footer still announced “Showing1activity item.” After full reload the buttons remained absent and unread stayed0, yet that footer persisted. This is an actual presentation defect, not a change to the Activity API contract.

## Correction

The panel derives one nondismissed item list for displayed rows, empty state and announced count. Stored dismissed rows still count toward the existing bounded loaded-page cap and cursor handling. If only dismissed rows are loaded and another page exists, copy explicitly limits the empty statement to loaded items. Reaching the existing raw-row cap says the loaded activity limit was reached without claiming every loaded record is visible. No backend semantics, unread authority, mutation, pagination limits or candidate data changed.

## Related browser evidence and limitations

The coordinator also observed Customer verified identity/history and the absent Operational context presentation. No successful knowledge insertion was demonstrated: the preserved cold fixture had no knowledge documents, and the existing local guard exposes no knowledge route. No spoken VoiceOver output, full keyboard-only acceptance, complete #133/#134/#140 acceptance or release clearance is claimed. The protected ticket03 draft and existing candidate are preserved.

## Validation

Two focused retained-dismissed-record regression cases cover empty and mixed visible lists. Initial Layout suite:22/23 passed; the pre-existing labelled-navigation shortcut test failed its focus assertion outside the count assertions; the cause is unconfirmed. An isolated rerun of that unchanged test alongside the two new cases passed3/3; dashboard TypeScript passed. Required exact-head CI/security and coordinator review remain mandatory. No native fixture or broad application rerun is introduced for this presentation correction.
