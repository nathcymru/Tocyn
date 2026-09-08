# Tocyn application icon asset package

Platform-targeted application icons derived from the approved Tocyn logo assets.

## Outputs

- `ios/app-icon-opaque.png` — 1024×1024 PNG, opaque iOS/App Store master.
- `electron/icon.png` — 1024×1024 PNG, transparent Electron master.
- `android/ic_background.svg` — 512×512 adaptive background.
- `android/ic_foreground.svg` — 512×512 adaptive foreground.
- `android/ic_monochrome.svg` — 512×512 themed/monochrome icon.
- `web/maskable-icon.png` — 512×512 opaque maskable icon.
- `web/apple-touch-icon.png` — 180×180 Apple touch icon.
- `web/icon.svg` — scalable web/favicon asset.

Source artwork is under `source/`.

## Regeneration

Requires Pillow:

```sh
python3 -m pip install Pillow
python3 public/app_icons/generate_tocyn_app_assets.py
```

The generator writes directly to the platform subdirectories and does not create temporary repository files.

The foreground/monochrome/web SVGs intentionally embed normalized PNG artwork so the approved source drawing is preserved exactly. They are packaging assets and should not be pulled into a runtime bundle unless the target actually needs them. If repository size later becomes material, replace them only from approved vector source artwork rather than auto-tracing the raster logo.
