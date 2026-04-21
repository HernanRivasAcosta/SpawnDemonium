import json
from pathlib import Path

import click

from utils.packer import pack


@click.command()
@click.argument(
    "maps_dir", type=click.Path(exists=True, file_okay=False, path_type=Path)
)
@click.argument("output_dir", type=click.Path(file_okay=False, path_type=Path))
@click.argument("atlas_name")
def main(maps_dir: Path, output_dir: Path, atlas_name: str) -> None:
    tileset_dir = maps_dir / "tilesets"
    if not tileset_dir.exists():
        raise ValueError(f"Tilesets directory does not exist: {tileset_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)

    id_offsets = _get_id_offsets(maps_dir)

    sprites: dict = {}
    for filepath in tileset_dir.glob("*.json"):
        with open(filepath) as f:
            sprites |= _get_all_sprites(id_offsets, filepath, json.load(f))

    def frame_key(filename: str) -> int:
        sprite = sprites[filename]
        return sprite["id"] + id_offsets[sprite["source"]]

    pack(
        [sprite["path"] for sprite in sprites.values()],
        output_dir / atlas_name,
        frame_key,
    )


def _get_id_offsets(maps_dir: Path) -> dict:
    map_paths = list(maps_dir.glob("*.json"))
    if len(map_paths) > 1:
        # TODO: Support multiple maps (which can have different offsets)
        raise ValueError(
            f"Multiple maps found in {maps_dir}, but only one is supported"
        )

    with open(map_paths[0]) as f:
        map_data = json.load(f)
        return {
            Path(tileset["source"]).stem: tileset["firstgid"]
            for tileset in map_data["tilesets"]
        }
    return {}


def _get_all_sprites(id_offsets: dict, filepath: Path, tileset: dict) -> dict:
    sprites = {}

    source = filepath.stem
    if source not in id_offsets:
        print(f"Tileset {filepath.stem} not used in any map, skipping")
        return sprites

    for tile in tileset["tiles"]:
        if "image" not in tile:
            raise ValueError(f"Tile is missing image: {tile}")
        if "id" not in tile:
            raise ValueError(f"Tile is missing id: {tile}")
        sprite_name = Path(tile["image"]).name
        sprites[sprite_name] = {
            "id": tile["id"],
            "source": source,
            "path": filepath.parent / tile["image"],
        }
    return sprites


if __name__ == "__main__":
    main()
