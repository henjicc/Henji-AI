struct PresentColorParams {
  colorRow0: vec4f,
  colorRow1: vec4f,
  colorRow2: vec4f,
  options: vec4f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> color: PresentColorParams;

fn encodeSrgb(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) { return clamped * 12.92; }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn acesToneMap(value: f32) -> f32 {
  let positive = max(value, 0.0);
  return clamp(
    (positive * (2.51 * positive + 0.03))
      / (positive * (2.43 * positive + 0.59) + 0.14),
    0.0,
    1.0,
  );
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  return vec4f(positions[vertexIndex], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let linear = textureLoad(sourceTexture, vec2i(position.xy), 0);
  if (linear.a <= 0.0) { return vec4f(0.0); }
  let straight = linear.rgb / linear.a;
  var srgbLinear = vec3f(
    dot(color.colorRow0.xyz, straight),
    dot(color.colorRow1.xyz, straight),
    dot(color.colorRow2.xyz, straight),
  );
  if (color.options.x > 0.5) {
    srgbLinear = vec3f(
      acesToneMap(srgbLinear.r),
      acesToneMap(srgbLinear.g),
      acesToneMap(srgbLinear.b),
    );
  }
  let encoded = vec3f(
    encodeSrgb(srgbLinear.r),
    encodeSrgb(srgbLinear.g),
    encodeSrgb(srgbLinear.b),
  );
  return vec4f(encoded * linear.a, linear.a);
}
