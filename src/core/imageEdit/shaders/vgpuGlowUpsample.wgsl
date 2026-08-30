struct Accumulate {
  highWeight: vec4f,
  lowWeight: vec4f,
}

@group(0) @binding(0) var<uniform> accumulate: Accumulate;
@group(0) @binding(1) var highLevel: texture_2d<f32>;
@group(0) @binding(2) var lowAccumulation: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;

fn sampleLow(uv: vec2f) -> vec4f {
  let inside = select(
    0.0,
    1.0,
    all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))
  );
  return textureSampleLevel(lowAccumulation, linearSampler, uv, 0.0) * inside;
}

/** 3×3 tent 上采样，权重 1-2-1，避免层与层之间出现箱形过渡。 */
fn tentUpsample(uv: vec2f) -> vec4f {
  let texel = 1.0 / max(vec2f(textureDimensions(lowAccumulation)), vec2f(1.0));
  let a = sampleLow(uv + texel * vec2f(-1.0, -1.0));
  let b = sampleLow(uv + texel * vec2f( 0.0, -1.0));
  let c = sampleLow(uv + texel * vec2f( 1.0, -1.0));
  let d = sampleLow(uv + texel * vec2f(-1.0,  0.0));
  let e = sampleLow(uv);
  let f = sampleLow(uv + texel * vec2f( 1.0,  0.0));
  let g = sampleLow(uv + texel * vec2f(-1.0,  1.0));
  let h = sampleLow(uv + texel * vec2f( 0.0,  1.0));
  let i = sampleLow(uv + texel * vec2f( 1.0,  1.0));
  return (a + c + g + i) * 0.0625
    + (b + d + f + h) * 0.125
    + e * 0.25;
}

@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let highDimensions = max(vec2f(textureDimensions(highLevel)), vec2f(1.0));
  let lowDimensions = max(vec2f(textureDimensions(lowAccumulation)), vec2f(1.0));
  let highUv = position.xy / highDimensions;
  let lowUv = position.xy / (2.0 * lowDimensions);
  let high = textureSampleLevel(highLevel, linearSampler, highUv, 0.0);
  let low = tentUpsample(lowUv);
  return high * accumulate.highWeight + low * accumulate.lowWeight;
}
