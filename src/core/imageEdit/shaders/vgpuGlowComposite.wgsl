struct Composite {
  params: vec4f,
  weights: vec4f,
  tail: vec4f,
  tint: vec4f,
  optics: vec4f,
  source: vec4f,
}

@group(0) @binding(0) var<uniform> composite: Composite;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var bloomNear: texture_2d<f32>;
@group(0) @binding(3) var bloomMedium: texture_2d<f32>;
@group(0) @binding(4) var bloomFar: texture_2d<f32>;
@group(0) @binding(5) var bloomWide: texture_2d<f32>;
@group(0) @binding(6) var bloomAtmosphere: texture_2d<f32>;
@group(0) @binding(7) var linearSampler: sampler;

fn emitterBrightness(color: vec3f) -> f32 {
  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  return max(luma, max(color.r, max(color.g, color.b)) * 0.82);
}

fn emitterEnergy(color: vec3f) -> f32 {
  let brightness = emitterBrightness(color);
  let threshold = composite.source.x;
  let knee = max(composite.source.y, 0.0001);
  let soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
  let softContribution = soft * soft / (4.0 * knee + 0.0001);
  let contribution = max(brightness - threshold, softContribution) / max(brightness, 0.0001);
  return brightness * contribution;
}

fn bloomEnergy(color: vec3f) -> f32 {
  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  return max(luma, max(color.r, max(color.g, color.b)) * 0.82);
}

fn sampleNear(uv: vec2f) -> vec3f {
  return textureSampleLevel(bloomNear, linearSampler, uv, 0.0).rgb;
}

fn sampleMedium(uv: vec2f) -> vec3f {
  return textureSampleLevel(bloomMedium, linearSampler, uv, 0.0).rgb;
}

fn sampleFar(uv: vec2f) -> vec3f {
  return textureSampleLevel(bloomFar, linearSampler, uv, 0.0).rgb;
}

fn sampleWide(uv: vec2f) -> vec3f {
  return textureSampleLevel(bloomWide, linearSampler, uv, 0.0).rgb;
}

fn sampleAtmosphere(uv: vec2f) -> vec3f {
  return textureSampleLevel(bloomAtmosphere, linearSampler, uv, 0.0).rgb;
}

fn layeredBloom(uv: vec2f) -> vec3f {
  let near = sampleNear(uv);
  let medium = sampleMedium(uv);
  let far = sampleFar(uv);
  let wide = sampleWide(uv);
  let atmosphere = sampleAtmosphere(uv);
  // 五个倍频尺度组成连续的散射 PSF：近场塑造光源密度，空气层只贡献很低频的长尾。
  // 所有层都来自同一个未模糊高光金字塔，不使用边缘带通或形态学描边。
  return near * composite.weights.x
    + medium * composite.weights.y
    + far * composite.weights.z
    + wide * composite.weights.w
    + atmosphere * composite.tail.x;
}

fn tintBloom(color: vec3f) -> vec3f {
  return mix(color, composite.tint.rgb * bloomEnergy(color), composite.tint.a);
}

fn coreEmitter(uv: vec2f) -> vec3f {
  let color = textureSampleLevel(scene, linearSampler, uv, 0.0).rgb;
  let brightness = emitterBrightness(color);
  let energy = emitterEnergy(color);
  let hot = pow(smoothstep(composite.source.x, 1.0, brightness), 1.4);
  let sourceCore = color * (energy / max(brightness, 0.0001));
  let naturalCore = mix(sourceCore, vec3f(energy), hot * composite.params.w);
  let tintedCore = mix(composite.tint.rgb * energy, vec3f(energy), hot * composite.params.w);
  // 核心使用曝光前的高光种子；能量提升只属于散射层，避免中心过曝成硬白块。
  return mix(naturalCore, tintedCore, composite.tint.a) * composite.tail.y;
}

fn toneBloom(color: vec3f) -> vec3f {
  let peak = max(color.r, max(color.g, color.b));
  if (peak <= 0.000001) {
    return vec3f(0.0);
  }
  // Oniric 的指数摄影响应只作用于 Bloom。按峰值映射再等比缩放 RGB，既生成柔和
  // 白热肩部，也不会因逐通道截断破坏原始色相。
  let response = 1.0 - exp(-peak * composite.params.y);
  let mappedPeak = pow(max(response, 0.0), 1.0 / max(composite.params.z, 0.0001));
  return color * (mappedPeak / peak);
}

fn preparedBloom(uv: vec2f) -> vec3f {
  return toneBloom(tintBloom(layeredBloom(uv)));
}

fn screenLinear(base: vec3f, glow: vec3f) -> vec3f {
  return base + glow - base * glow;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let base = textureSampleLevel(scene, linearSampler, uv, 0.0);
  let centeredBloom = preparedBloom(uv);
  let chromaOffset = vec2f(composite.optics.x * composite.optics.z, 0.0);
  let centeredCore = coreEmitter(uv);
  var diffuseGlow = centeredBloom;
  var core = centeredCore;

  if (composite.optics.w > 0.0001) {
    let redBloom = preparedBloom(uv + chromaOffset);
    let blueBloom = preparedBloom(uv - chromaOffset);
    let splitBloom = vec3f(redBloom.r, centeredBloom.g, blueBloom.b);
    diffuseGlow = mix(centeredBloom, splitBloom, composite.optics.w);

    let redCore = coreEmitter(uv + chromaOffset);
    let blueCore = coreEmitter(uv - chromaOffset);
    let splitCore = vec3f(redCore.r, centeredCore.g, blueCore.b);
    core = mix(centeredCore, splitCore, composite.optics.w);
  }

  // 先把 Bloom 与曝光前核心转为有限的光层，再在线性空间 Screen 到原图。
  // 原图不参与 Bloom Tone Map，因此暗部、肤色和未发光区域不会被辉光参数改写。
  let emitted = max(diffuseGlow + core, vec3f(0.0)) * composite.params.x;
  let glowLayer = vec3f(1.0) - exp(-emitted);
  let result = screenLinear(clamp(base.rgb, vec3f(0.0), vec3f(1.0)), glowLayer);
  return vec4f(result, base.a);
}
