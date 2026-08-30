@group(0) @binding(0) var sourceBloom: texture_2d<f32>;
@group(0) @binding(1) var sourceCarriers: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

struct CopyOutput {
  @location(0) bloom: vec4f,
  @location(1) chromaticCarriers: vec2f,
}

/** 把整图散射保存到独立 target，后续调整块尺寸时不会破坏这份共享结果。 */
@fragment fn fs_main(@location(0) uv: vec2f) -> CopyOutput {
  return CopyOutput(
    textureSampleLevel(sourceBloom, linearSampler, uv, 0.0),
    textureSampleLevel(sourceCarriers, linearSampler, uv, 0.0).rg
  );
}
