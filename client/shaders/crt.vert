#version 300 es
precision mediump float;

out vec2 v_uv;

void main() {
  // Generate a full-screen quad from vertex ID, no VBO needed.
  // Call with gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4).
  // IDs 0-3: BL(-1,-1), BR(1,-1), TL(-1,1), TR(1,1)
  float x = float(gl_VertexID & 1) * 2.0 - 1.0;
  float y = float((gl_VertexID >> 1) & 1) * 2.0 - 1.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
  v_uv = vec2(x, y) * 0.5 + 0.5;
}
