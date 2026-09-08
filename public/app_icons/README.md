# Tocyn application icon asset package

This package contains platform-targeted application icon assets derived from the approved Tocyn logo design.

## Included required outputs

- `app-icon-opaque.png` — 1024x1024, PNG, full colour, opaque background
- `icon.png` — 1024x1024, PNG, full colour, transparent background
- `ic_background.svg` — 512x512 SVG, full colour, opaque background layer
- `ic_foreground.svg` — 512x512 SVG, full colour, transparent foreground layer
- `ic_monochrome.svg` — 512x512 SVG, monochrome single-colour style asset
- `maskable-icon.png` — 512x512, PNG, full colour, opaque background
- `apple-touch-icon.png` — 180x180, PNG, full colour, opaque background
- `icon.svg` — scalable SVG, full colour, transparent favicon asset

## Source files included

- `source/tocyn-icon-color-source.png`
- `source/tocyn-logo-horizontal-source.png`
- `source/tocyn-icon-monochrome-source.png`

## Included script

- `generate_tocyn_app_assets.py` — regenerates the packaged outputs from the source PNG files.

## Notes

- Opaque PNG assets use a neutral light background (`#F3F4F6`) because iOS, Apple touch icon, and common PWA icon flows reject transparency or display more consistently with an opaque square master.
- SVG files are packaged as SVG format assets and embed the normalized PNG artwork to preserve the approved logo drawing exactly.
