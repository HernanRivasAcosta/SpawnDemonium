import type Game from "../game.ts";
import Node from "../core/node.ts";
import type Renderer from "./renderer.ts";

// The root of the sprite hierarchy — always the RenderGroup.
// Defined here as an interface to avoid a circular import with renderer.ts.
export interface SpriteRoot {
  getSpriteWidth(id: string): number;
  getSpriteHeight(id: string): number;
}

// SpriteParent is implemented by SpriteGroup and RenderGroup.
export interface SpriteParent {
  get atlas(): string | null;
  get root(): SpriteRoot;
  removeSprite(sprite: Sprite): void;
}

export class Color {
  r: number;
  g: number;
  b: number;

  constructor(r: number, g: number, b: number) {
    this.r = r;
    this.g = g;
    this.b = b;
  }

  static fromHex(hex: number): Color {
    return new Color(
      ((hex >> 16) & 0xff) / 255,
      ((hex >> 8) & 0xff) / 255,
      (hex & 0xff) / 255,
    );
  }

  static readonly RED = new Color(1, 0, 0);
  static readonly GREEN = new Color(0, 1, 0);
  static readonly BLUE = new Color(0, 0, 1);
  static readonly YELLOW = new Color(1, 1, 0);
  static readonly WHITE = new Color(1, 1, 1);
  static readonly BLACK = new Color(0, 0, 0);
}

export class Sprite extends Node {
  #id: string;
  get id(): string {
    return this.#id;
  }
  set id(v: string) {
    this.#id = v;
    this.#refreshSize();
  }
  #atlas: string | null;
  get atlas(): string | null {
    return this.#atlas;
  }
  // Public properties
  x: number = 0;
  y: number = 0;
  z: number = 0;
  scaleX: number = 1;
  scaleY: number = 1;
  get scale(): number {
    return this.scaleX;
  }
  set scale(v: number) {
    this.scaleX = v;
    this.scaleY = v;
  }
  visible: boolean = true;
  tint: Color = Color.WHITE;
  tintStrength: number = 0;
  // Anchor point in [0, 1] relative to the sprite's original size.
  // (0, 0) = top-left (default), (0.5, 0.5) = center, (1, 1) = bottom-right.
  anchorX: number = 0;
  anchorY: number = 0;
  // Protected so subclasses can delegate getSpriteWidth/getSpriteHeight upward
  protected _parent: SpriteParent | null = null;
  // Raw (unscaled) atlas dimensions; populated by #refreshSize()
  protected _width: number = 0;
  protected _height: number = 0;
  // Utility getter
  get renderer(): Renderer {
    return this.game.renderer;
  }

  get width(): number {
    return Math.abs(this._width * this.scaleX);
  }
  set width(v: number) {
    if (this._width === 0) return; // Avoid divide-by-zero when atlas is not loaded yet
    this.scaleX = Math.sign(this.scaleX) * (v / this._width);
  }

  get height(): number {
    return Math.abs(this._height * this.scaleY);
  }
  set height(v: number) {
    if (this._height === 0) return; // Avoid divide-by-zero when atlas is not loaded yet
    this.scaleY = Math.sign(this.scaleY) * (v / this._height);
  }

