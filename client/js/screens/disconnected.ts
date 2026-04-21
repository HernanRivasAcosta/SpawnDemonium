import Screen from "./screen.ts";
import type Game from "../game.ts";
import TextField from "../render/text-field.ts";
import Palette from "../render/palette.ts";

class DisconnectedScreen extends Screen {
  constructor(game: Game, params: Record<string, unknown> | null = null) {
    super(game, params);

    const msg = this.addChild(
      new TextField(this.game, "cyberphont3a", "You've been disconnected"),
    );
    msg.scale = 2;
    msg.centerX = this.centerX;
    msg.bottom = this.centerY - 20;

    const btn = this.addChild(new TextField(this.game, "cyberphont3a", "Back"));
    btn.scale = 2;
    btn.centerX = this.centerX;
    btn.top = this.centerY + 20;
    btn.tint = Palette.ELIXIR_PURPLE;
    btn.tintStrength = 1;
  }

  update(alpha: number, dt: number): void {
    super.update(alpha, dt);

    if (
      this.game.inputMap.backBtn.justReleased ||
      this.game.inputMap.acceptBtn.justReleased
    ) {
      this.game.sound.play("menuConfirm");
      this.manager.pop("mainMenu");
    }
  }
}

export default DisconnectedScreen;
