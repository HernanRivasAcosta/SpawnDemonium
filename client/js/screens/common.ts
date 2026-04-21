import Node from "../core/node.ts";
import type Game from "../game.ts";
import TextField from "../render/text-field.ts";
import Palette from "../render/palette.ts";

export interface ButtonConfig {
  id: string;
  text: string;
  scale?: number;
  checkbox?: boolean;
  // Default is mandatory for checkboxes, and ignored for regular buttons
  default?: boolean;
  extraSpacing?: number;
  // Labels are shown in the list, but can't be selected
  label?: boolean;
  // Left and right aligned buttons line up with the edges of the list's width
  align?: "left" | "center" | "right";
  // Pinned buttons stay below a scrolling list instead of scrolling with it
  pinned?: boolean;
}

export interface ButtonListConfig {
  loopButtons?: boolean;
  top?: number;
  centerX?: number;
  buttonSpacing?: number;
  // Width used to align buttons to the left or right, defaults to the widest button
  width?: number;
  // When set, the list scrolls to fit in this height, with its pinned buttons below it
  maxHeight?: number;
}

// Shown above and below a scrolling list when there are more buttons in that direction
const MORE_TEXT = "...";
const MORE_SPACING = 2;

export class ButtonList extends Node {
  #game: Game;
  #onSelected: (id: string, value: boolean) => void;
  #loopButtons: boolean;
  //
  #currentButton: number;
  #buttons: {
    id: string;
    textField: TextField;
    value: boolean;
    selectable: boolean;
    pinned: boolean;
    // Position before scrolling
    baseY: number;
  }[];
  #checkBoxes: { [key: string]: TextField };
  // Scrolling
  #top: number;
  #maxHeight: number | null;
  #scrollIndex: number;
  #moreAbove: TextField | null;
  #moreBelow: TextField | null;

  constructor(
    game: Game,
    buttons: ButtonConfig[],
    font: string,
    onSelected: (id: string, value: boolean) => void,
    configuration: ButtonListConfig,
  ) {
    super(game);
    this.#game = game;
    this.#onSelected = onSelected;
    this.#loopButtons = configuration.loopButtons ?? false;
    this.#checkBoxes = {};
    this.#top = configuration.top ?? 0;
    this.#maxHeight = configuration.maxHeight ?? null;
    this.#scrollIndex = 0;
    this.#moreAbove = null;
    this.#moreBelow = null;
    //
    let minX = 99999;
    let maxCheckboxLabelWidth = 0;
    let y = this.#top;
    // Pinned buttons go below the scrolling area, when there's one
    let pinnedY = this.#maxHeight === null ? null : this.#top + this.#maxHeight;
    const buttonSpacing = configuration.buttonSpacing ?? 10;
    this.#buttons = [];
    for (const button of buttons) {
      const id = button.id;
      const scale = button.scale ?? 1;
      const extraSpacing = button.extraSpacing ?? 0;
      const textField = this.addChild(
        new TextField(this.game, font, button.text),
      );
      const selectable = !(button.label ?? false);
      textField.tint = selectable ? Palette.ELIXIR_PURPLE : Palette.DEMON_RED;
      textField.scale = scale;
      textField.centerX = this.game.width / 2;
      const pinned = (button.pinned ?? false) && pinnedY !== null;
      if (pinned) {
        textField.y = pinnedY! + extraSpacing;
        pinnedY = textField.y + textField.height + buttonSpacing;
      } else {
        textField.y = y + extraSpacing;
        y += textField.height + buttonSpacing + extraSpacing;
      }
      minX = Math.min(minX, textField.x);
      if (button.checkbox ?? false) {
        maxCheckboxLabelWidth = Math.max(
          maxCheckboxLabelWidth,
          textField.width,
        );
      }
      this.#buttons.push({
        id,
        textField,
        value: true,
        selectable,
        pinned,
        baseY: textField.y,
      });
    }

    // Align the buttons that aren't centered
    const width =
      configuration.width ??
      Math.max(...this.#buttons.map((b) => b.textField.width));
    for (let i = 0; i < buttons.length; i++) {
      const textField = this.#buttons[i].textField;
      if (buttons[i].align === "left") {
        textField.left = this.game.width / 2 - width / 2;
      } else if (buttons[i].align === "right") {
        textField.right = this.game.width / 2 + width / 2;
      }
    }

    // Iterate again, to find the checkboxes
    for (const button of buttons) {
      if (button.checkbox ?? false) {
        // Get the label for this checkbox
        const label = this.#buttons.find((b) => b.id === button.id)!;
        label.value = button.default!;
        const labelTextField = label.textField;
        // Create the checkbox
        const checkbox = this.addChild(
          new TextField(this.game, font, this.#checkBoxText(label.value)),
        );
        checkbox.tint = labelTextField.tint;
        checkbox.scale = labelTextField.scale ?? 1;
        checkbox.right = labelTextField.right;
        checkbox.y = labelTextField.y;
        this.#checkBoxes[button.id] = checkbox;
        // The final width is the width of the checkbox plus the width of the textfield
        // However, since we want them aligned, we use the max width instead
        const finalWidth = checkbox.width + maxCheckboxLabelWidth * 2;
        // Center the textfield and the checkbox together
        labelTextField.left = this.game.width / 2 - finalWidth / 2;
        checkbox.right = this.game.width / 2 + finalWidth / 2;
      }
    }

    if (this.#maxHeight !== null) {
      this.#moreAbove = this.#createMoreIndicator(font);
      this.#moreAbove.y = this.#top - this.#moreAbove.height - MORE_SPACING;
      this.#moreBelow = this.#createMoreIndicator(font);
      this.#moreBelow.y = this.#top + this.#maxHeight + MORE_SPACING;
    }

    // Start on the first button that can be selected
    this.#currentButton = Math.max(
      0,
      this.#buttons.findIndex((b) => b.selectable),
    );
    this.#highlightSelected();
    this.#scrollTo(this.#currentButton);
  }

  update(alpha: number, dt: number): void {
    super.update(alpha, dt);

    if (this.#game.inputMap.vAxis.justChanged) {
      const delta = Math.sign(this.#game.inputMap.vAxis.value);
      if (delta !== 0) {
        const prevButton = this.#currentButton;
        this.#navigateButtons(delta);
        // Non looping lists don't move past their ends
        if (this.#currentButton !== prevButton) {
          this.#game.sound.play("menuMove");
          this.#scrollTo(this.#currentButton);
        }
        this.#highlightSelected();
      }
    }

    if (this.#game.inputMap.acceptBtn.justReleased) {
      const selected = this.#buttons[this.#currentButton];
      // Check if this button has a checkbox
      const checkBox = this.#checkBoxes[selected.id];
      if (checkBox) {
        // Toggle the value
        selected.value = !selected.value;
        // Update the checkbox text
        checkBox.text = this.#checkBoxText(selected.value);
      }
      // For non checkboxes the value will always be true
      this.#onSelected(selected.id, selected.value);
      // Play it after the callback, so toggling the sound on plays it and toggling it off doesn't
      this.#game.sound.play("menuConfirm");
    }
  }

  #navigateButtons(delta: number): void {
    const numButtons = this.#buttons.length;
    let next = this.#currentButton;
    // Labels can't be selected, so keep moving until a button is found
    for (let i = 0; i < numButtons; i++) {
      next += delta;
      if (this.#loopButtons) {
        next = (next + numButtons) % numButtons;
      } else if (next < 0 || next >= numButtons) {
        return;
      }
      if (this.#buttons[next].selectable) {
        this.#currentButton = next;
        return;
      }
    }
  }

  #createMoreIndicator(font: string): TextField {
    const indicator = this.addChild(new TextField(this.game, font, MORE_TEXT));
    indicator.tint = Palette.ELIXIR_PURPLE;
    indicator.tintStrength = 1;
    indicator.centerX = this.game.width / 2;
    return indicator;
  }

  // Scrolls the list, if needed, so the given button is in view
  #scrollTo(index: number): void {
    const button = this.#buttons[index];
    if (this.#maxHeight === null || button.pinned) {
      return;
    }
    const top = this.#top;
    const bottom = top + this.#maxHeight;
    // Keep the labels right above the button in view, so section titles show with their first entry
    let first = index;
    while (first > 0 && !this.#buttons[first - 1].selectable) {
      first--;
    }
    if (first < this.#scrollIndex) {
      this.#scrollIndex = first;
    }
    // Scroll down one whole button at a time, so buttons are never cut in half
    const buttonBottom = button.baseY + button.textField.height;
    while (
      this.#scrollIndex < first &&
      buttonBottom - (this.#buttons[this.#scrollIndex].baseY - top) > bottom
    ) {
      this.#scrollIndex++;
    }
    // Position the buttons, hiding the ones outside the scrolling area
    const offset = this.#buttons[this.#scrollIndex].baseY - top;
    let moreAbove = false;
    let moreBelow = false;
    for (const b of this.#buttons) {
      if (b.pinned) {
        continue;
      }
      const y = b.baseY - offset;
      const visible = y >= top && y + b.textField.height <= bottom;
      b.textField.y = y;
      b.textField.visible = visible;
      const checkBox = this.#checkBoxes[b.id];
      if (checkBox) {
        checkBox.y = y;
        checkBox.visible = visible;
      }
      if (y < top) {
        moreAbove = true;
      } else if (!visible) {
        moreBelow = true;
      }
    }
    this.#moreAbove!.visible = moreAbove;
    this.#moreBelow!.visible = moreBelow;
  }

  #highlightSelected() {
    for (let i = 0; i < this.#buttons.length; i++) {
      // Labels keep their own colour
      if (!this.#buttons[i].selectable) {
        continue;
      }
      const textField = this.#buttons[i].textField;
      const tintStrength = i === this.#currentButton ? 0 : 1;
      textField.tintStrength = tintStrength;
      // If there's a checkbox for this button, update its tint strength as well
      const checkBox = this.#checkBoxes[this.#buttons[i].id];
      if (checkBox) {
        checkBox.tintStrength = tintStrength;
      }
    }
  }

  #checkBoxText(value: boolean) {
    // The length of the strings for true and false needs to be the same
    return value ? " on" : "off";
    //return value ? "[x]" : "[ ]";
  }
}
