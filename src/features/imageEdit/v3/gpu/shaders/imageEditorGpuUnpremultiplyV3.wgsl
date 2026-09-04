@group(0) @binding(0) var source: texture_2d<f32>;

@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let value = textureLoad(source, vec2i(position.xy), 0);
  return vec4f(value.rgb / max(value.a, 0.000001), value.a);
}
