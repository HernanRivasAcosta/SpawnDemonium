#version 300 es
// Medium precision is sufficient for sprite colors
precision mediump float;

// The sprite atlas, bound once per draw call
uniform sampler2D u_texture;

// UV interpolated from the vertex shader; selects the texel for this fragment
in vec2 v_uv;
// Tint color (rgb) and blend strength (a) interpolated from the vertex shader
in vec4 v_tint;
// The final RGBA color written to the framebuffer
out vec4 out_color;

void main() {
  // Sample the atlas at the interpolated UV; alpha carries transparency
  vec4 tex = texture(u_texture, v_uv);
  // Blend tint into the rgb channels only; alpha is preserved so transparency is unaffected
  out_color = vec4(mix(tex.rgb, v_tint.rgb, v_tint.a), tex.a);
}
