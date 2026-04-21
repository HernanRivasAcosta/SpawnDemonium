import Screen from "./screen.ts";
import type Game from "../game.ts";
import { ButtonList } from "./common.ts";
import CONFIG from "../config.ts";

class OptionsScreen extends Screen {
  constructor(game: Game, params: Record<string, unknown> | null = null) {
    super(game, params);

    this.addChild(
      new ButtonList(
        this.game,
        [
          {
            id: "crt",
            text: "CRT filter",
            checkbox: true,
            default: CONFIG.crtFilter,
          },
          {
            id: "fps",
            text: "Show FPS",
            checkbox: true,
            default: CONFIG.showFPS,
          },
          {
            id: "ping",
            text: "Show ping",
            checkbox: true,
            default: CONFIG.showPing,
          },
          { id: "sound", text: "Sound", checkbox: true, default: CONFIG.sound },
          { id: "music", text: "Music", checkbox: true, default: CONFIG.music },
          {
            id: "persistName",
            text: "Save name",
            checkbox: true,
            default: CONFIG.persistName,
          },
          { id: "back", text: "Back", extraSpacing: 18 },
        ],
        "cyberphont3a",
        this.#onButtonSelected.bind(this),
        {
          loopButtons: false,
          buttonSpacing: 12,
          centerX: this.centerX,
          top: this.height / 3,
        },
      ),
    );
  }

  update(alpha: number, dt: number): void {
    super.update(alpha, dt);

    if (this.game.inputMap.backBtn.justReleased) {
      this.game.sound.play("menuConfirm");
      this.close();
    }
  }

  #onButtonSelected(selection: string, value: boolean): void {
    switch (selection) {
      case "back":
        this.close();
        break;
      case "crt":
        CONFIG.crtFilter = value;
        break;
      case "fps":
        CONFIG.showFPS = value;
        break;
      case "ping":
        CONFIG.showPing = value;
        break;
      case "sound":
        CONFIG.sound = value;
        this.game.sound.enabled = value;
        break;
      case "music":
        CONFIG.music = value;
        this.game.music.enabled = value;
        break;
      case "persistName":
        CONFIG.persistName = value;
        break;
      default:
        console.error("Unknown option selected", selection);
    }
  }
}

export default OptionsScreen;
