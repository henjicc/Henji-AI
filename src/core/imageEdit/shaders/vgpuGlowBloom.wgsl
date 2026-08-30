struct Bloom {
  // threshold, knee, HDR boost, mode（0=亮源提取，1=相邻层降采样）
  params: vec4f,
}

@group(0) @binding(0) var<uniform> bloom: Bloom;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

fn extractEmitter(color: vec3f) -> vec3f {
  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  let brightness = max(luma, max(color.r, max(color.g, color.b)) * 0.82);
  let threshold = bloom.params.x;
  let knee = max(bloom.params.y, 0.0001);
  let soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
  let softContribution = soft * soft / (4.0 * knee + 0.0001);
  let contribution = max(brightness - threshold, softContribution) / max(brightness, 0.0001);
  let hot = pow(smoothstep(threshold, 1.0, brightness), 1.6);
  return color * contribution * (1.0 + hot * bloom.params.z);
}

fn sampleSource(uv: vec2f, offset: vec2f, extract: bool) -> vec3f {
  let dimensions = max(vec2f(textureDimensions(source)), vec2f(1.0));
  let color = textureSampleLevel(source, linearSampler, uv + offset / dimensions, 0.0).rgb;
  if (extract) {
    return extractEmitter(color);
  }
  return color;
}

/**
 * 13-tap 正权重降采样核。所有采样都落在相邻 texel，权重和严格为 1：
 * 半径只来自连续 mip 层级，不会把细线复制成间隔固定的平行条纹。
 */
fn downsample13(uv: vec2f, extract: bool) -> vec3f {
  let a = sampleSource(uv, vec2f(-2.0, -2.0), extract);
  let b = sampleSource(uv, vec2f( 0.0, -2.0), extract);
  let c = sampleSource(uv, vec2f( 2.0, -2.0), extract);
  let d = sampleSource(uv, vec2f(-2.0,  0.0), extract);
  let e = sampleSource(uv, vec2f( 0.0,  0.0), extract);
  let f = sampleSource(uv, vec2f( 2.0,  0.0), extract);
  let g = sampleSource(uv, vec2f(-2.0,  2.0), extract);
  let h = sampleSource(uv, vec2f( 0.0,  2.0), extract);
  let i = sampleSource(uv, vec2f( 2.0,  2.0), extract);
  let j = sampleSource(uv, vec2f(-1.0, -1.0), extract);
  let k = sampleSource(uv, vec2f( 1.0, -1.0), extract);
  let l = sampleSource(uv, vec2f(-1.0,  1.0), extract);
  let m = sampleSource(uv, vec2f( 1.0,  1.0), extract);
  return (a + c + g + i) * 0.03125
    + (b + d + f + h) * 0.0625
    + e * 0.125
    + (j + k + l + m) * 0.125;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  return vec4f(downsample13(uv, bloom.params.w < 0.5), 1.0);
}
