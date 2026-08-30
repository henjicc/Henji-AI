struct Bloom {
  // 辐射域 threshold、knee、ceiling；w>=0 时为亮源增益，w<0 时仅降采样
  params: vec4f,
}

@group(0) @binding(0) var<uniform> bloom: Bloom;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

fn extractEmitter(color: vec3f) -> vec3f {
  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  let brightness = max(luma, max(color.r, max(color.g, color.b)) * 0.82);
  if (brightness <= 0.000001) {
    return vec3f(0.0);
  }

  // 输入是已经显示映射过的 LDR 图片。先用指数相机响应的逆函数重建有限的虚拟 HDR
  // 辐射，再在这个线性辐射域做门槛；饱和白和饱和色因此都能携带高于 1 的发光能量。
  let ceiling = max(bloom.params.z, 0.001);
  let radiance = min(
    -log(max(1.0 - min(brightness, 1.0 - exp(-ceiling)), exp(-ceiling))),
    ceiling
  );
  let threshold = bloom.params.x;
  let knee = max(bloom.params.y, 0.0001);
  let soft = clamp(radiance - threshold + knee, 0.0, 2.0 * knee);
  let softContribution = soft * soft / (4.0 * knee);
  let emittedRadiance = max(radiance - threshold, softContribution);
  return color * (emittedRadiance / brightness) * max(bloom.params.w, 0.0);
}

fn insideImage(uv: vec2f) -> f32 {
  return select(
    0.0,
    1.0,
    all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))
  );
}

fn sampleSource(uv: vec2f, offset: vec2f, extract: bool) -> vec3f {
  let dimensions = max(vec2f(textureDimensions(source)), vec2f(1.0));
  let sampleUv = uv + offset / dimensions;
  let color = textureSampleLevel(source, linearSampler, sampleUv, 0.0);
  if (extract) {
    // 先从直通颜色重建辐射，再乘覆盖率。若先把 Alpha 乘进非线性逆响应，抗锯齿边缘
    // 会被错误压暗并收缩，正是亮物体周围容易形成刻意描边的来源之一。
    return extractEmitter(color.rgb) * color.a * insideImage(sampleUv);
  }
  return color.rgb * insideImage(sampleUv);
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
  return vec4f(downsample13(uv, bloom.params.w >= 0.0), 1.0);
}
