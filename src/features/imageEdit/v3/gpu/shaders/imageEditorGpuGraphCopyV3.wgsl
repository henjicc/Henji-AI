@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(positions[vi], 0.0, 1.0);
}
@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  return textureLoad(sourceTexture, vec2i(position.xy), 0);
}
