# Documentation accuracy and diagrams

Apply this rule whenever a task changes README, `docs/`, Wiki source, public project-page copy, ADRs or policy documentation.

## Architecture authority and delivery evidence

- Product/architecture overview pages must explain **what Tocyn is**, then its **approved target architecture**, then **delivery/implementation status**. The principal diagram represents the approved target; a current-state topology is a separately labelled supplement.
- Accepted roadmap issues and ADRs establish architectural truth; code/configuration establish implementation state; actual environment verification establishes deployment evidence. Current code must not silently redefine the approved end state.
- Keep approved channels, headless/browser-runtime separation and asynchronous/service responsibilities in the target model even when their implementation is pending. Label them explicitly **Approved / planned** or **Not yet implemented**; release sequencing does not remove them from the architecture.
- A missing binding is evidence about the current runtime, not a reason to omit an approved target component. Do not invent a Worker count, binding/RPC topology or architectural decision where the approved contracts leave it open; identify that boundary and its source.
- Preserve working badges, sponsorship/contributor additions, links and unrelated accurate material during targeted corrections.

## Status accuracy

- Ground current-state claims in the repository/configuration being changed.
- Label future approved work **Approved / planned** or **Not yet implemented**; do not turn roadmap intent into a deployment claim.
- Preserve historical material as historical evidence rather than silently rewriting it as current authority.
- Keep Tocyn documentation Tocyn-specific. Do not import assumptions, architecture or policies from unrelated repositories.
- When a capability depends on a third-party provider, distinguish Tocyn code support from provider configuration/deployment status.

## Mermaid diagrams

Use Mermaid only when a diagram materially improves a relationship, process, hierarchy or timeline that is harder to understand from prose alone.

Follow the GitHub Docs diagram principles: decide audience/scope first; use flowcharts for processes, block/flow arrangements for architecture, hierarchy diagrams for categorisation and Gantt only for genuine timing/overlap; keep diagrams maintainable and avoid decorative complexity.

Every diagram must have prose that conveys the same important information. A reader who cannot render or visually interpret Mermaid must not lose architecture, security or procedural requirements.

Do not put secrets, tenant/customer data, real credentials or sensitive internal identifiers into diagrams.

Reference: https://docs.github.com/en/contributing/writing-for-github-docs/creating-diagrams-for-github-docs

## Link and asset hygiene

- Prefer repository-relative links inside repository Markdown.
- Use canonical assets under `public/`; do not add loose root duplicates to satisfy a document path.
- If moving an asset/document, search repository and Wiki-sync source for every reference and update it in the same PR.
- Broken links or stale screenshots/images are documentation defects, not cosmetic follow-up.

## Privacy/legal material

Privacy/security documents must distinguish technical controls from legal conclusions. Do not claim that installing Tocyn, using a feature or adding FidesLang metadata automatically creates GDPR compliance. When legal/regulatory examples are time-sensitive, link current regulator guidance and label examples as technical guidance rather than legal advice.
