import Screen from "./screen.ts";
import type Game from "../game.ts";
import { Sprite } from "../render/sprites.ts";
import Palette from "../render/palette.ts";
import TextField from "../render/text-field.ts";
import CONFIG from "../config.ts";
import type { InputListener } from "../core/input.ts";
import { KeyCodes } from "../core/input/mappings.ts";

const MAX_NAME_LEN = 9;
const KEY_SEPARATION = 3;
const DEFAULT_NAME = "PLAYER";
const SPACE = "space";
const BACKSPACE = "backspace";
const SPACE_ENABLED = false;

class PlayerSetupScreen extends Screen implements InputListener {
  //
  #nameField: TextField;
  #keys: string[][];
  #keyMap: Record<string, Sprite>;
  #startButton: TextField;
  // row = Y (which keyboard row), col = X (position within the row)
  #row: number;
  #col: number;
  #name: string;

  constructor(game: Game, params: Record<string, unknown> | null = null) {
    super(game, params);
    // Coming back from a game, the in-game music is still playing
    this.game.music.play("mainTheme");
    // Load the name from local storage
    this.#name = CONFIG.name;
    // Create the name text field
    const nameLabel = this.addChild(
      new TextField(this.game, "cyberphont3a", "Enter your name:"),
    );
    nameLabel.centerX = this.centerX;
    nameLabel.y = 30;
    this.#nameField = this.addChild(
      new TextField(this.game, "cyberphont3b", this.#name || DEFAULT_NAME),
    );
    this.#nameField.scale = 2;
    this.#nameField.centerX = this.centerX;
    this.#nameField.y = nameLabel.y + nameLabel.height + 8;
    //
    this.#startButton = this.addChild(
      new TextField(this.game, "cyberphont3a", "Play!"),
    );
    this.#startButton.scale = 2;
    this.#startButton.centerX = this.centerX;
    this.#startButton.centerY = this.#nameField.bottom + 30;
    this.#startButton.tint = Palette.ELIXIR_PURPLE;
    // Create the sprites for the on screen keyboard
    this.#keys = [];
    this.#keyMap = {};
    const kb = SPACE_ENABLED
      ? ["1234567890<", "qwertyuiop", "asdfghjkl", "zxcvbnm", " "]
      : ["1234567890<", "qwertyuiop", "asdfghjkl", "zxcvbnm"];
    const rows = kb.length;
    for (let r = 0; r < rows; r++) {
      const rowKeys = [];
      const cols = kb[r].length;
      for (let c = 0; c < cols; c++) {
        let keyName = kb[r][c];
        // Hacky, but gets the job done:
        if (keyName === " ") keyName = SPACE;
        else if (keyName === "<") keyName = BACKSPACE;
        const key = this.addChild(
          new Sprite(this.game, this.#keySpriteId(keyName, false), "ui"),
        );
        key.tint = Palette.ELIXIR_PURPLE;
        rowKeys.push(keyName);
        this.#keyMap[keyName] = key;
      }

      for (let i = 0; i < cols; i++) {
        const key = this.#keyMap[rowKeys[i]];
        // The backspace key is larger so it moves the entire row to the side.
        // By pretending its size is the same as all other keys, it looks nicer.
        const keyW =
          key.id == "kb_backspace_up"
            ? this.#keyMap[rowKeys[0]].width
            : key.width;
        key.x =
          this.centerX +
          (i - cols / 2) * (keyW + KEY_SEPARATION) +
          KEY_SEPARATION / 2;
        key.y =
          165 +
          (r - rows / 2) * (key.height + KEY_SEPARATION) +
          KEY_SEPARATION / 2;
      }
      this.#keys.push(rowKeys);
    }
    this.#row = 0;
    this.#col = Math.floor(this.#keys[0].length / 2);
    this.#startButton.tintStrength = 1;
    // Add the input listeners
    this.game.input.addListener(this);
  }

