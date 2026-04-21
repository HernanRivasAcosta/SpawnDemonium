import type { MapData } from "./game/map.ts";
import { type GameEntity, PlayerEntity, PlayerKind } from "./game/entities.ts";
import {
  type GameEvent,
  PlayerLeftEvent,
  PlayerShotEvent,
  ShotHitEvent,
  ShotHitPlayerEvent,
} from "./game/events.ts";
import Gameloop from "./game/gameloop.ts";
import World from "./game/world.ts";
import SpectatorCamera from "./game/spectator.ts";
import { HUD_PADDING, UI_FONT } from "./game/ui.ts";
import type Game from "../game.ts";
import Screen from "./screen.ts";
import ServerConnection, {
  type ConnectionListener,
} from "../net/connection.ts";
import { Tuple } from "../net/etf.ts";
import TextField from "../render/text-field.ts";
import CONFIG from "../config.ts";

// Seconds the player has to press back a second time to leave the game
const LEAVE_CONFIRM_TIME = 2;

// A point in the world the camera should center on
export interface CameraTarget {
  x: number;
  y: number;
}

// Everything needed to join a match and show it: the connection, the game loop, the world and the
// camera. What's specific to playing is done by the subclasses through the protected hooks
abstract class MatchScreen extends Screen implements ConnectionListener {
  #playerId: number;
  protected get playerId(): number {
    return this.#playerId;
  }
  #players: Map<number, string>;
  #playerName: string;
  #spectating: boolean;
  //
  #connection: ServerConnection;
  // Seconds left to confirm leaving the game, zero when not waiting for a confirmation
  #leaveConfirmTime: number;
  // Shown after pressing back once, while waiting for the second press to leave the game
  #leaveHint: TextField;
  // Shown in the top right corner, under the FPS counter if it's enabled
  #pingText: TextField;
  #lastPing: number;
  //
  #gameTick: number;
  protected get gameTick(): number {
    return this.#gameTick;
  }
  #gameloop: Gameloop;
  #lastServerTick: number;
  #serverEvents: Uint8Array[];
  // Shots announced before the tick they're fired on (NPCs decide theirs ahead of time), their
  // sound and the shooter's animation wait for it
  #pendingShots: PlayerShotEvent[];
  #entities: GameEntity[];
  //
  #world: World;
  protected get world(): World {
    return this.#world;
  }
  // Shows the action when there's no camera target
  #spectator: SpectatorCamera;

