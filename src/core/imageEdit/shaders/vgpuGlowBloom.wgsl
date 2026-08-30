struct Bloom {
  // 显示域 threshold、knee；虚拟辐射 ceiling；w>=0 时为亮源增益，w<0 时仅降采样
  params: vec4f,
  // 白热量，其余保留
  optics: vec4f,
}

@group(0) @binding(0) var<uniform> bloom: Bloom;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

const RADIANCE_SHOULDER: f32 = 0.88;

fn linearToSrgb(value: vec3f) -> vec3f {
  let safeValue = max(value, vec3f(0.0));
  let low = safeValue * 12.92;
  let high = 1.055 * pow(safeValue, vec3f(1.0 / 2.4)) - vec3f(0.055);
  return select(high, low, safeValue <= vec3f(0.0031308));
}

fn spectralEmissionPeak(displayColor: vec3f) -> f32 {
  let exactPeak = max(displayColor.r, max(displayColor.g, displayColor.b));
  if (exactPeak <= 0.000001) {
    return 0.0;
  }

  // max 会在主导通道交换处形成斜率折角，并让宽色域渐变出现能量暗沟。RGB 三次范数
  // 连续衡量多个高亮通道的光谱覆盖度；门控确保暗部与抗锯齿边缘仍严格等于 max。
  let spectralPeak = min(
    pow(dot(displayColor * displayColor, displayColor), 1.0 / 3.0),
    1.0
  );
  let gate = smoothstep(0.28, 0.72, exactPeak);
  return mix(exactPeak, spectralPeak, gate);
}

fn reconstructRadiance(displayValue: f32, ceiling: f32) -> f32 {
  let normalized = -log(1.0 - RADIANCE_SHOULDER);
  return ceiling
    * (-log(1.0 - RADIANCE_SHOULDER * clamp(displayValue, 0.0, 1.0)))
    / normalized;
}

fn brightPassFraction(displayValue: f32) -> f32 {
  if (displayValue <= 0.000001) {
    return 0.0;
  }
  let threshold = bloom.params.x;
  let knee = max(bloom.params.y, 0.0001);
  let delta = displayValue - threshold;
  let soft = clamp(delta + knee, 0.0, 2.0 * knee);
  let softContribution = soft * soft / (4.0 * knee);
  return clamp(max(delta, softContribution) / displayValue, 0.0, 1.0);
}

/**
 * RGB 保存彩色散射能量，A 单独保存白热核心能量。两者都从同一个源像素产生，
 * 但后续使用不同 PSF，因此相邻颜色不会先混合再突然被整片拉白。
 */
fn extractEmitter(color: vec3f) -> vec4f {
  let linearPeak = max(color.r, max(color.g, color.b));
  if (linearPeak <= 0.000001) {
    return vec4f(0.0);
  }

  // 门槛和 LDR 高光重建都在逐通道显示域工作；色度仍取线性 RGB。这样既不会把
  // Photoshop/sRGB 渐变挖成暗沟，也不会改变实际散射光的颜色比例。
  let displayColor = clamp(linearToSrgb(color), vec3f(0.0), vec3f(1.0));
  let displayPeak = spectralEmissionPeak(displayColor);
  let ceiling = max(bloom.params.z, 0.001);
  let radiance = reconstructRadiance(displayPeak, ceiling);
  let emittedRadiance = radiance * brightPassFraction(displayPeak);
  let sourceGain = max(bloom.params.w, 0.0);
  let chromaticity = color / linearPeak;
  let coloredEmitter = chromaticity * emittedRadiance * sourceGain;

  // 白热只由高置信亮源生成；A 通道随后只走紧致 core PSF，不污染彩色远场。
  let heatConfidence = pow(
    smoothstep(0.28, 0.92, radiance / ceiling),
    1.4
  );
  let whiteCore = emittedRadiance
    * sourceGain
    * heatConfidence
    * clamp(bloom.optics.x, 0.0, 1.0);
  return vec4f(coloredEmitter, whiteCore);
}

fn insideImage(uv: vec2f) -> f32 {
  return select(
    0.0,
    1.0,
    all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))
  );
}

fn sampleSource(uv: vec2f, offset: vec2f, extract: bool) -> vec4f {
  let dimensions = max(vec2f(textureDimensions(source)), vec2f(1.0));
  let sampleUv = uv + offset / dimensions;
  let color = textureSampleLevel(source, linearSampler, sampleUv, 0.0);
  if (extract) {
    // 先从直通颜色重建辐射，再乘覆盖率。若先把 Alpha 乘进非线性逆响应，抗锯齿边缘
    // 会被错误压暗并收缩，正是亮物体周围容易形成刻意描边的来源之一。
    return extractEmitter(color.rgb) * color.a * insideImage(sampleUv);
  }
  return color * insideImage(sampleUv);
}

/**
 * 13-tap 正权重降采样核。所有采样都落在相邻 texel，权重和严格为 1：
 * 半径只来自连续 mip 层级，不会把细线复制成间隔固定的平行条纹。
 */
fn downsample13(uv: vec2f, extract: bool) -> vec4f {
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
  return downsample13(uv, bloom.params.w >= 0.0);
}
