@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;

fn samplePremultiplied(uv: vec2f) -> vec4f {
  let dimensions = max(vec2f(textureDimensions(source)), vec2f(1.0));
  let halfTexel = 0.5 / dimensions;
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

/** 3×3 tent 重建，避免低分辨率层被直接双线性放大成方块。 */
@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let texel = 1.0 / max(vec2f(textureDimensions(source)), vec2f(1.0));
  let a = samplePremultiplied(uv + texel * vec2f(-1.0, -1.0));
  let b = samplePremultiplied(uv + texel * vec2f( 0.0, -1.0));
  let c = samplePremultiplied(uv + texel * vec2f( 1.0, -1.0));
  let d = samplePremultiplied(uv + texel * vec2f(-1.0,  0.0));
  let e = samplePremultiplied(uv);
  let f = samplePremultiplied(uv + texel * vec2f( 1.0,  0.0));
  let g = samplePremultiplied(uv + texel * vec2f(-1.0,  1.0));
  let h = samplePremultiplied(uv + texel * vec2f( 0.0,  1.0));
  let i = samplePremultiplied(uv + texel * vec2f( 1.0,  1.0));
  return toStraight(
    (a + c + g + i) * 0.0625
      + (b + d + f + h) * 0.125
      + e * 0.25
  );
}
