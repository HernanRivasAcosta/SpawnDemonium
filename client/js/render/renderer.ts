import Node from "../core/node.ts";
import type { Assets } from "../assets.ts";
import Camera from "./camera.ts";
import TextField from "./text-field.ts";
import { Sprite, SpriteGroup } from "./sprites.ts";
import type { SpriteParent, SpriteRoot } from "./sprites.ts";
import CONFIG from "../config.ts";
import type Game from "../game.ts";

// Floats per vertex: x, y, z, u, v, tintR, tintG, tintB, tintStrength
const FLOATS_PER_VERT = 9;
const BYTES_PER_VERT = FLOATS_PER_VERT * 4;
// 2 triangles = 6 vertices per sprite
const VERTS_PER_SPRITE = 6;
const MAX_SPRITES = 8192;
//
const MAX_Z = 255;

interface LeafData {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  tr: number;
  tg: number;
  tb: number;
  ts: number;
  texture: WebGLTexture | null;
}

interface AtlasRegionSrc {
  // Rect: [x, y, w, h] in atlas pixels
  r: [number, number, number, number];
  // Original size: [w, h]
  s: [number, number];
  // Trim offset: [x, y]
  o: [number, number];
}

interface AtlasSrc {
  w: number;
  h: number;
  sprites: Record<string, AtlasRegionSrc>;
}

class AtlasRegion {
  // The original (untrimmed) sprite size
  #w: number;
  #h: number;
  get w(): number {
    return this.#w;
  }
  get h(): number {
    return this.#h;
  }
  // Normalized UV bounds of the trimmed region in the atlas
  #u0: number;
  #v0: number;
  #u1: number;
  #v1: number;
  get u0(): number {
    return this.#u0;
  }
  get v0(): number {
    return this.#v0;
  }
  get u1(): number {
    return this.#u1;
  }
  get v1(): number {
    return this.#v1;
  }
  // The size of the trimmed region in pixels
  #tw: number;
  #th: number;
  get tw(): number {
    return this.#tw;
  }
  get th(): number {
    return this.#th;
  }
  // The offset of the trimmed region within the original sprite
  #ox: number;
  #oy: number;
  get ox(): number {
    return this.#ox;
  }
  get oy(): number {
    return this.#oy;
  }

  constructor(src: AtlasRegionSrc, atlasW: number, atlasH: number) {
    const [rx, ry, rw, rh] = src.r;
    this.#u0 = rx / atlasW;
    this.#v0 = ry / atlasH;
    this.#u1 = (rx + rw) / atlasW;
    this.#v1 = (ry + rh) / atlasH;
    this.#tw = rw;
    this.#th = rh;
    const [sw, sh] = src.s;
    this.#w = sw;
    this.#h = sh;
    const [ox, oy] = src.o;
    this.#ox = ox;
    this.#oy = oy;
  }
}

class Atlas {
  name: string;
  #regions: Map<string, AtlasRegion>;

  constructor(name: string, src: AtlasSrc) {
    this.name = name;
    this.#regions = new Map();
    // Parse the atlas to get all regions (the sprites)
    const w = src.w;
    const h = src.h;
    for (const [key, regionSrc] of Object.entries(src.sprites)) {
      this.#regions.set(key, new AtlasRegion(regionSrc, w, h));
    }
  }

  region(id: string): AtlasRegion | undefined {
    return this.#regions.get(id);
  }
}

class RenderGroup implements SpriteParent, SpriteRoot {
  #atlas: Atlas;
  get atlas(): string {
    return this.#atlas.name;
  }
  get root(): SpriteRoot {
    return this;
  }
  #texture: WebGLTexture;
  // Flat list of top-level sprites/groups owned by this render group
  #sprites: Sprite[];
  // Reference to the global pool and running count, set at the start of each collectInto call
  #pool: LeafData[] = [];
  #leafCount: number = 0;
  // Culling bounds set once per frame before collecting leaves
  #cullX0: number = 0;
  #cullY0: number = 0;
  #cullX1: number = 0;
  #cullY1: number = 0;

