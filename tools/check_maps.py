import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import click

from utils.markers import MARKER_TYPES
from utils.tmx import chunk_positions, layers, properties

# Checks the .tmx sources for mistakes that would break the build or the game,
# reporting all of them at once instead of failing on the first one.

# Tiled stores flipping and rotation in the highest bits of the gid
FLIP_FLAGS = 0xF0000000


@click.command()
@click.argument(
    "map_paths",
    nargs=-1,
    required=True,
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
)
def main(map_paths: tuple[Path, ...]) -> None:
    errors = [f"{p}: {e}" for p in map_paths for e in _check_map(p)]
    for error in errors:
        click.echo(error, err=True)
    if errors:
        raise SystemExit(1)


def _check_map(map_path: Path) -> list[str]:
    root = ET.parse(map_path).getroot()
    if root.get("infinite") != "1":
        return ["only infinite maps are supported"]

    errors: list[str] = []
    tile_types = _load_tilesets(map_path, root, errors)
    if errors:
        # Every gid check would fail without the tilesets, so stop here
        return errors
    w = int(root.get("width"))
    h = int(root.get("height"))
    tw = int(root.get("tilewidth"))
    th = int(root.get("tileheight"))
    out_of_bounds = (
        f"outside the {w}x{h} map, close the map in Tiled and run `make fix_maps`"
    )

    has_floor = False
    player_spawns = 0
    for layer in layers(root, "layer"):
        name = layer.get("name")
        props = properties(layer)
        is_markers = props.get("markers") == "true"
        if "floor" not in props and not is_markers:
            errors.append(
                f"layer '{name}' needs a 'floor' bool property, otherwise its tiles "
                "are treated as walls"
            )
        has_floor |= props.get("floor") == "true"

        encoding = layer.find("data").get("encoding")
        if encoding != "csv":
            errors.append(
                f"layer '{name}' uses '{encoding}' encoding, only csv is supported "
                "(Map > Map Properties > Tile Layer Format)"
            )
            continue

        # The same mistake is usually repeated in many tiles (e.g. the whole layer
        # being outside the map), so group the positions by problem
        issues: dict[str, list[tuple[int, int]]] = defaultdict(list)
        for chunk in layer.iter("chunk"):
            for x, y, gid in chunk_positions(chunk):
                if not (0 <= x < w and 0 <= y < h):
                    issues[out_of_bounds].append((x, y))
                gid_error = _gid_error(gid, tile_types)
                if gid_error:
                    issues[gid_error].append((x, y))
                elif is_markers:
                    marker_type = tile_types[gid]
                    if marker_type not in MARKER_TYPES:
                        issues[
                            f"marker 'type' property is {marker_type!r} instead of "
                            f"one of {list(MARKER_TYPES)}"
                        ].append((x, y))
                    player_spawns += marker_type == "player_spawn"
        for issue, positions in issues.items():
            errors.append(
                f"layer '{name}': {issue} ({len(positions)} tiles, first at "
                f"{positions[0]})"
            )

    if not has_floor:
        errors.append("no tile layer has the 'floor' property set to true")
    if player_spawns == 0:
        errors.append(
            "there are no player spawns, add a layer with the 'markers' bool property "
            "and place tiles with the 'type' property set to 'player_spawn'"
        )

    object_layers = list(layers(root, "objectgroup"))
    if not object_layers:
        errors.append(
            "there is no object layer for props, close the map in Tiled and run "
            "`make fix_maps` to add an empty one"
        )
    elif len(object_layers) > 1:
        names = ", ".join(f"'{g.get('name')}'" for g in object_layers)
        errors.append(
            f"only one object layer for props is supported, found {len(object_layers)}: "
            f"{names}"
        )

    for group in object_layers:
        for obj in group.findall("object"):
            where = f"object {obj.get('id')} in layer '{group.get('name')}'"
            if "gid" not in obj.attrib:
                errors.append(f"{where} is not a tile object")
                continue
            gid_error = _gid_error(int(obj.get("gid")), tile_types)
            if gid_error:
                errors.append(f"{where}: {gid_error}")
            # Tile objects are anchored at their bottom-left corner
            x = float(obj.get("x"))
            y = float(obj.get("y"))
            obj_w = float(obj.get("width", 0))
            obj_h = float(obj.get("height", 0))
            if x < 0 or y - obj_h < 0 or x + obj_w > w * tw or y > h * th:
                errors.append(f"{where} is {out_of_bounds}")

    return errors


def _load_tilesets(
    map_path: Path, root: ET.Element, errors: list[str]
) -> dict[int, str | None]:
    # Maps the gid of every tile defined in the tilesets to its 'type' property
    tile_types: dict[int, str | None] = {}
    for tileset in root.findall("tileset"):
        firstgid = int(tileset.get("firstgid"))
        source = tileset.get("source")
        if source is None:
            errors.append(
                f"tileset '{tileset.get('name')}' is embedded in the map, it must be "
                "an external .tsx file"
            )
            continue
        tileset_path = map_path.parent / source
        if not tileset_path.exists():
            errors.append(f"tileset {tileset_path} does not exist")
            continue
        tileset_root = ET.parse(tileset_path).getroot()
        for tile in tileset_root.findall("tile"):
            gid = firstgid + int(tile.get("id"))
            tile_types[gid] = properties(tile).get("type")
    return tile_types


def _gid_error(gid: int, tile_types: dict[int, str | None]) -> str | None:
    if gid & FLIP_FLAGS:
        return "flipped or rotated tiles are not supported"
    if gid not in tile_types:
        return f"gid {gid} is not in any tileset"
    return None


if __name__ == "__main__":
    main()
