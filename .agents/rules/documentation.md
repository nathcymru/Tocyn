# Documentation accuracy and diagrams

Apply this rule whenever a task changes README, `docs/`, Wiki source, public project-page copy, ADRs or policy documentation.

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
