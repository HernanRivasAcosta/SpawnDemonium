import { type Assets } from "./assets.ts";
import MusicPlayer from "./audio/music-player.ts";
import SoundPlayer from "./audio/sound-player.ts";
import Node from "./core/node.ts";
import Input from "./core/input.ts";
import { KeyCodes, XBOXMappings } from "./core/input/mappings.ts";
import Renderer from "./render/renderer.ts";
import SplashScreen from "./screens/splash.ts";
import MainMenuScreen from "./screens/main-menu.ts";
import OptionsScreen from "./screens/options.ts";
import CreditsScreen from "./screens/credits.ts";
import PlayerSetupScreen from "./screens/player-setup.ts";
import GameScreen from "./screens/game.ts";
import SpectatorScreen from "./screens/spectator.ts";
import DisconnectedScreen from "./screens/disconnected.ts";
import ScreenManager from "./screens/manager.ts";

class InputMap {
  #hAxis: Input.Axis;
  get hAxis(): Input.Axis {
    return this.#hAxis;
  }
  #vAxis: Input.Axis;
  get vAxis(): Input.Axis {
    return this.#vAxis;
  }
  #acceptBtn: Input.Button;
  get acceptBtn(): Input.Button {
    return this.#acceptBtn;
  }
  #shootBtn: Input.Button;
  get shootBtn(): Input.Button {
    return this.#shootBtn;
  }
  #startBtn: Input.Button;
  get startBtn(): Input.Button {
    return this.#startBtn;
  }
  #backBtn: Input.Button;
  get backBtn(): Input.Button {
    return this.#backBtn;
  }
  #deleteBtn: Input.Button;
  get deleteBtn(): Input.Button {
    return this.#deleteBtn;
  }

  constructor(input: Input) {
    this.#hAxis = input.addAxis("h", {
      decrementKeys: [KeyCodes.LEFT],
      incrementKeys: [KeyCodes.RIGHT],
      gamepadAxis: XBOXMappings.AXES.L_H,
      gamepadDecrementButtons: [XBOXMappings.D_LEFT],
      gamepadIncrementButtons: [XBOXMappings.D_RIGHT],
    });
    this.#vAxis = input.addAxis("v", {
      decrementKeys: [KeyCodes.UP],
      incrementKeys: [KeyCodes.DOWN],
      gamepadAxis: XBOXMappings.AXES.L_V,
      gamepadDecrementButtons: [XBOXMappings.D_UP],
      gamepadIncrementButtons: [XBOXMappings.D_DOWN],
    });
    this.#acceptBtn = input.addButton("accept", {
      keys: [KeyCodes.ENTER],
      gamepadButtons: [XBOXMappings.A],
    });
    this.#shootBtn = input.addButton("shoot", {
      keys: [KeyCodes.SPACE],
      gamepadButtons: [XBOXMappings.A],
    });
    this.#startBtn = input.addButton("start", {
      keys: [KeyCodes.ENTER, KeyCodes.SPACE],
      gamepadButtons: [XBOXMappings.A, XBOXMappings.START],
    });
    this.#backBtn = input.addButton("back", {
      keys: [KeyCodes.ESC],
      gamepadButtons: [XBOXMappings.B],
    });
    this.#deleteBtn = input.addButton("delete", {
      keys: [KeyCodes.BACKSPACE],
      gamepadButtons: [XBOXMappings.X],
    });
  }

  asByte() {
    // Matches the format in input.rs
    let byte = 0;
    if (this.hAxis.value > 0) {
      byte |= 1;
    } else if (this.hAxis.value < 0) {
      byte |= 2;
    }
    if (this.vAxis.value > 0) {
      byte |= 4;
    } else if (this.vAxis.value < 0) {
      byte |= 8;
    }
    if (this.shootBtn.pressed) {
      byte |= 16;
    }
    return byte;
  }
}

class Game extends Node {
  #assets: Assets;
  get assets(): Assets {
    return this.#assets;
  }
  #renderer: Renderer;
  get renderer(): Renderer {
    return this.#renderer;
  }
  get width(): number {
    return this.#renderer.width;
  }
  get height(): number {
    return this.#renderer.height;
  }
  #input: Input;
  get input(): Input {
    return this.#input;
  }
  #inputMap: InputMap;
  get inputMap(): InputMap {
    return this.#inputMap;
  }
  #music: MusicPlayer;
  get music(): MusicPlayer {
    return this.#music;
  }
  #sound: SoundPlayer;
  get sound(): SoundPlayer {
    return this.#sound;
  }
  //
  #screenManager: ScreenManager;
  get screenManager(): ScreenManager {
    return this.#screenManager;
  }
  // Game loop utilities
  #tick: number = 0;
  #tickRate: number = 0;
  get tickRate(): number {
    return this.#tickRate;
  }
  #msPerTick: number = 0;
  get msPerTick(): number {
    return this.#msPerTick;
  }
  #updateFun: (time: number) => void;
  #lastTime: number = 0;

  constructor(
    w: number,
    h: number,
    displayScale: number,
    assets: Assets,
    audioContext: AudioContext,
  ) {
    super(null);
    this.#assets = assets;
    this.#music = new MusicPlayer(audioContext, assets);
    this.#sound = new SoundPlayer(audioContext, assets);
    this.#renderer = this.addChild(new Renderer(this, w, h, displayScale));
    this.#renderer.initialise();
    // Set the inputs
    this.#input = new Input();
    this.#inputMap = new InputMap(this.#input);
    // Create the screen manager and its configuration
    const screens = {
      splash: SplashScreen,
      mainMenu: MainMenuScreen,
      options: OptionsScreen,
      credits: CreditsScreen,
      playerSetup: PlayerSetupScreen,
      game: GameScreen,
      spectator: SpectatorScreen,
      disconnected: DisconnectedScreen,
    };
    this.#screenManager = this.addChild(new ScreenManager(this, screens));
    this.#screenManager.push("splash");
    // Bind the callback
    this.#updateFun = this.#update.bind(this);
  }

  initialise(): void {
    this.#tick = 0;
    this.#tickRate = 40;
    this.#msPerTick = 1000 / this.#tickRate;
    this.#lastTime = 0;
    requestAnimationFrame((t) => this.#updateFun(t));
  }

  #update(time: number): void {
    const dt = time - this.#lastTime;
    this.#lastTime = time;
    //
    const rawTick = time / this.#msPerTick;
    const targetTick = Math.floor(rawTick);
    // The alpha is used to interpolate between ticks
    const alpha = rawTick - targetTick;
    // Update the inputs
    this.#input.preUpdate(alpha);
    // Update the tick
    while (targetTick > this.#tick) {
      this.#tick += 1;
      this.tick(this.#tick);
    }
    // Update all children
    this.update(alpha, dt);
    // The input post update is needed to clear the "justChanged" values of the inputs
    this.#input.postUpdate();
    // Schedule the next frame
    requestAnimationFrame((t) => this.#updateFun(t));
  }
}

export default Game;
