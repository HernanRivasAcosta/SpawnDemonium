import type { Assets } from "../assets.ts";
import CONFIG from "../config.ts";

// Seconds to fade in when a track starts, or when it resumes during a fade out
const FADE_IN = 1;
// Seconds the previous track takes to fade out when switching to another one
const TRACK_CHANGE_FADE = 2;

// One copy of a track, routed through its own gain so it can be faded independently
class Voice {
  readonly element: HTMLAudioElement;
  #context: AudioContext;
  #gain: GainNode;

  constructor(context: AudioContext, element: HTMLAudioElement) {
    this.element = element;
    this.#context = context;
    this.#gain = context.createGain();
    this.#gain.gain.value = 0;
    context
      .createMediaElementSource(element)
      .connect(this.#gain)
      .connect(context.destination);
  }

  start(fadeSeconds: number): void {
    this.element.currentTime = 0;
    this.element.play().catch((e) => {
      console.warn("Unable to play music", e);
    });
    this.fadeTo(1, fadeSeconds);
  }

  fadeTo(value: number, seconds: number): void {
    // Ramps are scheduled in the audio thread, so they stay smooth regardless of the frame rate
    const param = this.#gain.gain;
    const now = this.#context.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + seconds);
  }

  stop(): void {
    this.element.pause();
    // Silence the gain, so the next start fades in from zero
    const param = this.#gain.gain;
    param.cancelScheduledValues(this.#context.currentTime);
    param.value = 0;
  }
}

// A track that loops cleanly on its own
class Track {
  readonly name: string;
  protected readonly voices: Voice[];
  protected active: number;
  #stopTimer: number | null;

  protected get current(): Voice {
    return this.voices[this.active];
  }

  protected get fadingOut(): boolean {
    return this.#stopTimer !== null;
  }

  constructor(context: AudioContext, name: string, element: HTMLAudioElement) {
    this.name = name;
    element.loop = true;
    this.voices = [new Voice(context, element)];
    this.active = 0;
    this.#stopTimer = null;
  }

  // Starts the track, or brings it back if it was fading out
  start(): void {
    if (this.#stopTimer !== null) {
      clearTimeout(this.#stopTimer);
      this.#stopTimer = null;
      this.current.fadeTo(1, FADE_IN);
    } else {
      this.current.start(FADE_IN);
    }
  }

  // Fades the track out, and stops it once it's silent
  fadeOut(seconds: number): void {
    if (this.#stopTimer !== null) {
      return;
    }
    for (const voice of this.voices) {
      voice.fadeTo(0, seconds);
    }
    this.#stopTimer = setTimeout(() => {
      this.#stopTimer = null;
      this.stop();
    }, seconds * 1000);
  }

  stop(): void {
    if (this.#stopTimer !== null) {
      clearTimeout(this.#stopTimer);
      this.#stopTimer = null;
    }
    for (const voice of this.voices) {
      voice.stop();
    }
  }
}

// A track that doesn't loop cleanly, so two copies of it alternate, crossfading its end with its start
class LoopedTrack extends Track {
  #crossfade: number;

  constructor(
    context: AudioContext,
    name: string,
    element: HTMLAudioElement,
    crossfade: number,
  ) {
    super(context, name, element);
    this.#crossfade = crossfade;
    // Each copy plays once, the crossfade takes care of the looping
    element.loop = false;
    // The clone shares the source URL, so the track is not downloaded or stored twice
    const clone = element.cloneNode() as HTMLAudioElement;
    this.voices.push(new Voice(context, clone));
    for (const voice of this.voices) {
      voice.element.addEventListener("timeupdate", () => this.#onTimeUpdate());
    }
  }

  #onTimeUpdate(): void {
    // Looping while fading out would fade the incoming copy back in
    if (this.fadingOut) {
      return;
    }
    // timeupdate fires every ~250ms, which is precise enough to start a multi-second crossfade
    const element = this.current.element;
    if (
      !element.paused &&
      element.currentTime >= element.duration - this.#crossfade
    ) {
      // The outgoing voice reaches its end as its fade completes, and then stops on its own
      this.current.fadeTo(0, this.#crossfade);
      this.active = 1 - this.active;
      this.current.start(this.#crossfade);
    }
  }
}

class MusicPlayer {
  #context: AudioContext;
  #assets: Assets;
  #tracks: Map<string, Track>;
  // The track currently playing, tracks that are fading out are not included
  #track: Track | null;
  // The track the current screen wants, remembered while the music is disabled
  #requested: string | null;

  #enabled: boolean;
  get enabled(): boolean {
    return this.#enabled;
  }
  set enabled(value: boolean) {
    if (value === this.#enabled) {
      return;
    }
    this.#enabled = value;
    if (!value) {
      // Turning the music off stops it right away, without fading
      this.#stopAll();
    } else if (this.#requested !== null) {
      this.play(this.#requested);
    }
  }

  constructor(context: AudioContext, assets: Assets) {
    this.#context = context;
    this.#assets = assets;
    this.#tracks = new Map();
    this.#track = null;
    this.#requested = null;
    this.#enabled = CONFIG.music;
  }

  // Starts the given track, fading out the previous one. Does nothing if it's already playing
  play(name: string): void {
    this.#requested = name;
    if (!this.#enabled || this.#track?.name === name) {
      return;
    }
    // The context starts suspended, but resuming is allowed once the player has pressed a key
    this.#context.resume().catch((e) => {
      console.warn("Unable to resume the audio context", e);
    });
    this.#track?.fadeOut(TRACK_CHANGE_FADE);
    this.#track = this.#getTrack(name);
    this.#track.start();
    console.debug(`Playing music "${name}"`);
  }

  fadeOut(seconds: number): void {
    this.#requested = null;
    this.#track?.fadeOut(seconds);
    this.#track = null;
  }

  stop(): void {
    this.#requested = null;
    this.#stopAll();
  }

  #stopAll(): void {
    // Includes the tracks that are still fading out
    for (const track of this.#tracks.values()) {
      track.stop();
    }
    this.#track = null;
  }

  #getTrack(name: string): Track {
    let track = this.#tracks.get(name);
    if (track === undefined) {
      // Media elements can only be routed through Web Audio once, so tracks are kept for reuse
      const { element, loopCrossfade } = this.#assets.get(name, "music");
      track =
        loopCrossfade === null
          ? new Track(this.#context, name, element)
          : new LoopedTrack(this.#context, name, element, loopCrossfade);
      this.#tracks.set(name, track);
    }
    return track;
  }
}

export default MusicPlayer;
