import Node from "../core/node.ts";
import { Sprite, SpriteGroup, Color } from "./sprites.ts";
import type Game from "../game.ts";

class TextField extends Node {
  #text: string;
  get text(): string {
    return this.#text;
  }
  set text(value: string) {
    this.#setText(value);
  }
  #length: number;
  get length(): number {
    return this.#length;
  }
  //
  #w: number = 0;
  #h: number = 0;
  //
  #font: string;
  get font(): string {
    return this.#font;
  }
  //
  #group: SpriteGroup;
  #glyphs: Sprite[];
  // Miscelaneous getters/setters
  get x(): number {
    return this.#group.x;
  }
  set x(value: number) {
    this.#group.x = value;
  }
  get width(): number {
    return this.#w * this.scale;
  }
  get centerX(): number {
    return this.x + this.width / 2;
  }
  set centerX(value: number) {
    this.x = value - this.width / 2;
  }
  get left(): number {
    return this.x;
  }
  set left(value: number) {
    this.x = value;
  }
  get right(): number {
    return this.x + this.width;
  }
  set right(value: number) {
    this.x = value - this.width;
  }
  get y(): number {
    return this.#group.y;
  }
  get height(): number {
    return this.#h * this.scale;
  }
  set y(value: number) {
    this.#group.y = value;
  }
  get centerY(): number {
    return this.y + this.height / 2;
  }
  set centerY(value: number) {
    this.y = value - this.height / 2;
  }
  get top(): number {
    return this.y;
  }
  set top(value: number) {
    this.y = value;
  }
  get bottom(): number {
    return this.y + this.height;
  }
  set bottom(value: number) {
    this.y = value - this.height;
  }
  get z(): number {
    return this.#group.z;
  }
  set z(value: number) {
    this.#group.z = value;
  }
  get scale(): number {
    return this.#group.scale;
  }
  set scale(value: number) {
    this.#group.scale = value;
  }
  get visible(): boolean {
    return this.#group.visible;
  }
  set visible(value: boolean) {
    this.#group.visible = value;
  }
  get tint(): Color {
    return this.#group.tint;
  }
  set tint(value: Color) {
    this.#group.tint = value;
  }
  get tintStrength(): number {
    return this.#group.tintStrength;
  }
  set tintStrength(value: number) {
    this.#group.tintStrength = value;
  }

  constructor(game: Game, font: string, text: string = "") {
    super(game);
    this.#font = font;
    this.#text = "";
    this.#length = 0;
    this.#group = this.addChild(new SpriteGroup(this.game, "textField", font));
    this.#glyphs = [];
    //
    this.#setText(text);
  }

  #setText(text: string): void {
    this.#text = text;
    this.#w = 0;
    this.#h = 0;
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i).toString();
      // #length is the pre-update count; stable even as #glyphs grows during this loop
      let glyph: Sprite;
      if (i >= this.#length) {
        glyph = this.#group.addChild(new Sprite(this.game, charCode));
        this.#glyphs.push(glyph);
      } else {
        glyph = this.#glyphs[i];
        glyph.id = charCode;
      }
      glyph.x = this.#w;
      this.#w += glyph.width;
      this.#h = Math.max(this.#h, glyph.height);
    }
    for (const glyph of this.#glyphs.splice(text.length)) {
      glyph.remove();
    }
    this.#length = text.length;
  }
}

export default TextField;