  constructor(atlas: Atlas, texture: WebGLTexture) {
    this.#atlas = atlas;
    this.#texture = texture;
    this.#sprites = [];
  }

  getSpriteWidth(id: string): number {
    return this.#atlas.region(id)?.w ?? 0;
  }

  getSpriteHeight(id: string): number {
    return this.#atlas.region(id)?.h ?? 0;
  }

  add<T extends Sprite>(sprite: T): T {
    sprite._setParent(this);
    this.#sprites.push(sprite);
    return sprite;
  }

  removeSprite(sprite: Sprite): void {
    const idx = this.#sprites.indexOf(sprite);
    if (idx !== -1) {
      this.#sprites.splice(idx, 1);
    }
  }

  // Appends visible leaves into the shared global pool starting at `count`.
  // Returns the new total leaf count.
  collectInto(
    pool: LeafData[],
    count: number,
    cullX0: number,
    cullY0: number,
    cullX1: number,
    cullY1: number,
  ): number {
    this.#pool = pool;
    this.#leafCount = count;
    this.#cullX0 = cullX0;
    this.#cullY0 = cullY0;
    this.#cullX1 = cullX1;
    this.#cullY1 = cullY1;
    for (const sprite of this.#sprites) {
      this.#collectLeaves(sprite, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0);
    }
    return this.#leafCount;
  }

  // It's more performant to pass a ton of arguments than building short-lived objects.
  // Traverses the sprite tree, writing each visible leaf into the shared pool.
  #collectLeaves(
    sprite: Sprite,
    xOffset: number,
    yOffset: number,
    zOffset: number,
    zMult: number,
    scaleXOffset: number,
    scaleYOffset: number,
    // Accumulated tint from parent groups
    ptR: number,
    ptG: number,
    ptB: number,
    ptS: number,
  ): void {
    if (!sprite.visible) return;
    // Combine accumulated parent tint with this sprite/group's own tint.
    // Fast paths avoid division in the common cases (only one side has a tint).
    // When both sides have tints: keep the max strength, blend colors by weight.
    let nr: number, ng: number, nb: number, ns: number;
    const cs = sprite.tintStrength;
    if (cs === 0) {
      nr = ptR;
      ng = ptG;
      nb = ptB;
      ns = ptS;
    } else if (ptS === 0) {
      nr = sprite.tint.r;
      ng = sprite.tint.g;
      nb = sprite.tint.b;
      ns = cs;
    } else {
      ns = Math.max(ptS, cs);
      const totalW = ptS + cs;
      nr = (ptR * ptS + sprite.tint.r * cs) / totalW;
      ng = (ptG * ptS + sprite.tint.g * cs) / totalW;
      nb = (ptB * ptS + sprite.tint.b * cs) / totalW;
    }
    if (sprite instanceof SpriteGroup) {
      for (const child of sprite.children) {
        this.#collectLeaves(
          child,
          xOffset + sprite.x * scaleXOffset,
          yOffset + sprite.y * scaleYOffset,
          zOffset + sprite.z * zMult,
          zMult * sprite.zMult,
          scaleXOffset * sprite.scaleX,
          scaleYOffset * sprite.scaleY,
          nr,
          ng,
          nb,
          ns,
        );
      }
      return;
    }
    const region = this.#atlas.region(sprite.id)!;
    if (!region) {
      throw new Error(`Sprite ID "${sprite.id}" not found in atlas`);
    }
    // The sprite scale can only be an integer and it behaves as visible=false when 0
    const spriteScaleX = Math.trunc(sprite.scaleX * scaleXOffset);
    const spriteScaleY = Math.trunc(sprite.scaleY * scaleYOffset);
    if (spriteScaleX == 0 || spriteScaleY == 0) return;
    // Calculate the world-space pixel corners of the trimmed sprite region.
    // Anchor shifts the quad so that (anchorX, anchorY) of the original sprite
    // aligns with the sprite's (x, y) position.
    let x0 = Math.trunc(
      sprite.x * scaleXOffset +
        (region.ox - sprite.anchorX * region.w) * spriteScaleX +
        xOffset,
    );
    let y0 = Math.trunc(
      sprite.y * scaleYOffset +
        (region.oy - sprite.anchorY * region.h) * spriteScaleY +
        yOffset,
    );
    let x1 = x0 + region.tw * spriteScaleX;
    let y1 = y0 + region.th * spriteScaleY;
    // Cull sprites fully outside the camera viewport
    if (
      Math.max(x0, x1) < this.#cullX0 ||
      Math.min(x0, x1) > this.#cullX1 ||
      Math.max(y0, y1) < this.#cullY0 ||
      Math.min(y0, y1) > this.#cullY1
    )
      return;
    const z = Math.max(-1, Math.min(1, (zOffset + sprite.z * zMult) / MAX_Z));
    // Cache UVs; negative scale inverts corners so normalize and flip UVs to mirror
    let u0 = region.u0;
    let v0 = region.v0;
    let u1 = region.u1;
    let v1 = region.v1;
    if (x0 > x1) {
      let t = x0;
      x0 = x1;
      x1 = t;
      t = u0;
      u0 = u1;
      u1 = t;
    }
    if (y0 > y1) {
      let t = y0;
      y0 = y1;
      y1 = t;
      t = v0;
      v0 = v1;
      v1 = t;
    }
    if (this.#leafCount >= MAX_SPRITES) return;
    const leaf = this.#pool[this.#leafCount++]!;
    leaf.x0 = x0;
    leaf.y0 = y0;
    leaf.x1 = x1;
    leaf.y1 = y1;
    leaf.z = z;
    leaf.u0 = u0;
    leaf.v0 = v0;
    leaf.u1 = u1;
    leaf.v1 = v1;
    leaf.tr = nr;
    leaf.tg = ng;
    leaf.tb = nb;
    leaf.ts = ns;
    leaf.texture = this.#texture;
  }
}

