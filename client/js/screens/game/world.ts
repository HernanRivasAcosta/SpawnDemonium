import Node from "../../core/node.ts";
import type Game from "../../game.ts";
import {
  Sprite,
  AnimatedSprite,
  type FrameCallback,
} from "../../render/sprites.ts";
import {
  type GameEntity,
  PlayerEntity,
  PlayerKind,
  ShotEntity,
} from "./entities.ts";
import GameMap, { type MapData } from "./map.ts";

// TODO: These animations should be defined in some other format instead of hardcoded here
// The first animation is the one the sprite starts with
const PC_ANIMATIONS = {
  idle: 1,
  run: 4,
  spawn: 4,
  death: 4,
};
const NPC1_ANIMATIONS = {
  idle: 4,
  move: 4,
  death: 8,
  shoot: 4,
};
const NPC2_ANIMATIONS = {
  idle: 8,
  move: 4,
  death: 8,
  shoot: 4,
};
// The HP bars have a frame for each HP from 0 to 6
const HP_BAR_FRAMES = 6;
const SHOT_ANIMATIONS = {
  fly: 4,
};
// The bullets drawn at their real size instead of ENTITY_SCALE, by sprite id (the NPCs' bullet3
// looks too big when scaled)
const UNSCALED_BULLETS = new Set([3]);
// The animation speed is in ticks per frame, so the animation is framerate independent
const ANIMATION_SPEED = 6;
// The number of ticks the spawn animation lasts
const SPAWN_ANIMATION_TICKS = PC_ANIMATIONS.spawn * ANIMATION_SPEED;
// The scale of all the entities (their sprites are based around 16x16 instead of 32x32)
const ENTITY_SCALE = 2;
// The amount of time the HP bar lingers after changing (in seconds)
const HP_LINGER_TIME = 1.5;
// Sounds on screen play at full volume with no pan, sounds off screen are fully panned and silent
// at these distances from the edge of the screen
const SOUND_PAN_DISTANCE = 120;
const SOUND_MAX_DISTANCE = 480;

// How each kind of player is drawn
interface PlayerLook {
  // PCs have a sprite per colour, NPCs only have one
  sprite(spriteId: number): string;
  animations: Record<string, number>;
  // The animation played while moving
  move: string;
  // The sound played when they die
  deathSound: string;
  // Must match the max_hp of the kind in game.rs, the HP bar is scaled to it
  maxHp: number;
}
const PLAYER_LOOKS: Record<number, PlayerLook> = {
  [PlayerKind.PC]: {
    sprite: (spriteId) => `pc${spriteId}`,
    animations: PC_ANIMATIONS,
    move: "run",
    deathSound: "death",
    maxHp: 6,
  },
  [PlayerKind.NPC1]: {
    sprite: () => "npc1",
    animations: NPC1_ANIMATIONS,
    move: "move",
    deathSound: "explosion",
    maxHp: 3,
  },
  [PlayerKind.NPC2]: {
    sprite: () => "npc2",
    animations: NPC2_ANIMATIONS,
    move: "move",
    deathSound: "explosion",
    maxHp: 6,
  },
};

export class PlayerSprite extends AnimatedSprite {
  #hpBar: Sprite | null;
  #hpBarTimer: number = 0;
  #deathSound: string;
  get deathSound(): string {
    return this.#deathSound;
  }
  #moveAnimation: string;
  get moveAnimation(): string {
    return this.#moveAnimation;
  }
  // Number of ticks the death animation lasts
  #deathTicks: number;
  #maxHp: number;
  #canShoot: boolean;
  // While the shoot animation plays, the idle and move animations wait for it to end
  #shooting: boolean;
  get shooting(): boolean {
    return this.#shooting;
  }