  // When scale is negative the sprite is flipped, so anchorX=0 becomes the visual
  // right edge. effectiveAnchorX/Y give the fraction from the visual left/top edge.
  get #eax(): number {
    return this.scaleX >= 0 ? this.anchorX : 1 - this.anchorX;
  }
  get #eay(): number {
    return this.scaleY >= 0 ? this.anchorY : 1 - this.anchorY;
  }

  get left(): number {
    return this.x - this.#eax * this.width;
  }
  set left(v: number) {
    this.x = v + this.#eax * this.width;
  }

  get right(): number {
    return this.x + (1 - this.#eax) * this.width;
  }
  set right(v: number) {
    this.x = v - (1 - this.#eax) * this.width;
  }

  get top(): number {
    return this.y - this.#eay * this.height;
  }
  set top(v: number) {
    this.y = v + this.#eay * this.height;
  }

  get bottom(): number {
    return this.y + (1 - this.#eay) * this.height;
  }
  set bottom(v: number) {
    this.y = v - (1 - this.#eay) * this.height;
  }

  get centerX(): number {
    return this.x + (0.5 - this.#eax) * this.width;
  }
  set centerX(v: number) {
    this.x = v - (0.5 - this.#eax) * this.width;
  }

  get centerY(): number {
    return this.y + (0.5 - this.#eay) * this.height;
  }
  set centerY(v: number) {
    this.y = v - (0.5 - this.#eay) * this.height;
  }

  constructor(game: Game, id: string, atlas: string | null = null) {
    super(game);
    this.#id = id;
    this.#atlas = atlas;
    if (atlas) {
      this.renderer.add(this);
    }
  }

  // Called by SpriteGroup/RenderGroup.add() — not part of the public API
  _setParent(parent: SpriteParent): void {
    // If we have a parent, we rely on it to render this sprite
    this.renderer.removeSprite(this);
    //
    this._parent = parent;
    this.#atlas = parent.atlas;
    this.#refreshSize();
  }

  #refreshSize(): void {
    if (this._parent === null) return;
    const root = this._parent.root;
    this._width = root.getSpriteWidth(this.#id);
    this._height = root.getSpriteHeight(this.#id);
  }

  remove(): void {
    // Stop rendering it
    if (this._parent) {
      this._parent!.removeSprite(this);
    } else {
      this.renderer.removeSprite(this);
    }
    // Detach it from the node tree, so it stops ticking and updating, and remove its children
    super.remove();
  }
}

export class SpriteGroup extends Sprite implements SpriteParent {
  // Parallel to Node's private children list — Node's list drives tick/update,
  // this list drives rendering. Both are kept in sync via addChild/removeChild.
  #children: Sprite[];
  get children(): Sprite[] {
    return this.#children;
  }

  zMult: number;

  constructor(
    game: Game,
    id: string | null = null,
    atlas: string | null = null,
  ) {
    super(game, id ?? "", atlas);
    this.zMult = 1;
    this.#children = [];
  }

  override addChild<T extends Node>(child: T): T {
    const sprite = child as unknown as Sprite;
    if (sprite.atlas !== null && sprite.atlas !== this.atlas) {
      console.error(
        `Adding a sprite with atlas ${sprite.atlas} to a parent of incompatible atlas ${this.atlas}`,
      );
    }
    sprite._setParent(this);
    this.#children.push(sprite);
    return super.addChild(child);
  }

  override removeChild(child: Node): Node | null {
    const idx = this.#children.indexOf(child as unknown as Sprite);
    if (idx !== -1) {
      this.#children.splice(idx, 1);
    }
    return super.removeChild(child);
  }

  removeSprite(sprite: Sprite): void {
    this.removeChild(sprite);
  }

  // Chain root up to the RenderGroup, which is the only real atlas lookup
  get root(): SpriteRoot {
    return this._parent!.root;
  }

  // Bounding box of all children, overrides the atlas-based width/height from Sprite
  override get width(): number {
    if (this.#children.length === 0) return 0;
    let minX = Infinity,
      maxX = -Infinity;
    for (const child of this.#children) {
      minX = Math.min(minX, child.left);
      maxX = Math.max(maxX, child.right);
    }
    return maxX - minX;
  }

  override get height(): number {
    if (this.#children.length === 0) return 0;
    let minY = Infinity,
      maxY = -Infinity;
    for (const child of this.#children) {
      minY = Math.min(minY, child.top);
      maxY = Math.max(maxY, child.bottom);
    }
    return maxY - minY;
  }
}

export type FrameCallback = (
  sprite: AnimatedSprite,
  animation: string,
  frame: number,
) => void;

interface FrameEvent {
  callback: FrameCallback;
  animation: string | null;
  frame: number | null;
  remainingActivations: number;
}

export class AnimatedSprite extends Sprite {
  #entityId: string;
  #animations: Record<string, number>;
  #animSpeed: number;
  #currentAnim: string;
  get animation(): string {
    return this.#currentAnim;
  }
  #currentFrame: number;
  #enterEvents: FrameEvent[];
  #exitEvents: FrameEvent[];
  #playing: boolean;
  #firingExit: boolean;

  constructor(
    game: Game,
    entityId: string,
    atlas: string,
    animations: Record<string, number>,
    animSpeed: number = 1,
  ) {
    const firstAnim = Object.keys(animations)[0];
    super(game, `${entityId}_${firstAnim}_0`, atlas);
    this.#entityId = entityId;
    this.#animations = animations;
    this.#animSpeed = animSpeed;
    this.#currentAnim = firstAnim;
    this.#currentFrame = 0;
    this.#enterEvents = [];
    this.#exitEvents = [];
    this.#playing = false;
    this.#firingExit = false;
  }

  onEnterFrame(
    callback: FrameCallback,
    animation: string | null = null,
    frame: number | null = null,
    activations: number = 1,
  ): void {
    this.#enterEvents.push({
      callback,
      animation,
      frame,
      remainingActivations: activations,
    });
  }

  onExitFrame(
    callback: FrameCallback,
    animation: string | null = null,
    frame: number | null = null,
    activations: number = 1,
  ): void {
    this.#exitEvents.push({
      callback,
      animation,
      frame,
      remainingActivations: activations,
    });
  }

  // Returns the animation length, if the animation is not defined it just "unpauses"
  play(anim: string | null): number {
    this.#playing = true;
    if (anim === null || this.#currentAnim === anim) {
      return this.#animations[this.#currentAnim];
    }
    const prevAnim = this.#currentAnim;
    const prevFrame = this.#currentFrame;
    // Update state before firing exit so re-entrant play() calls hit the early return above
    this.#currentAnim = anim;
    this.#currentFrame = 0;
    this.id = `${this.#entityId}_${anim}_0`;
    // We need to fire the event for leaving the previous frame only if it wasn't firing already
    if (!this.#firingExit) {
      this.#fireExitEvents(prevAnim, prevFrame);
    }
    this.#fireEvents(this.#enterEvents, anim, 0);
    return this.#animations[anim];
  }

  pause(): void {
    this.#playing = false;
  }

  override tick(tick: number): void {
    super.tick(tick);
    if (this.#playing && tick % this.#animSpeed === 0) {
      const prevAnim = this.#currentAnim;
      const prevFrame = this.#currentFrame;
      this.#fireExitEvents(prevAnim, prevFrame);
      // If play() was called from the exit event, it already handled everything
      if (this.#currentAnim !== prevAnim) return;
      this.#currentFrame =
        (prevFrame + 1) % this.#animations[this.#currentAnim];
      this.id = `${this.#entityId}_${this.#currentAnim}_${this.#currentFrame}`;
      this.#fireEvents(
        this.#enterEvents,
        this.#currentAnim,
        this.#currentFrame,
      );
    }
  }

  #fireExitEvents(animation: string, frame: number): void {
    this.#firingExit = true;
    try {
      this.#fireEvents(this.#exitEvents, animation, frame);
    } finally {
      this.#firingExit = false;
    }
  }

  #fireEvents(events: FrameEvent[], animation: string, frame: number): void {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (
        (e.animation === null || e.animation === animation) &&
        (e.frame === null || e.frame === frame)
      ) {
        e.callback(this, animation, frame);
        if (--e.remainingActivations <= 0) {
          events.splice(i, 1);
        }
      }
    }
  }
}
