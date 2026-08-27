struct Composite {
  params: vec4f,
  weights: vec4f,
}

@group(0) @binding(0) var<uniform> composite: Composite;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var bloomNear: texture_2d<f32>;
@group(0) @binding(3) var bloomMedium: texture_2d<f32>;
@group(0) @binding(4) var bloomFar: texture_2d<f32>;
@group(0) @binding(5) var linearSampler: sampler;

fn rollHighlight(color: vec3f) -> vec3f {
  let peak = max(color.r, max(color.g, color.b));
  let shoulder = composite.params.y;
  if (peak <= shoulder) {
    return color;
  }
  let room = max(1.0 - shoulder, 0.001);
  let mappedPeak = shoulder + room * (1.0 - exp(-(peak - shoulder) / room));
  let rolled = color * (mappedPeak / max(peak, 0.0001));
  return mix(min(color, vec3f(1.0)), rolled, composite.params.z);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let base = textureSampleLevel(scene, linearSampler, uv, 0.0);
  let glow =
    textureSampleLevel(bloomNear, linearSampler, uv, 0.0).rgb * composite.weights.x +
    textureSampleLevel(bloomMedium, linearSampler, uv, 0.0).rgb * composite.weights.y +
    textureSampleLevel(bloomFar, linearSampler, uv, 0.0).rgb * composite.weights.z;
  return vec4f(rollHighlight(base.rgb + glow * composite.params.x), base.a);
}
