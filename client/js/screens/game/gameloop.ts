import { type GameEntity, parseEntity } from "./entities.ts";
import { type GameEvent, parseEvent } from "./events.ts";

interface GameloopExports {
  alloc(size: number): number;
  dealloc(ptr: number): void;
  initialise_client(ptr: number): number;
  client_tick(lastServerTick: number, ptr: number): number;
  log(): number;
  frame(): number;
  memory: WebAssembly.Memory;
}

// The state of the game after a tick
export interface Frame {
  tick: number;
  events: GameEvent[];
  entities: GameEntity[];
}

// Wraps the game logic compiled to wasm, handling the encoding of everything going in and out
class Gameloop {
  #exports: GameloopExports;

  constructor(module: WebAssembly.Module) {
    this.#exports = new WebAssembly.Instance(module)
      .exports as unknown as GameloopExports;
  }

  // Returns the server tick of the initial state. Since 0 is not a valid tick, it indicates errors
  initialise(initialState: Uint8Array): number {
    // Allocate the initial state in memory
    const ptr = this.#alloc(initialState);
    // Initialise the game loop
    const tick = this.#exports.initialise_client(ptr) as number;
    // Print the logs and clear the initial state
    this.#printLogs();
    this.#dealloc(ptr);
    return tick;
  }

  // Advances the game one tick, applying the server events received since the last one.
  // Returns null if there are too many events to process
  tick(lastServerTick: number, serverEvents: Uint8Array[]): Frame | null {
    // Get the number of events for this tick
    const numEvents = serverEvents.length;
    if (numEvents > 255) {
      console.error(`Too many events to process in one tick: ${numEvents}`);
      return null;
    }
    // Get the total size of the event payload
    const eventsSize = serverEvents.reduce((sum, e) => sum + e.length + 1, 0);
    const eventData = new Uint8Array(3 + eventsSize);
    // The first 2 bytes are the size of all events as a u16 big-endian
    eventData[0] = eventsSize >> 8;
    eventData[1] = eventsSize & 0xff;
    // The next byte is the number of events as a u8
    eventData[2] = numEvents;
    // And then the events one after the other
    let offset = 3;
    for (const event of serverEvents) {
      eventData[offset] = event.length;
      offset += 1;
      eventData.set(event, offset);
      offset += event.length;
    }
    // Allocate the event object and call the tick
    const eventPtr = this.#alloc(eventData);
    const tick = this.#exports.client_tick(lastServerTick, eventPtr) as number;
    // Deallocate the event object and print the logs
    this.#dealloc(eventPtr);
    this.#printLogs();
    // Read the state of the game after the tick
    return this.#readFrame(tick);
  }

  #alloc(data: Uint8Array): number {
    const size = data.length;
    const ptr = this.#exports.alloc(size) as number;
    const memoryView = new Uint8Array(this.#exports.memory.buffer);
    memoryView.set(data, ptr);
    return ptr;
  }

  #dealloc(ptr: number): void {
    this.#exports.dealloc(ptr);
  }

  #printLogs(): void {
    let ptr = this.#exports.log() as number;
    const memory = this.#exports.memory.buffer;
    const bytes = new Uint8Array(memory);
    const dv = new DataView(memory);
    const numLogs = bytes[ptr];
    const decoder = new TextDecoder();
    ptr += 1;
    for (let i = 0; i < numLogs; i++) {
      const level = bytes[ptr];
      // log_len is u16 big-endian
      const msgLen = dv.getUint16(ptr + 1, false);
      const msg = decoder.decode(bytes.subarray(ptr + 3, ptr + 3 + msgLen));
      ptr += 3 + msgLen;
      switch (level) {
        case 0:
          console.debug("[WASM][DEBUG]", msg);
          break;
        case 1:
          console.info("[WASM][INFO]", msg);
          break;
        case 2:
          console.warn("[WASM][WARN]", msg);
          break;
        case 3:
          console.error("[WASM][ERROR]", msg);
          break;
      }
    }
  }

  #readFrame(tick: number): Frame {
    const events: GameEvent[] = [];
    const entities: GameEntity[] = [];

    let ptr = this.#exports.frame() as number;
    const memory = this.#exports.memory.buffer;
    const bytes = new Uint8Array(memory);
    const dv = new DataView(memory);
    // The first 2 bytes are the number of bytes in the events section of the frame
    // we can ignore them
    ptr += 2;
    const numEvents = bytes[ptr];
    ptr += 1;
    for (let i = 0; i < numEvents; i++) {
      let event: GameEvent | null;
      [ptr, event] = parseEvent(dv, ptr);
      if (event !== null) events.push(event);
    }
    // We can also ignore the next 2 bytes which are the size of the entities section
    ptr += 2;
    const numEntities = bytes[ptr];
    ptr += 1;
    for (let i = 0; i < numEntities; i++) {
      let entity: GameEntity | null;
      [ptr, entity] = parseEntity(dv, ptr);
      if (entity !== null) entities.push(entity);
    }
    return { tick, events, entities };
  }
}

export default Gameloop;
