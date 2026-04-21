import math
import xml.etree.ElementTree as ET
from pathlib import Path

import click

from utils.tmx import chunk_positions, layers

# Fixes the problems in the .tmx sources that check_maps.py reports and that can
# be fixed automatically:
# - Tiled's infinite maps grow in any direction and never update the map size, so
#   chunks can end up at negative coordinates and the width/height in the header
#   are whatever the map was created with. The content is moved so the top-left
#   tile is close to (0, 0) and the size is updated to fit it.
# - Object positions are rounded to whole pixels.
# - An empty object layer for the props is added if the map has none.
# It is meant to be run manually with the map closed in Tiled, since Tiled would
# overwrite it.


@click.command()
@click.argument(
    "map_paths",
    nargs=-1,
    required=True,
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
)
def main(map_paths: tuple[Path, ...]) -> None:
    for map_path in map_paths:
        _fix_map(map_path)


def _fix_map(map_path: Path) -> None:
    tree = ET.parse(map_path)
    root = tree.getroot()
    if root.get("infinite") != "1":
        print(f"{map_path}: not an infinite map, skipping")
        return

    tw = int(root.get("tilewidth"))
    th = int(root.get("tileheight"))
    tile_layers = list(layers(root, "layer"))
    for layer in tile_layers:
        encoding = layer.find("data").get("encoding")
        if encoding != "csv":
            raise ValueError(
                f"Layer '{layer.get('name')}' uses '{encoding}' encoding, only csv "
                "is supported (Map > Map Properties > Tile Layer Format)"
            )
    object_layers = list(layers(root, "objectgroup"))
    # check_maps.py requires exactly one object layer for the props
    added_props_layer = not object_layers
    if added_props_layer:
        _add_props_layer(root)
    objects = [o for group in object_layers for o in group]
    chunks = [c for layer in tile_layers for c in layer.iter("chunk")]

    # Round before computing the bounds, so they match the final positions
    rounded = 0
    for obj in objects:
        changed = False
        for attr in ("x", "y"):
            value = obj.get(attr, "0")
            # Round half up instead of Python's round(), which rounds half to even
            new_value = str(math.floor(float(value) + 0.5))
            if new_value != value:
                obj.set(attr, new_value)
                changed = True
        rounded += changed

    bounds = _tile_bounds(chunks, objects, tw, th)
    if bounds is None:
        print(f"{map_path}: map is empty, skipping")
        return
    min_x, min_y, max_x, max_y = bounds

    # Only shift by whole chunks so the tile data inside each chunk stays untouched
    chunk_w, chunk_h = _chunk_size(chunks)
    dx = -math.floor(min_x / chunk_w) * chunk_w
    dy = -math.floor(min_y / chunk_h) * chunk_h
    w = max_x + 1 + dx
    h = max_y + 1 + dy

    if (
        not added_props_layer
        and rounded == 0
        and dx == 0
        and dy == 0
        and root.get("width") == str(w)
        and root.get("height") == str(h)
    ):
        print(f"{map_path}: already fixed")
        return

    for chunk in chunks:
        chunk.set("x", str(int(chunk.get("x")) + dx))
        chunk.set("y", str(int(chunk.get("y")) + dy))
    for obj in objects:
        obj.set("x", str(int(obj.get("x")) + dx * tw))
        obj.set("y", str(int(obj.get("y")) + dy * th))
    for element in [root, *tile_layers]:
        element.set("width", str(w))
        element.set("height", str(h))

    tree.write(map_path, encoding="UTF-8", xml_declaration=True)
    print(
        f"{map_path}: shifted by ({dx}, {dy}) tiles, new size is {w}x{h}, "
        f"rounded the position of {rounded} objects"
        + (", added an empty 'props' object layer" if added_props_layer else "")
    )


def _add_props_layer(root: ET.Element) -> None:
    # Added on top of the other layers, it can be moved later in Tiled
    # nextlayerid can be stale if the file was edited by hand, so make sure the id
    # is not already taken
    layer_tags = ("layer", "objectgroup", "imagelayer", "group")
    used_ids = [int(e.get("id", 0)) for e in root.iter() if e.tag in layer_tags]
    layer_id = max(int(root.get("nextlayerid", 1)), *[i + 1 for i in used_ids])
    root.set("nextlayerid", str(layer_id + 1))
    group = ET.SubElement(root, "objectgroup", {"id": str(layer_id), "name": "props"})
    # Keep the one space indentation Tiled uses for layers
    root[-2].tail = "\n "
    group.tail = "\n"


def _tile_bounds(
    chunks: list[ET.Element], objects: list[ET.Element], tw: int, th: int
) -> tuple[int, int, int, int] | None:
    # Inclusive bounds (in tiles) of all non-empty tiles and objects
    xs: list[int] = []
    ys: list[int] = []

    for chunk in chunks:
        for x, y, _ in chunk_positions(chunk):
            xs.append(x)
            ys.append(y)

    for obj in objects:
        x = float(obj.get("x", 0))
        y = float(obj.get("y", 0))
        w = float(obj.get("width", 0))
        h = float(obj.get("height", 0))
        # Tile objects are anchored at their bottom-left corner
        top = y - h if "gid" in obj.attrib else y
        # The max() keeps zero-sized objects (points) in the tile they are on
        left = math.floor(x / tw)
        top_tile = math.floor(top / th)
        xs += [left, max(math.ceil((x + w) / tw) - 1, left)]
        ys += [top_tile, max(math.ceil((top + h) / th) - 1, top_tile)]

    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def _chunk_size(chunks: list[ET.Element]) -> tuple[int, int]:
    sizes = {(int(c.get("width")), int(c.get("height"))) for c in chunks}
    if len(sizes) > 1:
        raise ValueError(f"All chunks must have the same size, found {sizes}")
    # Maps with only objects don't have chunks, fall back to Tiled's default
    return sizes.pop() if sizes else (16, 16)


if __name__ == "__main__":
    main()
