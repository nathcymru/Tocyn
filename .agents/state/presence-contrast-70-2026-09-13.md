# Presence Viewing contrast — partial #70

Root measured actual candidate54737 at5988: Viewing10px/weight500 green600 rgb(22,163,74) on selected Light white yields3.2957:1, below normal-text4.5:1. System-dark slate900 yields5.4169:1. The adjacent viewer name passed dark17.06:1; this is not a whole-screen audit. W3C reference: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html.

This narrow static CSS change uses green700 (#15803d) in light for5.0156:1 on white, preserving green600 in selected dark for5.4169:1. It follows the actual data-tocyn-theme-mode attribute, including unsaved selected-Light previews, rather than OS-media dark mode. Adjacent Typing uses existing theme-mapped slate text, not this green; unchanged.

Four existing TicketDetailPagination tests, dashboard TypeScript and dashboard build pass. Deterministic sRGB luminance arithmetic recorded above; no mirror-class test or new browser run. One edited legacyCRLF line normalized to pass diffcheck. No broader contrast, spokenVoiceOver or full #70 acceptance claim. Existing306 candidate upgrade remains queued until reviewed combined code/assets; no live asset replacement here.

Progresses #70. Zero Copilot/model requests; manual triggers checked. Preserve Project weighting/baselines, root review and exact-head gates before merge.
