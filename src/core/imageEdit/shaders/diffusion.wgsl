// 图片编辑器摄影柔光共享着色器。
// Renderer 与 Rust/wgpu 共用此文件；参数使用图片空间/线性光语义。

struct DiffusionUniforms {
  strength: f32,
  threshold_ev: f32,
  soft_knee_ev: f32,
  power: f32,
  veil: f32,
  black_retention: f32,
  highlight_compression: f32,
  mode: f32,
  texel_x: f32,
  texel_y: f32,
  radius: f32,
  chromatic_spread: f32,
  scatter_desaturation: f32,
  padding: f32,
};

@group(0) @binding(0) var source_texture: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(0) @binding(2) var<uniform> params: DiffusionUniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
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
  output.uv = vec2<f32>((position.x + 1.0) * 0.5, 1.0 - (position.y + 1.0) * 0.5);
  return output;
}

fn luminance(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn highlight_mask(value: f32) -> f32 {
  let threshold = exp2(params.threshold_ev);
  let knee = max(0.0001, exp2(params.soft_knee_ev) - 1.0);
  let normalized = clamp((value - threshold + knee) / knee, 0.0, 1.0);
  return pow(normalized, max(0.1, params.power));
}

fn sample_highlight(uv: vec2<f32>, offset: vec2<f32>) -> vec3<f32> {
  let color = textureSample(source_texture, source_sampler, uv + offset).rgb;
  let mask = highlight_mask(luminance(color));
  return color * mask;
}

fn diffuse_highlights(uv: vec2<f32>) -> vec3<f32> {
  let radius = max(0.0, params.radius);
  let step = vec2<f32>(params.texel_x, params.texel_y) * radius;
  var result = sample_highlight(uv, vec2<f32>(0.0, 0.0)) * 0.30;
  result += sample_highlight(uv, vec2<f32>(step.x, 0.0)) * 0.16;
  result += sample_highlight(uv, vec2<f32>(-step.x, 0.0)) * 0.16;
  result += sample_highlight(uv, vec2<f32>(0.0, step.y)) * 0.16;
  result += sample_highlight(uv, vec2<f32>(0.0, -step.y)) * 0.16;
  result += sample_highlight(uv, vec2<f32>(step.x, step.y)) * 0.03;
  result += sample_highlight(uv, vec2<f32>(-step.x, -step.y)) * 0.03;
  return result;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let base = textureSample(source_texture, source_sampler, input.uv).rgb;
  let scatter = diffuse_highlights(input.uv);
  let scatter_luma = luminance(scatter);
  let desaturated = vec3<f32>(scatter_luma, scatter_luma, scatter_luma);
  let chroma = mix(scatter, desaturated, clamp(params.scatter_desaturation, 0.0, 1.0));
  let glow = chroma * params.strength;
  let black_factor = mix(1.0, luminance(base), clamp(1.0 - params.black_retention, 0.0, 1.0));
  var output = base + glow * black_factor;

  if (params.mode < 0.5) {
    // 黑柔：主要扩散高光，同时保持暗部层次。
    output = mix(base, output, clamp(params.black_retention + 0.08, 0.0, 1.0));
  } else if (params.mode < 1.5) {
    // 白柔：在高光扩散之外增加轻微雾幕。
    output += vec3<f32>(params.veil) * (0.35 + scatter_luma);
  } else {
    // 辉光：不抬升整体黑位，保留更明确的光晕边缘。
    output = mix(base, output, 1.0 + params.highlight_compression * 0.25);
  }

  output = mix(output, base + (output - base) * 0.8, clamp(params.highlight_compression, 0.0, 1.0));
  return vec4<f32>(max(output, vec3<f32>(0.0)), 1.0);
}
