import json
from pathlib import Path

from PyTexturePacker import Packer


def pack(
    image_paths: list[Path],
    output_path: Path,
    frame_key: callable,
    trim_mode: int = 1,
) -> None:
    """Pack images into a texture atlas.

    image_paths: PNG files to pack
    output_path: destination path without extension (.atlas and .png are created)
    frame_key: callable(filename: str) -> key — maps each image filename to its
               key in the resulting atlas sprites dict
    trim_mode: 0 = no trimming, 1 = trim transparent pixels (default)
    """
    packer = Packer.create(
        max_width=1024,
        max_height=1024,
        border_padding=0,
        shape_padding=0,
        inner_padding=0,
        enable_rotated=False,
        trim_mode=trim_mode,
        atlas_format=_make_atlas_format(frame_key),
        atlas_ext=".atlas",
    )
    packer.pack([str(p) for p in image_paths], str(output_path))


def _make_atlas_format(frame_key: callable) -> callable:
    def atlas_format(data: dict, path: str) -> None:
        atlas = {
            "w": data["meta"]["size"]["w"],
            "h": data["meta"]["size"]["h"],
            "sprites": {},
        }
        for filename, frame in data["frames"].items():
            atlas["sprites"][frame_key(filename)] = {
                "r": [
                    frame["frame"]["x"],
                    frame["frame"]["y"],
                    frame["frame"]["w"],
                    frame["frame"]["h"],
                ],
                "s": [frame["sourceSize"]["w"], frame["sourceSize"]["h"]],
                "o": [frame["spriteSourceSize"]["x"], frame["spriteSourceSize"]["y"]],
            }
        with open(path, "w") as f:
            json.dump(atlas, f, separators=(",", ":"))

    return atlas_format
