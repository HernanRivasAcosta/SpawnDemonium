-include .env

WASM_TARGET  = wasm32-unknown-unknown
WASM_SRC     = game/target/$(WASM_TARGET)/release/game.wasm
SERVER_PRIV  = server/priv/
WASM_DST     = $(SERVER_PRIV)/wasm/
MAP_DST      = $(SERVER_PRIV)/maps/
RELEASE_DIR  = server/_build/prod/rel/spawndemonium
RELEASE_TAR  = spawndemonium.tar.gz
STATIC_DST       = $(SERVER_PRIV)/static/
ASSETS_DST       = $(STATIC_DST)/assets/
SPRITESHEET_DST  = $(ASSETS_DST)/spritesheets/
MAP_ASSETS_DST   = $(ASSETS_DST)/maps/
AUDIO_SRC        = assets/audio/
AUDIO_DST        = $(ASSETS_DST)/audio/

ASSETS_BUILD  = assets/_build/
ASSETS_TEMP   = assets/_temp/
ASSETS_SRC    = assets/src/

FONT_SRC              = $(ASSETS_SRC)/fonts/
FONT_TEMP             = $(ASSETS_TEMP)/fonts/
FONT_BUILD            = $(ASSETS_BUILD)fonts/
FONT_SPRITESHEET_DST  = $(SPRITESHEET_DST)/fonts/
FONT_TTF_SIZE         = 8

ENTITIES_SRC  = $(ASSETS_SRC)/entities/
UI_SRC        = $(ASSETS_SRC)/ui/

