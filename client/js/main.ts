import AssetManager, { type ManifestEntry } from "./assets.ts";
import Game from "./game.ts";

const W = 360;
const H = 240;

// The canvas is rendered at a higher resolution for the CRT post-process pass.
// Expose the display dimensions as CSS custom properties for layout.
const DISPLAY_SCALE = 4;
document.documentElement.style.setProperty(
  "--canvas-w",
  String(W * DISPLAY_SCALE),
);
document.documentElement.style.setProperty(
  "--canvas-h",
  String(H * DISPLAY_SCALE),
);

const MANIFEST: ManifestEntry[] = [
  { name: "gameloop", type: "wasm", url: "/wasm/game.wasm" },
  {
    name: "env",
    type: "spritesheet",
    atlasUrl: "/assets/spritesheets/env.atlas",
    imageUrl: "/assets/spritesheets/env.png",
  },
  {
    name: "entities",
    type: "spritesheet",
    atlasUrl: "/assets/spritesheets/entities.atlas",
    imageUrl: "/assets/spritesheets/entities.png",
  },
  {
    name: "ui",
    type: "spritesheet",
    atlasUrl: "/assets/spritesheets/ui.atlas",
    imageUrl: "/assets/spritesheets/ui.png",
  },
  { name: "mainMap", type: "map", url: "/assets/maps/main.json" },
  {
    name: "mainVertexShader",
    type: "shader",
    url: "/assets/shaders/main.vert",
  },
  {
    name: "mainFragmentShader",
    type: "shader",
    url: "/assets/shaders/main.frag",
  },
  {
    name: "crtVertexShader",
    type: "shader",
    url: "/assets/shaders/crt.vert",
  },
  {
    name: "crtFragmentShader",
    type: "shader",
    url: "/assets/shaders/crt.frag",
  },
  /*
    FONTS
  */
  {
    name: "cherry13R",
    type: "spritesheet",
    atlasUrl: "/assets/spritesheets/fonts/cherry-13-r.atlas",
    imageUrl: "/assets/spritesheets/fonts/cherry-13-r.png",
  },
  {
    name: "cyberphont3a",
    type: "spritesheet",
    atlasUrl: "/assets/spritesheets/fonts/cyberphont-30-a.atlas",
    imageUrl: "/assets/spritesheets/fonts/cyberphont-30-a.png",
  },
  {
    name: "cyberphont3b",
    type: "spritesheet",
    atlasUrl: "/assets/spritesheets/fonts/cyberphont-30-b.atlas",
    imageUrl: "/assets/spritesheets/fonts/cyberphont-30-b.png",
  },
  {
    name: "bitty",
    type: "spritesheet",
    atlasUrl: "/assets/spritesheets/fonts/bitty.atlas",
    imageUrl: "/assets/spritesheets/fonts/bitty.png",
  },
  {
    name: "area51",
    type: "spritesheet",
    atlasUrl: "/assets/spritesheets/fonts/area51.atlas",
    imageUrl: "/assets/spritesheets/fonts/area51.png",
  },
  { name: "shoot", type: "sound", url: "/assets/audio/sfx/shoot.wav" },
  { name: "hit", type: "sound", url: "/assets/audio/sfx/hit.wav" },
  { name: "explosion", type: "sound", url: "/assets/audio/sfx/explosion.wav" },
  { name: "death", type: "sound", url: "/assets/audio/sfx/death.wav" },
  { name: "spawn", type: "sound", url: "/assets/audio/sfx/spawn.wav" },
  { name: "menuMove", type: "sound", url: "/assets/audio/sfx/menu_move.wav" },
  {
    name: "menuConfirm",
    type: "sound",
    url: "/assets/audio/sfx/menu_confirm.wav",
  },
  {
    name: "mainTheme",
    type: "music",
    url: "/assets/audio/music/main_theme.ogg",
    // The track doesn't loop cleanly, so its end is crossfaded with its start
    loopCrossfade: 4,
  },
  {
    name: "ingame",
    type: "music",
    url: "/assets/audio/music/ingame.ogg",
    loopCrossfade: 4,
  },
];

(async () => {
  // The context starts suspended until the first user interaction, but it can already decode
  const audioContext = new AudioContext();
  const assets = await new AssetManager(MANIFEST, audioContext).load();
  const game = new Game(W, H, DISPLAY_SCALE, assets, audioContext);
  game.initialise();
})();