  constructor(
    game: Game,
    kind: number,
    spriteId: number,
    onDeath: FrameCallback,
  ) {
    const look = PLAYER_LOOKS[kind];
    super(
      game,
      look.sprite(spriteId),
      "entities",
      look.animations,
      ANIMATION_SPEED,
    );
    this.#moveAnimation = look.move;
    this.#deathSound = look.deathSound;
    this.#maxHp = look.maxHp;
    this.#deathTicks = look.animations.death * ANIMATION_SPEED;
    // Initialise the position and size properties
    this.scale = ENTITY_SCALE;
    this.anchorX = 0.5;
    this.anchorY = 1;
    // Add the callbacks at the end of non looping animations
    if ("spawn" in look.animations) {
      const onSpawn = () => {
        this.play("idle");
      };
      this.onExitFrame(onSpawn, "spawn", look.animations.spawn - 1);
    }
    this.onExitFrame(onDeath, "death", look.animations.death - 1);
    // Only NPCs have a shoot animation for now
    this.#canShoot = "shoot" in look.animations;
    this.#shooting = false;
    if (this.#canShoot) {
      const onShot = () => {
        this.#shooting = false;
      };
      this.onExitFrame(onShot, "shoot", look.animations.shoot - 1, Infinity);
    }
    //
    this.#hpBar = null;
    this.#hpBarTimer = 0;
  }

  // Plays the shoot animation, unless it's already playing (it isn't restarted). Shots are queued
  // ahead, so the shooter may already be dying when one is fired
  shoot(): void {
    if (this.#canShoot && this.animation !== "death") {
      this.#shooting = true;
      this.play("shoot");
    }
  }