MAP_SRCS      = $(wildcard maps/src/*.tmx)
MAP_TEMP      = $(patsubst maps/src/%.tmx,maps/_temp/%.json,$(MAP_SRCS))
TILESET_SRCS  = $(wildcard maps/src/tilesets/*.tsx)
TILESET_TEMP  = $(patsubst maps/src/tilesets/%.tsx,maps/_temp/tilesets/%.json,$(TILESET_SRCS))

KSY_SRC      = maps/map.ksy
KSY_DST      = game/src/game/map_format.rs
KSY_PY_DST   = tools/utils/map_format.py

ESBUILD      = esbuild

CLIENT_JS_SRCS   = $(wildcard client/js/*.ts) $(wildcard client/js/*/*.ts) $(wildcard client/js/*/*/*.ts)
CLIENT_JS_DST    = $(STATIC_DST)/js/main.js
CLIENT_CSS_SRC   = client/css/main.css
CLIENT_CSS_DST   = $(STATIC_DST)/css/main.css
CLIENT_HTML_SRC  = client/index.html
CLIENT_HTML_DST  = $(STATIC_DST)/index.html
SHADER_SRCS      = $(wildcard client/shaders/*)
SHADER_DST       = $(ASSETS_DST)/shaders/

PYTHON  = tools/.venv/bin/python
ISORT   = tools/.venv/bin/isort
BLACK   = tools/.venv/bin/black
RUFF    = tools/.venv/bin/ruff

MIX        = $(ELIXIR)/mix
IEX        = $(ELIXIR)/iex
LANG_PATH  = $(ELIXIR):$(ERLANG)
MIX_ENV    = $(if $(DEBUG),dev,prod)

.DEFAULT_GOAL := server

.PHONY: wasm maps fix_maps fonts entities ui client audio server release release_linux_arm64 run shell lint check clean update_tools FORCE

client/node_modules: client/package.json
	cd client && npm install
	touch client/node_modules

tools/.venv: tools/requirements.txt
	python3 -m venv tools/.venv
	tools/.venv/bin/pip install -r tools/requirements.txt
	touch tools/.venv

# The requirements aren't pinned, this upgrades them to their latest versions
update_tools: client/node_modules
	python3 -m venv --clear tools/.venv
	tools/.venv/bin/pip install --upgrade pip -r tools/requirements.txt
	touch tools/.venv
	cd client && npm update

$(KSY_DST): $(KSY_SRC)
	kaitai-struct-compiler -t rust --outdir game/src/game $(KSY_SRC)

$(KSY_PY_DST): $(KSY_SRC)
	kaitai-struct-compiler -t python --outdir tools/utils $(KSY_SRC)

wasm: $(KSY_DST)
	rustup target add $(WASM_TARGET)
	RUSTFLAGS="$(if $(DEBUG),--cfg debug_logging)" cargo build --manifest-path game/Cargo.toml --target $(WASM_TARGET) --release

$(WASM_DST):
	mkdir -p $(WASM_DST)

maps/_temp/%.json: maps/src/%.tmx
	mkdir -p maps/_temp
	tiled --export-map $(CURDIR)/$< $(CURDIR)/$@

maps/_temp/tilesets/%.json: maps/src/tilesets/%.tsx
	mkdir -p maps/_temp/tilesets
	tiled --export-tileset $(CURDIR)/$< $(CURDIR)/$@

maps/_build/.stamp: tools/.venv $(MAP_TEMP) $(TILESET_TEMP) $(KSY_PY_DST)
	mkdir -p maps/_build
	$(PYTHON) tools/pack_map_sprites.py maps/_temp maps/_build env
	$(PYTHON) tools/process_map.py maps/_temp maps/_build env
	$(if $(DEBUG),$(PYTHON) tools/generate_previews.py maps/_build)
	touch maps/_build/.stamp

# Rewrites the .tmx sources in place, so it is not part of any other target.
# Make sure the map(s) are closed in Tiled before running it
fix_maps: tools/.venv
	$(PYTHON) tools/fix_maps.py $(MAP_SRCS)

maps: maps/_build/.stamp
	mkdir -p $(MAP_DST)
	cp maps/_build/*.map $(MAP_DST)
	mkdir -p $(SPRITESHEET_DST)
	for f in maps/_build/*.atlas; do \
		cp $$f $(SPRITESHEET_DST); \
		cp $${f%.atlas}.png $(SPRITESHEET_DST); \
	done
	mkdir -p $(MAP_ASSETS_DST)
	cp maps/_build/*.json $(MAP_ASSETS_DST)

$(CLIENT_JS_DST): $(CLIENT_JS_SRCS) $(if $(FORCE),FORCE)
	mkdir -p $(STATIC_DST)/js
	$(ESBUILD) client/js/main.ts --bundle --pure:console.debug --pure:console.trace $(if $(DEBUG),,--minify) --outfile=$(CLIENT_JS_DST)

$(CLIENT_CSS_DST): $(CLIENT_CSS_SRC)
	mkdir -p $(STATIC_DST)/css
	cp $(CLIENT_CSS_SRC) $(CLIENT_CSS_DST)

$(CLIENT_HTML_DST): $(CLIENT_HTML_SRC)
	cp $(CLIENT_HTML_SRC) $(CLIENT_HTML_DST)

$(SHADER_DST): $(SHADER_SRCS)
	mkdir -p $(SHADER_DST)
	cp $(SHADER_SRCS) $(SHADER_DST)

client: $(CLIENT_JS_DST) $(CLIENT_CSS_DST) $(CLIENT_HTML_DST) $(SHADER_DST)

$(FONT_TEMP).stamp: tools/.venv
	$(PYTHON) tools/render_fonts.py $(FONT_SRC) $(FONT_TEMP) --size $(FONT_TTF_SIZE)
	touch $(FONT_TEMP).stamp

$(FONT_BUILD).stamp: tools/.venv $(FONT_TEMP).stamp
	mkdir -p $(FONT_BUILD)
	for d in $(FONT_TEMP)*/; do \
		$(PYTHON) tools/pack_sprites.py --hex-keys --no-trim "$$d" $(FONT_BUILD); \
	done
	touch $(FONT_BUILD).stamp

fonts: $(FONT_BUILD).stamp
	mkdir -p $(FONT_SPRITESHEET_DST)
	for f in $(FONT_BUILD)*.atlas; do \
		cp $$f $(FONT_SPRITESHEET_DST); \
		cp $${f%.atlas}.png $(FONT_SPRITESHEET_DST); \
	done

# The directory is a prerequisite too, its timestamp changes when files are deleted or renamed
$(ASSETS_BUILD)entities.stamp: tools/.venv $(ENTITIES_SRC) $(wildcard $(ENTITIES_SRC)*.png)
	$(PYTHON) tools/pack_sprites.py $(ENTITIES_SRC) $(ASSETS_BUILD)
	touch $(ASSETS_BUILD)entities.stamp

entities: $(ASSETS_BUILD)entities.stamp
	mkdir -p $(SPRITESHEET_DST)
	cp $(ASSETS_BUILD)entities.atlas $(SPRITESHEET_DST)
	cp $(ASSETS_BUILD)entities.png $(SPRITESHEET_DST)

$(ASSETS_BUILD)ui.stamp: tools/.venv $(UI_SRC) $(wildcard $(UI_SRC)*.png)
	$(PYTHON) tools/pack_sprites.py $(UI_SRC) $(ASSETS_BUILD)
	touch $(ASSETS_BUILD)ui.stamp

ui: $(ASSETS_BUILD)ui.stamp
	mkdir -p $(SPRITESHEET_DST)
	cp $(ASSETS_BUILD)ui.atlas $(SPRITESHEET_DST)
	cp $(ASSETS_BUILD)ui.png $(SPRITESHEET_DST)

audio:
	mkdir -p $(AUDIO_DST)
	cp -r $(AUDIO_SRC). $(AUDIO_DST)

server: wasm $(WASM_DST) maps fonts entities ui client audio
	mkdir -p $(WASM_DST)
	cp $(WASM_SRC) $(WASM_DST)
	PATH=$(LANG_PATH):$$PATH $(MIX) local.hex --force --if-missing
	PATH=$(LANG_PATH):$$PATH $(MIX) local.rebar --force --if-missing
	cd server && PATH=$(LANG_PATH):$$PATH $(MIX) deps.get $(if $(DEBUG),,--only prod)
	$(if $(DEBUG),,cd server && PATH=$(LANG_PATH):$$PATH MIX_ENV=$(MIX_ENV) $(MIX) release --overwrite)

release: server
	$(if $(DEBUG),$(error DEBUG builds don't produce a release))
	tar -czf $(RELEASE_TAR) -C $(dir $(RELEASE_DIR)) spawndemonium

# Same as release but built in Docker for the game server (Debian 13 on ARM64)
release_linux_arm64: $(MAP_TEMP) $(TILESET_TEMP) $(KSY_DST) $(KSY_PY_DST)
	docker build --platform linux/arm64 -f release.Dockerfile --output type=local,dest=. .

run: server
	$(if $(DEBUG),\
		cd server && SECRET_KEY_BASE=$(SECRET_KEY_BASE) PATH=$(LANG_PATH):$$PATH MIX_ENV=dev $(MIX) phx.server,\
		SECRET_KEY_BASE=$(SECRET_KEY_BASE) server/_build/prod/rel/spawndemonium/bin/spawndemonium start)

shell: server
	$(if $(DEBUG),\
		cd server && SECRET_KEY_BASE=$(SECRET_KEY_BASE) PATH=$(LANG_PATH):$$PATH MIX_ENV=dev $(IEX) -S $(MIX) phx.server,\
		SECRET_KEY_BASE=$(SECRET_KEY_BASE) server/_build/prod/rel/spawndemonium/bin/spawndemonium start_iex)

lint: tools/.venv client/node_modules
	cargo fmt --manifest-path game/Cargo.toml
	cd server && PATH=$(LANG_PATH):$$PATH $(MIX) format
	$(ISORT) --profile black --src tools --quiet tools/
	$(BLACK) tools/
	cd client && node_modules/.bin/prettier --write js/

check: tools/.venv client/node_modules
	cargo fmt --manifest-path game/Cargo.toml --check
	cargo clippy --manifest-path game/Cargo.toml -- -D warnings
	$(RUFF) check --cache-dir tools/.ruff_cache tools/
	$(PYTHON) tools/check_maps.py $(MAP_SRCS)
	cd client && node_modules/.bin/eslint js/
	cd client && node_modules/.bin/tsc --project tsconfig.json
	cd server && PATH=$(LANG_PATH):$$PATH $(MIX) dialyzer

clean:
	cargo clean --manifest-path game/Cargo.toml
	cd server && PATH=$(LANG_PATH):$$PATH $(MIX) clean
	rm -rf $(WASM_DST) $(MAP_DST) $(SPRITESHEET_DST) $(MAP_ASSETS_DST) $(AUDIO_DST) $(SHADER_DST)
	rm -f $(CLIENT_JS_DST) $(CLIENT_CSS_DST) $(CLIENT_HTML_DST) $(RELEASE_TAR) spawndemonium-linux-arm64.tar.gz
	rm -f $(KSY_DST) $(KSY_PY_DST)
	rm -rf maps/_temp maps/_build
	rm -rf $(ASSETS_BUILD) $(ASSETS_TEMP)
