#version 300 es

#ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
#else
  precision mediump float;
#endif

uniform sampler2D u_texture;
uniform float time;
uniform float yOffset;
// When 1, skip all CRT processing and output the raw texture sample
uniform int u_bypass;

in vec2 v_uv;
out vec4 out_color;

// Hardcoded constants
const float scanlineIntensity = 0.5;
const float scanlineCount = SCANLINE_COUNT;
const float brightness = 1.5;
const float contrast = 1.05;
const float saturation = 1.1;
const float bloomIntensity = 0.5;
const float bloomThreshold = 0.5;
const float rgbShift = 1.0;
const float adaptiveIntensity = 0.3;
const float vignetteStrength = 0.3;
const float curvature = 0.1;
const float flickerStrength = 0.0;
// Precomputed constants
const float PI = 3.14159265;
const vec3 LUMA = vec3(0.299, 0.587, 0.114);
const float BLOOM_THRESHOLD_FACTOR = 0.5;
const float BLOOM_FACTOR_MULT = 1.5;
const float RGB_SHIFT_SCALE = 0.005;
const float RGB_SHIFT_INTENSITY = 0.08;

// Optimized curvature function
vec2 curveRemapUV(vec2 uv, float curvature) {
  vec2 coords = uv * 2.0 - 1.0;
  float curveAmount = curvature * 0.25; // Reduced from 0.5
  float dist = dot(coords, coords); // More efficient than x*x + y*y
  coords = coords * (1.0 + dist * curveAmount);
  return coords * 0.5 + 0.5;
}

// Low-cost symmetric bloom sampling (cross + center, normalized)
vec4 sampleBloom(sampler2D tex, vec2 uv, float radius, vec4 centerSample) {
  vec2 o = vec2(radius);
  vec4 c = centerSample * 0.4;
  vec4 cross_ = (
    texture(tex, uv + vec2(o.x, 0.0)) +
    texture(tex, uv - vec2(o.x, 0.0)) +
    texture(tex, uv + vec2(0.0, o.y)) +
    texture(tex, uv - vec2(0.0, o.y))
  ) * 0.15;
  return c + cross_;
}

// Approximates vignette using Chebyshev distance squared instead of pow()
float vignetteApprox(vec2 uv, float strength) {
  vec2 vigCoord = uv * 2.0 - 1.0;
  float dist = max(abs(vigCoord.x), abs(vigCoord.y));
  return 1.0 - dist * dist * strength; // Use squared distance instead of pow
}

void main() {
  if (u_bypass != 0) {
    out_color = texture(u_texture, v_uv);
    return;
  }

  vec2 uv = v_uv;

  // Apply screen curvature if enabled (early out for out-of-bounds)
  if (curvature > 0.001) {
    uv = curveRemapUV(uv, curvature);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      out_color = vec4(0.0);
      return;
    }
  }

  // Get the original pixel color
  vec4 pixel = texture(u_texture, uv);

  // Apply bloom effect with threshold-based sampling (skip if disabled)
  if (bloomIntensity > 0.001) {
    float pixelLum = dot(pixel.rgb, LUMA);
    // Only sample bloom if pixel is above threshold
    float bloomThresholdHalf = bloomThreshold * BLOOM_THRESHOLD_FACTOR;
    if (pixelLum > bloomThresholdHalf) {
      vec4 bloomSample = sampleBloom(u_texture, uv, 0.005, pixel);
      bloomSample.rgb *= brightness;
      float bloomLum = dot(bloomSample.rgb, LUMA);
      float bloomFactor = bloomIntensity * max(0.0, (bloomLum - bloomThreshold) * BLOOM_FACTOR_MULT);
      pixel.rgb += bloomSample.rgb * bloomFactor;
    }
  }

  // Apply RGB shift only if significant (skip for minimal values)
  if (rgbShift > 0.005) {
    float shift = rgbShift * RGB_SHIFT_SCALE;
    pixel.r += texture(u_texture, vec2(uv.x + shift, uv.y)).r * RGB_SHIFT_INTENSITY;
    pixel.b += texture(u_texture, vec2(uv.x - shift, uv.y)).b * RGB_SHIFT_INTENSITY;
  }

  // Apply brightness
  pixel.rgb *= brightness;

  // Apply contrast and saturation in one pass
  float luminance = dot(pixel.rgb, LUMA);
  pixel.rgb = (pixel.rgb - 0.5) * contrast + 0.5;
  pixel.rgb = mix(vec3(luminance), pixel.rgb, saturation);

  // Calculate combined lighting mask (scanlines, flicker, vignette)
  float lightingMask = 1.0;

  // Calculate scanlines (skip if disabled)
  if (scanlineIntensity > 0.001) {
    float scanlineY = (uv.y + yOffset) * scanlineCount;
    float scanlinePattern = abs(sin(scanlineY * PI));

    // Apply adaptive intensity if enabled
    float adaptiveFactor = 1.0;
    if (adaptiveIntensity > 0.001) {
      float yPattern = sin(uv.y * 30.0) * 0.5 + 0.5;
      adaptiveFactor = 1.0 - yPattern * adaptiveIntensity * 0.2;
    }

    lightingMask *= 1.0 - scanlinePattern * scanlineIntensity * adaptiveFactor;
  }

  // Apply flicker effect
  if (flickerStrength > 0.001) {
    lightingMask *= 1.0 + sin(time * 110.0) * flickerStrength;
  }

  // Apply vignette (skip if disabled)
  if (vignetteStrength > 0.001) {
    lightingMask *= vignetteApprox(uv, vignetteStrength);
  }

  // Apply combined lighting effects in single multiplication
  pixel.rgb *= lightingMask;

  out_color = pixel;
}