function writeLeaf(
  buf: Float32Array,
  leaf: LeafData,
  bufOffset: number,
): number {
  const { x0, y0, x1, y1, z, u0, v0, u1, v1, tr, tg, tb, ts } = leaf;
  // Draw the 2 triangles for the sprite (TL, TR, BL, TR, BR, BL)
  // TL:
  buf[bufOffset++] = x0;
  buf[bufOffset++] = y0;
  buf[bufOffset++] = z;
  buf[bufOffset++] = u0;
  buf[bufOffset++] = v0;
  buf[bufOffset++] = tr;
  buf[bufOffset++] = tg;
  buf[bufOffset++] = tb;
  buf[bufOffset++] = ts;
  // TR:
  buf[bufOffset++] = x1;
  buf[bufOffset++] = y0;
  buf[bufOffset++] = z;
  buf[bufOffset++] = u1;
  buf[bufOffset++] = v0;
  buf[bufOffset++] = tr;
  buf[bufOffset++] = tg;
  buf[bufOffset++] = tb;
  buf[bufOffset++] = ts;
  // BL:
  buf[bufOffset++] = x0;
  buf[bufOffset++] = y1;
  buf[bufOffset++] = z;
  buf[bufOffset++] = u0;
  buf[bufOffset++] = v1;
  buf[bufOffset++] = tr;
  buf[bufOffset++] = tg;
  buf[bufOffset++] = tb;
  buf[bufOffset++] = ts;
  // TR:
  buf[bufOffset++] = x1;
  buf[bufOffset++] = y0;
  buf[bufOffset++] = z;
  buf[bufOffset++] = u1;
  buf[bufOffset++] = v0;
  buf[bufOffset++] = tr;
  buf[bufOffset++] = tg;
  buf[bufOffset++] = tb;
  buf[bufOffset++] = ts;
  // BR:
  buf[bufOffset++] = x1;
  buf[bufOffset++] = y1;
  buf[bufOffset++] = z;
  buf[bufOffset++] = u1;
  buf[bufOffset++] = v1;
  buf[bufOffset++] = tr;
  buf[bufOffset++] = tg;
  buf[bufOffset++] = tb;
  buf[bufOffset++] = ts;
  // BL:
  buf[bufOffset++] = x0;
  buf[bufOffset++] = y1;
  buf[bufOffset++] = z;
  buf[bufOffset++] = u0;
  buf[bufOffset++] = v1;
  buf[bufOffset++] = tr;
  buf[bufOffset++] = tg;
  buf[bufOffset++] = tb;
  buf[bufOffset++] = ts;
  return bufOffset;
}

