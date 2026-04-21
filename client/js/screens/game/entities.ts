// Who controls a player, must match PlayerKind in game/src/utils/types.rs
export const PlayerKind = {
  PC: 0,
  NPC1: 1,
  NPC2: 2,
} as const;

export abstract class GameEntity {
  abstract readonly type: number;
  abstract readonly id: number;
}

export class PlayerEntity extends GameEntity {
  readonly type = 1;
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly score: number;
  readonly alive: boolean;
  readonly hp: number;
  readonly orientation: number;
  readonly sprite: number;
  // Ticks left to spawn, negative when not spawning
  readonly spawnTimer: number;
  // One of PlayerKind
  readonly kind: number;

  private constructor(
    id: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    score: number,
    alive: boolean,
    hp: number,
    orientation: number,
    sprite: number,
    spawnTimer: number,
    kind: number,
  ) {
    super();
    this.id = id;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.score = score;
    this.alive = alive;
    this.hp = hp;
    this.orientation = orientation;
    this.sprite = sprite;
    this.spawnTimer = spawnTimer;
    this.kind = kind;
  }

  static parse(dv: DataView, ptr: number): [number, PlayerEntity] {
    const id = dv.getUint32(ptr, false);
    ptr += 4;
    const x = dv.getInt32(ptr, false);
    ptr += 4;
    const y = dv.getInt32(ptr, false);
    ptr += 4;
    const vx = dv.getInt32(ptr, false);
    ptr += 4;
    const vy = dv.getInt32(ptr, false);
    ptr += 4;
    const score = dv.getUint32(ptr, false);
    ptr += 4;
    const alive = dv.getUint8(ptr) === 1;
    ptr += 1;
    const hp = dv.getUint8(ptr);
    ptr += 1;
    const orientation = dv.getInt8(ptr);
    ptr += 1;
    const sprite = dv.getUint8(ptr);
    ptr += 1;
    const spawnTimer = dv.getInt32(ptr, false);
    ptr += 4;
    const kind = dv.getUint8(ptr);
    ptr += 1;
    return [
      ptr,
      new PlayerEntity(
        id,
        x,
        y,
        vx,
        vy,
        score,
        alive,
        hp,
        orientation,
        sprite,
        spawnTimer,
        kind,
      ),
    ];
  }
}

export class ShotEntity extends GameEntity {
  readonly type = 2;
  readonly id: number;
  readonly spawnTick: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly sprite: number;
  readonly damage: number;
  // How far above the shooter's feet it flies
  readonly height: number;

  private constructor(
    id: number,
    spawnTick: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    sprite: number,
    damage: number,
    height: number,
  ) {
    super();
    this.id = id;
    this.spawnTick = spawnTick;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.sprite = sprite;
    this.damage = damage;
    this.height = height;
  }

  static parse(dv: DataView, ptr: number): [number, ShotEntity] {
    const id = dv.getUint32(ptr, false);
    ptr += 4;
    const spawnTick = dv.getUint32(ptr, false);
    ptr += 4;
    const x = dv.getInt32(ptr, false);
    ptr += 4;
    const y = dv.getInt32(ptr, false);
    ptr += 4;
    const vx = dv.getInt32(ptr, false);
    ptr += 4;
    const vy = dv.getInt32(ptr, false);
    ptr += 4;
    const sprite = dv.getUint8(ptr);
    ptr += 1;
    const damage = dv.getUint8(ptr);
    ptr += 1;
    const height = dv.getUint8(ptr);
    ptr += 1;
    return [
      ptr,
      new ShotEntity(id, spawnTick, x, y, vx, vy, sprite, damage, height),
    ];
  }
}

export function parseEntity(
  dv: DataView,
  ptr: number,
): [number, GameEntity | null] {
  const entitySize = dv.getUint8(ptr);
  ptr += 1;
  const entityType = dv.getUint8(ptr);
  ptr += 1;
  switch (entityType) {
    case 1:
      return PlayerEntity.parse(dv, ptr);
    case 2:
      return ShotEntity.parse(dv, ptr);
    default:
      console.error(`Unknown entity type: ${entityType}`);
      return [ptr + entitySize - 1, null]; // -1 because we already consumed the type byte
  }
}
