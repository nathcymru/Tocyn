# Product branding #186 — side-conversation handover

Owner requested supplied Tocyn assets and centrally configured product identity. Branch `codex/tocyn-brand-refresh` is isolated from main delivery workers, based on `4341cd7`. No existing worktree, server, user avatar, authentication/storage name, widget embed contract or tenant theme configuration is changed.

Authoritative product name and asset references: `packages/shared/product-brand.ts`. Shared renderer: `packages/ui/src/brand.tsx`; static lockup selectors follow existing `data-tocyn-theme-mode`. Canonical owner-supplied PNGs remain unmodified under `public/assets/brand/`. Shared build adapter `tools/branding/vite.ts` serves/emits only these assets and derives title/favicon. Dashboard scripts explicitly select the maintained TypeScript config rather than its older checked-in JavaScript copy.

Live HMR preview: http://127.0.0.1:5196/login from this worktree; existing local backend 8787. Existing operator preview5190 and other development services were left running. No credentials printed or changed. Browser verified loaded light lockup, dark selector swap, central title, no old product name at login. Screenshot is disposable `/private/tmp/tocyn-brand-login.png`.

Node22 validation: dashboard/portal/widget production builds, shared UI typecheck, dashboard222 tests and portal66 tests pass. Existing test environment warnings remain. Supplied PNG hashes match Downloads originals. Dashboard build needed its locked terser5.51.2 dependency, installed separately under `/private/tmp/tocyn-brand-build-deps` and linked into this isolated worktree; shared dependency installations untouched.

Integration: keep PR workflow and required exact-head CI/security/signing; zero Copilot requested, ruleset22454811 has only deletion/non-fast-forward protections. Issue/Project In progress, Actual start11September. Do not call this merged/accepted until integration owner verifies PR checks. No main-thread subagents were contacted or created.
