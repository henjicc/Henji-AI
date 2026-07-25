struct ViewportUniforms {
  scale: vec2<f32>,
  offset: vec2<f32>,
};

@group(0) @binding(0) var source_texture: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(0) @binding(2) var<uniform> viewport: ViewportUniforms;

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
  output.uv = viewport.offset +
    vec2<f32>((position.x + 1.0) * 0.5, 1.0 - (position.y + 1.0) * 0.5) * viewport.scale;
  return output;
}

fn srgb_to_linear(value: vec3<f32>) -> vec3<f32> {
  let low = value / 12.92;
  let high = pow((value + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  return select(high, low, value <= vec3<f32>(0.04045));
}

fn linear_to_srgb(value: vec3<f32>) -> vec3<f32> {
  let safe_value = max(value, vec3<f32>(0.0));
  let low = safe_value * 12.92;
  let high = 1.055 * pow(safe_value, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
  return select(high, low, safe_value <= vec3<f32>(0.0031308));
}

@fragment
fn fragment_linearize(input: VertexOutput) -> @location(0) vec4<f32> {
  let color = textureSample(source_texture, source_sampler, input.uv);
  return vec4<f32>(srgb_to_linear(color.rgb), color.a);
}

@fragment
fn fragment_encode(input: VertexOutput) -> @location(0) vec4<f32> {
  let color = textureSample(source_texture, source_sampler, input.uv);
  return vec4<f32>(linear_to_srgb(color.rgb), color.a);
}
