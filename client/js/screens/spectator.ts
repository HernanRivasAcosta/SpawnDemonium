import type Game from "../game.ts";
import Leaderboard from "./game/leaderboard.ts";
import MatchScreen from "./match.ts";

// Must be a valid player name (up to 9 letters or digits)
const SPECTATOR_NAME = "SPECTATOR";

// Watching a match without playing. The camera follows the action since there's no camera target
class SpectatorScreen extends MatchScreen {
  #leaderboard: Leaderboard;

  constructor(game: Game, params: Record<string, unknown> | null) {
    super(game, params, SPECTATOR_NAME, true);
    this.#leaderboard = this.addChild(new Leaderboard(this.game));
  }

  update(alpha: number, dt: number) {
    if (this.game.inputMap.shootBtn.justPressed) {
      if (this.#leaderboard.shown) {
        this.#leaderboard.hide();
      } else {
        this.#leaderboard.show();
      }
    }
    super.update(alpha, dt);
  }

  // MatchScreen hooks

  protected onBack(): boolean {
    if (this.#leaderboard.shown) {
      this.#leaderboard.hide();
      return true;
    }
    return false;
  }

  // ConnectionListener implementation

  // The server sends the table after joining and every time it changes, even while it's hidden

  onMessage(payload: unknown): unknown | null {
    const msg = payload as unknown[];
    if (msg[0] === Symbol.for("high_scores")) {
      const decoder = new TextDecoder();
      const scores = (msg[1] as [Uint8Array, number][]).map(
        ([name, score]) => ({ name: decoder.decode(name), score }),
      );
      this.#leaderboard.setScores(scores);
      return null;
    }
    return super.onMessage(payload);
  }
}

export default SpectatorScreen;
