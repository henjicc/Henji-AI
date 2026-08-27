@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;

fn srgbToLinear(value: vec3f) -> vec3f {
  let low = value / 12.92;
  let high = pow((value + vec3f(0.055)) / 1.055, vec3f(2.4));
  return select(high, low, value <= vec3f(0.04045));
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let color = textureSampleLevel(source, linearSampler, uv, 0.0);
  return vec4f(srgbToLinear(color.rgb), color.a);
}
