from pathlib import Path

import click
from PIL import Image, ImageDraw, ImageFont

PRINTABLE_ASCII_START = 0x20
PRINTABLE_ASCII_END = 0x7E


@click.command()
@click.argument(
    "input_dir", type=click.Path(exists=True, file_okay=False, path_type=Path)
)
@click.argument("output_dir", type=click.Path(file_okay=False, path_type=Path))
@click.option(
    "--size",
    default=16,
    show_default=True,
    help="Font size in pixels for TTF fonts",
)
def main(input_dir: Path, output_dir: Path, size: int) -> None:
    for font_path in sorted(input_dir.iterdir()):
        if font_path.suffix.lower() == ".ttf":
            _render_ttf(font_path, output_dir, size)
        elif font_path.suffix.lower() == ".bdf":
            _render_bdf(font_path, output_dir)


def _render_ttf(font_path: Path, output_dir: Path, size: int) -> None:
    font_dir = output_dir / font_path.stem
    font_dir.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype(str(font_path), size)

    ascent, descent = font.getmetrics()
    cell_h = ascent + descent

    for codepoint in range(PRINTABLE_ASCII_START, PRINTABLE_ASCII_END + 1):
        char = chr(codepoint)
        cell_w = round(font.getlength(char))
        img = Image.new("RGBA", (cell_w, cell_h), (0, 0, 0, 0))
        # Space and other no-ink characters get a transparent cell; the rest are drawn
        # at (0, 0) so the glyph sits naturally within the em box
        if font.getbbox(char) is not None:
            draw = ImageDraw.Draw(img)
            draw.text((0, 0), char, fill=(255, 255, 255, 255), font=font)
        img.save(font_dir / f"{codepoint:04x}.png")

    count = PRINTABLE_ASCII_END - PRINTABLE_ASCII_START + 1
    print(f"  {font_path.name}: {count} glyphs (h={cell_h}) -> {font_dir}")


def _render_bdf(font_path: Path, output_dir: Path) -> None:
    font_dir = output_dir / font_path.stem
    font_dir.mkdir(parents=True, exist_ok=True)
    glyphs, font_bbox = _parse_bdf(font_path)

    if font_bbox is None:
        raise ValueError(f"FONTBOUNDINGBOX not found in {font_path}")

    fbw, fbh = font_bbox[0], font_bbox[1]
    count = 0

    for codepoint, glyph in sorted(glyphs.items()):
        if codepoint < PRINTABLE_ASCII_START or codepoint > PRINTABLE_ASCII_END:
            continue
        img = _render_bdf_glyph(glyph, font_bbox)
        img.save(font_dir / f"{codepoint:04x}.png")
        count += 1

    print(f"  {font_path.name}: {count} glyphs ({fbw}x{fbh}) -> {font_dir}")


def _parse_bdf(
    font_path: Path,
) -> tuple[dict[int, dict], tuple[int, int, int, int] | None]:
    glyphs: dict[int, dict] = {}
    font_bbox: tuple[int, int, int, int] | None = None
    current: dict | None = None
    reading_bitmap = False
    bitmap_lines: list[str] = []

    with open(font_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("FONTBOUNDINGBOX "):
                parts = line.split()
                font_bbox = (int(parts[1]), int(parts[2]), int(parts[3]), int(parts[4]))
            elif line.startswith("STARTCHAR "):
                current = {"name": line.split(None, 1)[1]}
                reading_bitmap = False
                bitmap_lines = []
            elif line == "BITMAP":
                reading_bitmap = True
            elif line == "ENDCHAR":
                if current is not None:
                    current["bitmap"] = bitmap_lines
                    if "encoding" in current:
                        glyphs[current["encoding"]] = current
                current = None
                reading_bitmap = False
                bitmap_lines = []
            elif reading_bitmap:
                bitmap_lines.append(line)
            elif current is not None:
                if line.startswith("ENCODING "):
                    current["encoding"] = int(line.split()[1])
                elif line.startswith("BBX "):
                    parts = line.split()
                    current["bbx"] = (
                        int(parts[1]),
                        int(parts[2]),
                        int(parts[3]),
                        int(parts[4]),
                    )

    return glyphs, font_bbox


def _render_bdf_glyph(glyph: dict, font_bbox: tuple[int, int, int, int]) -> Image.Image:
    fbw, fbh, fbx, fby = font_bbox
    img = Image.new("RGBA", (fbw, fbh), (0, 0, 0, 0))

    if "bbx" not in glyph or not glyph.get("bitmap"):
        return img  # transparent cell (e.g. space with no ink)

    w, h, x, y = glyph["bbx"]
    bitmap = glyph["bitmap"]
    pixels = img.load()
    bits_per_row = len(bitmap[0]) * 4

    # BDF y-axis points up; row 0 of the bitmap is the topmost row of the glyph.
    # Convert to image coordinates (y points down, origin top-left of cell):
    #   img_x = (bdf_x) - fbx  →  x + col - fbx
    #   img_y = (fby + fbh - 1) - bdf_y  →  fby + fbh - y - h + row
    img_x0 = x - fbx
    img_y0 = fby + fbh - y - h

    for row, hex_line in enumerate(bitmap):
        img_y = img_y0 + row
        if img_y < 0 or img_y >= fbh:
            continue
        value = int(hex_line, 16)
        for col in range(w):
            img_x = img_x0 + col
            if img_x < 0 or img_x >= fbw:
                continue
            if (value >> (bits_per_row - 1 - col)) & 1:
                pixels[img_x, img_y] = (255, 255, 255, 255)

    return img


if __name__ == "__main__":
    main()
