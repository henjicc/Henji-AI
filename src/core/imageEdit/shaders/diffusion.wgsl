// WebGPU Worker 多尺度摄影柔光着色器。
// 所有散射在 Linear sRGB 代理空间完成，半径来自共享归一化配方。

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) local_uv: vec2<f32>,
};

@vertex
fn vertex_main(@builtin(vertex_index) index: u32) -> VertexOutput {
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0),
  );
  let position = positions[index];
  var output: VertexOutput;
  output.position = vec4<f32>(position, 0.0, 1.0);
  output.local_uv = vec2<f32>(
    (position.x + 1.0) * 0.5,
    1.0 - (position.y + 1.0) * 0.5
  );
  return output;
}

fn luminance(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

struct SourceUniforms {
  scale: vec2<f32>,
  offset: vec2<f32>,
  threshold_linear: f32,
  soft_knee_linear: f32,
  power: f32,
  highlight_gain: f32,
  micro_gain: f32,
  highlight_recovery: f32,
  mode: f32,
  position_variation: f32,
};

@group(0) @binding(0) var source_input: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(0) @binding(2) var<uniform> source_params: SourceUniforms;

fn highlight_response(value: f32) -> f32 {
  let knee = max(source_params.soft_knee_linear, 0.000015);
  let shoulder = clamp(
    (value - source_params.threshold_linear + knee) / (2.0 * knee),
    0.0,
    1.0
  );
  let smooth_shoulder = shoulder * shoulder * (3.0 - 2.0 * shoulder);
  return pow(smooth_shoulder, max(source_params.power, 0.1));
}

@fragment
fn fragment_source(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = source_params.offset + input.local_uv * source_params.scale;
  let color = textureSample(source_input, source_sampler, uv);
  if (color.a <= 0.00001) {
    return vec4<f32>(0.0);
  }
  let luma = luminance(color.rgb);
  let highlight = highlight_response(luma);
  let recovered = mix(
    color.rgb,
    vec3<f32>(luma),
    source_params.highlight_recovery * 0.35
  );
  let micro = luma * luma * source_params.micro_gain;
  var response = recovered * (
    highlight * source_params.highlight_gain + micro
  );
  if (source_params.mode < 0.5) {
    response *= mix(0.65, 1.0, highlight);
  } else if (source_params.mode < 1.5) {
    response += color.rgb * micro * 0.45;
  } else {
    response *= highlight * 0.65 + 0.35;
  }
  return vec4<f32>(max(response, vec3<f32>(0.0)) * color.a, color.a);
}

struct BlurUniforms {
  scale: vec2<f32>,
  offset: vec2<f32>,
  aspect_correction: vec2<f32>,
  radius: f32,
  axis: f32,
  anisotropy: f32,
  angle: f32,
  padding: vec2<f32>,
};

@group(0) @binding(0) var blur_input: texture_2d<f32>;
@group(0) @binding(1) var blur_sampler: sampler;
@group(0) @binding(2) var<uniform> blur_params: BlurUniforms;

fn blur_direction() -> vec2<f32> {
  let horizontal = vec2<f32>(cos(blur_params.angle), sin(blur_params.angle));
  let vertical = vec2<f32>(-horizontal.y, horizontal.x);
  let selected = select(horizontal, vertical, blur_params.axis > 0.5);
  let anisotropy_scale = select(
    1.0 + blur_params.anisotropy,
    max(0.15, 1.0 - blur_params.anisotropy),
    blur_params.axis > 0.5
  );
  return selected * blur_params.aspect_correction
    * blur_params.radius * anisotropy_scale;
}

fn gaussian_sample(uv: vec2<f32>, direction: vec2<f32>) -> vec4<f32> {
  var result = textureSample(blur_input, blur_sampler, uv) * 0.227027;
  result += textureSample(blur_input, blur_sampler, uv + direction * 1.384615) * 0.316216;
  result += textureSample(blur_input, blur_sampler, uv - direction * 1.384615) * 0.316216;
  result += textureSample(blur_input, blur_sampler, uv + direction * 3.230769) * 0.070270;
  result += textureSample(blur_input, blur_sampler, uv - direction * 3.230769) * 0.070270;
  return result;
}

@fragment
fn fragment_blur_horizontal(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = blur_params.offset + input.local_uv * blur_params.scale;
  return gaussian_sample(uv, blur_direction());
}

@fragment
fn fragment_blur_vertical(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = blur_params.offset + input.local_uv * blur_params.scale;
  return gaussian_sample(uv, blur_direction());
}

struct CompositeUniforms {
  scale: vec2<f32>,
  offset: vec2<f32>,
  weights_a: vec4<f32>,
  weights_b: vec4<f32>,
  strength: f32,
  scatter_fraction: f32,
  direct_retention: f32,
  veil: f32,
  black_retention: f32,
  highlight_compression: f32,
  scatter_desaturation: f32,
  high_frequency_retention: f32,
  mid_frequency_retention: f32,
  mode: f32,
  chromatic_spread: f32,
  padding: f32,
};

@group(0) @binding(0) var composite_base: texture_2d<f32>;
@group(0) @binding(1) var composite_sampler: sampler;
@group(0) @binding(2) var scatter_0: texture_2d<f32>;
@group(0) @binding(3) var scatter_1: texture_2d<f32>;
@group(0) @binding(4) var scatter_2: texture_2d<f32>;
@group(0) @binding(5) var scatter_3: texture_2d<f32>;
@group(0) @binding(6) var scatter_4: texture_2d<f32>;
@group(0) @binding(7) var scatter_5: texture_2d<f32>;
@group(0) @binding(8) var<uniform> composite_params: CompositeUniforms;

fn sample_chromatic(texture: texture_2d<f32>, uv: vec2<f32>, spread: f32) -> vec3<f32> {
  if (spread <= 0.000001) {
    return textureSample(texture, composite_sampler, uv).rgb;
  }
  let red = textureSample(texture, composite_sampler, uv + vec2<f32>(spread, 0.0)).r;
  let green = textureSample(texture, composite_sampler, uv).g;
  let blue = textureSample(texture, composite_sampler, uv - vec2<f32>(spread, 0.0)).b;
  return vec3<f32>(red, green, blue);
}

@fragment
fn fragment_composite(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = composite_params.offset + input.local_uv * composite_params.scale;
  let base = textureSample(composite_base, composite_sampler, uv);
  if (base.a <= 0.00001) {
    return vec4<f32>(0.0);
  }
  let spread = composite_params.chromatic_spread;
  var scatter = sample_chromatic(scatter_0, uv, spread * 0.25)
    * composite_params.weights_a.x;
  scatter += sample_chromatic(scatter_1, uv, spread * 0.4)
    * composite_params.weights_a.y;
  scatter += sample_chromatic(scatter_2, uv, spread * 0.6)
    * composite_params.weights_a.z;
  scatter += sample_chromatic(scatter_3, uv, spread * 0.8)
    * composite_params.weights_a.w;
  scatter += sample_chromatic(scatter_4, uv, spread)
    * composite_params.weights_b.x;
  scatter += sample_chromatic(scatter_5, uv, spread * 1.25)
    * composite_params.weights_b.y;

  let scatter_luma = luminance(scatter);
  scatter = mix(
    scatter,
    vec3<f32>(scatter_luma),
    composite_params.scatter_desaturation
  );
  let deduction = min(
    base.rgb,
    scatter * composite_params.scatter_fraction
  );
  let direct = max(base.rgb - deduction, vec3<f32>(0.0));
  let high_detail = base.rgb
    - textureSample(scatter_0, composite_sampler, uv).rgb;
  let mid_detail = base.rgb
    - textureSample(scatter_2, composite_sampler, uv).rgb;
  var color = direct + scatter * composite_params.strength;
  color += high_detail * composite_params.high_frequency_retention * 0.08;
  color += mid_detail * composite_params.mid_frequency_retention * 0.04;

  if (composite_params.mode < 0.5) {
    let black_guard = mix(
      luminance(base.rgb),
      1.0,
      composite_params.black_retention
    );
    color = mix(base.rgb, color, black_guard);
  } else if (composite_params.mode < 1.5) {
    color += vec3<f32>(composite_params.veil) * (0.35 + scatter_luma);
  } else {
    color = max(color - vec3<f32>(composite_params.veil), vec3<f32>(0.0));
  }

  let compressed = color / (
    vec3<f32>(1.0)
      + color * composite_params.highlight_compression
  );
  color = mix(color, compressed, composite_params.highlight_compression);
  return vec4<f32>(max(color, vec3<f32>(0.0)), base.a);
}
