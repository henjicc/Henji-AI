struct Composite {
  params: vec4f,
  weights: vec4f,
  tint: vec4f,
  optics: vec4f,
  source: vec4f,
}

@group(0) @binding(0) var<uniform> composite: Composite;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var bloomNear: texture_2d<f32>;
@group(0) @binding(3) var bloomMedium: texture_2d<f32>;
@group(0) @binding(4) var bloomFar: texture_2d<f32>;
@group(0) @binding(5) var linearSampler: sampler;

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
  let hot = pow(smoothstep(threshold, 1.0, brightness), 1.6);
  return brightness * contribution * (1.0 + hot * composite.source.z);
}

fn sampleNear(uv: vec2f) -> f32 {
  return textureSampleLevel(bloomNear, linearSampler, uv, 0.0).r;
}

fn sampleMedium(uv: vec2f) -> f32 {
  return textureSampleLevel(bloomMedium, linearSampler, uv, 0.0).r;
}

fn sampleFar(uv: vec2f) -> f32 {
  return textureSampleLevel(bloomFar, linearSampler, uv, 0.0).r;
}

fn rollHighlight(color: vec3f) -> vec3f {
  let peak = max(color.r, max(color.g, color.b));
  let shoulder = composite.params.y;
  if (peak <= shoulder) {
    return color;
  }
  let room = max(1.0 - shoulder, 0.001);
  let mappedPeak = shoulder + room * (1.0 - exp(-(peak - shoulder) / room));
  let rolled = color * (mappedPeak / max(peak, 0.0001));
  return mix(min(color, vec3f(1.0)), rolled, composite.params.z);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let base = textureSampleLevel(scene, linearSampler, uv, 0.0);
  let near = sampleNear(uv);
  let medium = sampleMedium(uv);
  let far = sampleFar(uv);

  // 多尺度高斯和近似指数型光学 PSF；DoG 带通项专门恢复紧贴光源的明亮窄边，
  // 避免三个模糊层直接相加后变成没有层次的一团雾。
  let nearBand = max(near - medium * 0.72, 0.0);
  let mediumBand = max(medium - far * 0.72, 0.0);
  let haze = near * composite.weights.x
    + medium * composite.weights.y
    + far * composite.weights.z;
  let bands = nearBand * composite.weights.x * 0.75
    + mediumBand * composite.weights.y * 0.35;
  let layered = haze + bands * composite.weights.w;

  // 根据近场能量梯度沿每个轮廓的法线方向拆分 RGB，而不是把整张图向固定方向错位。
  // 因此圆环内外缘、文字和任意形状都会得到自己的镜头像差方向。
  let gradientStep = composite.optics.xy * 2.0;
  let gradient = vec2f(
    sampleNear(uv + vec2f(gradientStep.x, 0.0)) - sampleNear(uv - vec2f(gradientStep.x, 0.0)),
    sampleNear(uv + vec2f(0.0, gradientStep.y)) - sampleNear(uv - vec2f(0.0, gradientStep.y))
  );
  let gradientLength = length(gradient);
  let direction = select(vec2f(1.0, 0.0), gradient / max(gradientLength, 0.00001), gradientLength > 0.00001);
  let chromaOffset = direction * composite.optics.xy * composite.optics.z;
  let chromaticNear = vec3f(
    sampleNear(uv + chromaOffset),
    near,
    sampleNear(uv - chromaOffset)
  );
  let chromaticNearBand = max(chromaticNear - vec3f(medium * 0.72), vec3f(0.0));
  let chromaticLayered = chromaticNear * composite.weights.x
    + vec3f(medium * composite.weights.y + far * composite.weights.z)
    + chromaticNearBand * composite.weights.x * 0.75 * composite.weights.w
    + vec3f(mediumBand * composite.weights.y * 0.35 * composite.weights.w);

  let tint = composite.tint.rgb;
  // 高色差时适度补回中性光谱，确保即便用户选择单一强色，RGB 分离仍然可见；
  // 低值几乎完全保持用户着色。
  let spectralTint = mix(tint, vec3f(1.0), composite.tint.a * 0.45);
  let diffuseGlow = mix(vec3f(layered) * tint, chromaticLayered * spectralTint, composite.tint.a);

  // 全分辨率光源核心和约 1px 的外缘亮边不经过降采样，保住圆环/文字的锐利发光体质感。
  let directEnergy = emitterEnergy(base.rgb);
  let hot = pow(smoothstep(composite.source.x, 1.0, emitterBrightness(base.rgb)), 1.4);
  let coreTint = mix(tint, vec3f(1.0), hot * composite.params.w);
  let chromaticCore = vec3f(
    emitterEnergy(textureSampleLevel(scene, linearSampler, uv + chromaOffset, 0.0).rgb),
    directEnergy,
    emitterEnergy(textureSampleLevel(scene, linearSampler, uv - chromaOffset, 0.0).rgb)
  );
  let spectralCoreTint = mix(coreTint, vec3f(1.0), composite.tint.a * 0.75);
  let core = mix(
    vec3f(directEnergy) * coreTint,
    chromaticCore * spectralCoreTint,
    composite.tint.a
  ) * composite.optics.w;
  let rimStep = composite.optics.xy * composite.source.w;
  let neighborEnergy = max(
    max(emitterEnergy(textureSampleLevel(scene, linearSampler, uv + vec2f(rimStep.x, 0.0), 0.0).rgb),
        emitterEnergy(textureSampleLevel(scene, linearSampler, uv - vec2f(rimStep.x, 0.0), 0.0).rgb)),
    max(emitterEnergy(textureSampleLevel(scene, linearSampler, uv + vec2f(0.0, rimStep.y), 0.0).rgb),
        emitterEnergy(textureSampleLevel(scene, linearSampler, uv - vec2f(0.0, rimStep.y), 0.0).rgb))
  );
  let rim = max(neighborEnergy - directEnergy, 0.0) * composite.weights.w;
  let emitted = (diffuseGlow + core + rim * tint) * composite.params.x;
  return vec4f(rollHighlight(base.rgb + emitted), base.a);
}
