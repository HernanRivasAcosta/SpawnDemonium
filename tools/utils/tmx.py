import xml.etree.ElementTree as ET
from collections.abc import Iterator

# Helpers to read Tiled's .tmx/.tsx files directly, for the tools that work on the
# map sources instead of the JSON exported by Tiled.


def layers(element: ET.Element, tag: str) -> Iterator[ET.Element]:
    # Only walk layers and groups, so objects inside embedded tilesets (tile
    # hitboxes, which are relative to the tile) are never included
    for child in element:
        if child.tag == tag:
            yield child
        elif child.tag == "group":
            yield from layers(child, tag)


def properties(element: ET.Element) -> dict[str, str]:
    return {
        p.get("name"): p.get("value", p.text)
        for p in element.findall("properties/property")
    }


def chunk_tiles(chunk: ET.Element) -> list[int]:
    # Only csv encoded chunks are supported
    return [int(v) for v in (chunk.text or "").replace("\n", "").split(",") if v]


def chunk_positions(chunk: ET.Element) -> Iterator[tuple[int, int, int]]:
    # Yields (x, y, gid) for every non-empty tile in the chunk
    chunk_x = int(chunk.get("x"))
    chunk_y = int(chunk.get("y"))
    chunk_w = int(chunk.get("width"))
    for i, gid in enumerate(chunk_tiles(chunk)):
        if gid != 0:
            yield chunk_x + i % chunk_w, chunk_y + i // chunk_w, gid
