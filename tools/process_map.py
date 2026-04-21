import json
import struct
from dataclasses import asdict
from pathlib import Path

import click

from utils.aabb import AABB, simplify
from utils.map_format import MapFormat
from utils.markers import MARKER_TYPES


@click.command()
@click.argument(
    "maps_dir", type=click.Path(exists=True, file_okay=False, path_type=Path)
)
@click.argument("output_dir", type=click.Path(file_okay=False, path_type=Path))
@click.argument("atlas_name")
def main(maps_dir: Path, output_dir: Path, atlas_name: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    map_paths = list(maps_dir.glob("*.json"))
    if len(map_paths) > 1:
        # TODO: Support multiple maps
        raise ValueError(
            f"Multiple maps found in {maps_dir}, but only one is supported"
        )

    for map_path in map_paths:
        processed = _process_map(map_path, atlas_name)
        # Output the map
        with open((output_dir / processed["name"]).with_suffix(".json"), "w") as f:
            f.write(_export_json(processed))
        with open((output_dir / processed["name"]).with_suffix(".map"), "wb") as f:
            f.write(_export_map(processed))


def _process_map(map_path: Path, atlas_name: str) -> dict:
    with open(map_path) as f:
        map_data = json.load(f)

    tile_data: dict[int, list[AABB]] = {}
    for tileset in map_data["tilesets"]:
        tileset_path = (
            map_path.parent / "tilesets" / Path(tileset["source"]).stem
        ).with_suffix(".json")
        tile_data |= _load_tiledata(tileset_path, tileset["firstgid"])

    w = map_data["width"]
    h = map_data["height"]
    tw = map_data["tilewidth"]
    th = map_data["tileheight"]

    floor = 0
    entities_z = None
    layers = []
    markers = []
    entities = []
    aabbs: list[AABB] = []
    floors: list[AABB] = []

    for z, layer_data in enumerate(map_data["layers"]):
        if layer_data["type"] == "tilelayer":
            props = {p["name"]: p["value"] for p in layer_data.get("properties", [])}

            is_floor = props.get("floor", False)
            if is_floor:
                floor = z

            tiles = [0] * (w * h)
            for chunk in layer_data["chunks"]:
                chunk_x = chunk["x"]
                chunk_y = chunk["y"]
                chunk_w = chunk["width"]

                for i, tile_id in enumerate(chunk["data"]):
                    if tile_id == 0:
                        continue
                    x = chunk_x + (i % chunk_w)
                    y = chunk_y + (i // chunk_w)
                    if not (0 <= x < w and 0 <= y < h):
                        raise ValueError(
                            f"Tile at ({x}, {y}) in layer '{layer_data['name']}' is "
                            f"outside the {w}x{h} map, close the map in Tiled and "
                            "run `make fix_maps`"
                        )

                    # If the layer contains markers instead of tiles
                    if props.get("markers", False):
                        marker_type = tile_data[tile_id]["type"]
                        if marker_type is None:
                            raise ValueError(
                                f"Tile ID {tile_id} at ({x}, {y}) is a marker, but has no type property"
                            )
                        markers.append(
                            {
                                "type": marker_type,
                                "x": x * tw + tw // 2,
                                "y": y * th + th // 2,
                            }
                        )
                    else:
                        tiles[y * w + x] = tile_id
                        if is_floor:
                            floors.append(AABB(x * tw, y * th, tw, th))
                        for aabb in tile_data[tile_id]["aabbs"]:
                            aabbs.append(
                                aabb.translated(x * tw, y * th, wall=not is_floor)
                            )

            layers.append(
                {
                    "z": z,
                    "tiles": _rle(tiles),
                    **{k: v for k, v in props.items() if k not in ["floor", "markers"]},
                }
            )
        elif layer_data["type"] == "objectgroup":
            # There's only one object layer allowed
            entities_z = z
            for obj in layer_data["objects"]:
                # For objects we only care about the "tile_id" equivalent which is the gid
                obj_id = obj["gid"]
                x = int(obj["x"])
                y = int(obj["y"])
                obj_w = int(obj["width"])
                obj_h = int(obj["height"])
                if x < 0 or y - obj_h < 0 or x + obj_w > w * tw or y > h * th:
                    raise ValueError(
                        f"Object {obj['id']} at ({x}, {y}) is outside the {w}x{h} "
                        "map, close the map in Tiled and run `make fix_maps`"
                    )
                entity_aabbs = tile_data[obj_id]["aabbs"]
                if entity_aabbs:
                    # Bottom center of the combined hitbox bounding box, relative to sprite top-left
                    min_ax = min(a.x for a in entity_aabbs)
                    max_ax = max(a.x + a.w for a in entity_aabbs)
                    max_ay = max(a.y + a.h for a in entity_aabbs)
                    ax = min_ax + (max_ax - min_ax) // 2
                    ay = max_ay
                else:
                    ax = obj_w // 2
                    ay = obj_h
                entities.append(
                    {
                        "id": obj_id,
                        "x": x,
                        "y": y,
                        "ax": ax,
                        "ay": ay,
                    }
                )
                # We still need to add any AABBs in these objects
                for aabb in tile_data[obj_id]["aabbs"]:
                    # Since 0 is at the bottom of the entities, we need to substract
                    # the AABB height from the y coordinate to get the top-left corner
                    aabbs.append(
                        AABB(
                            x=int(obj["x"]) + aabb.x,
                            y=int(obj["y"]) - obj_h + aabb.y,
                            w=aabb.w,
                            h=aabb.h,
                            wall=True,
                        )
                    )

        else:
            print(f'Ignoring unsupported layer type: {layer_data["type"]}')

    if entities_z is None:
        raise ValueError(
            f"{map_path} has no object layer, add one for the props to set the "
            "depth at which entities are rendered"
        )

    return {
        "name": map_path.stem,
        "w": w,
        "h": h,
        "tw": tw,
        "th": th,
        "floor": floor,
        "entities_z": entities_z,
        "layers": layers,
        "markers": markers,
        "entities": entities,
        "aabbs": simplify(aabbs),
        # Only exported to the .map file, the client doesn't need them
        "floors": simplify(floors),
        "atlas": atlas_name,
    }


def _rle(tiles: list[int]) -> list[int]:
    # Encode a list of integers in flat run length encoding (RLE) format
    if not tiles:
        return []
    result = []
    count = 1
    current = tiles[0]
    for tile in tiles[1:]:
        if tile == current:
            count += 1
        else:
            result.extend([count, current])
            count = 1
            current = tile
    result.extend([count, current])
    return result


def _load_tiledata(tileset_path: Path, offset: int) -> dict[int, dict]:
    with open(tileset_path) as f:
        tileset_data = json.load(f)

    tile_data: dict[int, list[AABB]] = {}
    for tile in tileset_data["tiles"]:
        aabbs = []
        if "objectgroup" in tile:
            for o in tile["objectgroup"]["objects"]:
                aabbs.append(
                    AABB(
                        x=int(o["x"]),
                        y=int(o["y"]),
                        w=int(o["width"]),
                        h=int(o["height"]),
                    )
                )
        type = None
        if "properties" in tile:
            for p in tile["properties"]:
                if p["name"] == "type":
                    type = _tile_type(p["value"])
        tile_data[offset + tile["id"]] = {"aabbs": aabbs, "type": type}
    return tile_data


def _tile_type(type):
    if type not in MARKER_TYPES:
        raise ValueError(f"Unknown marker type: {type}")
    return MARKER_TYPES[type]


def _export_json(map_data: dict) -> str:
    data = {k: v for k, v in map_data.items() if k != "floors"}
    data["aabbs"] = [asdict(aabb) for aabb in map_data["aabbs"]]
    return json.dumps(data, separators=(",", ":"))


def _export_map(map_data: dict) -> bytes:
    # Binary layout defined in maps/map.ksy, which is also compiled to map_format.rs
    # (Rust reader) and map_format.py (used below to verify this output).
    # If you change the ksy, update the struct.pack calls here to match.
    markers = map_data["markers"]
    aabbs = map_data["aabbs"]
    # u2 width, u2 height, u2 num_markers
    header = struct.pack("<HHH", map_data["w"], map_data["h"], len(markers))
    # Each marker: u1 type, u2 x, u2 y
    marker_data = struct.pack(
        "<" + "BHH" * len(markers),
        *[v for m in markers for v in (m["type"], m["x"], m["y"])],
    )
    # u2 num_aabbs
    aabb_header = struct.pack("<H", len(aabbs))
    # Each aabb: u2 x, u2 y, u2 w, u2 h, b1 wall (packed as a byte, LSB)
    aabb_data = struct.pack(
        "<" + "HHHHB" * len(aabbs),
        *[v for a in aabbs for v in (a.x, a.y, a.w, a.h, int(a.wall) << 7)],
    )
    # u2 num_floors
    floors = map_data["floors"]
    floor_header = struct.pack("<H", len(floors))
    # Each floor: u2 x, u2 y, u2 w, u2 h
    floor_data = struct.pack(
        "<" + "HHHH" * len(floors),
        *[v for f in floors for v in (f.x, f.y, f.w, f.h)],
    )
    result = header + marker_data + aabb_header + aabb_data + floor_header + floor_data
    _verify_map(map_data, result)
    return result


def _verify_map(map_data: dict, data: bytes) -> None:
    # Parse the binary we just wrote using the kaitai-generated reader and check
    # every field matches the source data. This catches any drift between the
    # struct.pack calls above and the ksy definition at build time.
    parsed = MapFormat.from_bytes(data)
    if parsed.width != map_data["w"] or parsed.height != map_data["h"]:
        raise ValueError(
            f"Map dimensions mismatch: expected ({map_data['w']}, {map_data['h']}), "
            f"got ({parsed.width}, {parsed.height})"
        )
    if len(parsed.markers) != len(map_data["markers"]):
        raise ValueError(
            f"Marker count mismatch: expected {len(map_data['markers'])}, got {len(parsed.markers)}"
        )
    for i, (expected, actual) in enumerate(zip(map_data["markers"], parsed.markers)):
        if (
            int(actual.kind) != expected["type"]
            or actual.x != expected["x"]
            or actual.y != expected["y"]
        ):
            raise ValueError(
                f"Marker {i} mismatch: expected {expected}, "
                f"got (type={int(actual.kind)}, x={actual.x}, y={actual.y})"
            )
    if len(parsed.aabbs) != len(map_data["aabbs"]):
        raise ValueError(
            f"AABB count mismatch: expected {len(map_data['aabbs'])}, got {len(parsed.aabbs)}"
        )
    for i, (expected, actual) in enumerate(zip(map_data["aabbs"], parsed.aabbs)):
        if (
            expected.x != actual.x
            or expected.y != actual.y
            or expected.w != actual.w
            or expected.h != actual.h
            or expected.wall != bool(actual.wall)
        ):
            raise ValueError(
                f"AABB {i} mismatch: expected {expected}, "
                f"got ({actual.x}, {actual.y}, {actual.w}, {actual.h}, wall={actual.wall})"
            )
    if len(parsed.floors) != len(map_data["floors"]):
        raise ValueError(
            f"Floor count mismatch: expected {len(map_data['floors'])}, got {len(parsed.floors)}"
        )
    for i, (expected, actual) in enumerate(zip(map_data["floors"], parsed.floors)):
        if (
            expected.x != actual.x
            or expected.y != actual.y
            or expected.w != actual.w
            or expected.h != actual.h
        ):
            raise ValueError(
                f"Floor {i} mismatch: expected {expected}, "
                f"got ({actual.x}, {actual.y}, {actual.w}, {actual.h})"
            )


if __name__ == "__main__":
    main()
