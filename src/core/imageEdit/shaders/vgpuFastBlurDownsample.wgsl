@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;

fn samplePremultiplied(uv: vec2f, offset: vec2f) -> vec4f {
  let dimensions = max(vec2f(textureDimensions(source)), vec2f(1.0));
  let sampleUv = uv + offset / dimensions;
  let halfTexel = 0.5 / dimensions;
  let color = textureSampleLevel(
    source,
    linearSampler,
    clamp(sampleUv, halfTexel, vec2f(1.0) - halfTexel),
    0.0
  );
  return vec4f(color.rgb * color.a, color.a);
}

fn toStraight(color: vec4f) -> vec4f {
  let alpha = max(color.a, 0.0);
  return vec4f(color.rgb / max(alpha, 0.000001), alpha);
}

/** 13-tap 正权重降采样核；所有读取都落在相邻 texel。 */
fn downsample13(uv: vec2f) -> vec4f {
  let a = samplePremultiplied(uv, vec2f(-2.0, -2.0));
  let b = samplePremultiplied(uv, vec2f( 0.0, -2.0));
  let c = samplePremultiplied(uv, vec2f( 2.0, -2.0));
  let d = samplePremultiplied(uv, vec2f(-2.0,  0.0));
  let e = samplePremultiplied(uv, vec2f( 0.0,  0.0));
  let f = samplePremultiplied(uv, vec2f( 2.0,  0.0));
  let g = samplePremultiplied(uv, vec2f(-2.0,  2.0));
  let h = samplePremultiplied(uv, vec2f( 0.0,  2.0));
  let i = samplePremultiplied(uv, vec2f( 2.0,  2.0));
  let j = samplePremultiplied(uv, vec2f(-1.0, -1.0));
  let k = samplePremultiplied(uv, vec2f( 1.0, -1.0));
  let l = samplePremultiplied(uv, vec2f(-1.0,  1.0));
  let m = samplePremultiplied(uv, vec2f( 1.0,  1.0));
  return (a + c + g + i) * 0.03125
    + (b + d + f + h) * 0.0625
    + e * 0.125
    + (j + k + l + m) * 0.125;
}

@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let sourceDimensions = max(vec2f(textureDimensions(source)), vec2f(1.0));
  let uv = position.xy * 2.0 / sourceDimensions;
  return toStraight(downsample13(uv));
}
