import Screen from "./screen.ts";
import type Game from "../game.ts";
import { ButtonList } from "./common.ts";

class MainMenuScreen extends Screen {
  constructor(game: Game, params: Record<string, unknown> | null = null) {
    super(game, params);
    // Does nothing if the music is already playing, e.g. when coming back from the options
    this.game.music.play("mainTheme");

    this.addChild(
      new ButtonList(
        this.game,
        [
          { id: "playerSetup", text: "Start Game" },
          { id: "spectator", text: "Spectate" },
          { id: "options", text: "Options" },
          { id: "credits", text: "Credits" },
        ],
        "cyberphont3a",
        this.#onButtonSelected.bind(this),
        {
          loopButtons: false,
          buttonSpacing: 20,
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

  #onButtonSelected(selection: string, _value: boolean): void {
    this.manager.push(selection);
  }
}

export default MainMenuScreen;
