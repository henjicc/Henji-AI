/** WGSL mirrors the neutral CPU kernel. Hosts only bind sampling, transforms and mode indices. */
export const COMPOSITING_WGSL = `
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
fn blendRgb(b: vec3f, s: vec3f, mode: u32) -> vec3f {
  return vec3f(blendChannel(b.r, s.r, mode), blendChannel(b.g, s.g, mode), blendChannel(b.b, s.b, mode));
}
fn compositeWithBlend(backdrop: vec4f, source: vec4f, blended: vec3f, clipped: bool) -> vec4f {
  let alpha = select(source.a + backdrop.a * (1.0 - source.a), backdrop.a, clipped);
  let rgb = (1.0 - source.a) * backdrop.rgb + select((1.0 - backdrop.a) * source.rgb, vec3f(0.0), clipped) + backdrop.a * source.a * blended;
  return vec4f(rgb, alpha);
}
`;
