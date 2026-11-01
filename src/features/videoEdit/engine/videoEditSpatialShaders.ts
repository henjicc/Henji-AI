/** 材料面顶点保持完整齐次坐标；裁剪和透视正确插值交给光栅器。 */
export const VIDEO_EDIT_SPATIAL_LAYER_SHADER = `
struct Params { clipFromUv: mat4x4f, options: vec4f }
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var imageSampler: sampler;
@group(0) @binding(2) var<uniform> p: Params;
@vertex fn vs(@builtin(vertex_index) i: u32) -> Vertex {
  let uv = array<vec2f, 6>(vec2f(0,0),vec2f(0,1),vec2f(1,0),vec2f(1,0),vec2f(0,1),vec2f(1,1))[i];
  return Vertex(p.clipFromUv * vec4f(uv, 0, 1), uv);
}
@fragment fn fs(v: Vertex) -> @location(0) vec4f {
  let color = textureSample(image, imageSampler, v.uv);
  let rgb = select(clamp(color.rgb, vec3f(0), vec3f(color.a)), max(color.rgb, vec3f(0)), p.options.z == 1);
  return vec4f(rgb, color.a) * p.options.x * p.options.y;
}
`
