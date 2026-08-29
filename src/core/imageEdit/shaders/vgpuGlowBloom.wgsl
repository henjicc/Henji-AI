struct Bloom {
  sourceSize: vec2f,
  direction: vec2f,
  params: vec4f,
  glow: vec4f,
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
  let boosted = color * contribution * (1.0 + hot * bloom.glow.x);
  // 散射种子始终保留光源色；白热只发生在全分辨率核心层，形成“中心趋白、外围带色”的
  // 真实灯光关系。只有用户主动开启着色时，最终合成阶段才会替换散射颜色。
  return boosted;
}

fn extractDownsample(uv: vec2f) -> vec3f {
  let texel = 1.0 / bloom.sourceSize;
  let offset = texel * 0.5;
  // 逐样本提取再平均，避免细线和小字先被降采样压暗到门槛以下。
  return (
    extractEmitter(textureSampleLevel(source, linearSampler, uv + vec2f(-offset.x, -offset.y), 0.0).rgb) +
    extractEmitter(textureSampleLevel(source, linearSampler, uv + vec2f( offset.x, -offset.y), 0.0).rgb) +
    extractEmitter(textureSampleLevel(source, linearSampler, uv + vec2f(-offset.x,  offset.y), 0.0).rgb) +
    extractEmitter(textureSampleLevel(source, linearSampler, uv + vec2f( offset.x,  offset.y), 0.0).rgb)
  ) * 0.25;
}

fn pyramidDownsample(uv: vec2f) -> vec3f {
  let texel = 1.0 / bloom.sourceSize;
  let a = textureSampleLevel(source, linearSampler, uv + texel * vec2f(-2.0, -2.0), 0.0).rgb;
  let b = textureSampleLevel(source, linearSampler, uv + texel * vec2f( 0.0, -2.0), 0.0).rgb;
  let c = textureSampleLevel(source, linearSampler, uv + texel * vec2f( 2.0, -2.0), 0.0).rgb;
  let d = textureSampleLevel(source, linearSampler, uv + texel * vec2f(-2.0,  0.0), 0.0).rgb;
  let e = textureSampleLevel(source, linearSampler, uv, 0.0).rgb;
  let f = textureSampleLevel(source, linearSampler, uv + texel * vec2f( 2.0,  0.0), 0.0).rgb;
  let g = textureSampleLevel(source, linearSampler, uv + texel * vec2f(-2.0,  2.0), 0.0).rgb;
  let h = textureSampleLevel(source, linearSampler, uv + texel * vec2f( 0.0,  2.0), 0.0).rgb;
  let i = textureSampleLevel(source, linearSampler, uv + texel * vec2f( 2.0,  2.0), 0.0).rgb;
  let j = textureSampleLevel(source, linearSampler, uv + texel * vec2f(-1.0, -1.0), 0.0).rgb;
  let k = textureSampleLevel(source, linearSampler, uv + texel * vec2f( 1.0, -1.0), 0.0).rgb;
  let l = textureSampleLevel(source, linearSampler, uv + texel * vec2f(-1.0,  1.0), 0.0).rgb;
  let m = textureSampleLevel(source, linearSampler, uv + texel * vec2f( 1.0,  1.0), 0.0).rgb;
  return (a + c + g + i) * 0.03125
    + (b + d + f + h) * 0.0625
    + e * 0.125
    + (j + k + l + m) * 0.125;
}

fn gaussianBlur(uv: vec2f) -> vec3f {
  let sigma = max(bloom.params.z, 0.5);
  let inverseTwoSigmaSquared = 0.5 / (sigma * sigma);
  let w0 = 1.0;
  let w1 = exp(-1.0 * inverseTwoSigmaSquared);
  let w2 = exp(-4.0 * inverseTwoSigmaSquared);
  let w3 = exp(-9.0 * inverseTwoSigmaSquared);
  let w4 = exp(-16.0 * inverseTwoSigmaSquared);
  let pair12 = w1 + w2;
  let pair34 = w3 + w4;
  let offset12 = (w1 + 2.0 * w2) / max(pair12, 0.000001);
  let offset34 = (3.0 * w3 + 4.0 * w4) / max(pair34, 0.000001);
  let normalization = w0 + 2.0 * (pair12 + pair34);
  let texel = bloom.direction / bloom.sourceSize * bloom.glow.w;
  var color = textureSampleLevel(source, linearSampler, uv, 0.0).rgb * w0;
  color += textureSampleLevel(source, linearSampler, uv + texel * offset12, 0.0).rgb * pair12;
  color += textureSampleLevel(source, linearSampler, uv - texel * offset12, 0.0).rgb * pair12;
  color += textureSampleLevel(source, linearSampler, uv + texel * offset34, 0.0).rgb * pair34;
  color += textureSampleLevel(source, linearSampler, uv - texel * offset34, 0.0).rgb * pair34;
  return color / normalization;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  var color: vec3f;
  if (bloom.params.w < 0.5) {
    color = extractDownsample(uv);
  } else if (bloom.params.w < 1.5) {
    color = pyramidDownsample(uv);
  } else {
    color = gaussianBlur(uv);
  }
  return vec4f(color, 1.0);
}
