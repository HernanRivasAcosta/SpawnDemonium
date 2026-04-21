import { KeyCodes } from "./input/mappings";

const DEFAULT_GAMEPAD_AXIS_DEADZONE = 0.2;
// Keys that get preventDefault() to suppress browser behaviour (scrolling, tab focus, back nav)
const PREVENT_DEFAULT_KEYS: Set<number> = new Set([
  KeyCodes.TAB,
  KeyCodes.SPACE,
  KeyCodes.UP,
  KeyCodes.DOWN,
  KeyCodes.LEFT,
  KeyCodes.RIGHT,
  KeyCodes.BACKSPACE,
]);
// How long a button must be held before repeat pulses begin (ms)
const KEY_REPEAT_DELAY = 500; // ms before key repeat starts
// Interval between repeat pulses once keyRepeatDelay has elapsed (ms)
const KEY_REPEAT_INTERVAL = 50;

class Axis {
  #keyValue: number = 0;
  #gamepadValue: number = 0;
  #prevValue: number = 0;
  #justChanged: boolean = false;
  #triggered: boolean = false;
  #heldSince: number | null = null;
  #lastRepeat: number | null = null;
  // Sign of the value when the repeat clock started; resets on direction change
  #activeSign: number = 0;

  get value(): number {
    return Math.max(-1, Math.min(1, this.#keyValue + this.#gamepadValue));
  }

  get justChanged(): boolean {
    return this.#justChanged;
  }

  // True on the frame the axis first becomes non-zero, then again on each
  // repeat pulse. Resets immediately if the direction reverses.
  get triggered(): boolean {
    return this.#triggered;
  }

  // Called on keydown/keyup with ±1
  adjust(amount: number): void {
    this.#keyValue += amount;
  }

  // Set every frame from the gamepad; 0 when no gamepad is connected
  setGamepad(value: number): void {
    this.#gamepadValue = value;
  }

  preUpdate(now: number): void {
    const current = this.value;
    this.#justChanged = current !== this.#prevValue;
    this.#prevValue = current;

    const sign = Math.sign(current);
    if (sign !== 0) {
      if (this.#heldSince === null || sign !== this.#activeSign) {
        // First push or direction reversed: fire immediately and restart clock
        this.#triggered = true;
        this.#heldSince = now;
        this.#lastRepeat = now;
        this.#activeSign = sign;
      } else if (
        now - this.#heldSince >= KEY_REPEAT_DELAY &&
        now - this.#lastRepeat! >= KEY_REPEAT_INTERVAL
      ) {
        this.#triggered = true;
        this.#lastRepeat = now;
      } else {
        this.#triggered = false;
      }
    } else {
      this.#triggered = false;
      this.#heldSince = null;
      this.#lastRepeat = null;
      this.#activeSign = 0;
    }
  }

  postUpdate(): void {
    this.#justChanged = false;
    this.#triggered = false;
  }
}

class Button {
  // Counts how many keys currently contributing to this button are held
  #pressCount: number = 0;
  // Gamepad state set every frame; separate from keyboard so both can coexist
  #gamepadPressed: boolean = false;
  #prevValue: boolean = false;
  #justChanged: boolean = false;
  #triggered: boolean = false;
  #heldSince: number | null = null;
  #lastRepeat: number | null = null;

  get pressed(): boolean {
    return this.#pressCount > 0 || this.#gamepadPressed;
  }

  get justChanged(): boolean {
    return this.#justChanged;
  }
  get justPressed(): boolean {
    return this.justChanged && this.pressed;
  }
  get justReleased(): boolean {
    return this.justChanged && !this.pressed;
  }

  // True on the frame the button is first pressed, then again on each repeat
  // pulse after repeatDelay has elapsed (fired every repeatInterval ms).
  // Mirrors OS key-repeat behaviour for use in menus and similar discrete actions.
  get triggered(): boolean {
    return this.#triggered;
  }

  press(): void {
    this.#pressCount++;
  }

  release(): void {
    this.#pressCount = Math.max(0, this.#pressCount - 1);
  }

  // Set every frame from the gamepad; false when no gamepad is connected
  setGamepad(pressed: boolean): void {
    this.#gamepadPressed = pressed;
  }

  preUpdate(now: number): void {
    const current = this.pressed;
    this.#justChanged = current !== this.#prevValue;
    this.#prevValue = current;

    if (current) {
      if (this.#heldSince === null) {
        // First frame pressed: fire immediately and start the repeat clock
        this.#triggered = true;
        this.#heldSince = now;
        this.#lastRepeat = now;
      } else if (
        now - this.#heldSince >= KEY_REPEAT_DELAY &&
        now - this.#lastRepeat! >= KEY_REPEAT_INTERVAL
      ) {
        this.#triggered = true;
        this.#lastRepeat = now;
      } else {
        this.#triggered = false;
      }
    } else {
      this.#triggered = false;
      this.#heldSince = null;
      this.#lastRepeat = null;
    }
  }

  postUpdate(): void {
    this.#justChanged = false;
    this.#triggered = false;
  }
}

export interface InputListener {
  onKeyDown(keyCode: number): void;
  onKeyUp(keyCode: number): void;
}

export interface AxisOptions {
  decrementKeys?: number[];
  incrementKeys?: number[];
  // Index into Gamepad.axes[]
  gamepadAxis?: number;
  // Indices into Gamepad.buttons[] that push the axis to -1 or +1
  gamepadDecrementButtons?: number[];
  gamepadIncrementButtons?: number[];
}

export interface ButtonOptions {
  keys?: number[];
  // Indices into Gamepad.buttons[]
  gamepadButtons?: number[];
  // Use a gamepad axis as a button: pressed when axis value >= threshold
  gamepadAxis?: { index: number; threshold: number };
}

class Input {
  #axes: Map<string, Axis>;
  #buttons: Map<string, Button>;
  // keyCode → list of (axis, contribution) pairs; contribution is +1 or -1
  #keyAxisMap: Map<number, Array<{ axis: Axis; amount: number }>>;
  // keyCode → list of buttons to press/release
  #keyButtonMap: Map<number, Button[]>;
  // Axis → gamepad axis index, polled every frame
  #axisGamepadMap: Map<Axis, number>;
  // Gamepad button index → buttons, polled every frame
  #gamepadButtonMap: Map<number, Button[]>;
  // Gamepad axis → button bindings, polled every frame
  #gamepadAxisButtonBindings: Array<{
    button: Button;
    axisIndex: number;
    threshold: number;
  }>;
  // Gamepad button → axis bindings: buttonIndex + contribution amount (±1)
  #gamepadButtonAxisBindings: Array<{
    axis: Axis;
    buttonIndex: number;
    amount: number;
  }>;
  // Keys currently held down; guards onKeyDown against browser key-repeat events
  #heldKeys: Set<number>;
  #listeners: Set<InputListener>;
  // The active gamepad (if any)
  #gamepad: Gamepad | null;
  get gamepadConnected(): boolean {
    return this.#gamepad !== null;
  }
  //
  #gamepadAxisDeadzone: number = DEFAULT_GAMEPAD_AXIS_DEADZONE;