  update(alpha: number, dt: number): void {
    super.update(alpha, dt);

    // Check if we need to go back
    if (this.game.inputMap.backBtn.justReleased) {
      this.game.sound.play("menuConfirm");
      this.close();
      return;
    }

    // Adjust the currently selected key
    const prevRow = this.#row;
    const prevCol = this.#col;
    // First check the vertical axis
    if (this.game.inputMap.vAxis.triggered) {
      const numRows = this.#keys.length;
      this.#row = Math.max(
        0,
        Math.min(numRows, this.#row + this.game.inputMap.vAxis.value),
      );
    }

    if (this.#row === 0) {
      // If the row is 0, it's the start button
      this.#startButton.tintStrength = 1;
      // Keyboard rows start at 1, since row 0 is the start button
      if (prevRow > 0) {
        this.#keyMap[this.#keys[prevRow - 1][prevCol]].tintStrength = 0;
      }
      //
      if (this.game.inputMap.acceptBtn.justReleased) {
        this.game.sound.play("menuConfirm");
        this.manager.push("game", {
          name: (this.#name || DEFAULT_NAME).toUpperCase(),
        });
      }
    } else {
      // Remap #col proportionally so the cursor stays at the same relative
      // horizontal position when moving between rows of different lengths
      if (prevRow == 0) {
        this.#startButton.tintStrength = 0;
      } else if (this.#row !== prevRow) {
        const prevLen = this.#keys[prevRow - 1].length;
        const newLen = this.#keys[this.#row - 1].length;
        this.#col =
          prevLen > 1
            ? Math.round((this.#col / (prevLen - 1)) * (newLen - 1))
            : 0;
      }

      if (this.game.inputMap.hAxis.triggered) {
        this.#col += Math.trunc(this.game.inputMap.hAxis.value);
      }
      // The columns loop around
      const numCols = this.#keys[this.#row - 1].length;
      if (this.#col < 0) {
        this.#col = numCols - 1;
      } else if (this.#col >= numCols) {
        this.#col = 0;
      }
      // Undo the tint of the previous key and set the new key to the selected colour
      if (prevRow > 0) {
        this.#keyMap[this.#keys[prevRow - 1][prevCol]].tintStrength = 0;
      }
      this.#keyMap[this.#keys[this.#row - 1][this.#col]].tintStrength = 0.5;
      // Check if the accept button was pressed
      if (this.game.inputMap.acceptBtn.justReleased) {
        this.game.sound.play("menuConfirm");
        this.#onKeyPressed(this.#keys[this.#row - 1][this.#col]);
      }
    }
    if (this.#row !== prevRow || this.#col !== prevCol) {
      this.game.sound.play("menuMove");
    }
  }

  remove(): void {
    super.remove();
    this.game.input.removeListener(this);
  }

  // InputListener

  onKeyDown(keyCode: number): void {
    const keyName = this.#keyNameFromCode(keyCode);
    if (keyName) {
      this.game.sound.play("menuConfirm");
      this.#onKeyPressed(keyName);
      this.#keyMap[keyName].id = this.#keySpriteId(keyName, true);
    }
  }

  onKeyUp(keyCode: number): void {
    const keyName = this.#keyNameFromCode(keyCode);
    if (keyName) {
      this.#keyMap[keyName].id = this.#keySpriteId(keyName, false);
    }
  }

  // Utility functions

  #keyNameFromCode(keyCode: number): string | null {
    if (keyCode >= KeyCodes.A && keyCode <= KeyCodes.Z) {
      return String.fromCharCode(keyCode).toLowerCase();
    } else if (keyCode >= KeyCodes.NUM_0 && keyCode <= KeyCodes.NUM_9) {
      return String.fromCharCode(keyCode);
    } else if (keyCode === KeyCodes.SPACE && SPACE_ENABLED) {
      return SPACE;
    } else if (keyCode === KeyCodes.BACKSPACE) {
      return BACKSPACE;
    } else {
      return null;
    }
  }

  #onKeyPressed(keyName: string): void {
    if (keyName === BACKSPACE) {
      this.#name = this.#name.slice(0, -1);
    } else {
      if (this.#name.length < MAX_NAME_LEN) {
        if (keyName === SPACE) {
          keyName = " ";
        }
        this.#name += keyName;
      }
    }
    // Save the new name
    CONFIG.name = this.#name;
    // Update the name field and recenter it
    this.#nameField.text = this.#name || DEFAULT_NAME;
    this.#nameField.centerX = this.centerX;
  }

  #keySpriteId(keyName: string, down: boolean): string {
    if (down) {
      return `kb_${keyName}_down`;
    } else {
      return `kb_${keyName}_up`;
    }
  }
}

export default PlayerSetupScreen;