class Renderer extends Node {
  // Game (logical) resolution — used for sprite positioning and the FBO
  #w: number;
  get width(): number {
    return this.#w;
  }
  #h: number;
  get height(): number {
    return this.#h;
  }
  // Display resolution — the canvas and CRT pass run at this size
  #displayW: number;
  #displayH: number;
  // The camera
  #camera: Camera;
  get camera(): Camera {
    return this.#camera;
  }
  //
  #canvas: HTMLCanvasElement;
  #assets: Assets;
  #glContext: WebGL2RenderingContext;
  #mainProgram: WebGLProgram;
  #crtProgram: WebGLProgram;
  #renderGroups: Map<string, RenderGroup>;
  // Shared sprite geometry buffers for the main pass
  #vao: WebGLVertexArrayObject;
  #vbo: WebGLBuffer;
  #spriteBuffer: Float32Array;
  #uCamera: WebGLUniformLocation;
  // Global pre-allocated leaf pool shared across all render groups
  #leafPool: LeafData[];
  // Offscreen framebuffer for the CRT post-process pass
  #fbo: WebGLFramebuffer;
  #fboTexture: WebGLTexture;
  #fboDepth: WebGLRenderbuffer;
  // CRT quad (no VBO — positions are generated from gl_VertexID in the shader)
  #crtVao: WebGLVertexArrayObject;
  #uCrtTime: WebGLUniformLocation;
  #uCrtYOffset: WebGLUniformLocation;
  #uCrtBypass: WebGLUniformLocation;
  // Stats
  #fps: number = 0;
  #fpsCounter!: TextField;

