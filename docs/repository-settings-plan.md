# Tocyn repository administration

Scope: nathcymru/Tocyn only.

## Verified on 7 September 2026

The original five active repository rulesets protect the default branch and release tags:

- Main integrity: PRs, conversation resolution, squash-only, linear history, deletion/force-push prevention; no bypass.
- Pull request review: one approval and stale/last-push review controls; administrator exception through PRs only.
- Signed main commits: verified signatures on the default branch, no feature-branch restriction or bypass.
- Required CI: Tocyn / lint, Tocyn / typecheck, Tocyn / build, Tocyn / test, Analyze (javascript-typescript), Analyze (actions), all bound to GitHub Actions app 15368; no bypass.
- Release tag integrity: block update/deletion of v* tags, no bypass.

The required CodeQL checks are supplied by GitHub's active default setup, observed on PR #23, not the inherited `.github/workflows/codeql.yml` advanced workflow. Keep default setup enabled unless its replacement is deliberately configured and the gate names are updated.

## Foundation complete

PR #23 merged through the protected squash path at `a949cfb812a43fce05e4155772f1822d923ac7b0`, with a verified signature. The required application checks and both default CodeQL language checks passed. Default CodeQL run [34108290848](https://github.com/nathcymru/Tocyn/actions/runs/34108290848) passed on main using `dynamic/github-code-scanning/codeql`.

The inactive inherited advanced CodeQL workflow has been removed. Default setup remains responsible for scanning JavaScript/TypeScript and Actions. The remaining checked-in CI workflow uses full commit SHAs for checkout and setup-node, a read-only token, hosted runners, and no persisted checkout credentials. The owner confirmed a selected-action policy allowing GitHub-created actions. Repository-wide SHA enforcement is explicitly deferred for the reported GitHub-managed workflow compatibility issue; this was not reproduced as part of the application review. Keep checked-in actions pinned.

## Settings confirmed by owner-run script

The owner supplied terminal output from 7 September 2026 showing successful writes and read-back verification for:

- Squash-only merge settings and automatic deletion of merged branches.
- Read-only default Actions token and Actions PR approvals disabled.
- Approval required for all external-contributor workflows.
- Dependabot alerts and security updates.
- Secret scanning, push protection and private vulnerability reporting.
- Immutable future releases.
- Repository topics, standard contributor labels and the built Pages homepage.

These are owner-run API verification results, not administration reads performed by the connector. The connector cannot independently inspect those administration endpoints.

## Community published

- [Welcome](https://github.com/nathcymru/Tocyn/discussions/32).
- [Roadmap](https://github.com/nathcymru/Tocyn/discussions/33).
- [New contributors](https://github.com/nathcymru/Tocyn/discussions/34).

The second script run confirmed the same posts already existed without creating duplicates. It published the five additional Wiki pages and preserved the owner's differing Home page. A differing Home page is a content-review item, not a failed Wiki push. Confirm that Home links to the five pages in docs/community-drafts/wiki/Home.md.

The owner reports completing Wiki collaborator-only editing, Discussion category setup and pinning Welcome/roadmap. Those UI settings have not been independently read back.

Milestones v0.1.0 and v0.2.0 are assigned to the corresponding issues. Email migration issue #18 is now assigned to v0.3.0 - Omnichannel Configuration & Expansion. Do not create duplicate milestones. The FidesLang objectives remain in issues #16 and #17.

Versioned documentation remains authoritative. Use the Wiki for navigation and onboarding, and accept documentation changes by PR. Only label genuinely small, explained tasks as good first issues.

## Remaining checks

1. Keep repository-wide SHA enforcement deferred until the reported managed-workflow incompatibility is resolved and verified; do not turn it on as part of this task. Default token and external-contributor approval settings already passed script verification.
2. Confirm Wiki Home navigation. Preserve the owner's content when adding missing links.
3. The homepage is confirmed built by the script, and index.html contains a Web3Forms submission handler. This verifies configuration, not browser rendering, recipient ownership or successful delivery. The owner should verify the contact route; private vulnerability reporting is the primary security route.
4. Review collaborator release permissions and any production deployment process before the first application release. There is no application deployment or release workflow in the current .github/workflows directory; the observed GitHub Pages deployment serves the public project page. Do not invent a production environment merely to complete a checklist.
5. The owner supplied evidence that dependency graph, Dependabot, default CodeQL and secret protection are enabled. The scoped application and tenant reviews are complete, with findings and release blockers: see [security review](security/review-2026-09-07.md). Issues #13 and #19 remain open for remediation and tenant implementation. This is not a security clearance.

Keep issue #22 open until these checks are recorded. The code and workflow cleanup is contributor work; UI-only checks should be given to the owner one screen at a time.

## Additional owner evidence and development tooling

The owner supplied screens showing no collaborators, github-pages restricted to main with no environment secrets/variables, and an empty copilot environment and agent secrets. The owner reported disabling administrator bypass for github-pages. No application production environment was created.

A sixth ruleset, Copilot review for default branch, requests reviews on new pushes and draft PRs. The owner enabled the Copilot approval preview. Automatic review requests and counted approvals are distinct; verify an actual approval and merge gate on the next PR without routinely bypassing checks.

Development-only navigation and focused agent skills are documented in [agent development](agent-development.md). The setup workflow has no Cloudflare credentials, deployment environment or publishing step.
