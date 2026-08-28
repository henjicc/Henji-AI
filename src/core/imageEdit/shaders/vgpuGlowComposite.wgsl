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

fn layeredBloom(uv: vec2f) -> vec3f {
  let near = sampleNear(uv);
  let medium = sampleMedium(uv);
  let far = sampleFar(uv);
  let nearBand = max(near - medium * 0.72, vec3f(0.0));
  let mediumBand = max(medium - far * 0.72, vec3f(0.0));
  let haze = near * composite.weights.x
    + medium * composite.weights.y
    + far * composite.weights.z;
  let bands = nearBand * composite.weights.x * 0.75
    + mediumBand * composite.weights.y * 0.35;
  return haze + bands * composite.weights.w;
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
  return mix(naturalCore, tintedCore, composite.tint.a) * composite.source.w;
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
  let centeredBloom = layeredBloom(uv);
  let chromaOffset = vec2f(composite.optics.x * composite.optics.z, 0.0);
  let redBloom = layeredBloom(uv + chromaOffset);
  let blueBloom = layeredBloom(uv - chromaOffset);

  // Glitch 风格 RGB 分离：R 向右、G 留在原位、B 向左。固定方向能形成清楚的彩色重影，
  // 不再沿轮廓四周生成一圈杂乱的彩边。着色开启时仍用同一能量场生成纯 RGB 分离。
  let splitSourceBloom = vec3f(redBloom.r, centeredBloom.g, blueBloom.b);
  let splitTintedBloom = vec3f(
    bloomEnergy(redBloom),
    bloomEnergy(centeredBloom),
    bloomEnergy(blueBloom)
  );
  let splitBloom = mix(splitSourceBloom, splitTintedBloom, composite.tint.a);
  let diffuseGlow = mix(tintBloom(centeredBloom), splitBloom, composite.optics.w);

  // 全分辨率光源核心和约 1px 的外缘亮边不经过降采样，保住圆环/文字的锐利发光体质感。
  let directEnergy = emitterEnergy(base.rgb);
  let centeredCore = coreEmitter(uv);
  let redCore = coreEmitter(uv + chromaOffset);
  let blueCore = coreEmitter(uv - chromaOffset);
  let splitSourceCore = vec3f(redCore.r, centeredCore.g, blueCore.b);
  let splitTintedCore = vec3f(
    emitterEnergy(textureSampleLevel(scene, linearSampler, uv + chromaOffset, 0.0).rgb),
    directEnergy,
    emitterEnergy(textureSampleLevel(scene, linearSampler, uv - chromaOffset, 0.0).rgb)
  ) * composite.source.w;
  let splitCore = mix(splitSourceCore, splitTintedCore, composite.tint.a);
  let core = mix(centeredCore, splitCore, composite.optics.w);
  let rimStep = composite.optics.xy * 1.35;
  let neighborEnergy = max(
    max(emitterEnergy(textureSampleLevel(scene, linearSampler, uv + vec2f(rimStep.x, 0.0), 0.0).rgb),
        emitterEnergy(textureSampleLevel(scene, linearSampler, uv - vec2f(rimStep.x, 0.0), 0.0).rgb)),
    max(emitterEnergy(textureSampleLevel(scene, linearSampler, uv + vec2f(0.0, rimStep.y), 0.0).rgb),
        emitterEnergy(textureSampleLevel(scene, linearSampler, uv - vec2f(0.0, rimStep.y), 0.0).rgb))
  );
  let rim = max(neighborEnergy - directEnergy, 0.0) * composite.weights.w;
  let rimColor = mix(vec3f(1.0), composite.tint.rgb, composite.tint.a);
  let emitted = (diffuseGlow + core + rim * rimColor) * composite.params.x;
  return vec4f(rollHighlight(base.rgb + emitted), base.a);
}
