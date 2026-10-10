/** 两个 pass：每个色块只求一次平均，再展开，工作量随输入像素线性增长。 */
const header = `
struct Params { origin: vec2f, firstBlock: vec2f, fullSize: vec2f, blockSize: f32, padding: f32 }
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var source: texture_2d<f32>;
`
export const MOSAIC_AVERAGE_WGSL = header + `
@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let block = i32(params.blockSize);
  let start = (vec2i(position.xy) + vec2i(params.firstBlock)) * block;
  let lower = max(start, vec2i(0));
  let upper = min(start + vec2i(block), vec2i(params.fullSize));
  var sum = vec4f(0); var count = 0.0;
  let size = vec2i(textureDimensions(source));
  for(var y = lower.y; y < upper.y; y += 1) {
    for(var x = lower.x; x < upper.x; x += 1) {
      let local = vec2i(x,y) - vec2i(params.origin);
      if(all(local >= vec2i(0)) && all(local < size)) { sum += textureLoad(source, local, 0); count += 1.0; }
    }
  }
  return sum / max(count, 1.0);
}`
export const MOSAIC_EXPAND_WGSL = header + `
@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let global = floor(position.xy) + params.origin;
  if(any(global < vec2f(0)) || any(global >= params.fullSize)) { return vec4f(0); }
  let cell = vec2i(floor(global / params.blockSize) - params.firstBlock);
  return textureLoad(source, cell, 0);
}`
