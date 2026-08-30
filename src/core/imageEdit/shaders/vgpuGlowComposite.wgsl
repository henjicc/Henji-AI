struct Composite {
  // intensity, response exposure, left chromatic channel, right chromatic channel
  params: vec4f,
  // inverse scene size XY, chromatic offset px, chromatic amount
  optics: vec4f,
  // dither amount, reserved
  finish: vec4f,
  // global scatter offset XY, scale XY; [0, 0, 1, 1] means local/full-frame scatter
  scatterRegion: vec4f,
  // scatter 源图尺寸 XY，bloom level-0 尺寸 XY
  scatterGeometry: vec4f,
}

@group(0) @binding(0) var<uniform> composite: Composite;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var bloomPyramid: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;

fn sampleBloom(uv: vec2f) -> vec4f {
  let mappedSourceUv = composite.scatterRegion.xy + uv * composite.scatterRegion.zw;
  let sourceSize = max(composite.scatterGeometry.xy, vec2f(1.0));
  let bloomSize = max(composite.scatterGeometry.zw, vec2f(1.0));
  let scatterUv = mappedSourceUv * sourceSize / (2.0 * bloomSize);
  let inside = select(
    0.0,
    1.0,
    all(mappedSourceUv >= vec2f(0.0)) && all(mappedSourceUv <= vec2f(1.0))
  );
  return textureSampleLevel(bloomPyramid, linearSampler, scatterUv, 0.0) * inside;
}

fn channelColor(index: f32) -> vec3f {
  if (index < 0.5) { return vec3f(1.0, 0.0, 0.0); }
  if (index < 1.5) { return vec3f(0.0, 1.0, 0.0); }
  return vec3f(0.0, 0.0, 1.0);
}

fn channelEnergy(color: vec3f, index: f32) -> f32 {
  if (index < 0.5) { return color.r; }
  if (index < 1.5) { return color.g; }
  return color.b;
}

/**
 * 只在位移终点周围做不到一个原图像素的对称正值软化。这仍是单个完整辉光
 * PSF：不会沿色散路径复制出多条细线或圆环，也不会产生差分描边和振铃。
 * 4 个权重归一的双线性样本对常量区域与逐通道总能量均保持不变。
 */
fn sampleSoftShiftedBloom(uv: vec2f, offset: vec2f) -> vec3f {
  let shiftedUv = uv + offset;
  let softness = composite.optics.xy * (0.75 * clamp(composite.optics.w, 0.0, 1.0));
  return max(
    (
      sampleBloom(shiftedUv + vec2f(-softness.x, -softness.y)).rgb
      + sampleBloom(shiftedUv + vec2f( softness.x, -softness.y)).rgb
      + sampleBloom(shiftedUv + vec2f(-softness.x,  softness.y)).rgb
      + sampleBloom(shiftedUv + vec2f( softness.x,  softness.y)).rgb
    ) * 0.25,
    vec3f(0.0)
  );
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

@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let dimensions = max(vec2f(textureDimensions(scene)), vec2f(1.0));
  let sceneUv = position.xy / dimensions;
  let base = textureSampleLevel(scene, linearSampler, sceneUv, 0.0);
  let centeredBloom = sampleBloom(sceneUv);
  let centered = max(centeredBloom.rgb, vec3f(0.0));
  let chromaOffset = vec2f(composite.optics.x * composite.optics.z, 0.0);
  var diffuse = centered;

  // Pixel Aberration 必须发生在完整辉光上，而不是只搬运远场光幕。对线性 PSF 有
  // K * T(E) = T(K * E)，所以在相机响应之前位移完整通道，与“先移动发光输入、
  // 再进行全部近/中/远场卷积”严格等价。平坦区域自动抵消，色边天然只出现在边界。
  if (composite.optics.w > 0.0001) {
    let leftShifted = sampleSoftShiftedBloom(sceneUv, chromaOffset);
    let rightShifted = sampleSoftShiftedBloom(sceneUv, -chromaOffset);
    let spectralDelta =
      channelColor(composite.params.z) * (
        channelEnergy(leftShifted, composite.params.z)
        - channelEnergy(centered, composite.params.z)
      )
      + channelColor(composite.params.w) * (
        channelEnergy(rightShifted, composite.params.w)
        - channelEnergy(centered, composite.params.w)
      );
    // 整体替换逐通道守恒、无负核、无振铃；滑杆只控制连续位移距离。
    // 不再把原位与位移光峰叠加，所以细线与圆环在任何中间档都不会双影。
    diffuse = max(centered + spectralDelta, vec3f(0.0));
  }

  // 白热始终锚定未位移的原始核心；色差不参与白热峰值，也不会把两侧色光漂白。
  let centeredPeak = max(centered.r, max(centered.g, centered.b));
  let whiteBlend = clamp(
    max(centeredBloom.a, 0.0) / max(centeredPeak, 0.000001),
    0.0,
    1.0
  );
  let whiteCorrection = (vec3f(centeredPeak) - centered) * whiteBlend;
  let opticalEnergy = max(diffuse + whiteCorrection, vec3f(0.0));

  // 只对总能量峰值执行一次标量相机响应，再沿原 RGB 方向缩放。旧的逐通道 exp 会让
  // 高能彩色光自行褪色；标量响应把白化权完全交给上面的核心白热。
  let emitted = opticalEnergy * composite.params.x * composite.params.y;
  let emittedPeak = max(emitted.r, max(emitted.g, emitted.b));
  let emittedDirection = emitted / max(emittedPeak, 0.000001);
  var response = 1.0 - exp(-emittedPeak);

  // 抖动只作用于标量响应，RGB 方向保持不变；不会给未发光区域或原图纹理增加噪声。
  let presence = smoothstep(0.001, 0.04, response);
  let dither = (hash12(floor(sceneUv * dimensions)) - 0.5) * composite.finish.x * presence;
  response = clamp(response + dither, 0.0, 1.0);
  let glowLayer = emittedDirection * response;

  return compositeGlow(base, glowLayer);
}
