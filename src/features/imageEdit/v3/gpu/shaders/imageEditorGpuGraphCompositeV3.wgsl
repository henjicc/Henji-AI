struct Params {
  inverseLinear: vec4f,
  inverseTranslation: vec4f,
  options: vec4f,
  maskOptions: vec4f,
}
@group(0) @binding(0) var backdropTexture: texture_2d<f32>;
@group(0) @binding(1) var contentTexture: texture_2d<f32>;
@group(0) @binding(2) var maskTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: Params;

fn loadColor(texture: texture_2d<f32>, coord: vec2i) -> vec4f {
  let size = vec2i(textureDimensions(texture));
  if (coord.x < 0 || coord.y < 0 || coord.x >= size.x || coord.y >= size.y) { return vec4f(0.0); }
  return textureLoad(texture, coord, 0);
}
fn bilinearColor(texture: texture_2d<f32>, point: vec2f) -> vec4f {
  let p0 = vec2i(floor(point)); let f = fract(point);
  let top = mix(loadColor(texture, p0), loadColor(texture, p0 + vec2i(1, 0)), f.x);
  let bottom = mix(loadColor(texture, p0 + vec2i(0, 1)), loadColor(texture, p0 + vec2i(1, 1)), f.x);
  return mix(top, bottom, f.y);
}
fn loadMask(coord: vec2i) -> f32 {
  let size = vec2i(textureDimensions(maskTexture));
  if (coord.x < 0 || coord.y < 0 || coord.x >= size.x || coord.y >= size.y) { return params.maskOptions.y; }
  return textureLoad(maskTexture, coord, 0).r;
}
fn bilinearMask(point: vec2f) -> f32 {
  if (params.maskOptions.x < 0.5) { return params.maskOptions.y; }
  let p0 = vec2i(floor(point)); let f = fract(point);
  let top = mix(loadMask(p0), loadMask(p0 + vec2i(1, 0)), f.x);
  let bottom = mix(loadMask(p0 + vec2i(0, 1)), loadMask(p0 + vec2i(1, 1)), f.x);
  let value = mix(top, bottom, f.y);
  return select(value, 1.0 - value, params.maskOptions.z > 0.5);
}
fn blendChannel(backdrop: f32, source: f32, mode: u32) -> f32 {
  if (mode == 1u) { return backdrop * source; }
  if (mode == 2u) { return backdrop + source - backdrop * source; }
  if (mode == 3u) { return select(2.0 * backdrop * source, 1.0 - 2.0 * (1.0 - backdrop) * (1.0 - source), backdrop > 0.5); }
  if (mode == 4u) {
    if (source <= 0.5) { return backdrop - (1.0 - 2.0 * source) * backdrop * (1.0 - backdrop); }
    let curve = select(((16.0 * backdrop - 12.0) * backdrop + 4.0) * backdrop, sqrt(max(0.0, backdrop)), backdrop > 0.25);
    return backdrop + (2.0 * source - 1.0) * (curve - backdrop);
  }
  return source;
}
fn composite(backdrop: vec4f, source: vec4f, mode: u32) -> vec4f {
  let outputAlpha = source.a + backdrop.a * (1.0 - source.a);
  let b = select(vec3f(0.0), backdrop.rgb / backdrop.a, backdrop.a > 0.0);
  let s = select(vec3f(0.0), source.rgb / source.a, source.a > 0.0);
  let blended = vec3f(blendChannel(b.r, s.r, mode), blendChannel(b.g, s.g, mode), blendChannel(b.b, s.b, mode));
  let rgb = (1.0 - source.a) * backdrop.rgb + (1.0 - backdrop.a) * source.rgb + backdrop.a * source.a * blended;
  return vec4f(rgb, outputAlpha);
}
@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(positions[vi], 0.0, 1.0);
}
@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let inverse = params.inverseLinear;
  let point = vec2f(inverse.x * position.x + inverse.z * position.y + params.inverseTranslation.x,
                    inverse.y * position.x + inverse.w * position.y + params.inverseTranslation.y) - vec2f(0.5);
  let amount = params.options.x * bilinearMask(point);
  let source = bilinearColor(contentTexture, point) * amount;
  let backdrop = textureLoad(backdropTexture, vec2i(position.xy), 0);
  return composite(backdrop, source, u32(params.options.y));
}
