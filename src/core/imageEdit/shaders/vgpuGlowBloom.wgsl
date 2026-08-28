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
  let energy = brightness * contribution * (1.0 + hot * bloom.glow.x);
  // 辉光的空间分布只传递标量能量，颜色统一在最终合成阶段注入。这样自定义着色不会
  // 因降采样层级不同而被原图颜色重新污染，RGB 色差也可以作用于同一份光能场。
  return vec3f(energy);
}

fn downsample(uv: vec2f) -> vec3f {
  let texel = 1.0 / bloom.sourceSize;
  let offset = texel * 0.5;
  var color = (
    textureSampleLevel(source, linearSampler, uv + vec2f(-offset.x, -offset.y), 0.0).rgb +
    textureSampleLevel(source, linearSampler, uv + vec2f( offset.x, -offset.y), 0.0).rgb +
    textureSampleLevel(source, linearSampler, uv + vec2f(-offset.x,  offset.y), 0.0).rgb +
    textureSampleLevel(source, linearSampler, uv + vec2f( offset.x,  offset.y), 0.0).rgb
  ) * 0.25;
  if (bloom.params.w < 0.5) {
    color = extractEmitter(color);
  }
  return color;
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
  let texel = bloom.direction / bloom.sourceSize;
  var color = textureSampleLevel(source, linearSampler, uv, 0.0).rgb * w0;
  color += textureSampleLevel(source, linearSampler, uv + texel * offset12, 0.0).rgb * pair12;
  color += textureSampleLevel(source, linearSampler, uv - texel * offset12, 0.0).rgb * pair12;
  color += textureSampleLevel(source, linearSampler, uv + texel * offset34, 0.0).rgb * pair34;
  color += textureSampleLevel(source, linearSampler, uv - texel * offset34, 0.0).rgb * pair34;
  return color / normalization;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let color = select(downsample(uv), gaussianBlur(uv), bloom.params.w > 1.5);
  return vec4f(color, 1.0);
}
