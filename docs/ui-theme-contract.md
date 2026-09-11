# Tocyn UI theme contract (v1)

The shared UI package exposes a versioned, static-CSS theme contract through `resolveTocynTheme`. The resolver is pure: it does not write to the DOM, persist preferences, inject a stylesheet, or cross an application/server boundary. Consumers apply its returned `variables` to a root or an instance container using ordinary `style.setProperty` calls or an equivalent CSP-approved mechanism.

The canonical data-only validation module is `@luminatick/shared/ui-theme`; the UI package re-exports it for compatibility. Server validation may import this pure shared module without importing UI components, DOM helpers, React or stylesheets. Browser application remains in `packages/ui/src/theme-scope.ts`.

## Scope and precedence

The contract version is `1`. A theme has a `light` or `dark` mode and the token groups below. Values are resolved in this order, with later values winning:

```text
package fallback < tenant theme < explicit instance overrides
```

Apply tenant values to the tenant's workspace root. Apply instance values to that instance's container so two instances cannot overwrite one another. Removing an override must remove the corresponding custom property from that container; `tocynThemePropertiesToReset` returns the exact allowlisted property names for this operation. A removed property then inherits the tenant value, or the package fallback.

The resolver accepts only declared token keys on plain data objects: opaque three- or six-digit hexadecimal colours, token-specific lengths/numbers, durations no longer than 500ms, and an allowlisted easing grammar. Unknown keys, accessors, CSS delimiters, URLs, markup and arbitrary functions are rejected. Theme input must never be treated as CSS text, a stylesheet, an HTML attribute fragment, or a URL. Resolved values are frozen.

## Token groups

| Group | Properties | Boundary |
| --- | --- | --- |
| Surfaces and colour | surface, panel, muted surface, divider, text, muted text, selected, critical, quiet, focus | Text tokens require 4.5:1 contrast against each declared content surface; focus requires 3:1. These token checks supplement browser verification. Colour is never the only state signal. |
| Motion | fast/normal/slow duration and standard easing | Static CSS includes a reduced-motion path. Healthy system state must not depend on animation. The application preference adapter owns any explicit user preference override. |
| Targets and density | minimum target and comfortable density | Targets accept 44–96px and static CSS enforces a 44px minimum independently of root font size. Density accepts 8–32px or 0.5–2rem and cannot lower the target floor. |
| Typography | body scale and line height | Body size accepts 16–32px or 1–2rem; line height accepts 1.5–2.5. Application typography and zoom remain available. |

`data-tocyn-theme-mode="light"` or `"dark"` declares the selected mode for a root/container and sets `color-scheme`. System colour-scheme following requires `data-tocyn-theme-system` on the root/host without an explicit mode. This opt-in prevents partially adapted applications from acquiring incompatible dark surfaces. Persistent mode and cognitive/workspace preferences belong to the authenticated operator state described in the [workspace interaction contract](workspace/operator-workspace-interaction-contract.md), not tenant branding data.

## CSP and integration boundary

The package ships a static stylesheet (`@luminatick/ui/styles.css`) and standard custom properties. No CSS-in-JS, `<style>` text generation, URL-backed stylesheet, or browser-to-API-Worker UI import is part of this contract. A consumer may set validated properties through DOM CSSOM APIs under its existing CSP. The application adapter still needs to define first-paint bootstrapping, authenticated tenant loading, persistent preference restore, wrapper lifecycle, and the CSP directive/test for the deployed shell; those are outside this bounded foundation.

`createTocynThemeScope(element, input)` applies a fully resolved theme through CSSOM and returns `apply` and `remove`. Supply the tenant and instance inputs together; it does not discover inherited tenant data. Invalid input is rejected before DOM mutation. One active scope owns an element; removing it restores original managed inline properties (including priority) and the original mode attribute, while leaving unrelated properties intact. A removed scope cannot apply again or overwrite a newer owner. The helper preserves DOM nodes, focus and entered input values. Applications must dispose their scope when the authorized identity or owning container changes; this helper does not authorize tenant access or persist preferences.

## Evidence and limitations

`packages/ui/src/__tests__/theme.test.ts` covers versioning, precedence, light/dark defaults, CSS injection rejection, unknown-key rejection, and reset-property enumeration. Existing primitive tests continue to cover native focus, keyboard, form and ref behavior. Browser first-paint timing, multiple live DOM instances, persistence/reload, computed contrast, assistive technology, CSP headers, and the application adapter remain integration acceptance work.

`theme-scope.test.ts` adds four DOM tests for isolation, replacement/removal, focus and input preservation, invalid-update atomicity, exclusive ownership and disposal fencing. These use jsdom and do not substitute for real browser/CSP acceptance.

`node tools/ui-browser/theme-scope.mjs` tests the actual bundled helper and static stylesheet in headless Chromium using an ephemeral loopback fixture with `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; base-uri 'none'`. It exercises two simultaneously themed containers, rendered light/dark surfaces, replacement/removal, original inline priority, focus/input preservation and invalid-update rejection. It records security-policy violation events and console errors, and blocks/counts external network attempts. The required CI build retains its source-hashed JSON receipt. This proves the synthetic fixture's CSP behavior, not authenticated application integration, deployed headers, cross-browser/assistive-technology acceptance or production first paint.

## Stored tenant palettes

The dedicated settings resource uses `{ version: "1", light: { ...tokens }, dark: { ...tokens } }`. Both palettes are validated against their own package defaults before any write; omitted palettes use defaults. Unknown fields, null palettes and unsupported versions are rejected. This draft shape supersedes the earlier unmerged light-only `tenant` sketch; no accepted storage migration is implied. A malformed stored record falls back to both safe package palettes with a bounded `fallback` signal, without returning corrupt values. Operator mode persistence and guarded application integration remain pending #66 acceptance.
