struct Accumulate {
  highWeight: vec4f,
  lowWeight: vec4f,
}

@group(0) @binding(0) var<uniform> accumulate: Accumulate;
@group(0) @binding(1) var highLevel: texture_2d<f32>;
@group(0) @binding(2) var lowAccumulation: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;

/** 3×3 tent 上采样，权重 1-2-1，避免层与层之间出现箱形过渡。 */
fn tentUpsample(uv: vec2f) -> vec3f {
  let texel = 1.0 / max(vec2f(textureDimensions(lowAccumulation)), vec2f(1.0));
  let a = textureSampleLevel(lowAccumulation, linearSampler, uv + texel * vec2f(-1.0, -1.0), 0.0).rgb;
  let b = textureSampleLevel(lowAccumulation, linearSampler, uv + texel * vec2f( 0.0, -1.0), 0.0).rgb;
  let c = textureSampleLevel(lowAccumulation, linearSampler, uv + texel * vec2f( 1.0, -1.0), 0.0).rgb;
  let d = textureSampleLevel(lowAccumulation, linearSampler, uv + texel * vec2f(-1.0,  0.0), 0.0).rgb;
  let e = textureSampleLevel(lowAccumulation, linearSampler, uv, 0.0).rgb;
  let f = textureSampleLevel(lowAccumulation, linearSampler, uv + texel * vec2f( 1.0,  0.0), 0.0).rgb;
  let g = textureSampleLevel(lowAccumulation, linearSampler, uv + texel * vec2f(-1.0,  1.0), 0.0).rgb;
  let h = textureSampleLevel(lowAccumulation, linearSampler, uv + texel * vec2f( 0.0,  1.0), 0.0).rgb;
  let i = textureSampleLevel(lowAccumulation, linearSampler, uv + texel * vec2f( 1.0,  1.0), 0.0).rgb;
  return (a + c + g + i) * 0.0625
    + (b + d + f + h) * 0.125
    + e * 0.25;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let high = textureSampleLevel(highLevel, linearSampler, uv, 0.0).rgb;
  let low = tentUpsample(uv);
  let combined = high * accumulate.highWeight.rgb + low * accumulate.lowWeight.rgb;
  return vec4f(combined, 1.0);
}
