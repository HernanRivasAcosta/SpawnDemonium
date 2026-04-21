import type Camera from "../../render/camera.ts";
import { type GameEntity, PlayerEntity, PlayerKind } from "./entities.ts";
import type GameMap from "./map.ts";

// Maximum number of entities in a frame (the count is encoded as a u8)
const MAX_ENTITIES = 256;
// How much an NPC counts towards the action, compared to a PC
const NPC_WEIGHT = 1 / MAX_ENTITIES;
// Distance (in pixels) kept between the entities in the action and the edges of the screen
const ACTION_MARGIN = 32;
// Penalty (in players) for moving the camera away from the action it's showing. It grows with the
// distance until it reaches its maximum at ACTION_SWITCH_DISTANCE pixels. Being under 1 means an
// area with more players always wins, but the camera won't jump between equivalent areas
const ACTION_SWITCH_PENALTY = 0.5;
const ACTION_SWITCH_DISTANCE = 180;
// After a reset the camera pans to the action this much slower than it usually moves, unless the
// action is further than PAN_MAX_SCREENS screen widths away, then it teleports
const PAN_SPEED_FACTOR = 2 / 3;
const PAN_MAX_SCREENS = 2;

// Moves the camera to where the action is when there's no active player to follow
class SpectatorCamera {
  #camera: Camera;
  #map: GameMap;
  // Scratch buffers used to find the action, preallocated to avoid allocations every frame
  #xs: Float64Array;
  #ys: Float64Array;
  #weights: Float64Array;
  #keys: Float64Array;
  #byY: Uint8Array;
  #column: Uint8Array;
  // Center of mass of the action the camera is showing (moving away from it is penalised), or null
  // when the camera isn't showing the action
  #focus: { x: number; y: number } | null;
  // Keys of the entities in the action the camera is showing, used to tell when the action changes
  #members: Float64Array;
  #memberCount: number;
  // Set by reset(), the camera pans to the next action it shows instead of teleporting
  #pan: boolean;
  // While panning after a reset the camera is slowed down, this is its usual speed
  #panning: boolean;
  #cameraSpeed: number;

  constructor(camera: Camera, map: GameMap) {
    this.#camera = camera;
    this.#map = map;
    this.#xs = new Float64Array(MAX_ENTITIES);
    this.#ys = new Float64Array(MAX_ENTITIES);
    this.#weights = new Float64Array(MAX_ENTITIES);
    this.#keys = new Float64Array(MAX_ENTITIES);
    this.#byY = new Uint8Array(MAX_ENTITIES);
    this.#column = new Uint8Array(MAX_ENTITIES);
    this.#focus = null;
    this.#members = new Float64Array(MAX_ENTITIES);
    this.#memberCount = 0;
    this.#pan = false;
    this.#panning = false;
    this.#cameraSpeed = camera.v;
  }

  // Forgets the action being shown, so the next call to follow() starts searching from wherever
  // the camera is and pans to it. Call it while something else controls the camera
  reset(): void {
    this.#focus = null;
    this.#pan = true;
    this.#stopPanning();
  }

