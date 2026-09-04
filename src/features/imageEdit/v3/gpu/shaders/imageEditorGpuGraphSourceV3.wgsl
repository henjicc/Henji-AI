struct Params { originSize: vec4f }
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: Params;

fn decodeSrgb(value: f32) -> f32 {
  let magnitude = abs(value);
  let decoded = select(magnitude / 12.92, pow((magnitude + 0.055) / 1.055, 2.4), magnitude > 0.04045);
  return sign(value) * decoded;
}

@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(positions[vi], 0.0, 1.0);
}

@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let coord = vec2i(position.xy - params.originSize.xy);
  let size = vec2i(textureDimensions(sourceTexture));
  if (coord.x < 0 || coord.y < 0 || coord.x >= size.x || coord.y >= size.y) { return vec4f(0.0); }
  let encoded = textureLoad(sourceTexture, coord, 0);
  return vec4f(vec3f(decodeSrgb(encoded.r), decodeSrgb(encoded.g), decodeSrgb(encoded.b)) * encoded.a, encoded.a);
}
