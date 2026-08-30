struct Composite {
  // intensity, bloom exposure, bloom gamma, white heat
  params: vec4f,
  // tint RGB, tint enabled
  tint: vec4f,
  // inverse scene size XY, chromatic offset px, chromatic amount
  optics: vec4f,
  // threshold, knee, HDR boost, reserved
  source: vec4f,
  // micro-core gain, micro-core radius px, dither amount, reserved
  core: vec4f,
}

@group(0) @binding(0) var<uniform> composite: Composite;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var bloomPyramid: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;

fn brightness(color: vec3f) -> f32 {
  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  return max(luma, max(color.r, max(color.g, color.b)) * 0.82);
}

fn extractEmitter(color: vec3f) -> vec3f {
  let value = brightness(color);
  let threshold = composite.source.x;
  let knee = max(composite.source.y, 0.0001);
  let soft = clamp(value - threshold + knee, 0.0, 2.0 * knee);
  let softContribution = soft * soft / (4.0 * knee + 0.0001);
  let contribution = max(value - threshold, softContribution) / max(value, 0.0001);
  let hot = pow(smoothstep(threshold, 1.0, value), 1.6);
  // 近场只拿少量 HDR 提升，避免微核重新变成一圈发白的描边。
  return color * contribution * (1.0 + hot * composite.source.z * 0.18);
}

fn tintGlow(color: vec3f) -> vec3f {
  return mix(color, composite.tint.rgb * brightness(color), composite.tint.a);
}

/**
 * 全分辨率 3×3 tent 微核只补金字塔缺少的 1～2px 近场散射。它是低通后的亮源能量，
 * 不包含形态学边缘、带通或未模糊副本，所以圆环和文字边缘不会再出现人为描边。
 */
fn softCore(uv: vec2f) -> vec3f {
  let step = composite.optics.xy * composite.core.y;
  let a = extractEmitter(textureSampleLevel(scene, linearSampler, uv + step * vec2f(-1.0, -1.0), 0.0).rgb);
  let b = extractEmitter(textureSampleLevel(scene, linearSampler, uv + step * vec2f( 0.0, -1.0), 0.0).rgb);
  let c = extractEmitter(textureSampleLevel(scene, linearSampler, uv + step * vec2f( 1.0, -1.0), 0.0).rgb);
  let d = extractEmitter(textureSampleLevel(scene, linearSampler, uv + step * vec2f(-1.0,  0.0), 0.0).rgb);
  let e = extractEmitter(textureSampleLevel(scene, linearSampler, uv, 0.0).rgb);
  let f = extractEmitter(textureSampleLevel(scene, linearSampler, uv + step * vec2f( 1.0,  0.0), 0.0).rgb);
  let g = extractEmitter(textureSampleLevel(scene, linearSampler, uv + step * vec2f(-1.0,  1.0), 0.0).rgb);
  let h = extractEmitter(textureSampleLevel(scene, linearSampler, uv + step * vec2f( 0.0,  1.0), 0.0).rgb);
  let i = extractEmitter(textureSampleLevel(scene, linearSampler, uv + step * vec2f( 1.0,  1.0), 0.0).rgb);
  return (a + c + g + i) * 0.0625
    + (b + d + f + h) * 0.125
    + e * 0.25;
}

fn sampleTintedBloom(uv: vec2f) -> vec3f {
  return tintGlow(textureSampleLevel(bloomPyramid, linearSampler, uv, 0.0).rgb);
}

fn toneBloom(color: vec3f) -> vec3f {
  let peak = max(color.r, max(color.g, color.b));
  if (peak <= 0.000001) {
    return vec3f(0.0);
  }
  // Oniric 式指数曝光只作用于辉光。先按峰值等比映射保住色相，再让最热区域逐渐趋白；
  // 中场和尾光因为能量更低会自然保留光源颜色，层次不靠硬阈值切出来。
  let response = 1.0 - exp(-peak * composite.params.y);
  let mappedPeak = pow(max(response, 0.0), 1.0 / max(composite.params.z, 0.0001));
  let mapped = color * (mappedPeak / peak);
  let heat = pow(smoothstep(0.28, 0.92, mappedPeak), 1.35) * composite.params.w;
  return mix(mapped, vec3f(mappedPeak), heat);
}

fn hash12(position: vec2f) -> f32 {
  let p3 = fract(vec3f(position.xyx) * 0.1031);
  let mixed = p3 + dot(p3, p3.yzx + 33.33);
  return fract((mixed.x + mixed.y) * mixed.z);
}

fn screenLinear(base: vec3f, glow: vec3f) -> vec3f {
  return base + glow - base * glow;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let base = textureSampleLevel(scene, linearSampler, uv, 0.0);
  let centered = sampleTintedBloom(uv);
  let chromaOffset = vec2f(composite.optics.x * composite.optics.z, 0.0);
  var diffuse = centered;

  // 顺序是「先着色，再做 RGB 通道位移」。只移动已经柔化的散射层，不移动原图或微核，
  // 因而得到真正的 RGB 分离而不是三份彩色硬边描边。
  if (composite.optics.w > 0.0001) {
    let red = sampleTintedBloom(uv + chromaOffset);
    let blue = sampleTintedBloom(uv - chromaOffset);
    let separated = vec3f(red.r, centered.g, blue.b);
    diffuse = mix(centered, separated, composite.optics.w);
  }

  let micro = tintGlow(softCore(uv)) * composite.core.x;
  let emitted = max(toneBloom(diffuse + micro), vec3f(0.0)) * composite.params.x;
  var glowLayer = vec3f(1.0) - exp(-emitted);

  // 亚量化抖动只存在于可见辉光内，强度小于一个 8-bit 台阶；它打散平滑渐变里的同心色带，
  // 不会给未发光区域或原图纹理增加噪声。
  let dimensions = max(vec2f(textureDimensions(scene)), vec2f(1.0));
  let presence = smoothstep(0.001, 0.04, max(glowLayer.r, max(glowLayer.g, glowLayer.b)));
  let dither = (hash12(floor(uv * dimensions)) - 0.5) * composite.core.z * presence;
  glowLayer = clamp(glowLayer + vec3f(dither), vec3f(0.0), vec3f(1.0));

  let result = screenLinear(clamp(base.rgb, vec3f(0.0), vec3f(1.0)), glowLayer);
  return vec4f(result, base.a);
}
