struct Composite {
  // intensity, response exposure, reserved, reserved
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

/**
 * 色差只应移动已经散开的光，不应复制紧致热核。用一个小十字低通取得宽散射分量，
 * 随位移增大同步加宽，避免最大色差重新退化成红蓝硬描边。
 */
fn sampleDiffuseBloom(uv: vec2f, blurPx: f32) -> vec3f {
  let texel = composite.optics.xy * max(blurPx, 1.0);
  let center = sampleBloom(uv).rgb;
  let horizontal = sampleBloom(uv - vec2f(texel.x, 0.0)).rgb
    + sampleBloom(uv + vec2f(texel.x, 0.0)).rgb;
  let vertical = sampleBloom(uv - vec2f(0.0, texel.y)).rgb
    + sampleBloom(uv + vec2f(0.0, texel.y)).rgb;
  return center * 0.4 + (horizontal + vertical) * 0.15;
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

  // 着色已在源阶段完成。色差以预柔化散射层的位移差分叠回 centered：紧核心始终留在
  // 原位，只有外围光场产生 Glitch RGB 分离，不会出现三份彩色文字/描边。
  if (composite.optics.w > 0.0001) {
    let separationBlurPx = 1.25 + composite.optics.z * 0.55;
    let softCentered = max(sampleDiffuseBloom(sceneUv, separationBlurPx), vec3f(0.0));
    let red = max(sampleDiffuseBloom(sceneUv + chromaOffset, separationBlurPx), vec3f(0.0));
    let blue = max(sampleDiffuseBloom(sceneUv - chromaOffset, separationBlurPx), vec3f(0.0));
    let separated = vec3f(red.r, softCentered.g, blue.b);
    diffuse = max(
      centered + (separated - softCentered) * composite.optics.w,
      vec3f(0.0)
    );
  }

  // A 是只走紧致 PSF 的白热替换置信度。它只把核心色度推向同峰值白色，不再叠加
  // 第二份白色能量，因此不会在物体边界制造刻意的白描边，远场仍保留光源颜色。
  let diffusePeak = max(diffuse.r, max(diffuse.g, diffuse.b));
  let whiteBlend = clamp(
    max(centeredBloom.a, 0.0) / max(diffusePeak, 0.000001),
    0.0,
    1.0
  );
  let opticalEnergy = mix(diffuse, vec3f(diffusePeak), whiteBlend);

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
