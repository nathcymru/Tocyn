from PIL import Image
from pathlib import Path
import base64

BG = '#F3F4F6'
ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / 'source'
COLOR_ICON_SRC = SOURCE_DIR / 'tocyn-icon-color-source.png'
LOGO_SRC = SOURCE_DIR / 'tocyn-logo-horizontal-source.png'
MONO_ICON_SRC = SOURCE_DIR / 'tocyn-icon-monochrome-source.png'


def trim_alpha(img: Image.Image) -> Image.Image:
    img = img.convert('RGBA')
    alpha = img.getchannel('A')
    bbox = alpha.getbbox()
    return img.crop(bbox) if bbox else img


def pad_square_transparent(src: Image.Image, size: int, scale: float = 0.82) -> Image.Image:
    src = trim_alpha(src)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    max_dim = int(size * scale)
    ratio = min(max_dim / src.width, max_dim / src.height)
    new_size = (max(1, int(src.width * ratio)), max(1, int(src.height * ratio)))
    src = src.resize(new_size, Image.LANCZOS)
    x = (size - src.width) // 2
    y = (size - src.height) // 2
    canvas.alpha_composite(src, (x, y))
    return canvas


def pad_square_opaque(src: Image.Image, size: int, bg_hex: str = BG, scale: float = 0.78) -> Image.Image:
    rgba = pad_square_transparent(src, size, scale=scale)
    bg = Image.new('RGBA', (size, size), tuple(int(bg_hex[i:i+2], 16) for i in (1, 3, 5)) + (255,))
    bg.alpha_composite(rgba)
    return bg.convert('RGB')


def image_to_data_uri(path: Path, mime: str) -> str:
    data = base64.b64encode(path.read_bytes()).decode('ascii')
    return f'data:{mime};base64,{data}'


def write_svg_background(path: Path, fill: str = BG, size: int = 512):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}" role="img" aria-label="Tocyn Android adaptive background"><rect width="{size}" height="{size}" fill="{fill}"/></svg>'
    path.write_text(svg, encoding='utf-8')


def write_svg_embedded(path: Path, png_path: Path, size: int = 512, aria_label: str = 'Tocyn icon'):
    data_uri = image_to_data_uri(png_path, 'image/png')
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}" role="img" aria-label="{aria_label}"><image href="{data_uri}" x="0" y="0" width="{size}" height="{size}" preserveAspectRatio="xMidYMid meet"/></svg>'
    path.write_text(svg, encoding='utf-8')


def main():
    color_icon = Image.open(COLOR_ICON_SRC).convert('RGBA')
    mono_icon = Image.open(MONO_ICON_SRC).convert('RGBA')

    fg_png_512 = pad_square_transparent(color_icon, 512, scale=0.84)
    mono_png_512 = pad_square_transparent(mono_icon, 512, scale=0.84)
    fg_png_512_path = ROOT / '_ic_foreground_512.png'
    mono_png_512_path = ROOT / '_ic_monochrome_512.png'
    fg_png_512.save(fg_png_512_path, 'PNG')
    mono_png_512.save(mono_png_512_path, 'PNG')

    pad_square_opaque(color_icon, 1024, scale=0.78).save(ROOT / 'app-icon-opaque.png', 'PNG')
    pad_square_transparent(color_icon, 1024, scale=0.84).save(ROOT / 'icon.png', 'PNG')
    write_svg_background(ROOT / 'ic_background.svg', fill=BG, size=512)
    write_svg_embedded(ROOT / 'ic_foreground.svg', fg_png_512_path, size=512, aria_label='Tocyn Android adaptive foreground icon')
    write_svg_embedded(ROOT / 'ic_monochrome.svg', mono_png_512_path, size=512, aria_label='Tocyn Android monochrome icon')
    pad_square_opaque(color_icon, 512, scale=0.72).save(ROOT / 'maskable-icon.png', 'PNG')
    pad_square_opaque(color_icon, 180, scale=0.78).save(ROOT / 'apple-touch-icon.png', 'PNG')
    write_svg_embedded(ROOT / 'icon.svg', fg_png_512_path, size=512, aria_label='Tocyn web favicon')

if __name__ == '__main__':
    main()
