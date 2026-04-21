import Node from "../core/node.ts";
import type Game from "../game.ts";
import type Screen from "./screen.ts";

type ScreenConstructor = new (
  game: Game,
  params: Record<string, unknown> | null,
) => Screen;

class ScreenManager extends Node {
  #screens: Record<string, ScreenConstructor>;
  #currentScreen: Screen | null;
  #currentScreenName: string | null;

  #stack: string[];

  constructor(game: Game, screens: Record<string, ScreenConstructor>) {
    super(game);
    this.#screens = screens;
    this.#currentScreen = null;
    this.#currentScreenName = null;
    this.#stack = [];
  }

  push(screenName: string, params: Record<string, unknown> | null = null) {
    if (this.#currentScreen && this.#currentScreenName) {
      this.#stack.push(this.#currentScreenName);
      this.#currentScreen.remove();
    }
    // Reset the camera
    this.game.renderer.camera.reset();
    // Set the new screen
    this.#currentScreenName = screenName;
    this.#currentScreen = this.addChild(
      new this.#screens[screenName](this.game, params),
    );
  }

  pop(until: string | null = null) {
    if (until !== null) {
      while (
        this.#stack.length > 1 &&
        this.#stack[this.#stack.length - 1] !== until
      ) {
        this.#stack.pop();
      }
    }

    const prev = this.#stack.pop();
    if (this.#currentScreen && prev) {
      this.#currentScreen.remove();
      this.game.renderer.camera.reset();
      this.#currentScreenName = prev;
      this.#currentScreen = this.addChild(
        new this.#screens[prev](this.game, null),
      );
    }
  }
}

export default ScreenManager;