  constructor(
    game: Game,
    params: Record<string, unknown> | null,
    name: string,
    spectating: boolean,
  ) {
    super(game, params);
    this.game.music.play("ingame");
    //
    this.#playerId = 0;
    this.#players = new Map();
    // Initialise the game
    this.#gameTick = 0;
    this.#gameloop = new Gameloop(this.game.assets.get("gameloop", "wasm"));
    this.#lastServerTick = 0;
    this.#serverEvents = [];
    this.#pendingShots = [];
    this.#entities = [];
    // Create the world, which renders the map and the entities
    const mapData = this.game.assets.get("mainMap", "map") as MapData;
    this.#world = this.addChild(new World(this.game, mapData));
    // Move the camera to a sensible starting location
    this.#spectator = new SpectatorCamera(
      this.game.renderer.camera,
      this.#world.map,
    );
    this.#spectator.follow(this.#entities, 0, false);
    //
    this.#leaveConfirmTime = 0;
    this.#leaveHint = this.addChild(
      new TextField(this.game, UI_FONT, "Press Esc again to leave"),
    );
    this.#leaveHint.visible = false;
    this.#leaveHint.z = 111;
    // Uses the same font as the FPS counter, so they have the same height
    this.#pingText = this.addChild(new TextField(this.game, "bitty", "-"));
    this.#pingText.z = 255;
    this.#lastPing = NaN;
    // Store the player name and initialise the connection
    this.#playerName = name;
    this.#spectating = spectating;
    this.#connection = this.addChild(new ServerConnection(this.game, this));
    this.#connection.connect();
  }

  // Hooks for the subclasses

  // Called once the game loop is initialised with the server state
  protected onJoined(): void {}

  // Called every tick after the game loop advanced, while in the game
  protected onTick(_tick: number): void {}

  // Called for every event, after the parts that apply to everyone were handled
  protected onEvent(_event: GameEvent): void {}

  // Called when back is pressed. Returns true if it was used for something else, like closing an
  // overlay, so it doesn't count towards leaving the game
  protected onBack(): boolean {
    return false;
  }

  // The camera centers on the returned point, or follows the action when it's null
  protected cameraTarget(_alpha: number): CameraTarget | null {
    return null;
  }

  // Helpers for the subclasses

  protected send(payload: unknown): void {
    this.#connection.send(payload);
  }

  protected get latency(): number {
    return this.#connection.clock.ping / 2;
  }

  protected findPlayer(id: number): PlayerEntity | undefined {
    for (const entity of this.#entities) {
      if (entity instanceof PlayerEntity && entity.id === id) return entity;
    }
    return undefined;
  }

  // Node update logic

  tick(tick: number) {
    super.tick(tick);
    // If we're not in the game yet, don't do anything
    if (!this.#connection.inGame) {
      return;
    }
    // Perform the gameloop tick
    if (!this.#tick()) {
      return;
    }
    this.onTick(tick);
  }

  update(alpha: number, dt: number) {
    // Leaving needs a second press of the back button, so it can't happen by accident
    if (this.game.inputMap.backBtn.justReleased && !this.onBack()) {
      if (this.#leaveConfirmTime > 0) {
        this.game.sound.play("menuConfirm");
        this.close();
        return;
      }
      this.#leaveConfirmTime = LEAVE_CONFIRM_TIME;
      this.#leaveHint.visible = true;
    } else if (this.#leaveConfirmTime > 0) {
      this.#leaveConfirmTime -= dt / 1000;
      if (this.#leaveConfirmTime <= 0) {
        this.#leaveHint.visible = false;
      }
    }

    // Update the sprites based on the current game state
    this.#world.sync(this.#entities, alpha);
    // Without a target, we need to focus on where the action is
    const camera = this.game.renderer.camera;
    const target = this.cameraTarget(alpha);
    if (target !== null) {
      camera.centerAt(target.x, target.y);
      // Forget the previous action, the next search should start from wherever the target was
      this.#spectator.reset();
    } else {
      this.#spectator.follow(this.#entities, alpha);
    }
    // The camera has to move after its target is set and before the children update, so the UI
    // and HP bars are positioned relative to this frame's camera and sprites. Otherwise they
    // would be one frame behind and jitter by a pixel while moving
    camera.update(alpha, dt);
    this.#leaveHint.centerX = camera.centerX;
    this.#leaveHint.bottom = camera.bottom - HUD_PADDING;
    this.#updatePing(camera.right, camera.top);
    super.update(alpha, dt);
  }

  #updatePing(right: number, top: number): void {
    this.#pingText.visible = CONFIG.showPing;
    if (!CONFIG.showPing) return;
    // Only rebuild the text when the value changes, the ping is updated way less often than frames
    const ping = this.#connection.clock.ping;
    // Object.is treats NaN (not synced yet) as equal to itself
    if (!Object.is(ping, this.#lastPing)) {
      this.#lastPing = ping;
      this.#pingText.text = Number.isNaN(ping) ? "-" : `${ping}ms`;
    }
    this.#pingText.right = right;
    this.#pingText.top = CONFIG.showFPS ? top + this.#pingText.height : top;
  }

  // ConnectionListener implementation

  onConnection(): void {
    // Do nothing for now
  }

  onSynced(): void {
    console.debug("Joining game");
    this.#connection.send(
      new Tuple(Symbol("join"), this.#playerName, this.#spectating),
    );
  }

  onGameJoined(
    playerId: number,
    players: Map<number, Uint8Array>,
    state: Map<symbol, unknown>,
  ): void {
    // Store the player list, decoding the names from UTF-8
    this.#players.clear();
    const decoder = new TextDecoder();
    players.forEach((name, id) => this.#players.set(id, decoder.decode(name)));
    // Get the playerId and final name of the current player
    this.#playerId = playerId;
    // Spectators aren't in the player list, so they keep the name they sent
    this.#playerName = this.#players.get(playerId) ?? this.#playerName;
    // Initialise the game loop with the server state
    const wasmState = state.get(Symbol.for("wasm_state")) as Uint8Array;
    this.#lastServerTick = this.#gameloop.initialise(wasmState);
    if (this.#lastServerTick > 0) {
      console.info(
        `Joined game as player ${this.#playerName} (${this.#playerId})`,
      );
      // Fast-forward the gameloop to account for the latency since the server sent the state
      const latency = this.latency;
      const ticksElapsed = Math.floor(latency / this.game.msPerTick);
      console.debug(
        `Fast-forwarding ${ticksElapsed} ticks (latency: ${latency}ms)`,
      );
      for (let i = 0; i < ticksElapsed; i++) {
        if (!this.#tick()) {
          return;
        }
      }
    } else {
      console.error("Failed to initialise game client");
      this.#connection.disconnect();
      return;
    }
    this.onJoined();
  }

  onMessage(payload: unknown): unknown | null {
    const msg = payload as unknown[];
    const payloadType = msg[0] as symbol;
    if (payloadType === Symbol.for("tick")) {
      const [_type, tick, events] = msg as [symbol, number, Uint8Array[]];
      // Store the last known server tick
      this.#lastServerTick = tick;
      // Add the events to the queue to be processed in the next tick
      if (events.length > 0) {
        this.#serverEvents.push(...events);
      }
    } else {
      console.warn("Received unhandled payload:", payload);
    }
    return null;
  }

  onDisconnected(): void {
    console.warn("Disconnected from server");
    this.manager.push("disconnected");
  }

  // Game loop

  // Returns false if the game can't continue, in which case the connection was closed
  #tick(): boolean {
    const frame = this.#gameloop.tick(this.#lastServerTick, this.#serverEvents);
    if (frame === null) {
      this.#connection.disconnect();
      return false;
    }
    this.#serverEvents = [];
    this.#gameTick = frame.tick;
    this.#entities = frame.entities;
    // Handle the events after the entities were updated
    for (const event of frame.events) {
      this.#handleEvent(event);
      this.onEvent(event);
    }
    this.#firePendingShots();
    return true;
  }

  #firePendingShots(): void {
    if (this.#pendingShots.length === 0) return;
    // Compacted in place, it's checked every tick
    let kept = 0;
    for (const shot of this.#pendingShots) {
      if (shot.tick > this.#gameTick) {
        this.#pendingShots[kept++] = shot;
        continue;
      }
      this.#world.playSoundAt("shoot", shot.x, shot.y);
      this.#world.findPlayerSprite(shot.shooterId)?.shoot();
    }
    this.#pendingShots.length = kept;
  }

  #handleEvent(event: GameEvent): void {
    if (event instanceof PlayerLeftEvent) {
      // When the player disconnects, play the death animation
      const playerSprite = this.#world.playerSprite(event.id, PlayerKind.PC, 1);
      playerSprite.play("death");
    } else if (event instanceof PlayerShotEvent) {
      this.#pendingShots.push(event);
    } else if (event instanceof ShotHitEvent) {
      this.#world.playSoundAt("hit", event.x, event.y);
      // The shot hit a wall, remove it
      this.#world.removeShot(event.id);
    } else if (event instanceof ShotHitPlayerEvent) {
      this.#world.playSoundAt("hit", event.x, event.y);
      // The sprite doesn't exist if the hit happened before the player was drawn (while catching
      // up after joining). Creating it here would need its kind, which is gone if the hit killed
      // an NPC
      const playerSprite = this.#world.findPlayerSprite(event.playerId);
      if (playerSprite !== undefined) {
        playerSprite.showHP(event.hp);
        // Play the death animation if the player died
        if (!event.alive) {
          playerSprite.play("death");
          this.#world.playSoundAt(
            playerSprite.deathSound,
            playerSprite.x,
            playerSprite.bottom,
          );
        }
      }
      // Remove the shot sprite
      this.#world.removeShot(event.shotId);
    }
  }
}

export default MatchScreen;
