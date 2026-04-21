export abstract class GameEvent {
  abstract readonly type: number;
}

export class PlayerSpawnEvent extends GameEvent {
  readonly type = 2;
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly tick: number;
  readonly sprite: number;

  private constructor(
    id: number,
    x: number,
    y: number,
    tick: number,
    sprite: number,
  ) {
    super();
    this.id = id;
    this.x = x;
    this.y = y;
    this.tick = tick;
    this.sprite = sprite;
  }

  static parse(dv: DataView, ptr: number): [number, PlayerSpawnEvent] {
    const id = dv.getUint32(ptr, false);
    ptr += 4;
    const x = dv.getInt32(ptr, false);
    ptr += 4;
    const y = dv.getInt32(ptr, false);
    ptr += 4;
    const tick = dv.getUint32(ptr, false);
    ptr += 4;
    const sprite = dv.getUint8(ptr);
    ptr += 1;
    return [ptr, new PlayerSpawnEvent(id, x, y, tick, sprite)];
  }
}

export class PlayerJoinEvent extends GameEvent {
  readonly type = 3;
  readonly id: number;
  readonly sprite: number;
  // One of PlayerKind (in entities.ts)
  readonly kind: number;

  private constructor(id: number, sprite: number, kind: number) {
    super();
    this.id = id;
    this.sprite = sprite;
    this.kind = kind;
  }

  static parse(dv: DataView, ptr: number): [number, PlayerJoinEvent] {
    const id = dv.getUint32(ptr, false);
    ptr += 4;
    const sprite = dv.getUint8(ptr);
    ptr += 1;
    const kind = dv.getUint8(ptr);
    ptr += 1;
    return [ptr, new PlayerJoinEvent(id, sprite, kind)];
  }
}

export class PlayerLeftEvent extends GameEvent {
  readonly type = 4;
  readonly id: number;

  private constructor(id: number) {
    super();
    this.id = id;
  }

  static parse(dv: DataView, ptr: number): [number, PlayerLeftEvent] {
    const id = dv.getUint32(ptr, false);
    ptr += 4;
    return [ptr, new PlayerLeftEvent(id)];
  }
}

export class PlayerShotEvent extends GameEvent {
  readonly type = 5;
  readonly tick: number;
  readonly id: number;
  readonly shooterId: number;
  readonly x: number;
  readonly y: number;
  readonly orientation: number;

  private constructor(
    tick: number,
    id: number,
    shooterId: number,
    x: number,
    y: number,
    orientation: number,
  ) {
    super();
    this.tick = tick;
    this.id = id;
    this.shooterId = shooterId;
    this.x = x;
    this.y = y;
    this.orientation = orientation;
  }

  static parse(dv: DataView, ptr: number): [number, PlayerShotEvent] {
    const tick = dv.getUint32(ptr, false);
    ptr += 4;
    const id = dv.getUint32(ptr, false);
    ptr += 4;
    const shooterId = dv.getUint32(ptr, false);
    ptr += 4;
    const x = dv.getInt32(ptr, false);
    ptr += 4;
    const y = dv.getInt32(ptr, false);
    ptr += 4;
    const orientation = dv.getInt8(ptr);
    ptr += 1;
    // The height (only for the wall collisions, which the wasm does) and the sprite (the wasm puts
    // it in the shot entity)
    ptr += 2;
    return [ptr, new PlayerShotEvent(tick, id, shooterId, x, y, orientation)];
  }
}

export class ShotHitEvent extends GameEvent {
  readonly type = 6;
  readonly tick: number;
  readonly id: number;
  readonly x: number;
  readonly y: number;

  private constructor(tick: number, id: number, x: number, y: number) {
    super();
    this.tick = tick;
    this.id = id;
    this.x = x;
    this.y = y;
  }

  static parse(dv: DataView, ptr: number): [number, ShotHitEvent] {
    const tick = dv.getUint32(ptr, false);
    ptr += 4;
    const id = dv.getUint32(ptr, false);
    ptr += 4;
    const x = dv.getInt32(ptr, false);
    ptr += 4;
    const y = dv.getInt32(ptr, false);
    ptr += 4;
    return [ptr, new ShotHitEvent(tick, id, x, y)];
  }
}

export class ShotHitPlayerEvent extends GameEvent {
  readonly type = 7;
  readonly tick: number;
  readonly playerId: number;
  // The HP the player was left with
  readonly hp: number;
  readonly alive: boolean;
  readonly shotId: number;
  readonly x: number;
  readonly y: number;

  private constructor(
    tick: number,
    playerId: number,
    hp: number,
    alive: boolean,
    shotId: number,
    x: number,
    y: number,
  ) {
    super();
    this.tick = tick;
    this.playerId = playerId;
    this.hp = hp;
    this.alive = alive;
    this.shotId = shotId;
    this.x = x;
    this.y = y;
  }

  static parse(dv: DataView, ptr: number): [number, ShotHitPlayerEvent] {
    const tick = dv.getUint32(ptr, false);
    ptr += 4;
    const playerId = dv.getUint32(ptr, false);
    ptr += 4;
    const hp = dv.getUint8(ptr);
    ptr += 1;
    const alive = dv.getUint8(ptr) !== 0;
    ptr += 1;
    const shotId = dv.getUint32(ptr, false);
    ptr += 4;
    const x = dv.getInt32(ptr, false);
    ptr += 4;
    const y = dv.getInt32(ptr, false);
    ptr += 4;
    return [
      ptr,
      new ShotHitPlayerEvent(tick, playerId, hp, alive, shotId, x, y),
    ];
  }
}

// Only sent by the server, clients don't keep track of the score
export class ScoreUpdateEvent extends GameEvent {
  readonly type = 8;
  readonly tick: number;
  readonly playerId: number;
  readonly score: number;

  private constructor(tick: number, playerId: number, score: number) {
    super();
    this.tick = tick;
    this.playerId = playerId;
    this.score = score;
  }

  static parse(dv: DataView, ptr: number): [number, ScoreUpdateEvent] {
    const tick = dv.getUint32(ptr, false);
    ptr += 4;
    const playerId = dv.getUint32(ptr, false);
    ptr += 4;
    const score = dv.getUint32(ptr, false);
    ptr += 4;
    return [ptr, new ScoreUpdateEvent(tick, playerId, score)];
  }
}

export function parseEvent(
  dv: DataView,
  ptr: number,
): [number, GameEvent | null] {
  const eventSize = dv.getUint8(ptr);
  ptr += 1;
  const eventType = dv.getUint8(ptr);
  ptr += 1;
  switch (eventType) {
    case 2:
      return PlayerSpawnEvent.parse(dv, ptr);
    case 3:
      return PlayerJoinEvent.parse(dv, ptr);
    case 4:
      return PlayerLeftEvent.parse(dv, ptr);
    case 5:
      return PlayerShotEvent.parse(dv, ptr);
    case 6:
      return ShotHitEvent.parse(dv, ptr);
    case 7:
      return ShotHitPlayerEvent.parse(dv, ptr);
    case 8:
      return ScoreUpdateEvent.parse(dv, ptr);
    default:
      console.warn(`Ignoring event of type ${eventType}`);
      // -1 because we already consumed the type byte
      return [ptr + eventSize - 1, null];
  }
}
