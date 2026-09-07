# Tocyn repository administration

Scope: nathcymru/Tocyn only.

## Verified on 7 September 2026

Five active repository rulesets protect the default branch and release tags:

- Main integrity: PRs, conversation resolution, squash-only, linear history, deletion/force-push prevention; no bypass.
- Pull request review: one approval and stale/last-push review controls; administrator exception through PRs only.
- Signed main commits: verified signatures on the default branch, no feature-branch restriction or bypass.
- Required CI: Tocyn / lint, Tocyn / typecheck, Tocyn / build, Tocyn / test, Analyze (javascript-typescript), Analyze (actions), all bound to GitHub Actions app 15368; no bypass.
- Release tag integrity: block update/deletion of v* tags, no bypass.

The required CodeQL checks are supplied by GitHub's active default setup, observed on PR #23, not the inherited `.github/workflows/codeql.yml` advanced workflow. Keep default setup enabled unless its replacement is deliberately configured and the gate names are updated.

The previous all-branch signature block no longer applies to the foundation branch. Passing CI and the final verified merge remain required. The role-based review exception applies to all repository administrators; use it only for documented solo-maintainer cases.

## Still to verify or configure

- Enable CI for this fork and demonstrate the exact required checks on a PR. Do not bypass failed checks.
- Verify Actions read-only default token, external-contributor workflow approvals and allowed-action policy. Pin remaining actions before enabling repository-wide SHA enforcement.
- Keep active CodeQL default setup; reconcile the inherited advanced workflow before enabling it to avoid duplicate configurations.
- Verify dependency graph, Dependabot alerts/security updates, secret scanning, push protection and private vulnerability reporting.
- Verify the Pages contact URL and private reporting fallback before relying on them.
- Keep production credentials out of PR checks and protect deployment environments.
- Set repository-wide merge toggles to match squash-only policy and retain automatic branch deletion.
- Configure release creation permissions and immutable release assets before first publication; tag update/deletion protection alone does not provide these.
- Populate topics and a verified homepage URL.

## Community publication

Issues #12–#22 exist. Native milestones v0.1.0, v0.2.0 and v0.3.0 remain to be created and assigned; title prefixes record intent only.

Prepared Wiki pages and Discussion posts are in docs/community-drafts. Inspect existing Wiki/Discussions before publishing. Prefer reviewed documentation in docs as the authoritative source and maintainer-only Wiki edits. Categories: Announcements, Q&A, Ideas, Show and tell. Pin Welcome and roadmap posts.

Use a small label set: bug, enhancement, documentation, security, dependencies, help wanted, good first issue. Apply good first issue only to genuinely bounded, explained work.

The current connector cannot change these administrative settings or publish Wiki/Discussions. Draft files are not evidence of publication.