  constructor() {
    this.#gamepad = null;
    this.#heldKeys = new Set();
    this.#listeners = new Set();
    this.#axes = new Map();
    this.#buttons = new Map();
    this.#keyAxisMap = new Map();
    this.#keyButtonMap = new Map();
    this.#axisGamepadMap = new Map();
    this.#gamepadButtonMap = new Map();
    this.#gamepadAxisButtonBindings = [];
    this.#gamepadButtonAxisBindings = [];
    //
    document.body.addEventListener("keyup", this.#onKeyUp.bind(this), {
      capture: true,
    });
    document.body.addEventListener("keydown", this.#onKeyDown.bind(this), {
      capture: true,
    });
    window.addEventListener(
      "gamepadconnected",
      this.#onGamepadConnected.bind(this),
    );
    window.addEventListener(
      "gamepaddisconnected",
      this.#onGamepadDisconnected.bind(this),
    );
  }

  addAxis(id: string, options: AxisOptions): Axis {
    const axis = new Axis();
    this.#axes.set(id, axis);
    for (const key of options.decrementKeys ?? []) {
      const entries = this.#keyAxisMap.get(key) ?? [];
      entries.push({ axis, amount: -1 });
      this.#keyAxisMap.set(key, entries);
    }
    for (const key of options.incrementKeys ?? []) {
      const entries = this.#keyAxisMap.get(key) ?? [];
      entries.push({ axis, amount: 1 });
      this.#keyAxisMap.set(key, entries);
    }
    if (options.gamepadAxis !== undefined) {
      this.#axisGamepadMap.set(axis, options.gamepadAxis);
    }
    for (const idx of options.gamepadDecrementButtons ?? []) {
      this.#gamepadButtonAxisBindings.push({
        axis,
        buttonIndex: idx,
        amount: -1,
      });
    }
    for (const idx of options.gamepadIncrementButtons ?? []) {
      this.#gamepadButtonAxisBindings.push({
        axis,
        buttonIndex: idx,
        amount: 1,
      });
    }
    return axis;
  }

  getAxis(id: string): Axis | undefined {
    return this.#axes.get(id);
  }

  keyIsDown(keyCode: number): boolean {
    return this.#heldKeys.has(keyCode);
  }

  keyIsUp(keyCode: number): boolean {
    return !this.#heldKeys.has(keyCode);
  }

  addButton(id: string, options: ButtonOptions): Button {
    const button = new Button();
    this.#buttons.set(id, button);
    for (const key of options.keys ?? []) {
      const entries = this.#keyButtonMap.get(key) ?? [];
      entries.push(button);
      this.#keyButtonMap.set(key, entries);
    }
    for (const idx of options.gamepadButtons ?? []) {
      const entries = this.#gamepadButtonMap.get(idx) ?? [];
      entries.push(button);
      this.#gamepadButtonMap.set(idx, entries);
    }
    if (options.gamepadAxis !== undefined) {
      this.#gamepadAxisButtonBindings.push({
        button,
        axisIndex: options.gamepadAxis.index,
        threshold: options.gamepadAxis.threshold,
      });
    }
    return button;
  }

  getButton(id: string): Button | undefined {
    return this.#buttons.get(id);
  }

  // Fires once per physical keydown (no browser repeat).
  addListener(listener: InputListener): void {
    this.#listeners.add(listener);
  }

  removeListener(listener: InputListener): void {
    this.#listeners.delete(listener);
  }

  // Poll gamepad and propagate values; call before game logic each frame
  preUpdate(_alpha: number): void {
    this.#gamepad = this.#getGamepad();
    // Sum button contributions per axis (±1 per pressed button, clamped later)
    const buttonAxisContribs = new Map<Axis, number>();
    for (const { axis, buttonIndex, amount } of this
      .#gamepadButtonAxisBindings) {
      if (this.#gamepad?.buttons[buttonIndex]?.pressed) {
        buttonAxisContribs.set(
          axis,
          (buttonAxisContribs.get(axis) ?? 0) + amount,
        );
      }
    }
    for (const [axis, axisIndex] of this.#axisGamepadMap) {
      const raw = this.#gamepad?.axes[axisIndex] ?? 0;
      const axisVal = Math.abs(raw) < this.#gamepadAxisDeadzone ? 0 : raw;
      const btnVal = buttonAxisContribs.get(axis) ?? 0;
      axis.setGamepad(Math.max(-1, Math.min(1, axisVal + btnVal)));
      buttonAxisContribs.delete(axis);
    }
    // Axes with only button contributions (no gamepadAxis)
    for (const [axis, contrib] of buttonAxisContribs) {
      axis.setGamepad(Math.max(-1, Math.min(1, contrib)));
    }
    const gamepadButtonStates = new Map<Button, boolean>();
    for (const [buttonIndex, buttons] of this.#gamepadButtonMap) {
      const pressed = this.#gamepad?.buttons[buttonIndex]?.pressed ?? false;
      for (const button of buttons) {
        gamepadButtonStates.set(
          button,
          (gamepadButtonStates.get(button) ?? false) || pressed,
        );
      }
    }
    for (const [button, pressed] of gamepadButtonStates)
      button.setGamepad(pressed);
    for (const { button, axisIndex, threshold } of this
      .#gamepadAxisButtonBindings) {
      const raw = this.#gamepad?.axes[axisIndex] ?? 0;
      const value = Math.abs(raw) < this.#gamepadAxisDeadzone ? 0 : raw;
      button.setGamepad(value >= threshold);
    }
    // Snapshot values and compute justChanged/triggered now that all sources are settled
    const now = performance.now();
    for (const axis of this.#axes.values()) axis.preUpdate(now);
    for (const button of this.#buttons.values()) button.preUpdate(now);
  }

  // Clear justChanged flags; call after game logic each frame
  postUpdate(): void {
    for (const axis of this.#axes.values()) axis.postUpdate();
    for (const button of this.#buttons.values()) button.postUpdate();
  }

  //

  #getGamepad(): Gamepad | null {
    // Get the first available standard gamepad
    for (const gamepad of navigator.getGamepads()) {
      if (gamepad && gamepad.mapping === "standard") {
        return gamepad;
      }
    }
    // If that doesn't work, just get the first available gamepad with no mapping
    for (const gamepad of navigator.getGamepads()) {
      if (gamepad) {
        return gamepad;
      }
    }
    // If that doesn't work either, return null
    return null;
  }

  // Listeners

  #onKeyDown(e: KeyboardEvent): void {
    if (PREVENT_DEFAULT_KEYS.has(e.keyCode)) e.preventDefault();
    if (this.#heldKeys.has(e.keyCode)) return;
    this.#heldKeys.add(e.keyCode);
    const axisEntries = this.#keyAxisMap.get(e.keyCode);
    if (axisEntries) {
      for (const { axis, amount } of axisEntries) axis.adjust(amount);
    }
    const buttons = this.#keyButtonMap.get(e.keyCode);
    if (buttons) {
      for (const button of buttons) button.press();
    }
    for (const listener of this.#listeners) listener.onKeyDown(e.keyCode);
  }

  #onKeyUp(e: KeyboardEvent): void {
    if (PREVENT_DEFAULT_KEYS.has(e.keyCode)) e.preventDefault();
    if (!this.#heldKeys.has(e.keyCode)) return;
    this.#heldKeys.delete(e.keyCode);
    const axisEntries = this.#keyAxisMap.get(e.keyCode);
    if (axisEntries) {
      for (const { axis, amount } of axisEntries) axis.adjust(-amount);
    }
    const buttons = this.#keyButtonMap.get(e.keyCode);
    if (buttons) {
      for (const button of buttons) button.release();
    }
    for (const listener of this.#listeners) listener.onKeyUp(e.keyCode);
  }

  #onGamepadConnected(e: GamepadEvent): void {
    console.info(`Gamepad "${e.gamepad.id}" connected`);
  }

  #onGamepadDisconnected(e: GamepadEvent): void {
    console.info(`Gamepad "${e.gamepad.id}" disconnected`);
  }
}

// Namespace merge so callers can write Input.Axis / Input.Button as types
// without a separate named import
// eslint-disable-next-line @typescript-eslint/no-namespace
namespace Input {
  export type Axis = InstanceType<typeof Axis>;
  export type Button = InstanceType<typeof Button>;
}

export default Input;
