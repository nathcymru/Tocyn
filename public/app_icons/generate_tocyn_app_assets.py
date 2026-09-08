from io import BytesIO
from pathlib import Path
import base64

from PIL import Image

BG = '#F3F4F6'
ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / 'source'
ANDROID_DIR = ROOT / 'android'
IOS_DIR = ROOT / 'ios'
ELECTRON_DIR = ROOT / 'electron'
WEB_DIR = ROOT / 'web'
COLOR_ICON_SRC = SOURCE_DIR / 'tocyn-icon-color-source.png'
MONO_ICON_SRC = SOURCE_DIR / 'tocyn-icon-monochrome-source.png'
RESAMPLE = Image.Resampling.LANCZOS if hasattr(Image, 'Resampling') else Image.LANCZOS


def trim_alpha(img: Image.Image) -> Image.Image:
    img = img.convert('RGBA')
    bbox = img.getchannel('A').getbbox()
    return img.crop(bbox) if bbox else img


def pad_square_transparent(src: Image.Image, size: int, scale: float = 0.82) -> Image.Image:
    src = trim_alpha(src)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    max_dim = int(size * scale)
    ratio = min(max_dim / src.width, max_dim / src.height)
    new_size = (max(1, int(src.width * ratio)), max(1, int(src.height * ratio)))
    src = src.resize(new_size, RESAMPLE)
    canvas.alpha_composite(src, ((size - src.width) // 2, (size - src.height) // 2))
    return canvas


def pad_square_opaque(src: Image.Image, size: int, bg_hex: str = BG, scale: float = 0.78) -> Image.Image:
    rgba = pad_square_transparent(src, size, scale=scale)
    bg = Image.new('RGBA', (size, size), tuple(int(bg_hex[i:i+2], 16) for i in (1, 3, 5)) + (255,))
    bg.alpha_composite(rgba)
    return bg.convert('RGB')


def image_to_data_uri(image: Image.Image) -> str:
    buffer = BytesIO()
    image.save(buffer, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')


def write_svg_background(path: Path, fill: str = BG, size: int = 512) -> None:
    path.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}" role="img" aria-label="Tocyn Android adaptive background"><rect width="{size}" height="{size}" fill="{fill}"/></svg>\n',
        encoding='utf-8',
    )


def write_svg_embedded(path: Path, image: Image.Image, size: int = 512, aria_label: str = 'Tocyn icon') -> None:
    path.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}" role="img" aria-label="{aria_label}"><image href="{image_to_data_uri(image)}" x="0" y="0" width="{size}" height="{size}" preserveAspectRatio="xMidYMid meet"/></svg>\n',
        encoding='utf-8',
    )


def main() -> None:
    for directory in (ANDROID_DIR, IOS_DIR, ELECTRON_DIR, WEB_DIR):
        directory.mkdir(parents=True, exist_ok=True)

    color_icon = Image.open(COLOR_ICON_SRC).convert('RGBA')
    mono_icon = Image.open(MONO_ICON_SRC).convert('RGBA')
    foreground = pad_square_transparent(color_icon, 512, scale=0.84)
    monochrome = pad_square_transparent(mono_icon, 512, scale=0.84)

    pad_square_opaque(color_icon, 1024, scale=0.78).save(IOS_DIR / 'app-icon-opaque.png', 'PNG')
    pad_square_transparent(color_icon, 1024, scale=0.84).save(ELECTRON_DIR / 'icon.png', 'PNG')
    write_svg_background(ANDROID_DIR / 'ic_background.svg')
    write_svg_embedded(ANDROID_DIR / 'ic_foreground.svg', foreground, aria_label='Tocyn Android adaptive foreground icon')
    write_svg_embedded(ANDROID_DIR / 'ic_monochrome.svg', monochrome, aria_label='Tocyn Android monochrome icon')
    pad_square_opaque(color_icon, 512, scale=0.72).save(WEB_DIR / 'maskable-icon.png', 'PNG')
    pad_square_opaque(color_icon, 180, scale=0.78).save(WEB_DIR / 'apple-touch-icon.png', 'PNG')
    write_svg_embedded(WEB_DIR / 'icon.svg', foreground, aria_label='Tocyn web favicon')


if __name__ == '__main__':
    main()
