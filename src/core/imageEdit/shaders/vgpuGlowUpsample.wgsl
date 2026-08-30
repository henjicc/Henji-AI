struct Accumulate {
  highWeight: vec4f,
  lowWeight: vec4f,
  // high carrier weight, first-merge low carrier weight（后续层为 -1）, left/right channel index
  carrier: vec4f,
}

@group(0) @binding(0) var<uniform> accumulate: Accumulate;
@group(0) @binding(1) var highLevel: texture_2d<f32>;
@group(0) @binding(2) var lowAccumulation: texture_2d<f32>;
@group(0) @binding(3) var lowCarrierAccumulation: texture_2d<f32>;
@group(0) @binding(4) var linearSampler: sampler;

fn sampleLow(uv: vec2f) -> vec4f {
  let inside = select(
    0.0,
    1.0,
    all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))
  );
  return textureSampleLevel(lowAccumulation, linearSampler, uv, 0.0) * inside;
}

fn sampleLowCarrier(uv: vec2f) -> vec2f {
  let inside = select(
    0.0,
    1.0,
    all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))
  );
  return textureSampleLevel(lowCarrierAccumulation, linearSampler, uv, 0.0).rg * inside;
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

fn tentUpsampleCarrier(uv: vec2f) -> vec2f {
  let texel = 1.0 / max(vec2f(textureDimensions(lowCarrierAccumulation)), vec2f(1.0));
  let a = sampleLowCarrier(uv + texel * vec2f(-1.0, -1.0));
  let b = sampleLowCarrier(uv + texel * vec2f( 0.0, -1.0));
  let c = sampleLowCarrier(uv + texel * vec2f( 1.0, -1.0));
  let d = sampleLowCarrier(uv + texel * vec2f(-1.0,  0.0));
  let e = sampleLowCarrier(uv);
  let f = sampleLowCarrier(uv + texel * vec2f( 1.0,  0.0));
  let g = sampleLowCarrier(uv + texel * vec2f(-1.0,  1.0));
  let h = sampleLowCarrier(uv + texel * vec2f( 0.0,  1.0));
  let i = sampleLowCarrier(uv + texel * vec2f( 1.0,  1.0));
  return (a + c + g + i) * 0.0625
    + (b + d + f + h) * 0.125
    + e * 0.25;
}

struct AccumulationOutput {
  @location(0) bloom: vec4f,
  @location(1) chromaticCarriers: vec2f,
}

fn channelEnergy(color: vec3f, index: f32) -> f32 {
  if (index < 0.5) { return color.r; }
  if (index < 1.5) { return color.g; }
  return color.b;
}

@fragment fn fs_main(@builtin(position) position: vec4f) -> AccumulationOutput {
  let highDimensions = max(vec2f(textureDimensions(highLevel)), vec2f(1.0));
  let lowDimensions = max(vec2f(textureDimensions(lowAccumulation)), vec2f(1.0));
  let highUv = position.xy / highDimensions;
  let lowUv = position.xy / (2.0 * lowDimensions);
  let high = textureSampleLevel(highLevel, linearSampler, highUv, 0.0);
  let low = tentUpsample(lowUv);
  let highPositive = max(high.rgb, vec3f(0.0));
  let highCarriers = vec2f(
    channelEnergy(highPositive, accumulate.carrier.z),
    channelEnergy(highPositive, accumulate.carrier.w)
  ) * accumulate.carrier.x;
  var lowCarriers = vec2f(0.0);
  if (accumulate.carrier.y >= 0.0) {
    let lowPositive = max(low.rgb, vec3f(0.0));
    lowCarriers = vec2f(
      channelEnergy(lowPositive, accumulate.carrier.z),
      channelEnergy(lowPositive, accumulate.carrier.w)
    ) * accumulate.carrier.y;
  } else {
    lowCarriers = tentUpsampleCarrier(lowUv);
  }
  return AccumulationOutput(
    high * accumulate.highWeight + low * accumulate.lowWeight,
    max(highCarriers + lowCarriers, vec2f(0.0))
  );
}
