#version 300 es
// Medium precision is sufficient for 2D screen-space coordinates
precision mediump float;

// Per-vertex position in world space (x, y) and layer depth (z)
in vec3 a_pos;
// Per-vertex texture coordinate, passed straight through to the fragment shader
in vec2 a_uv;
// Tint color (rgb) and blend strength (a), passed straight through to the fragment shader
in vec4 a_tint;

// Top-left corner of the viewport in world space, updated each frame
uniform vec2 u_camera;
// Viewport size in pixels, used to convert pixel offsets to [-1, 1] clip space
uniform vec2 u_resolution;

// Interpolated UV passed to the fragment shader
out vec2 v_uv;
// Interpolated tint passed to the fragment shader
out vec4 v_tint;

void main() {
  // Translate world position into pixel offset from the top-left of the viewport
  vec2 screen = a_pos.xy - u_camera;
  // Map [0, resolution] to [-1, 1]: divide to get [0, 1], scale to [0, 2], shift to [-1, 1]
  vec2 clip = (screen / u_resolution) * 2.0 - 1.0;
  // Negate clip.y because WebGL clip space has +Y pointing up, but screen space has +Y pointing down
  // Negate a_pos.z so higher z values (drawn later) are closer to the viewer (smaller depth)
  gl_Position = vec4(clip.x, -clip.y, -a_pos.z, 1.0);
  v_uv = a_uv;
  v_tint = a_tint;
}
