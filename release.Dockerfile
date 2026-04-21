# Builds the release for the game server (Debian 13 on ARM64), use `make release_linux_arm64`
# rather than running it directly. Tiled and the Kaitai compiler aren't installed, the map exports
# and the generated parsers don't depend on the platform so they are made on the host and copied in.
FROM elixir:1.19.5-otp-28 AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl python3 python3-venv npm \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g esbuild
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --target wasm32-unknown-unknown
ENV PATH=/root/.cargo/bin:$PATH

WORKDIR /src
COPY . .
# Make the files from the host newer than their sources so make doesn't try to regenerate them
RUN find maps/_temp game/src/game/map_format.rs tools/utils/map_format.py -exec touch {} +
RUN make release ERLANG=/usr/local/bin ELIXIR=/usr/local/bin

FROM scratch
COPY --from=build /src/spawndemonium.tar.gz /spawndemonium-linux-arm64.tar.gz
