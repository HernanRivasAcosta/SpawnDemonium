import type Game from "../../game.ts";
import Node from "../../core/node.ts";
import { Sprite } from "../../render/sprites.ts";
import TextField from "../../render/text-field.ts";

export const HUD_PADDING = 6;
export const UI_FONT = "cyberphont3a";

// The prompt elements are created and removed together, so they're grouped to keep them in sync
interface Prompt {
  background: Sprite;
  title: TextField;
  subtitle: TextField;
}

class GameUI extends Node {
  #hpBar: Sprite;
  #scoreText: TextField;
  #prompt: Prompt | null;

  constructor(game: Game) {
    super(game);
    this.#scoreText = this.addChild(new TextField(this.game, UI_FONT));
    this.#hpBar = this.addChild(new Sprite(this.game, "", "ui"));
    // Initialise the UI
    this.setScore(0);
    this.setHp(1);
    // Initialise the prompt
    this.#prompt = null;
  }

  setScore(score: number): void {
    this.#scoreText.text = `Score: ${score}`;
  }

  setHp(hp: number): void {
    this.#hpBar.id = `player_hp_${Math.floor(hp * 9)}`;
  }

  showInitialPrompt(): void {
    const prompt = this.#ensurePrompt();
    prompt.title.text = "Welcome";
    prompt.subtitle.text = "Press shoot to spawn";
  }

  showSpawnPrompt(): void {
    const prompt = this.#ensurePrompt();
    prompt.title.text = "Process terminated";
    prompt.subtitle.text = "Press shoot to spawn";
  }

  updateSpawnTimer(secondsLeft: number): void {
    const prompt = this.#ensurePrompt();
    prompt.title.text = "Spawning in";
    prompt.subtitle.text = `${secondsLeft}`;
  }

  hidePrompt(): void {
    if (this.#prompt !== null) {
      this.#prompt.background.remove();
      this.#prompt.title.remove();
      this.#prompt.subtitle.remove();
      this.#prompt = null;
    } else {
      console.warn("Unable to hide already hidden prompt");
    }
  }

  update(alpha: number, dt: number): void {
    super.update(alpha, dt);

    // We need to update the positions of the UI elements every frame, since the camera can move
    this.#hpBar.left = this.game.renderer.camera.left + HUD_PADDING;
    this.#scoreText.left = this.#hpBar.right + 10;
    this.#scoreText.top = this.game.renderer.camera.top + HUD_PADDING;
    this.#hpBar.centerY = this.#scoreText.centerY;
    this.#hpBar.z = 100;
    this.#scoreText.z = 100;
    // Update the position of the message container if it exists
    if (this.#prompt !== null) {
      const { background, title, subtitle } = this.#prompt;
      // Position the background
      background.width = this.game.renderer.camera.width;
      background.height = this.game.renderer.camera.height;
      background.centerX = this.game.renderer.camera.centerX;
      background.centerY = this.game.renderer.camera.centerY;
      background.z = 109;
      // Update the message
      title.centerX = this.game.renderer.camera.centerX;
      title.bottom = this.game.renderer.camera.centerY - 5;
      title.z = 110;
      subtitle.centerX = this.game.renderer.camera.centerX;
      subtitle.top = this.game.renderer.camera.centerY + 5;
      subtitle.z = 110;
    }
  }

  #ensurePrompt(): Prompt {
    if (this.#prompt === null) {
      const background = this.addChild(
        new Sprite(this.game, "background", "ui"),
      );
      const title = this.addChild(new TextField(this.game, UI_FONT));
      title.scale = 3;
      const subtitle = this.addChild(new TextField(this.game, UI_FONT));
      subtitle.scale = 2;
      this.#prompt = { background, title, subtitle };
    }
    return this.#prompt;
  }
}

export default GameUI;
