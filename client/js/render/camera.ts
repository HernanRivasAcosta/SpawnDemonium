class Camera {
  // The size (integers)
  #w: number;
  #h: number;
  // Current position (floats)
  // Note: The x and y can be floats so that the camera can move smoothly in a diagonal
  #x: number;
  #y: number;
  // When rendering, we need to ensure the camera is at integer coordinates
  // for pixel perfect rendering
  get x(): number {
    return Math.floor(this.#x);
  }
  get y(): number {
    return Math.floor(this.#y);
  }
  get width(): number {
    return this.#w;
  }
  get height(): number {
    return this.#h;
  }
  get left(): number {
    return this.x;
  }
  get right(): number {
    return this.x + this.#w;
  }
  get centerX(): number {
    return Math.floor((this.left + this.right) / 2);
  }
  get top(): number {
    return this.y;
  }
  get bottom(): number {
    return this.y + this.#h;
  }
  get centerY(): number {
    return Math.floor((this.top + this.bottom) / 2);
  }
  // Target position
  #tx: number;
  #ty: number;
  // Velocity in pixels per second
  #v: number;
  get v(): number {
    return this.#v;
  }
  set v(value: number) {
    this.#v = value;
  }

  constructor(v: number = 1, width: number, height: number) {
    this.#w = width;
    this.#h = height;
    //
    this.#x = 0;
    this.#tx = 0;
    this.#y = 0;
    this.#ty = 0;
    this.#v = v;
  }

  getUniform(): [number, number] {
    return [this.x, this.y];
  }

  reset() {
    this.moveTo(0, 0, true);
  }

  centerAt(x: number, y: number, snap: boolean = false): void {
    this.moveTo(x - this.#w / 2, y - this.#h / 2, snap);
  }

  moveTo(x: number, y: number, snap: boolean = false): void {
    this.#tx = x;
    this.#ty = y;
    if (snap) {
      this.#x = x;
      this.#y = y;
    }
  }

  // dt is in milliseconds
  update(alpha: number, dt: number): void {
    const dx = this.#tx - this.#x;
    const dy = this.#ty - this.#y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0) {
      const v = Math.min((this.#v * dt) / 1000, d);
      this.#x = this.#x + (dx / d) * v;
      this.#y = this.#y + (dy / d) * v;
    }
  }
}

export default Camera;
