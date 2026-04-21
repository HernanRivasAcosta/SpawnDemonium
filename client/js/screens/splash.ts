import Screen from "./screen.ts";
import type Game from "../game.ts";
import TextField from "../render/text-field.ts";
import { Sprite } from "../render/sprites.ts";
import Palette from "../render/palette.ts";

class SplashScreen extends Screen {
  #pressStart: TextField;

  constructor(game: Game, params: Record<string, unknown> | null = null) {
    super(game, params);
    // The logo
    const logo = this.addChild(new Sprite(this.game, "logo_v1", "ui"));
    logo.scale = 2;
    logo.centerX = this.centerX;
    logo.centerY = this.height / 2.5;
    // The "Press start" text
    this.#pressStart = this.addChild(
      new TextField(this.game, "cyberphont3a", "Press start"),
    );
    this.#pressStart.scale = 2;
    this.#pressStart.centerX = this.centerX;
    this.#pressStart.centerY = this.height - this.height / 5;
    this.#pressStart.tint = Palette.DEMON_RED;
    this.#pressStart.tintStrength = 1;
  }

  tick(tick: number): void {
    super.tick(tick);

    if (tick % 15 === 0) {
      this.#pressStart.visible = !this.#pressStart.visible;
    }
  }

  update(alpha: number, dt: number): void {
    super.update(alpha, dt);

    if (this.game.inputMap.startBtn.justReleased) {
      this.game.sound.play("menuConfirm");
      this.manager.push("mainMenu");
    }
  }
}

export default SplashScreen;