  showHP(value: number) {
    if (this.#hpBar === null) {
      this.#hpBar = new Sprite(this.game, "", "ui");
      this.#hpBar.z = 10;
      this.addChild(this.#hpBar);
    }
    // Scale the HP to the frames of the bar, so a full bar means full HP for every kind
    const frame = Math.round((value * HP_BAR_FRAMES) / this.#maxHp);
    const hp = Math.max(0, Math.min(HP_BAR_FRAMES, frame));
    this.#hpBar.id = `blue_hp_${hp}`;
    // The bar should not outlast the dying player
    if (value <= 0) {
      this.#hpBarTimer = this.#deathTicks;
    } else {
      this.#hpBarTimer = Math.floor(HP_LINGER_TIME * this.game.tickRate);
    }
  }

  tick(tick: number): void {
    super.tick(tick);

    if (this.#hpBar !== null) {
      this.#hpBarTimer--;
      if (this.#hpBarTimer <= 0) {
        this.#hpBar.remove();
        this.#hpBar = null;
      }
    }
  }

  update(alpha: number, dt: number): void {
    super.update(alpha, dt);

    if (this.#hpBar !== null) {
      // Position the HP bar above the player
      this.#hpBar.centerX = this.centerX;
      this.#hpBar.bottom = this.top - 2;
    }
  }
}

// Renders the state of the game: the map and a sprite for each entity
class World extends Node {
  #map: GameMap;
  get map(): GameMap {
    return this.#map;
  }
  #playerSprites: Map<number, PlayerSprite>;
  #shotSprites: Map<number, AnimatedSprite>;
  // Players whose spawn animation already started, so it only plays once per spawn
  #spawning: Set<number>;

  constructor(game: Game, mapData: MapData) {
    super(game);
    this.#map = this.addChild(new GameMap(this.game, mapData));
    this.#playerSprites = new Map();
    this.#shotSprites = new Map();
    this.#spawning = new Set();
  }

  // Moves the sprites to the positions of the entities, interpolated by alpha
  sync(entities: GameEntity[], alpha: number): void {
    for (const entity of entities) {
      if (entity instanceof PlayerEntity) {
        if (entity.alive) {
          this.#spawning.delete(entity.id);
          const sprite = this.playerSprite(
            entity.id,
            entity.kind,
            entity.sprite,
          );
          const x = entity.x + entity.vx * alpha;
          const y = entity.y + entity.vy * alpha;
          sprite.scaleX = entity.orientation < 0 ? -ENTITY_SCALE : ENTITY_SCALE;
          sprite.x = x;
          sprite.bottom = y;
          sprite.z = this.#map.entityZ(y);
          if (sprite.shooting) {
            // It stays still while shooting, the animation goes back to idle when it ends
          } else if (entity.vx !== 0 || entity.vy !== 0) {
            sprite.play(sprite.moveAnimation);
          } else {
            sprite.play("idle");
          }
        } else if (
          // Players that aren't alive are spawning, they're shown from the start of the animation.
          // NPCs have no spawn animation, they just appear when they come alive
          entity.kind === PlayerKind.PC &&
          entity.spawnTimer < SPAWN_ANIMATION_TICKS &&
          !this.#spawning.has(entity.id)
        ) {
          this.#spawning.add(entity.id);
          this.#spawnPlayer(entity.id, entity.sprite, entity.x, entity.y);
        }
      } else if (entity instanceof ShotEntity) {
        const sprite = this.#shotSprite(entity.id, entity.sprite);
        const x = entity.x + entity.vx * alpha;
        const y = entity.y + entity.vy * alpha;
        sprite.x = x;
        sprite.y = y;
        // Sort by the ground position under the shot, so it doesn't go behind its shooter
        sprite.z = this.#map.entityZ(y + entity.height);
      }
    }
  }

  // Returns the sprite of a player, or undefined if it hasn't been drawn yet
  findPlayerSprite(id: number): PlayerSprite | undefined {
    return this.#playerSprites.get(id);
  }

  // Returns the sprite of a player, creating it if it doesn't exist. It's removed when the death
  // animation ends
  playerSprite(
    id: number,
    kind: number = PlayerKind.PC,
    spriteId: number = 0,
  ): PlayerSprite {
    if (this.#playerSprites.has(id)) {
      return this.#playerSprites.get(id)!;
    } else {
      const sprite = new PlayerSprite(this.game, kind, spriteId, () => {
        this.#removePlayerSprite(id);
      });
      // Add the child to the sprites, as a child and return it
      this.#playerSprites.set(id, sprite);
      return this.addChild(sprite);
    }
  }

  // Plays the spawn animation of a player at the given position
  #spawnPlayer(id: number, spriteId: number, x: number, y: number): void {
    // Only PCs have a spawn animation
    const sprite = this.playerSprite(id, PlayerKind.PC, spriteId);
    sprite.play("spawn");
    sprite.x = x;
    sprite.bottom = y;
    sprite.z = this.#map.entityZ(y);
    this.playSoundAt("spawn", x, y);
  }

  removeShot(id: number): void {
    if (this.#shotSprites.has(id)) {
      const sprite = this.#shotSprites.get(id)!;
      sprite.remove();
      this.#shotSprites.delete(id);
    }
  }

  // Plays a sound positioned relative to the screen, only sounds we can't see are affected
  playSoundAt(name: string, x: number, y: number): void {
    const camera = this.game.renderer.camera;
    // Signed distance outside the screen on each axis, zero while on screen
    const dx =
      x < camera.left ? x - camera.left : Math.max(0, x - camera.right);
    const dy = y < camera.top ? y - camera.top : Math.max(0, y - camera.bottom);
    const volume = 1 - Math.hypot(dx, dy) / SOUND_MAX_DISTANCE;
    // play() clamps both values, and skips the sound if it's silent
    this.game.sound.play(name, volume, dx / SOUND_PAN_DISTANCE);
  }

  #removePlayerSprite(id: number): void {
    if (this.#playerSprites.has(id)) {
      const sprite = this.#playerSprites.get(id)!;
      sprite.remove();
      this.#playerSprites.delete(id);
    }
  }

  #shotSprite(id: number, spriteId: number): AnimatedSprite {
    if (this.#shotSprites.has(id)) {
      return this.#shotSprites.get(id)!;
    } else {
      const sprite = new AnimatedSprite(
        this.game,
        `bullet${spriteId}`,
        "entities",
        SHOT_ANIMATIONS,
        1,
      );
      // Initialise the position and size properties
      sprite.scale = UNSCALED_BULLETS.has(spriteId) ? 1 : ENTITY_SCALE;
      sprite.anchorX = 0.5;
      sprite.anchorY = 0.5;
      // Add the child to the sprites, as a child and return it
      this.#shotSprites.set(id, sprite);
      return this.addChild(sprite);
    }
  }
}

export default World;
