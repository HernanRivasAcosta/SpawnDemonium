const SHOW_FPS_KEY = "showFPS";
const SHOW_PING_KEY = "showPing";
const CRT_FILTER_KEY = "useCRTFilter";
const MUSIC_KEY = "playMusic";
const SOUND_KEY = "playSound";
const PERSIST_NAME_KEY = "persistName";
const NAME_KEY = "name";

class Config {
  #showFPS: boolean;
  get showFPS(): boolean {
    return this.#showFPS;
  }
  set showFPS(value: boolean) {
    this.#showFPS = value;
    this.#save(SHOW_FPS_KEY, value);
  }
  #showPing: boolean;
  get showPing(): boolean {
    return this.#showPing;
  }
  set showPing(value: boolean) {
    this.#showPing = value;
    this.#save(SHOW_PING_KEY, value);
  }
  #crtFilter: boolean;
  get crtFilter(): boolean {
    return this.#crtFilter;
  }
  set crtFilter(value: boolean) {
    this.#crtFilter = value;
    this.#save(CRT_FILTER_KEY, value);
  }
  #music: boolean;
  get music(): boolean {
    return this.#music;
  }
  set music(value: boolean) {
    this.#music = value;
    this.#save(MUSIC_KEY, value);
  }
  #sound: boolean;
  get sound(): boolean {
    return this.#sound;
  }
  set sound(value: boolean) {
    this.#sound = value;
    this.#save(SOUND_KEY, value);
  }
  #persistName: boolean;
  get persistName(): boolean {
    return this.#persistName;
  }
  set persistName(value: boolean) {
    if (!value) {
      localStorage.removeItem(NAME_KEY);
    }
    this.#persistName = value;
    this.#save(PERSIST_NAME_KEY, value);
  }
  #name: string;
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
    if (this.persistName) {
      this.#save(NAME_KEY, value.toUpperCase());
    }
  }

  constructor() {
    this.#showFPS = this.#loadBool(SHOW_FPS_KEY, false);
    this.#showPing = this.#loadBool(SHOW_PING_KEY, false);
    this.#crtFilter = this.#loadBool(CRT_FILTER_KEY, true);
    this.#music = this.#loadBool(MUSIC_KEY, false);
    this.#sound = this.#loadBool(SOUND_KEY, true);
    this.#persistName = this.#loadBool(PERSIST_NAME_KEY, true);
    this.#name = this.#loadString(NAME_KEY, "AAA").toUpperCase();
  }

  #save(key: string, value: boolean | string) {
    const localStorage = window.localStorage;
    localStorage.setItem(key, value.toString());
  }

  #loadString(key: string, defaultValue: string): string {
    const stored = localStorage.getItem(key);
    return stored === null ? defaultValue : stored;
  }

  #loadBool(key: string, defaultValue: boolean): boolean {
    return this.#loadString(key, defaultValue.toString()) === "true";
  }
}

const CONFIG = new Config();
export default CONFIG;
