import Game from "../game.ts";

class Node {
  #children: Node[];
  #hasRemoved: boolean;
  #parent: Node | null;
  get parent(): Node | null {
    return this.#parent;
  }

  #game: Game;
  get game(): Game {
    return this.#game;
  }

  constructor(game: Game | null) {
    if (game === null) {
      if (!(this instanceof Game)) {
        throw new Error(
          "Only Game can be constructed without a game reference",
        );
      }
      this.#game = this as unknown as Game;
    } else {
      this.#game = game;
    }
    this.#children = [];
    this.#hasRemoved = false;
    this.#parent = null;
  }

  protected _addedToParent(parent: Node) {
    this.#parent = parent;
  }

  protected _removedFromParent() {
    this.#parent = null;
  }

  addChild<T extends Node>(child: T): T {
    // A child removed and added back before the cleanup is still in the list
    if (!this.#hasRemoved || !this.#children.includes(child)) {
      this.#children.push(child);
    }
    child._addedToParent(this);
    return child;
  }

  removeChild(child: Node): Node | null {
    if (child.#parent !== this) return null;
    child._removedFromParent();
    this.#hasRemoved = true;
    return child;
  }

  tick(tick: number) {
    const children = this.#children;
    // Children added during the pass update starting on the next one
    const count = children.length;
    for (let i = 0; i < count; i++) {
      const child = children[i];
      // Skip the removed children
      if (child.#parent === this) child.tick(tick);
    }
    this.#cleanUp();
  }

  update(alpha: number, dt: number) {
    const children = this.#children;
    // Children added during the pass update starting on the next one
    const count = children.length;
    for (let i = 0; i < count; i++) {
      const child = children[i];
      // Skip the removed children
      if (child.#parent === this) child.update(alpha, dt);
    }
    this.#cleanUp();
  }

  // Drops the removed children from the list, compacting it in place
  #cleanUp(): void {
    if (!this.#hasRemoved) return;
    this.#hasRemoved = false;
    const children = this.#children;
    let n = 0;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.#parent === this) children[n++] = child;
    }
    children.length = n;
  }

  removeFromParent() {
    this.#parent?.removeChild(this);
  }

  remove() {
    this.removeFromParent();
    const children = this.#children;
    this.#children = [];
    this.#hasRemoved = false;
    for (const child of children) {
      // Skip the children that were already removed
      if (child.#parent !== this) continue;
      child._removedFromParent();
      child.remove();
    }
  }
}

export default Node;
