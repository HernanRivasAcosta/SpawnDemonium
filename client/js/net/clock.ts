// The number of samples HAS to be an odd number
const DEFAULT_CLOCK_SAMPLES = 21;
// The value in milliseconds that assumes the connection is local
const MAX_LOCAL_PING = 15;

class NetClock {
  #numSamples: number;
  #pings: Uint32Array;
  #offsets: Int32Array;
  #currentIndex: number;
  #synced: boolean;
  #ping: number;
  #serverTimeOffset: number;
  #packetLoss: number;

  get synced(): boolean {
    return this.#synced;
  }

  get ping(): number {
    return this.#ping;
  }

  get localTime(): number {
    return Math.floor(performance.now());
  }

  get serverTime(): number {
    return this.localTime + this.serverTimeOffset;
  }

  get serverTimeOffset(): number {
    return this.#serverTimeOffset;
  }

  get packetLoss(): number {
    return this.#packetLoss;
  }

  constructor() {
    this.#numSamples = DEFAULT_CLOCK_SAMPLES;
    this.#pings = new Uint32Array(this.#numSamples);
    this.#offsets = new Int32Array(this.#numSamples);
    this.#currentIndex = -1;
    this.#synced = false;
    this.#ping = NaN;
    this.#serverTimeOffset = NaN;
    this.#packetLoss = NaN;
  }

  clear(): void {
    this.#pings = new Uint32Array(this.#numSamples);
    this.#offsets = new Int32Array(this.#numSamples);
    this.#currentIndex = -1;
    this.#synced = false;
    this.#ping = NaN;
    this.#serverTimeOffset = NaN;
    this.#packetLoss = NaN;
  }

  addSample(requestLocalTime: number, serverTime: number): void {
    this.#currentIndex += 1;
    // We could use modulo, but this way we also set synced
    if (this.#currentIndex === this.#numSamples) {
      this.#synced = true;
      this.#currentIndex = 0;
    }
    // Store the pings and offsets in their respective arrays
    const localTime = this.localTime;
    const ping = localTime - requestLocalTime;
    this.#pings[this.#currentIndex] = ping;
    const latency = ping / 2;
    this.#offsets[this.#currentIndex] = serverTime + latency - localTime;
    // If we are synced, calculate the time difference
    if (this.#synced) {
      // Twice the median ping is the threshold we can accept
      // TODO: Use quickselect to calculate the median
      const threshold =
        2 * [...this.#pings].sort((a, b) => a - b)[(this.#numSamples - 1) >> 1];
      // Initialise the variables used to calculate the mean ping and offset
      let offsetSum = 0;
      let pingSum = 0;
      let samples = 0;
      // Add the samples if the ping was not too high
      for (let i = 0; i < this.#numSamples; i++) {
        const ping = this.#pings[i];
        if (ping < MAX_LOCAL_PING || ping <= threshold) {
          pingSum += ping;
          offsetSum += this.#offsets[i];
          samples++;
        }
      }
      // Calculate the average offset and ping
      this.#ping = Math.floor(pingSum / samples);
      this.#serverTimeOffset = Math.floor(offsetSum / samples);
      // The packet loss is inferred from the packages that took twice as long to arrive
      // (This works because if the message took twice the median time to arrive, it was probably resent)
      this.#packetLoss = Math.floor((1 - samples / this.#numSamples) * 100);
    }
  }
}

export default NetClock;
