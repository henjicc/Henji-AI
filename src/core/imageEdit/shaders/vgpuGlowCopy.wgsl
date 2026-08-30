@group(0) @binding(0) var sourceBloom: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;

/** 把整图散射保存到独立 target，后续调整块尺寸时不会破坏这份共享结果。 */
@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSampleLevel(sourceBloom, linearSampler, uv, 0.0);
}
