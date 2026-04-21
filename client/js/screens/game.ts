import GameUI from "./game/ui.ts";
import {
  type GameEvent,
  PlayerSpawnEvent,
  ScoreUpdateEvent,
  ShotHitPlayerEvent,
} from "./game/events.ts";
import type Game from "../game.ts";
import MatchScreen, { type CameraTarget } from "./match.ts";
import { Tuple } from "../net/etf.ts";

// Number of seconds it takes to respawn
const SPAWN_TIMER = 3;
// The minimum input latency. Any player under this latency will feel the game the same way
const MIN_LATENCY = 50;
// Seconds the camera stays where the player died, so the death animation is seen, before it pans
// to the action
const DEATH_CAMERA_TIME = 1.5;

// Playing a match: spawning, sending the input, following the player and the HUD
class GameScreen extends MatchScreen {
  #ui: GameUI;
  //
  #spawnTick: number;
  #waitingToSpawn: boolean;
  // Where the player is going to spawn, the camera stays there while waiting
  #spawnX: number;
  #spawnY: number;
  #prevInput: number;
  // Ticks left keeping the camera where the player died
  #deathCameraTicks: number;
  // Reused every frame to avoid allocations. It keeps the last position of the player after they
  // die
  #cameraTarget: CameraTarget;

  constructor(game: Game, params: Record<string, unknown> | null) {
    super(game, params, params!.name as string, false);
    this.#ui = this.addChild(new GameUI(this.game));
    this.#spawnTick = -1;
    this.#waitingToSpawn = false;
    this.#spawnX = 0;
    this.#spawnY = 0;
    this.#prevInput = 0;
    this.#deathCameraTicks = 0;
    this.#cameraTarget = { x: 0, y: 0 };
  }

  update(alpha: number, dt: number) {
    if (this.#waitingToSpawn && this.game.inputMap.shootBtn.justPressed) {
      this.#waitingToSpawn = false;
      // Send a spawn request
      this.send(
        new Tuple(
          Symbol("spawn"),
          this.gameTick + this.game.tickRate * SPAWN_TIMER,
        ),
      );
      // The player's inputs were reset when they died, so the keys held now are sent again after
      // the request (the server applies them once the player spawns)
      this.#prevInput = -1;
    }
    super.update(alpha, dt);
  }

  onSynced(): void {
    this.#ui.showInitialPrompt();
    super.onSynced();
  }

  // MatchScreen hooks

  protected onJoined(): void {
    // Request to spawn
    this.#waitingToSpawn = true;
  }

  protected onTick(tick: number): void {
    if (this.#deathCameraTicks > 0) {
      this.#deathCameraTicks--;
    }
    // Update the spawn timer
    if (this.#spawnTick > this.gameTick) {
      const secsToSpawn = Math.ceil(
        (this.#spawnTick - this.gameTick) / this.game.tickRate,
      );
      this.#ui.updateSpawnTimer(secsToSpawn);
    } else if (this.#spawnTick === this.gameTick) {
      this.#ui.hidePrompt();
      // The player spawns with full HP
      this.#ui.setHp(1);
    }
    // Get the current input
    const input = this.game.inputMap.asByte();
    // If the input changed or it's been 200 ticks since the last input, send it
    if (input !== this.#prevInput || tick % 200 === 0) {
      this.#prevInput = input;
      // Calculate the current latency
      const latency = Math.max(this.latency, MIN_LATENCY);
      // Calculate the tick we expect the input to be processed on, accounting for latency
      const inputTick =
        this.gameTick + Math.ceil(latency / this.game.msPerTick);
      this.send(new Tuple(Symbol("input"), inputTick, input));
    }
  }

  protected onEvent(event: GameEvent): void {
    if (event instanceof PlayerSpawnEvent) {
      if (event.id === this.playerId) {
        this.#spawnX = event.x;
        this.#spawnY = event.y;
        this.game.renderer.camera.centerAt(event.x, event.y, true);
        this.#spawnTick = event.tick;
      }
    } else if (event instanceof ShotHitPlayerEvent) {
      if (event.playerId === this.playerId) {
        // TODO: Don't hardcode the HP
        this.#ui.setHp(event.hp / 6);
        // Show the death prompt when the death animation ends
        if (!event.alive) {
          this.#deathCameraTicks = Math.floor(
            DEATH_CAMERA_TIME * this.game.tickRate,
          );
          this.world.playerSprite(event.playerId).onExitFrame(
            () => {
              this.#onPlayerDeath();
            },
            "death",
            3,
          );
        }
      }
    } else if (event instanceof ScoreUpdateEvent) {
      // The other players' scores aren't shown
      if (event.playerId === this.playerId) {
        this.#ui.setScore(event.score);
      }
    }
  }

  protected cameraTarget(alpha: number): CameraTarget | null {
    const player = this.findPlayer(this.playerId);
    if (player !== undefined && player.alive) {
      // Look a bit ahead of the player
      this.#cameraTarget.x =
        player.x + player.vx * alpha + player.orientation * 24;
      this.#cameraTarget.y = player.y + player.vy * alpha;
      return this.#cameraTarget;
    } else if (this.#deathCameraTicks > 0) {
      // Stay where the player was last seen
      return this.#cameraTarget;
    } else if (this.#spawnTick >= this.gameTick) {
      // About to spawn, keep looking at the spawn point
      this.#cameraTarget.x = this.#spawnX;
      this.#cameraTarget.y = this.#spawnY;
      return this.#cameraTarget;
    }
    return null;
  }

  #onPlayerDeath() {
    this.#ui.showSpawnPrompt();
    this.#waitingToSpawn = true;
  }
}

export default GameScreen;
