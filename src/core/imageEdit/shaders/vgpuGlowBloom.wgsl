struct Bloom {
  // 显示域 threshold、knee；虚拟 HDR 最大增益；w>=0 时为亮源增益，w<0 时仅降采样
  params: vec4f,
  // 白热量，其余保留
  optics: vec4f,
  // 线性着色 RGB；a=1 时替代光源色度，a=0 时跟随原图
  tint: vec4f,
}

@group(0) @binding(0) var<uniform> bloom: Bloom;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

const SOFT_PEAK_TAU: f32 = 0.06;
const SPECTRAL_CHROMA_START: f32 = 0.025;
const SPECTRAL_CHROMA_END: f32 = 0.10;
const LDR_EMISSION_GAMMA: f32 = 1.35;
const WHITE_HEAT_START: f32 = 0.78;
const WHITE_HEAT_END: f32 = 0.995;

fn linearToSrgb(value: vec3f) -> vec3f {
  let safeValue = max(value, vec3f(0.0));
  let low = safeValue * 12.92;
  let high = 1.055 * pow(safeValue, vec3f(1.0 / 2.4)) - vec3f(0.055);
  return select(high, low, safeValue <= vec3f(0.0031308));
}

fn srgbToLinear(value: f32) -> f32 {
  let safeValue = max(value, 0.0);
  let low = safeValue / 12.92;
  let high = pow((safeValue + 0.055) / 1.055, 2.4);
  return select(high, low, safeValue <= 0.04045);
}

/**
 * 用 softmax 权重得到可微且有界的显示峰值。它是 RGB 的凸组合：中性灰严格保持原值，
 * 永远不会超过最亮通道，也不会在主导通道交换处留下 max() 的 V 形折角。
 */
fn smootherstep01(value: f32) -> f32 {
  let amount = clamp(value, 0.0, 1.0);
  return amount * amount * amount * (amount * (amount * 6.0 - 15.0) + 10.0);
}

/** 可微的通道峰值，仅用于稳定地提取色度方向。 */
fn softChannelPeak(displayColor: vec3f) -> f32 {
  let highest = max(displayColor.r, max(displayColor.g, displayColor.b));
  let weights = exp((displayColor - vec3f(highest)) / SOFT_PEAK_TAU);
  return dot(weights, displayColor) / max(dot(weights, vec3f(1.0)), 0.000001);
}

/**
 * SDR 图形缺少真实 emissive buffer。这里使用一个可解释的色度先验：中性灰严格保持
 * 原亮度；存在明确色度差异时，三次光谱范数补偿 RGB 渐变中多个发光通道共同贡献的
 * 能量。这样青→浅黄→橙不会在通道交接处塌陷，也不会把普通灰色误推成裁白高光。
 */
fn emissionPeak(displayColor: vec3f) -> f32 {
  let channelPeak = softChannelPeak(displayColor);
  let mean = dot(displayColor, vec3f(1.0 / 3.0));
  let deviation = displayColor - vec3f(mean);
  let chroma = sqrt(max(dot(deviation, deviation) / 3.0, 0.0));
  let spectralPeak = min(
    pow(dot(displayColor * displayColor, displayColor), 1.0 / 3.0),
    1.0
  );
  let chromaConfidence = smootherstep01(
    (chroma - SPECTRAL_CHROMA_START) / (SPECTRAL_CHROMA_END - SPECTRAL_CHROMA_START)
  );
  return mix(channelPeak, spectralPeak, chromaConfidence);
}

/** 只判断亮源资格；超过软膝后恒为 1，不再从已经有限的 LDR 亮度中减掉门槛。 */
fn emissionConfidence(displayValue: f32) -> f32 {
  let threshold = bloom.params.x;
  let knee = max(bloom.params.y, 0.0001);
  return smootherstep01((displayValue - (threshold - knee)) / (2.0 * knee));
}

/**
 * 把接近裁白的 LDR 值扩展成有限虚拟 HDR 增益。顶端使用 smootherstep，255 附近的
 * 一阶导数趋近于零，因此 JPEG 量化不会被放大成孤立热点。
 */
fn virtualRadianceGain(displayValue: f32) -> f32 {
  let shoulderStart = clamp(bloom.params.x + bloom.params.y, 0.0, 0.9999);
  let headroom = smootherstep01(
    (displayValue - shoulderStart) / max(1.0 - shoulderStart, 0.0001)
  );
  let maximumGain = max(bloom.params.z, 1.0);
  return mix(1.0, maximumGain, headroom);
}

/**
 * RGB 保存彩色散射能量，A 单独保存白热核心能量。两者都从同一个源像素产生，
 * 但后续使用不同 PSF，因此相邻颜色不会先混合再突然被整片拉白。
 */
fn extractEmitter(color: vec3f) -> vec4f {
  let displayColor = clamp(linearToSrgb(color), vec3f(0.0), vec3f(1.0));
  let channelPeak = softChannelPeak(displayColor);
  let displayPeak = emissionPeak(displayColor);
  if (channelPeak <= 0.000001 || displayPeak <= 0.000001) {
    return vec4f(0.0);
  }

  let confidence = emissionConfidence(displayPeak);
  let expansion = virtualRadianceGain(displayPeak);
  let sourceGain = max(bloom.params.w, 0.0);

  // 将发射幅度与色度方向分开。色度仍取线性 RGB，但归一参考来自可微的显示峰值，
  // 因此不同主导通道交接时不会再把同一段渐变的能量压暗。
  let sourceDirection = color / max(srgbToLinear(channelPeak), 0.000001);
  let tintDirection = bloom.tint.rgb
    / max(max(bloom.tint.r, max(bloom.tint.g, bloom.tint.b)), 0.000001);
  let emissionDirection = mix(
    sourceDirection,
    tintDirection,
    clamp(bloom.tint.a, 0.0, 1.0)
  );
  // 部分反转 SDR 显示压缩，得到有限且稳定的艺术 emissive prior；只有接近裁白的
  // 像素才会取得完整 ceiling，8-bit 顶值附近没有无穷斜率。
  let emittedRadiance = pow(displayPeak, LDR_EMISSION_GAMMA)
    * expansion
    * confidence
    * sourceGain;
  let coloredEmitter = emissionDirection * emittedRadiance;

  // 白热只依据未补偿的真实通道峰值接近裁白的程度，不能让“渐变连续性补偿”误造
  // 白描边。A 仍只记录紧致核心的替换置信度，不代表额外白色能量。
  let heatConfidence = pow(smootherstep01(
    (channelPeak - WHITE_HEAT_START) / (WHITE_HEAT_END - WHITE_HEAT_START)
  ), 1.4);
  let whiteCore = max(
    coloredEmitter.r,
    max(coloredEmitter.g, coloredEmitter.b)
  ) * heatConfidence * clamp(bloom.optics.x, 0.0, 1.0);
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
