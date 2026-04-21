import type { Assets } from "../assets.ts";
import CONFIG from "../config.ts";

class SoundPlayer {
  #context: AudioContext;
  #assets: Assets;

  #enabled: boolean;
  get enabled(): boolean {
    return this.#enabled;
  }
  set enabled(value: boolean) {
    // Sounds that are already playing are short enough to be left to finish
    this.#enabled = value;
  }

  constructor(context: AudioContext, assets: Assets) {
    this.#context = context;
    this.#assets = assets;
    this.#enabled = CONFIG.sound;
  }

  // The volume goes from 0 to 1 and the pan from -1 (left) to 1 (right)
  play(name: string, volume: number = 1.0, pan: number = 0.0): void {
    // Skip inaudible sounds before creating any audio nodes
    if (!this.#enabled || volume <= 0) {
      return;
    }
    // The music might be disabled, so it can't be relied on to have resumed the context
    if (this.#context.state !== "running") {
      this.#context.resume().catch((e) => {
        console.warn("Unable to resume the audio context", e);
      });
    }
    // Buffer sources are single use and cheap, a new one allows the same sound to overlap itself
    const source = this.#context.createBufferSource();
    source.buffer = this.#assets.get(name, "sound");
    volume = Math.min(1, Math.max(0, volume));
    pan = Math.min(1, Math.max(-1, pan));
    // The near side stays at full volume, while the far side eases in quadratically, so it
    // drops noticeably even for sounds close to the centre
    const left = 1 - Math.max(0, pan);
    const right = 1 + Math.min(0, pan);
    const leftGain = new GainNode(this.#context, {
      gain: left * left * volume,
    });
    const rightGain = new GainNode(this.#context, {
      gain: right * right * volume,
    });
    // Each gain feeds one channel of the output, a stereo file is downmixed to mono first
    const merger = new ChannelMergerNode(this.#context, { numberOfInputs: 2 });
    source.connect(leftGain).connect(merger, 0, 0);
    source.connect(rightGain).connect(merger, 0, 1);
    merger.connect(this.#context.destination);
    source.start();
  }
}

export default SoundPlayer;
