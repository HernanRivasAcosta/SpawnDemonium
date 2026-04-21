import Node from "../../core/node.ts";
import { Sprite, SpriteGroup } from "../../render/sprites.ts";
import type Game from "../../game.ts";

export interface MapLayer {
  z: number;
  // RLE-encoded tile data: alternating [count, tileId] pairs; tileId 0 = empty
  tiles: number[];
}

// Values of the marker types, they must match MARKER_TYPES in tools/utils/markers.py
const PLAYER_SPAWN_MARKER = 1;

export interface MapMarker {
  type: number;
  // Center of the marker's tile, in pixels
  x: number;
  y: number;
}

export interface MapData {
  w: number;
  h: number;
  tw: number;
  th: number;
  atlas: string;
  name: string;
  // Z of the object layer, entities are rendered between it and the next layer
  entities_z: number;
  layers: MapLayer[];
  markers: MapMarker[];
  entities: Record<string, number>[];
}

class GameMap extends Node {
  #w: number;
  #h: number;
  get w(): number {
    return this.#w;
  }
  get h(): number {
    return this.#h;
  }
  // Size in pixels
  #width: number;
  #height: number;
  get width(): number {
    return this.#width;
  }
  get height(): number {
    return this.#height;
  }
  #playerSpawns: MapMarker[];
  get playerSpawns(): MapMarker[] {
    return this.#playerSpawns;
  }
  #entitiesZ: number;
  //
  #atlasId: string;
  #spriteGroup: SpriteGroup;

  constructor(game: Game, data: MapData) {
    super(game);
    this.#w = data.w;
    this.#h = data.h;
    const tw = data.tw;
    const th = data.th;
    this.#width = this.#w * tw;
    this.#height = this.#h * th;
    this.#playerSpawns = data.markers.filter(
      (m) => m.type === PLAYER_SPAWN_MARKER,
    );
    this.#entitiesZ = data.entities_z;
    this.#atlasId = data.atlas;
    //
    this.#spriteGroup = this.addChild(
      new SpriteGroup(this.game, `map.${data.name}`, this.#atlasId),
    );
    // Create the background
    for (const layer of data.layers) {
      let tileIndex = 0;
      const tileData = layer.tiles;
      // The map is stored using RLE, with count and tileId pairs
      for (let i = 0; i < tileData.length; i += 2) {
        const numTiles = tileData[i];
        // To further save space (by avoiding quotation marks), ids are integers
        const tileId = tileData[i + 1];
        if (tileId !== 0) {
          for (let k = 0; k < numTiles; k++) {
            const idx = tileIndex + k;
            // The actual sprite ids are strings
            const tileSprite = this.#spriteGroup.addChild(
              new Sprite(this.game, tileId.toString()),
            );
            tileSprite.x = (idx % this.#w) * tw;
            tileSprite.y = Math.floor(idx / this.#w) * th;
            tileSprite.z = layer.z;
          }
        }
        tileIndex += numTiles;
      }
    }
    // Create the entities
    for (const entity of data.entities) {
      const entitySprite = this.#spriteGroup.addChild(
        new Sprite(this.game, entity.id.toString(), this.#atlasId),
      );
      entitySprite.anchorX = entity.ax / entitySprite.width;
      entitySprite.anchorY = entity.ay / entitySprite.height;
      // The coordinates from the exported map are for the bottom left of the sprite
      entitySprite.left = entity.x;
      entitySprite.bottom = entity.y;
      // Half a pixel lower, so props are drawn over the players standing exactly on their bottom
      // edge (like someone pressed against the back of a rack, under the rack's top)
      entitySprite.z = this.entityZ(entitySprite.y + 0.5);
    }
  }

  entityZ(y: number): number {
    // 10000 is used as the maximum y value, it will be smaller in reality
    return this.#entitiesZ + y / 10000;
  }
}

export default GameMap;