  #stopPanning(): void {
    if (this.#panning) {
      this.#panning = false;
      this.#camera.v = this.#cameraSpeed;
    }
  }

  // The action is the screen sized area with the most PCs (NPCs break ties, or decide when there
  // are no PCs), and the camera centers on the center of mass of everything inside it. The camera
  // follows the action smoothly, but teleports when it starts showing it (unless it was reset) or
  // switches to a different one
  follow(entities: GameEntity[], alpha: number, smooth: boolean = true): void {
    const camera = this.#camera;
    const xs = this.#xs;
    const ys = this.#ys;
    const weights = this.#weights;
    const keys = this.#keys;
    // Gather the interpolated positions of everything that counts towards the action
    let n = 0;
    let pcs = 0;
    for (const entity of entities) {
      if (entity instanceof PlayerEntity && entity.alive) {
        xs[n] = entity.x + entity.vx * alpha;
        ys[n] = entity.y + entity.vy * alpha;
        // NPCs only break ties: there can't be more than 255 entities, so all of them together
        // are worth less than a single PC
        if (entity.kind === PlayerKind.PC) {
          weights[n] = 1;
          pcs++;
        } else {
          weights[n] = NPC_WEIGHT;
        }
        // Entities of different types can share ids, so the type goes above the 32 bits of the id
        keys[n] = entity.type * 0x100000000 + entity.id;
        n++;
      }
    }
    // Without PCs the action is wherever there are more NPCs. At their usual weight, the penalty for
    // switching areas would outweigh any difference in NPCs, so they count as much as PCs instead
    if (pcs === 0) weights.fill(1, 0, n);
    if (n === 0) {
      // Nothing is going on, so whatever happens next is a new action. Until then, stay where we
      // are unless we have to snap, then show a random spawn point (or the map's center if the
      // map has none)
      this.#focus = null;
      if (!smooth) {
        const spawns = this.#map.playerSpawns;
        if (spawns.length > 0) {
          const spawn = spawns[Math.floor(Math.random() * spawns.length)];
          camera.centerAt(spawn.x, spawn.y, true);
        } else {
          camera.centerAt(this.#map.width / 2, this.#map.height / 2, true);
        }
      }
      return;
    }
    // The camera teleports instead of moving smoothly when it starts showing the action, and when
    // it switches to a different one (checked below). After a reset it pans to the action instead,
    // and the action it was showing before the reset doesn't count as a switch
    const starting = this.#focus === null;
    let teleport = !smooth || (starting && !this.#pan);
    if (starting && !teleport) {
      this.#panning = true;
      this.#cameraSpeed = camera.v;
    }
    this.#pan = false;
    // Start from wherever the camera is, so the closest of the equivalent areas is chosen. The
    // object is only created when the camera starts showing the action, then updated in place
    const focus = (this.#focus ??= {
      x: camera.centerX,
      y: camera.centerY,
    });
    // Sort the indices by y. n is small, so an insertion sort is fast and doesn't allocate
    const byY = this.#byY;
    for (let i = 0; i < n; i++) {
      const y = ys[i];
      let j = i - 1;
      while (j >= 0 && ys[byY[j]] > y) {
        byY[j + 1] = byY[j];
        j--;
      }
      byY[j + 1] = i;
    }
    // Only the part of the screen inside the margins counts as the area
    const areaW = camera.width - 2 * ACTION_MARGIN;
    const areaH = camera.height - 2 * ACTION_MARGIN;
    // There's always a best area with an entity on its left edge and another one on its top edge.
    // So for each entity, take the column of width areaW starting at it and slide a window of
    // height areaH down through the entities in that column (in y order), adding and removing
    // them from running totals. That's O(n²) instead of checking every pair of edges in O(n³)
    const column = this.#column;
    let bestScore = -Infinity;
    let bestLeft = 0;
    let bestTop = 0;
    for (let i = 0; i < n; i++) {
      const left = xs[i];
      const right = left + areaW;
      let m = 0;
      for (let k = 0; k < n; k++) {
        const idx = byY[k];
        const x = xs[idx];
        if (x >= left && x <= right) column[m++] = idx;
      }
      let hi = 0;
      let count = 0;
      let weight = 0;
      let sumX = 0;
      let sumY = 0;
      for (let lo = 0; lo < m; lo++) {
        const top = ys[column[lo]];
        const bottom = top + areaH;
        while (hi < m && ys[column[hi]] <= bottom) {
          const idx = column[hi++];
          count++;
          weight += weights[idx];
          sumX += xs[idx];
          sumY += ys[idx];
        }
        // Entities sharing the same y were already evaluated with the first of them
        if (lo === 0 || top !== ys[column[lo - 1]]) {
          const dx = sumX / count - focus.x;
          const dy = sumY / count - focus.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const score =
            weight -
            ACTION_SWITCH_PENALTY * Math.min(1, d / ACTION_SWITCH_DISTANCE);
          if (score > bestScore) {
            bestScore = score;
            bestLeft = left;
            bestTop = top;
          }
        }
        // Remove the top entity before moving the window down
        const idx = column[lo];
        count--;
        weight -= weights[idx];
        sumX -= xs[idx];
        sumY -= ys[idx];
      }
    }
    // Get the center of mass and the bounds of the chosen area
    const bestRight = bestLeft + areaW;
    const bestBottom = bestTop + areaH;
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = xs[k];
      const y = ys[k];
      if (x >= bestLeft && x <= bestRight && y >= bestTop && y <= bestBottom) {
        // The column buffer is free now, reuse it to store the members of the chosen area
        column[count++] = k;
        sumX += x;
        sumY += y;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    // The penalty is measured from the unclamped center of mass, so it stays near 0 for the
    // area we're already showing
    focus.x = sumX / count;
    focus.y = sumY / count;
    // The center of mass can be far from the center of the area, so clamp it to keep everything
    // in the area on screen
    const halfW = camera.width / 2 - ACTION_MARGIN;
    const halfH = camera.height / 2 - ACTION_MARGIN;
    const x = Math.min(Math.max(focus.x, maxX - halfW), minX + halfW);
    const y = Math.min(Math.max(focus.y, maxY - halfH), minY + halfH);
    // It's a different action if none of the entities that were being shown are in it. Players
    // joining or leaving the action move its center of mass a lot, but it's still the same action
    const members = this.#members;
    if (!teleport && !starting) {
      const memberCount = this.#memberCount;
      let shared = false;
      for (let i = 0; i < count && !shared; i++) {
        const key = keys[column[i]];
        for (let j = 0; j < memberCount; j++) {
          if (members[j] === key) {
            shared = true;
            break;
          }
        }
      }
      teleport = !shared;
    }
    for (let i = 0; i < count; i++) {
      members[i] = keys[column[i]];
    }
    this.#memberCount = count;
    if (this.#panning) {
      const dx = x - camera.centerX;
      const dy = y - camera.centerY;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (teleport || d > PAN_MAX_SCREENS * camera.width) {
        teleport = true;
        this.#stopPanning();
      } else if (d <= 1) {
        // Arrived, from now on it follows the action at its usual speed
        this.#stopPanning();
      } else {
        camera.v = this.#cameraSpeed * PAN_SPEED_FACTOR;
      }
    }
    camera.centerAt(x, y, teleport);
  }
}

export default SpectatorCamera;
