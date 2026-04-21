import type Game from "../../game.ts";
import Node from "../../core/node.ts";
import { Sprite } from "../../render/sprites.ts";
import TextField from "../../render/text-field.ts";
import { UI_FONT } from "./ui.ts";

// Matches @max_entries in high_scores.ex
const MAX_ROWS = 5;
const ROW_WIDTH = 210;
// Fixed, so the rows are spaced evenly even when some are empty (and have no height)
const ROW_HEIGHT = 24;
const TITLE_TOP = 30;
const ROWS_TOP = 90;

export interface HighScore {
  name: string;
  score: number;
}

interface Row {
  name: TextField;
  score: TextField;
}

// The best scores in the server, over the dimmed play area like the GameUI prompts. Everything is
// created once and hidden, since it's toggled often
class Leaderboard extends Node {
  #background: Sprite;
  #title: TextField;
  #rows: Row[];
  #shown: boolean;
  get shown(): boolean {
    return this.#shown;
  }

  constructor(game: Game) {
    super(game);
    this.#background = this.addChild(new Sprite(this.game, "background", "ui"));
    this.#title = this.addChild(
      new TextField(this.game, UI_FONT, "Leaderboard"),
    );
    this.#title.scale = 3;
    this.#rows = [];
    for (let i = 0; i < MAX_ROWS; i++) {
      const name = this.addChild(new TextField(this.game, UI_FONT));
      const score = this.addChild(new TextField(this.game, UI_FONT));
      name.scale = 2;
      score.scale = 2;
      this.#rows.push({ name, score });
    }
    this.#shown = true;
    this.hide();
  }

  setScores(scores: HighScore[]): void {
    for (let i = 0; i < MAX_ROWS; i++) {
      const row = this.#rows[i];
      row.name.text = i < scores.length ? scores[i].name : "";
      row.score.text = i < scores.length ? `${scores[i].score}` : "";
    }
  }

  show(): void {
    this.#setVisible(true);
  }

  hide(): void {
    this.#setVisible(false);
  }

  update(alpha: number, dt: number): void {
    super.update(alpha, dt);
    if (!this.#shown) {
      return;
    }
    // Like the GameUI, everything follows the camera
    const camera = this.game.renderer.camera;
    this.#background.width = camera.width;
    this.#background.height = camera.height;
    this.#background.centerX = camera.centerX;
    this.#background.centerY = camera.centerY;
    this.#background.z = 109;
    this.#title.centerX = camera.centerX;
    this.#title.top = camera.top + TITLE_TOP;
    this.#title.z = 110;
    // Names are left aligned and scores right aligned, in a column centered on the screen
    const left = camera.centerX - ROW_WIDTH / 2;
    let top = camera.top + ROWS_TOP;
    for (const { name, score } of this.#rows) {
      name.left = left;
      name.top = top;
      name.z = 110;
      score.right = left + ROW_WIDTH;
      score.top = top;
      score.z = 110;
      top += ROW_HEIGHT;
    }
  }

  #setVisible(visible: boolean): void {
    if (visible === this.#shown) {
      return;
    }
    this.#shown = visible;
    this.#background.visible = visible;
    this.#title.visible = visible;
    for (const { name, score } of this.#rows) {
      name.visible = visible;
      score.visible = visible;
    }
  }
}

export default Leaderboard;
