const MAX_TAPS: u32 = 8u;

struct Params {
  direction: vec2f,
  texelSize: vec2f,
  taps: array<vec4f, 8>,
  centerWeight: f32,
  tapCount: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

fn samplePremultiplied(uv: vec2f) -> vec4f {
  let halfTexel = params.texelSize * 0.5;
  let color = textureSampleLevel(
    source,
    linearSampler,
    clamp(uv, halfTexel, vec2f(1.0) - halfTexel),
    0.0
  );
  return vec4f(color.rgb * color.a, color.a);
}

fn toStraight(color: vec4f) -> vec4f {
  let alpha = max(color.a, 0.0);
  return vec4f(color.rgb / max(alpha, 0.000001), alpha);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  var color = samplePremultiplied(uv) * params.centerWeight;
  for (var index = 0u; index < MAX_TAPS; index += 1u) {
    if (index >= params.tapCount) { break; }
    let tap = params.taps[index];
    color += samplePremultiplied(uv + params.direction * tap.x) * tap.y;
    color += samplePremultiplied(uv - params.direction * tap.x) * tap.y;
  }
  return toStraight(color);
}
