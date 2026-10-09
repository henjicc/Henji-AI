/** 两宿主只提供 ABI 与域转换；取样、预乘、边界、核数学只有这一个源码。 */
export const GAUSSIAN_WGSL = `
fn gaussianLoad(image: texture_2d<f32>, position: vec2i, size: vec2i, repeatEdges: bool, origin: vec2i) -> vec4f {
 var p = position;
 if (any(p < vec2i(0)) || any(p >= size)) {
  if (!repeatEdges) { return vec4f(0.0); }
  p = clamp(p, vec2i(0), size - 1);
 }
 let color = textureLoad(image, p - origin, 0);
 if (color.a == 0.0) { return vec4f(0.0); }
 return color;
}
fn gaussianSample(image: texture_2d<f32>, position: vec2f, size: vec2i, repeatEdges: bool, origin: vec2i) -> vec4f {
 let base = vec2i(floor(position)); let weight = fract(position);
 let top = mix(gaussianLoad(image, base, size, repeatEdges, origin), gaussianLoad(image, base + vec2i(1, 0), size, repeatEdges, origin), weight.x);
 let bottom = mix(gaussianLoad(image, base + vec2i(0, 1), size, repeatEdges, origin), gaussianLoad(image, base + vec2i(1), size, repeatEdges, origin), weight.x);
 return mix(top, bottom, weight.y);
}
fn gaussianConvolve(image: texture_2d<f32>, position: vec2f, direction: vec2f, sigma: f32, radius: i32, size: vec2i, repeatEdges: bool, origin: vec2i) -> vec4f {
 var sum = vec4f(0.0); var total = 0.0;
 for (var i = -radius; i <= radius; i++) {
  let distance = f32(i); let weight = exp(-0.5 * distance * distance / max(sigma * sigma, 0.000001));
  sum += gaussianSample(image, position + direction * distance, size, repeatEdges, origin) * weight; total += weight;
 }
 return sum / total;
}
`
