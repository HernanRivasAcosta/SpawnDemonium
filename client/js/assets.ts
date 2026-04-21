export interface SpritesheetData {
  // Parsed atlas JSON
  atlas: unknown;
  image: ImageBitmap;
}

export interface MusicData {
  element: HTMLAudioElement;
  // Seconds the end of the track overlaps with its start to fake a loop, null if it loops cleanly
  loopCrossfade: number | null;
}

type AssetTypeMap = {
  wasm: WebAssembly.Module;
  image: ImageBitmap;
  shader: string;
  map: unknown;
  spritesheet: SpritesheetData;
  sound: AudioBuffer;
  music: MusicData;
};

type AssetType = keyof AssetTypeMap;

// Discriminated union of all possible loaded asset shapes
type LoadedAsset = {
  [T in AssetType]: { name: string; type: T; data: AssetTypeMap[T] };
}[AssetType];

export type ManifestEntry =
  | { name: string; type: "wasm"; url: string }
  | { name: string; type: "image"; url: string }
  | { name: string; type: "shader"; url: string }
  | { name: string; type: "map"; url: string }
  | { name: string; type: "sound"; url: string }
  | { name: string; type: "music"; url: string; loopCrossfade?: number }
  | { name: string; type: "spritesheet"; atlasUrl: string; imageUrl: string };

/**
 * Loaded asset store returned by AssetManager.load().
 * Assets are accessible by name; typed retrieval is available via getAssetsByType.
 */
export class Assets {
  #assets: Map<string, LoadedAsset>;

  constructor(assets: LoadedAsset[]) {
    this.#assets = new Map();
    for (const asset of assets) {
      if (this.#assets.has(asset.name)) {
        throw new Error(`Duplicate asset name: ${asset.name}`);
      }
      this.#assets.set(asset.name, asset);
    }
  }

  // The expected type is checked at runtime, so a wrong name or type fails here with a clear error
  get<T extends AssetType>(name: string, type: T): AssetTypeMap[T] {
    const asset = this.#assets.get(name);
    if (asset === undefined) {
      throw new Error(`Unknown asset: ${name}`);
    }
    if (asset.type !== type) {
      throw new Error(`Asset "${name}" is of type ${asset.type}, not ${type}`);
    }
    // TypeScript can't narrow the union through the generic, but the check above guarantees it
    return asset.data as AssetTypeMap[T];
  }

  getAssetsByType<T extends AssetType>(type: T): Map<string, AssetTypeMap[T]> {
    const result = new Map<string, AssetTypeMap[T]>();
    for (const asset of this.#assets.values()) {
      if (asset.type === type) {
        result.set(asset.name, asset.data as AssetTypeMap[T]);
      }
    }
    return result;
  }
}

/**
 * Loads a list of assets in parallel.
 * Returns an Assets object containing the loaded data, accessible by name and type.
 *
 * Manifest entry format:
 *   { name: string, type: "wasm",        url: string }                          → WebAssembly.Module
 *   { name: string, type: "image",       url: string }                          → ImageBitmap
 *   { name: string, type: "shader",      url: string }                          → string
 *   { name: string, type: "map",         url: string }                          → JSON
 *   { name: string, type: "sound",       url: string }                          → AudioBuffer
 *   { name: string, type: "music",       url: string, loopCrossfade?: number }  → MusicData
 *   { name: string, type: "spritesheet", atlasUrl: string, imageUrl: string }   → SpritesheetData
 *
 * Sounds are fully decoded up front so they can be played with no latency, which requires an
 * AudioContext. Music is kept compressed (decoding a whole track takes tens of MB) and streamed
 * from memory through an audio element instead.
 *
 * @example
 * const assets = await new AssetManager([
 *   { name: "wasm",   type: "wasm",        url: "/wasm/game.wasm" },
 *   { name: "world",  type: "spritesheet", atlasUrl: "/assets/spritesheets/env.atlas", imageUrl: "/assets/spritesheets/env.png" },
 * ]).load();
 */
class AssetManager {
  #manifest: ManifestEntry[];
  #audioContext: BaseAudioContext | null;
  #bytesLoaded: number = 0;
  #bytesTotal: number = 0;

  constructor(
    manifest: ManifestEntry[],
    audioContext: BaseAudioContext | null = null,
  ) {
    this.#manifest = manifest;
    this.#audioContext = audioContext;
  }

  /**
   * Fraction of total bytes received, in [0, 1].
   * Assets without a Content-Length header contribute only when fully received.
   */
  get progress(): number {
    return this.#bytesTotal === 0 ? 0 : this.#bytesLoaded / this.#bytesTotal;
  }

  async load(): Promise<Assets> {
    this.#bytesLoaded = 0;
    this.#bytesTotal = 0;
    const entries = await Promise.all(
      this.#manifest.map((entry) => this.#loadEntry(entry)),
    );
    console.info("All assets loaded");
    return new Assets(entries);
  }

  async #loadEntry(entry: ManifestEntry): Promise<LoadedAsset> {
    if (entry.type === "spritesheet") {
      console.debug(
        `Loading ${entry.name} of type spritesheet from ${entry.atlasUrl} and ${entry.imageUrl}`,
      );
      const [atlas, image] = await Promise.all([
        this.#load(entry.atlasUrl).then((b) =>
          JSON.parse(new TextDecoder().decode(b)),
        ),
        this.#load(entry.imageUrl).then((b) =>
          createImageBitmap(new Blob([b.buffer as ArrayBuffer])),
        ),
      ]);
      return { name: entry.name, type: entry.type, data: { atlas, image } };
    }
    console.debug(
      `Loading "${entry.name}" of type ${entry.type} from ${entry.url}`,
    );
    const body = await this.#load(entry.url);
    let data: AssetTypeMap[typeof entry.type];
    switch (entry.type) {
      case "wasm":
        data = new WebAssembly.Module(body.buffer as ArrayBuffer);
        break;
      case "map":
        data = JSON.parse(new TextDecoder().decode(body));
        break;
      case "image":
        data = await createImageBitmap(new Blob([body.buffer as ArrayBuffer]));
        break;
      case "shader":
        data = new TextDecoder().decode(body);
        break;
      case "sound":
        if (this.#audioContext === null) {
          throw new Error(
            `Unable to decode sound "${entry.name}" without an AudioContext`,
          );
        }
        data = await this.#audioContext.decodeAudioData(
          body.buffer as ArrayBuffer,
        );
        break;
      case "music": {
        // Point the element at the bytes already in memory, so it doesn't download the track again
        const music = new Audio(
          URL.createObjectURL(new Blob([body.buffer as ArrayBuffer])),
        );
        music.preload = "auto";
        data = { element: music, loopCrossfade: entry.loopCrossfade ?? null };
        break;
      }
    }
    console.debug(
      `Loaded "${entry.name}" of type ${entry.type} from ${entry.url}`,
    );
    return { name: entry.name, type: entry.type, data } as LoadedAsset;
  }

  async #load(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    const contentLength = response.headers.get("Content-Length");
    const knownSize = contentLength ? parseInt(contentLength) : 0;
    if (knownSize) this.#bytesTotal += knownSize;

    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (knownSize) this.#bytesLoaded += value.length;
    }

    if (!knownSize) {
      this.#bytesTotal += loaded;
      this.#bytesLoaded += loaded;
    }

    const body = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    return body;
  }
}

export default AssetManager;
