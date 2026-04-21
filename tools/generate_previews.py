import json
from pathlib import Path

import click
from PIL import Image, ImageDraw

from utils.map_format import MapFormat


class RgbaColor(click.ParamType):
    name = "color"

    def convert(self, value: str, param, ctx) -> tuple[int, int, int, int]:
        if value.startswith("#"):
            hex = value[1:]
        elif value.startswith(("0x", "0X")):
            hex = value[2:]
        else:
            self.fail(f"'{value}' is not a valid #rgba or #rrggbbaa color", param, ctx)
        if len(hex) == 4:
            r, g, b, a = (int(c * 2, 16) for c in hex)
        elif len(hex) == 8:
            r, g, b, a = (int(hex[i : i + 2], 16) for i in range(0, 8, 2))
        else:
            self.fail(f"'{value}' is not a valid #rgba or #rrggbbaa color", param, ctx)
        return (r, g, b, a)


@click.command()
@click.argument(
    "build_dir", type=click.Path(exists=True, file_okay=False, path_type=Path)
)
@click.option(
    "--hitbox-color",
    type=RgbaColor(),
    default="#ff3232c8",
    help="RGBA hex color for wall hitbox outlines (#rgba or #rrggbbaa).",
)
@click.option(
    "--floor-color",
    type=RgbaColor(),
    default="#3232ffc8",
    help="RGBA hex color for floor hitbox outlines (#rgba or #rrggbbaa).",
)
@click.option(
    "--floor-rect-color",
    type=RgbaColor(),
    default="#32ff32c8",
    help="RGBA hex color for the floor rectangles (#rgba or #rrggbbaa).",
)
def main(
    build_dir: Path,
    hitbox_color: tuple[int, int, int, int],
    floor_color: tuple[int, int, int, int],
    floor_rect_color: tuple[int, int, int, int],
) -> None:
    map_path = _find_one(build_dir, "*.json", "map")
    binary_map_path = _find_one(build_dir, "*.map", "binary map")
    atlas_path = _find_one(build_dir, "*.atlas", "atlas")

    with open(map_path) as f:
        map_data = json.load(f)
    with open(atlas_path) as f:
        atlas = json.load(f)

    sprites = {int(k): v for k, v in atlas["sprites"].items()}
    atlas_image = Image.open(atlas_path.with_suffix(".png")).convert("RGBA")

    w = map_data["w"]
    h = map_data["h"]
    tw = map_data["tw"]
    th = map_data["th"]
    canvas = Image.new("RGBA", (w * tw, h * th), (0, 0, 0, 255))

    for layer in sorted(map_data["layers"], key=lambda layer: layer["z"]):
        for i, tile_id in enumerate(_decode_rle(layer["tiles"])):
            if tile_id == 0 or tile_id not in sprites:
                continue
            frame = sprites[tile_id]
            rx, ry, rw, rh = frame["r"]
            sprite = atlas_image.crop((rx, ry, rx + rw, ry + rh))
            px, py = frame["o"]
            canvas.alpha_composite(sprite, dest=((i % w) * tw + px, (i // w) * th + py))

    for entity in map_data.get("entities", []):
        entity_id = entity["id"]
        if entity_id not in sprites:
            continue
        frame = sprites[entity_id]
        rx, ry, rw, rh = frame["r"]
        sprite = atlas_image.crop((rx, ry, rx + rw, ry + rh))
        px, py = frame["o"]
        _, sh = frame["s"]
        canvas.alpha_composite(sprite, dest=(entity["x"] + px, entity["y"] - sh + py))

    canvas.save(build_dir / "preview.png")

    hitboxes = [
        (aabb["x"], aabb["y"], aabb["w"], aabb["h"], aabb["wall"])
        for aabb in map_data["aabbs"]
    ]
    _save_overlay(
        canvas,
        [
            (x, y, w, h, hitbox_color if wall else floor_color)
            for x, y, w, h, wall in hitboxes
        ],
        build_dir / "preview_hitboxes.png",
    )

    # The floors are only in the binary map, the one the game logic reads
    floors = MapFormat.from_file(str(binary_map_path)).floors
    _save_overlay(
        canvas,
        [(f.x, f.y, f.w, f.h, floor_rect_color) for f in floors],
        build_dir / "preview_floors.png",
    )


def _save_overlay(
    canvas: Image.Image,
    rects: list[tuple[int, int, int, int, tuple[int, int, int, int]]],
    path: Path,
) -> None:
    # Draws the rectangles filled and outlined over the canvas, the outlines show where each
    # rectangle ends even when they touch
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for x, y, w, h, (r, g, b, a) in rects:
        draw.rectangle(
            [x, y, x + w - 1, y + h - 1],
            fill=(r, g, b, round(a * 0.75)),
            outline=(r, g, b, a),
        )
    Image.alpha_composite(canvas, overlay).save(path)


def _decode_rle(data: list[int]) -> list[int]:
    result = []
    for i in range(0, len(data), 2):
        result.extend([data[i + 1]] * data[i])
    return result


def _find_one(directory: Path, pattern: str, kind: str) -> Path:
    matches = list(directory.glob(pattern))
    if len(matches) != 1:
        raise ValueError(
            f"Expected exactly one {kind} in {directory}, found {len(matches)}"
        )
    return matches[0]


if __name__ == "__main__":
    main()
