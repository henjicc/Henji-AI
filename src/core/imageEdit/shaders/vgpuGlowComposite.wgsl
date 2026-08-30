struct Composite {
  // intensity, response exposure, reserved, reserved
  params: vec4f,
  // tint RGB, tint enabled
  tint: vec4f,
  // inverse scene size XY, chromatic offset px, chromatic amount
  optics: vec4f,
  // dither amount, reserved
  finish: vec4f,
  // global scatter offset XY, scale XY; [0, 0, 1, 1] means local/full-frame scatter
  scatterRegion: vec4f,
}

@group(0) @binding(0) var<uniform> composite: Composite;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var bloomPyramid: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;

fn brightness(color: vec3f) -> f32 {
  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  return max(luma, max(color.r, max(color.g, color.b)) * 0.82);
}

fn tintGlow(color: vec3f) -> vec3f {
  return mix(color, composite.tint.rgb * brightness(color), composite.tint.a);
}

fn sampleBloom(uv: vec2f) -> vec4f {
  let scatterUv = composite.scatterRegion.xy + uv * composite.scatterRegion.zw;
  return textureSampleLevel(bloomPyramid, linearSampler, scatterUv, 0.0);
}

fn hash12(position: vec2f) -> f32 {
  let p3 = fract(vec3f(position.xyx) * 0.1031);
  let mixed = p3 + dot(p3, p3.yzx + 33.33);
  return fract((mixed.x + mixed.y) * mixed.z);
}

fn screenLinear(base: vec3f, glow: vec3f) -> vec3f {
  return base + glow - base * glow;
}

/**
 * 把辉光看作一层预乘的光学能量，并按 W3C source-over + screen 混合合成到直通原图。
 * glowAlpha 取光层的峰值，glowStraight 保留其色相：
 * - 原图不透明时，结果严格等于旧的 screen(base, glowPremultiplied)，观感不漂移；
 * - 原图透明时，光晕会得到自己的覆盖率，不再被 base.a 截掉；
 * - 半透明边缘遵守 Porter-Duff，不会出现重复乘 Alpha 的黑边。
 * 返回值仍是直通颜色，最终写入 premultiplied Surface 时由 encode pass 统一预乘。
 */
fn compositeGlow(base: vec4f, glowPremultiplied: vec3f) -> vec4f {
  let baseAlpha = clamp(base.a, 0.0, 1.0);
  let baseStraight = clamp(base.rgb, vec3f(0.0), vec3f(1.0));
  let glowAlpha = clamp(
    max(glowPremultiplied.r, max(glowPremultiplied.g, glowPremultiplied.b)),
    0.0,
    1.0
  );
  if (glowAlpha <= 0.000001) {
    return vec4f(baseStraight, baseAlpha);
  }

  let glowStraight = clamp(
    glowPremultiplied / glowAlpha,
    vec3f(0.0),
    vec3f(1.0)
  );
  let blended = screenLinear(baseStraight, glowStraight);
  let outAlpha = glowAlpha + baseAlpha * (1.0 - glowAlpha);
  let outPremultiplied =
      glowStraight * glowAlpha * (1.0 - baseAlpha)
    + blended * glowAlpha * baseAlpha
    + baseStraight * baseAlpha * (1.0 - glowAlpha);
  return vec4f(outPremultiplied / max(outAlpha, 0.000001), outAlpha);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let base = textureSampleLevel(scene, linearSampler, uv, 0.0);
  let centeredBloom = sampleBloom(uv);
  let centered = tintGlow(centeredBloom.rgb);
  let chromaOffset = vec2f(composite.optics.x * composite.optics.z, 0.0);
  var diffuse = centered;

  // 顺序是「先着色，再做 RGB 通道位移」。只移动已经柔化的散射层，不移动原图或微核，
  // 因而得到真正的 RGB 分离而不是三份彩色硬边描边。
  if (composite.optics.w > 0.0001) {
    let red = tintGlow(sampleBloom(uv + chromaOffset).rgb);
    let blue = tintGlow(sampleBloom(uv - chromaOffset).rgb);
    let separated = vec3f(red.r, centered.g, blue.b);
    diffuse = mix(centered, separated, composite.optics.w);
  }

  // RGB 是保留色彩的完整散射；A 是源阶段生成并只走紧致 core PSF 的白热能量。
  // 白热不参与着色或 RGB 位移，也不会在相邻颜色卷积重叠后突然整片漂白。
  let opticalEnergy = max(diffuse, vec3f(0.0))
    + vec3f(max(centeredBloom.a, 0.0));

  // 两层能量一直保留在线性虚拟辐射域。这里只执行一次最终相机响应：
  // screen(base, 1-exp(-E)) 等价于 1-(1-base)exp(-E)，因此不会像旧链路那样
  // 对辉光先曝光一次、合成时又指数压缩一次而把核心与裙部压成同一亮度。
  let emitted = opticalEnergy * composite.params.x * composite.params.y;
  var glowLayer = vec3f(1.0) - exp(-emitted);

  // 亚量化抖动只存在于可见辉光内，强度小于一个 8-bit 台阶；它打散平滑渐变里的同心色带，
  // 不会给未发光区域或原图纹理增加噪声。
  let dimensions = max(vec2f(textureDimensions(scene)), vec2f(1.0));
  let presence = smoothstep(0.001, 0.04, max(glowLayer.r, max(glowLayer.g, glowLayer.b)));
  let dither = (hash12(floor(uv * dimensions)) - 0.5) * composite.finish.x * presence;
  glowLayer = clamp(glowLayer + vec3f(dither), vec3f(0.0), vec3f(1.0));

  return compositeGlow(base, glowLayer);
}
