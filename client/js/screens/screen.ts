import Node from "../core/node.ts";
import type Game from "../game.ts";
import type ScreenManager from "./manager.ts";

abstract class Screen extends Node {
  get width(): number {
    return this.game.renderer.width;
  }
  get height(): number {
    return this.game.renderer.height;
  }
  get left(): number {
    return 0;
  }
  get right(): number {
    return this.width;
  }
  get centerX(): number {
    return this.width / 2;
  }
  get top(): number {
    return 0;
  }
  get bottom(): number {
    return this.height;
  }
  get centerY(): number {
    return this.height / 2;
  }
  protected get manager(): ScreenManager {
    return this.game.screenManager;
  }

  protected readonly params: Record<string, unknown> | null;

  constructor(game: Game, params: Record<string, unknown> | null) {
    super(game);
    this.params = params;
  }

  close() {
    this.manager.pop();
  }
}

export default Screen;
