struct PresentColorParams {
  colorRow0: vec4f,
  colorRow1: vec4f,
  colorRow2: vec4f,
  options: vec4f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> color: PresentColorParams;

fn encodeSrgb(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) { return clamped * 12.92; }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn acesToneMap(value: f32) -> f32 {
  let positive = max(value, 0.0);
  return clamp(
    (positive * (2.51 * positive + 0.03))
      / (positive * (2.43 * positive + 0.59) + 0.14),
    0.0,
    1.0,
  );
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  return vec4f(positions[vertexIndex], 0.0, 1.0);
}

// options.y 是合成分辨率相对呈现分辨率的比例：显存紧张时合成分辨率低于屏幕，在这里放大铺满。
// 放大用双线性：合成结果是预乘 alpha，直接插值不会在透明边缘带出黑边。原分辨率时逐像素读取，结果与合成完全一致。
fn sampleSource(position: vec2f) -> vec4f {
  let scale = color.options.y;
  let maxTexel = vec2i(textureDimensions(sourceTexture)) - vec2i(1);
  if (scale >= 1.0) {
    return textureLoad(sourceTexture, min(vec2i(position), maxTexel), 0);
  }
  // 呈现像素中心换算到源像素坐标，再减半个像素落到四个相邻源像素中心之间。
  let coordinate = position * scale - vec2f(0.5);
  let base = floor(coordinate);
  let weight = coordinate - base;
  let first = clamp(vec2i(base), vec2i(0), maxTexel);
  let second = clamp(vec2i(base) + vec2i(1), vec2i(0), maxTexel);
  let top = mix(
    textureLoad(sourceTexture, first, 0),
    textureLoad(sourceTexture, vec2i(second.x, first.y), 0),
    weight.x,
  );
  let bottom = mix(
    textureLoad(sourceTexture, vec2i(first.x, second.y), 0),
    textureLoad(sourceTexture, second, 0),
    weight.x,
  );
  return mix(top, bottom, weight.y);
}

@fragment
fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let linear = sampleSource(position.xy);
  if (linear.a <= 0.0) { return vec4f(0.0); }
  let straight = linear.rgb / linear.a;
  var srgbLinear = vec3f(
    dot(color.colorRow0.xyz, straight),
    dot(color.colorRow1.xyz, straight),
    dot(color.colorRow2.xyz, straight),
  );
  if (color.options.x > 0.5) {
    srgbLinear = vec3f(
      acesToneMap(srgbLinear.r),
      acesToneMap(srgbLinear.g),
      acesToneMap(srgbLinear.b),
    );
  }
  let encoded = vec3f(
    encodeSrgb(srgbLinear.r),
    encodeSrgb(srgbLinear.g),
    encodeSrgb(srgbLinear.b),
  );
  return vec4f(encoded * linear.a, linear.a);
}
