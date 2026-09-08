# Public assets

- `app_icons/` — platform-targeted Tocyn application icon package and regeneration helper.
- `assets/brand/` — canonical public Tocyn brand imagery used by repository documentation and the GitHub Pages project page.

The root `index.html` now references the canonical `public/assets/brand/` paths directly. Do not reintroduce duplicate root image copies solely for documentation/Page convenience; update consumers to the canonical paths instead.
