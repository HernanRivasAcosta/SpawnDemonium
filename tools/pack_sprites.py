import re
from pathlib import Path

import click

from utils.packer import pack


@click.command()
@click.argument(
    "input_dir", type=click.Path(exists=True, file_okay=False, path_type=Path)
)
@click.argument("output_dir", type=click.Path(file_okay=False, path_type=Path))
@click.option(
    "--hex-keys",
    is_flag=True,
    default=False,
    help="Use hex codepoint as frame key (for font atlases).",
)
@click.option(
    "--trim/--no-trim",
    default=True,
    help="Trim transparent pixels (default: trim).",
)
def main(input_dir: Path, output_dir: Path, hex_keys: bool, trim: bool) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    sprites = sorted(input_dir.glob("*.png"))
    if not sprites:
        raise click.ClickException(f"No PNG files found in {input_dir}")

    output_name = _sanitize_name(input_dir.name)
    frame_key = _hex_key if hex_keys else _name_key
    pack(sprites, output_dir / output_name, frame_key, trim_mode=0 if not trim else 1)
    print(f"  {input_dir.name} -> {output_name}: {len(sprites)} sprites packed")


def _sanitize_name(name: str) -> str:
    name = name.lower()
    name = name.replace(".", "")
    name = re.sub(r"[^a-z0-9]+", "-", name)
    return name.strip("-")


def _hex_key(filename: str) -> int:
    return int(Path(filename).stem, 16)


def _name_key(filename: str) -> str:
    return Path(filename).stem


if __name__ == "__main__":
    main()