  constructor(game: Game, width: number, height: number, displayScale: number) {
    super(game);
    this.#w = width;
    this.#h = height;
    this.#displayW = width * displayScale;
    this.#displayH = height * displayScale;
    this.#assets = this.game.assets;
    this.#camera = new Camera(360, this.#w, this.#h);
    this.#renderGroups = new Map();
    // Set up the canvas at display resolution; game renders into a smaller FBO
    this.#canvas = document.getElementById("canvas") as HTMLCanvasElement;
    this.#canvas.width = this.#displayW;
    this.#canvas.height = this.#displayH;
    const gl = (this.#glContext = this.#canvas.getContext(
      "webgl2",
    ) as WebGL2RenderingContext);
    if (!gl) {
      throw new Error("webgl2 not supported");
    }
    // Compile the main program
    const mainVertSrc = this.#assets.get("mainVertexShader", "shader");
    const mainFragSrc = this.#assets.get("mainFragmentShader", "shader");
    const mainProgram = (this.#mainProgram = this.#buildProgram(
      mainVertSrc,
      mainFragSrc,
    )!);
    if (!this.#mainProgram) {
      throw new Error("failed to build main shader program");
    }
    // Initialise the main renderer; viewport is set per-pass in update()
    gl.viewport(0, 0, this.#displayW, this.#displayH);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // Set up the shared geometry buffers for the main pass
    this.#spriteBuffer = new Float32Array(
      MAX_SPRITES * VERTS_PER_SPRITE * FLOATS_PER_VERT,
    );
    this.#vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.#vao);
    this.#vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.#spriteBuffer.byteLength,
      gl.DYNAMIC_DRAW,
    );
    const aPos = gl.getAttribLocation(mainProgram, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, BYTES_PER_VERT, 0);
    const aUv = gl.getAttribLocation(mainProgram, "a_uv");
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, BYTES_PER_VERT, 12);
    const aTint = gl.getAttribLocation(mainProgram, "a_tint");
    gl.enableVertexAttribArray(aTint);
    gl.vertexAttribPointer(aTint, 4, gl.FLOAT, false, BYTES_PER_VERT, 20);
    gl.bindVertexArray(null);
    // Set static main-pass uniforms
    gl.useProgram(mainProgram);
    gl.uniform2f(
      gl.getUniformLocation(mainProgram, "u_resolution"),
      width,
      height,
    );
    gl.uniform1i(gl.getUniformLocation(mainProgram, "u_texture"), 0);
    this.#uCamera = gl.getUniformLocation(mainProgram, "u_camera")!;
    // Create a render group per spritesheet
    for (const [spritesheetName, spritesheet] of this.#assets
      .getAssetsByType("spritesheet")
      .entries()) {
      console.debug(
        `Creating render group for spritesheet: ${spritesheetName}`,
      );
      const texture = this.#createTexture(spritesheet.image);
      const atlas = new Atlas(spritesheetName, spritesheet.atlas as AtlasSrc);
      this.#renderGroups.set(spritesheetName, new RenderGroup(atlas, texture));
    }
    // Pre-allocate the global leaf pool shared across all render groups
    this.#leafPool = Array.from({ length: MAX_SPRITES }, () => ({
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 0,
      z: 0,
      u0: 0,
      v0: 0,
      u1: 0,
      v1: 0,
      tr: 0,
      tg: 0,
      tb: 0,
      ts: 0,
      texture: null,
    }));
    // Compile the CRT program
    const crtVertSrc = this.#assets.get("crtVertexShader", "shader");
    const crtFragSrc = this.#assets
      .get("crtFragmentShader", "shader")
      .replace("SCANLINE_COUNT", `${this.#h}.0`);
    const crtProgram = (this.#crtProgram = this.#buildProgram(
      crtVertSrc,
      crtFragSrc,
    )!);
    if (!this.#crtProgram) {
      throw new Error("failed to build crt program");
    }
    // Set static CRT uniforms and cache dynamic uniform locations
    gl.useProgram(crtProgram);
    gl.uniform1i(gl.getUniformLocation(crtProgram, "u_texture"), 0);
    this.#uCrtTime = gl.getUniformLocation(crtProgram, "time")!;
    this.#uCrtYOffset = gl.getUniformLocation(crtProgram, "yOffset")!;
    this.#uCrtBypass = gl.getUniformLocation(crtProgram, "u_bypass")!;
    // Empty VAO for the fullscreen quad (positions come from gl_VertexID)
    this.#crtVao = gl.createVertexArray()!;
    // Offscreen FBO: colour attachment + depth renderbuffer
    this.#fboTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.#fboTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.#w,
      this.#h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.#fboDepth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.#fboDepth);
    gl.renderbufferStorage(
      gl.RENDERBUFFER,
      gl.DEPTH_COMPONENT16,
      this.#w,
      this.#h,
    );
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    this.#fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.#fboTexture,
      0,
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      this.#fboDepth,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  initialise() {
    // The FPS counter can only be created after the renderer
    this.#fpsCounter = new TextField(this.game, "bitty", "-");
    this.#fpsCounter.z = MAX_Z;
  }

  add<T extends Sprite>(sprite: T): T {
    // The atlas cannot be null
    const group = this.#getGroup(sprite.atlas!);
    if (group === null) {
      throw new Error(`Unable to find render group for atlas: ${sprite.atlas}`);
    }
    return group.add(sprite);
  }

  removeSprite(sprite: Sprite): void {
    const group = this.#getGroup(sprite.atlas!);
    if (group !== null) {
      group.removeSprite(sprite);
    }
  }

  update(alpha: number, dt: number): void {
    super.update(alpha, dt);
    // Update the FPS counter
    this.#fps = dt > 0 ? this.#fps * 0.9 + (1000 / dt) * 0.1 : this.#fps;
    this.#fpsCounter.text = `${this.#fps.toFixed(1)} fps`;
    this.#fpsCounter.right = this.#camera.right;
    this.#fpsCounter.top = this.#camera.top;
    this.#fpsCounter.visible = CONFIG.showFPS;
    const gl = this.#glContext;
    // Pass 1: render sprites into the offscreen FBO at game resolution
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
    gl.viewport(0, 0, this.#w, this.#h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.#mainProgram);
    // Collect all visible leaves from every render group into one global pool
    const cullX0 = this.#camera.left;
    const cullY0 = this.#camera.top;
    const cullX1 = this.#camera.right;
    const cullY1 = this.#camera.bottom;
    let n = 0;
    for (const group of this.#renderGroups.values()) {
      n = group.collectInto(this.#leafPool, n, cullX0, cullY0, cullX1, cullY1);
    }
    // Sort back-to-front by Z so painter's algorithm handles overlap across atlases.
    // Transparent pixels must not block sprites behind them, which is what the
    // depth buffer would do. Insertion sort is O(n) for nearly-sorted data,
    // which is the common case when sprite Z values are stable across frames.
    const pool = this.#leafPool;
    for (let i = 1; i < n; i++) {
      const tmp = pool[i]!;
      const tmpZ = tmp.z;
      let j = i - 1;
      while (j >= 0 && pool[j]!.z > tmpZ) {
        pool[j + 1] = pool[j]!;
        j--;
      }
      pool[j + 1] = tmp;
    }
    // Write sorted leaves into the GPU upload buffer
    const buf = this.#spriteBuffer;
    let bufOffset = 0;
    for (let i = 0; i < n; i++) {
      bufOffset = writeLeaf(buf, pool[i]!, bufOffset);
    }
    // Upload once, then draw in batches — one draw call per contiguous run of
    // the same texture. Texture switches are rare when atlases have well-separated
    // Z ranges (e.g. map tiles behind characters), so the overhead is minimal.
    if (bufOffset > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.#vbo);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.#spriteBuffer.subarray(0, bufOffset),
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2fv(this.#uCamera, this.#camera.getUniform());
      gl.bindVertexArray(this.#vao);
      let batchStart = 0;
      let currentTexture = pool[0]!.texture!;
      gl.bindTexture(gl.TEXTURE_2D, currentTexture);
      for (let i = 1; i <= n; i++) {
        const tex = i < n ? pool[i]!.texture : null;
        if (tex !== currentTexture) {
          gl.drawArrays(
            gl.TRIANGLES,
            batchStart * VERTS_PER_SPRITE,
            (i - batchStart) * VERTS_PER_SPRITE,
          );
          if (tex !== null) {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            currentTexture = tex;
          }
          batchStart = i;
        }
      }
      gl.bindVertexArray(null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Pass 2: upscale FBO to display resolution, optionally with CRT effects
    gl.viewport(0, 0, this.#displayW, this.#displayH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.#crtProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#fboTexture);
    // Smooth upscale when CRT is on so the filter has sub-pixel detail to work with
    const filter = CONFIG.crtFilter ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.uniform1i(this.#uCrtBypass, CONFIG.crtFilter ? 0 : 1);
    gl.uniform1f(this.#uCrtTime, dt);
    gl.uniform1f(this.#uCrtYOffset, dt * 0.05);
    gl.bindVertexArray(this.#crtVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  #buildProgram(vertSrc: string, fragSrc: string): WebGLProgram | null {
    const gl = this.#glContext;
    const vert = this.#compileShader(gl.VERTEX_SHADER, vertSrc);
    const frag = this.#compileShader(gl.FRAGMENT_SHADER, fragSrc);
    if (!vert || !frag) return null;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("program link error:", gl.getProgramInfoLog(prog));
      return null;
    }

    return prog;
  }

  #compileShader(type: number, src: string): WebGLShader | null {
    const gl = this.#glContext;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("shader compile error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  // Utils

  #createTexture(image: ImageBitmap): WebGLTexture {
    const gl = this.#glContext;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Nearest-neighbor: pixel-art sprites should not be blurred
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  }

  #getGroup(atlas: string): RenderGroup | null {
    return this.#renderGroups.get(atlas) ?? null;
  }
}

export default Renderer;
