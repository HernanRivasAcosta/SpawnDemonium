<p align="center">
  <img src="assets/src/ui/logo_v1.png" alt="Spawndemonium" width="396">
</p>

# Spawndemonium

Sure, letting supervisors respawn AI process can't have any negative consequences.

# Building

## Prerequisites
- Rust (with `cargo`).
- Erlang (via [kerl](https://github.com/kerl/kerl) or similar).
- Elixir (via [kiex](https://github.com/taylor/kiex) or similar).
- Python 3 via [pyenv](https://github.com/pyenv/pyenv). Once installed, set up the virtualenv:

```sh
pyenv install 3.14.3
pyenv local 3.14.3
pyenv exec python -m venv tools/.venv
tools/.venv/bin/pip install -r tools/requirements.txt
```

- Node.js (for JS linting and type checking).
- [kaitai-struct-compiler](https://kaitai.io/) for generating the map format parser from `maps/map.ksy`. On macOS: `brew install kaitai-struct-compiler`.
- [Tiled](https://www.mapeditor.org/) accessible as `tiled` in your PATH. On macOS, if Tiled was installed by downloading the image and dragging it to Applications (rather than via Homebrew), a plain symlink to the binary won't work because the plugins won't load. Use a wrapper script instead:

```sh
cat > ~/.local/bin/tiled << 'EOF'
#!/bin/sh
cd /Applications/Tiled.app/Contents/MacOS
exec ./Tiled "$@"
EOF
chmod +x ~/.local/bin/tiled
```

## Setup

Copy `.env.example` to `.env` and set the paths to your Erlang and Elixir installations:

```sh
cp .env.example .env
```

```sh
# .env
ERLANG=/path/to/erlang/bin
ELIXIR=/path/to/elixir/bin
SECRET_KEY_BASE=<generate with: cd server && mix phx.gen.secret>
```

## Targets

| Command | Description |
|---------|-------------|
| `make` | Build everything and produce an Elixir release |
| `make run` | Build everything and start the server (accessible at `localhost:4000`) |
| `make shell` | Build everything and start the server with an IEx shell (accessible at `localhost:4000`) |
| `make release` | Build everything and package the Elixir release as `spawndemonium.tar.gz` |
| `make release_linux_arm64` | Same as `make release`, but built in Docker for Debian 13 on ARM64 |
| `make wasm` | Build only the WASM file |
| `make maps` | Export all Tiled maps to JSON |
| `make maps DEBUG=1` | Same, but also generate map previews |
| `make lint` | Check formatting (Elixir, Python, JS/prettier) |
| `make check` | Check correctness (Rust/clippy, Python/ruff, JS/eslint+tsc) |
| `make clean` | Remove all build artifacts |

### Build flags

| Flag | Description |
|------|-------------|
| `DEBUG=1` | Build the Elixir server in dev mode (instead of prod), skip JS minification, and enable debug logging in the WASM module |
| `FORCE=1` | Force a JS rebuild even if sources haven't changed (useful when toggling `DEBUG`) |

These can be combined: `make shell DEBUG=1 FORCE=1`

# Deploying

`make release` produces `spawndemonium.tar.gz`, a self-contained release that includes the Erlang runtime, so the target machine doesn't need Erlang, Elixir or any of the build tools. It must be built on the same OS and architecture as the target machine.

`make release_linux_arm64` builds it in Docker for Debian 13 on ARM64 (e.g. a `c4a` VM on Google Cloud with the `debian-13-arm64` image) and produces `spawndemonium-linux-arm64.tar.gz`. It needs Docker, Tiled and the Kaitai compiler on the host, the map exports and generated parsers are made on the host and copied into the image.

```sh
tar -xzf spawndemonium.tar.gz
export SECRET_KEY_BASE=<generate with: cd server && mix phx.gen.secret>
export PHX_HOST=<public hostname>  # Optional, defaults to localhost
export PORT=4000                   # Optional, defaults to 4000

spawndemonium/bin/spawndemonium daemon   # Start in the background
spawndemonium/bin/spawndemonium remote   # Open an IEx shell on the running node
spawndemonium/bin/spawndemonium stop     # Stop it
```

Leave the remote shell with `Ctrl+C` twice. Don't use `System.halt()`, the shell runs on the server node so it would stop the server. The daemon's logs are written to `spawndemonium/tmp/log/`.

# Credits
- Graphics:
  - Main logo by [Eunoia](https://www.fiverr.com/ashilpadarrel)
  - Environment by [Averick](https://www.fiverr.com/averickn)
  - [Outer Buddies](https://trevor-pupkin.itch.io/outer-buddies) by [Pupkin Assets](https://trevor-pupkin.itch.io/).
  - [Simple keys](https://beamedeighth.itch.io/simplekeys-animated-pixel-keyboard-keys) by [beamedeighth](https://beamedeighth.itch.io/)
  - Icons:
    - [Hell icons created by Freepik - Flaticon](https://www.flaticon.com/free-icons/hell).
  - [CRT Shader](https://github.com/gingerbeardman/webgl-crt-shader/) by [@gingerbeardman](https://blog.gingerbeardman.com/2026/01/04/webgl-crt-shader/).
  - Marquees:
    - Left: [Abstract purple background](https://www.freepik.com/free-vector/abstract-purple-background_177834912.htm#fromView=search&page=1&position=13&uuid=e6236493-5336-4840-bf1f-6ec497bc482d&query=purple) by cecepbinsae on Freepik.
    - Right: [Road to hell, infernal hot cave with lava and fire](https://www.freepik.com/free-vector/road-hell-infernal-hot-cave-with-lava-fire_6198147.htm#fromView=search&page=1&position=0&uuid=7834f2b3-5785-488f-9ebe-54c435156dcb&query=hell) by vectorpouch on Freepik.
- Fonts:
  - [Cyberphont 3.0](https://finnmercury.itch.io/cyberphont-30) by [Finnmercury](https://finnmercury.itch.io/).
  - [Area51](https://damieng.com/typography/zx-origins/area51/) by [DamienG](https://damieng.com/).
- Music:
  - Menu theme:
    - PROGRESS by [fatal-snipe](https://zxart.ee/eng/authors/f/fatal-snipe/).
  - Ingame theme:
    - LASTCOP by [fatal-snipe](https://zxart.ee/eng/authors/f/fatal-snipe/).
- Tools:
  - Sounds created with [jsfxr](https://sfxr.me).
  - Maps created with [Tiled](https://www.mapeditor.org/).
