@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

fn encodeSrgb(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) {
    return clamped * 12.92;
  }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
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
  if (linear.a <= 0.0) {
    return vec4f(0.0);
  }
  let straight = linear.rgb / linear.a;
  let encoded = vec3f(
    encodeSrgb(straight.r),
    encodeSrgb(straight.g),
    encodeSrgb(straight.b),
  );
  return vec4f(encoded * linear.a, linear.a);
}
