/**
 * WGSL of the video edit compositor, shared by the compositor and its real-device precision test (task 2.7).
 * Every pass works in f32 inside the shader; precision is decided only by the texture formats it reads and writes.
 */

/** Layer geometry: 24 floats (96 bytes), including optional corner-pin homography. */
export const VIDEO_EDIT_LAYER_VERTEX = `
struct Params { size: vec2f, rotation: vec2f, position: vec2f, brightness: f32, opacity: f32, aspect: vec2f, padding: vec2f, warp0: vec4f, warp1: vec4f, warp2: vec4f }
@group(0) @binding(2) var<uniform> p: Params;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Vertex {
  let uv = array<vec2f, 6>(vec2f(0,0),vec2f(0,1),vec2f(1,0),vec2f(1,0),vec2f(0,1),vec2f(1,1))[i];
  let point = (uv * 2 - 1) * p.size;
  let rotated = vec2f(point.x * p.rotation.x - point.y * p.rotation.y * p.aspect.x,
                      point.x * p.rotation.y * p.aspect.y + point.y * p.rotation.x);
  var sampleUv = uv;
  if (p.padding.y == 1) { sampleUv.x = 1 - sampleUv.x; }
  if (p.padding.x == 90) { sampleUv = vec2f(sampleUv.y, 1 - sampleUv.x); }
  if (p.padding.x == 180) { sampleUv = 1 - sampleUv; }
  if (p.padding.x == 270) { sampleUv = vec2f(1 - sampleUv.y, sampleUv.x); }
  if (p.warp2.z == 1) {
    let unit = vec3f(uv, 1);
    let x = dot(p.warp0.xyz, unit); let y = dot(p.warp1.xyz, unit); let w = dot(p.warp2.xyz, unit);
    // Homogeneous position gives perspective-correct UV interpolation across both triangles.
    return Vertex(vec4f(2 * x - w, w - 2 * y, 0, w), sampleUv);
  }
  return Vertex(vec4f(rotated.x + p.position.x, -rotated.y - p.position.y, 0, 1), sampleUv);
}
@group(0) @binding(1) var s: sampler;
`

/** One RGBA layer: an external (decoder) texture or an owned/uploaded 2D texture, straight or premultiplied alpha. */
export function videoEditLayerShader(external: boolean, premultiplied = false): string {
  const sample = external ? 'textureSampleBaseClampToEdge(t, s, v.uv)' : 'textureSample(t, s, v.uv)'
  return VIDEO_EDIT_LAYER_VERTEX + `
@group(0) @binding(0) var t: ${external ? 'texture_external' : 'texture_2d<f32>'};
@fragment fn fs(v: Vertex) -> @location(0) vec4f {
 let c = ${sample}; let alpha = c.a * p.opacity;
 return vec4f(${premultiplied ? 'clamp(c.rgb * p.brightness, vec3f(0), vec3f(c.a)) * p.opacity' : 'clamp(c.rgb * p.brightness, vec3f(0), vec3f(1)) * alpha'}, alpha);
}`
}

/** A compact 8-bit 4:2:0 owned picture (full luma plane + half chroma plane, BT.709). */
export const VIDEO_EDIT_CACHED_YUV_SHADER = VIDEO_EDIT_LAYER_VERTEX + `
@group(0) @binding(0) var y: texture_2d<f32>;
@group(0) @binding(3) var uv: texture_2d<f32>;
@fragment fn fs(v: Vertex) -> @location(0) vec4f {
 let luma = textureSample(y, s, v.uv).r;
 let chroma = textureSample(uv, s, v.uv).rg - 0.5;
 let rgb = vec3f(luma + 1.5748 * chroma.y, luma - 0.187324 * chroma.x - 0.468124 * chroma.y, luma + 1.8556 * chroma.x);
 return vec4f(clamp(rgb * p.brightness, vec3f(0), vec3f(1)) * p.opacity, p.opacity);
}`

/** Snapshot copies of a decoder frame into owned memory; `rgba` writes either `rgba8unorm` or `rgba16float`. */
export const VIDEO_EDIT_COPY_SHADER = `
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Vertex {
 let uv = array<vec2f, 3>(vec2f(0,0), vec2f(0,2), vec2f(2,0))[i];
 return Vertex(vec4f(uv.x * 2 - 1, 1 - uv.y * 2, 0, 1), uv);
}
@group(0) @binding(0) var t: texture_external;
@fragment fn rgba(v: Vertex) -> @location(0) vec4f { return textureLoad(t, vec2u(v.position.xy)); }
@fragment fn y(v: Vertex) -> @location(0) vec4f {
 let c = textureLoad(t, vec2u(v.position.xy)).rgb;
 return vec4f(dot(c, vec3f(0.2126, 0.7152, 0.0722)), 0, 0, 1);
}
@fragment fn uv(v: Vertex) -> @location(0) vec4f {
 let point = vec2u(v.position.xy) * 2u;
 let edge = textureDimensions(t) - 1u;
 let c = (textureLoad(t, min(point, edge)).rgb + textureLoad(t, min(point + vec2u(1,0), edge)).rgb + textureLoad(t, min(point + vec2u(0,1), edge)).rgb + textureLoad(t, min(point + vec2u(1,1), edge)).rgb) * 0.25;
 let luma = dot(c, vec3f(0.2126, 0.7152, 0.0722));
 return vec4f((c.b - luma) / 1.8556 + 0.5, (c.r - luma) / 1.5748 + 0.5, 0, 1);
}
`

/**
 * The same three copies at a reduced playback resolution (task 4.9): each output pixel is the box average of the
 * `step`×`step` decoded pixels it covers (chroma: `2·step`), so every decoded pixel is read once, as in the full-size
 * copy, and the picture neither aliases nor shifts. Colour is averaged with premultiplied alpha. `step` 1 is never
 * used here: full resolution keeps `VIDEO_EDIT_COPY_SHADER` and its exact pixels. `source` `texture` reads an ordinary
 * 2D texture instead of a decoded frame; only the GPU tests use it, to check the averaging on known pixels.
 */
export function videoEditDownscaleCopyShader(step: 2 | 4 | 8, source: 'external' | 'texture' = 'external'): string {
  const external = source === 'external'
  return `
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Vertex {
 let uv = array<vec2f, 3>(vec2f(0,0), vec2f(0,2), vec2f(2,0))[i];
 return Vertex(vec4f(uv.x * 2 - 1, 1 - uv.y * 2, 0, 1), uv);
}
@group(0) @binding(0) var t: ${external ? 'texture_external' : 'texture_2d<f32>'};
const STEP: u32 = ${step}u;
fn box(origin: vec2u, size: u32) -> vec4f {
 let edge = textureDimensions(t) - 1u;
 var sum = vec4f(0);
 for (var y = 0u; y < size; y++) {
  for (var x = 0u; x < size; x++) {
   let c = textureLoad(t, min(origin + vec2u(x, y), edge)${external ? '' : ', 0'});
   sum += vec4f(c.rgb * c.a, c.a);
  }
 }
 let n = f32(size * size);
 return vec4f(select(vec3f(0), sum.rgb / max(sum.a, 0.000001), sum.a > 0.0), sum.a / n);
}
@fragment fn rgba(v: Vertex) -> @location(0) vec4f { return box(vec2u(v.position.xy) * STEP, STEP); }
@fragment fn y(v: Vertex) -> @location(0) vec4f {
 let c = box(vec2u(v.position.xy) * STEP, STEP).rgb;
 return vec4f(dot(c, vec3f(0.2126, 0.7152, 0.0722)), 0, 0, 1);
}
@fragment fn uv(v: Vertex) -> @location(0) vec4f {
 let c = box(vec2u(v.position.xy) * STEP * 2u, STEP * 2u).rgb;
 let luma = dot(c, vec3f(0.2126, 0.7152, 0.0722));
 return vec4f((c.b - luma) / 1.8556 + 0.5, (c.r - luma) / 1.5748 + 0.5, 0, 1);
}
`
}

/**
 * Quantizes the `rgba16float` composition to the 8-bit canvas.
 * - A value within 0.13 of an 8-bit step of a level is that level, written exactly: an 8-bit picture stored as half
 *   floats is off by at most one f16 ulp (0.125 of a step below 1.0; the render target conversion may truncate), so
 *   8-bit pictures in a high-precision frame keep their pixels.
 * - Any other value gets a fixed rectangular dither of ±0.5 step (interleaved gradient noise, Jimenez 2014) before
 *   rounding: smooth 10-bit gradients do not band and stay unbiased on average, and the pattern is identical in
 *   preview and export (no time term).
 */
export const VIDEO_EDIT_PRESENT_SHADER = `
struct Vertex { @builtin(position) position: vec4f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Vertex {
 let uv = array<vec2f, 3>(vec2f(0,0), vec2f(0,2), vec2f(2,0))[i];
 return Vertex(vec4f(uv.x * 2 - 1, 1 - uv.y * 2, 0, 1));
}
@group(0) @binding(0) var source: texture_2d<f32>;
@fragment fn fs(v: Vertex) -> @location(0) vec4f {
 let c = textureLoad(source, vec2u(v.position.xy), 0);
 let noise = fract(52.9829189 * fract(dot(floor(v.position.xy), vec2f(0.06711056, 0.00583715))));
 let steps = c.rgb * 255.0;
 let level = round(steps);
 let quantized = select(steps + (noise - 0.5), level, abs(steps - level) < vec3f(0.13));
 return vec4f(clamp(quantized / 255.0, vec3f(0), vec3f(c.a)), c.a);
}
`

const TEXTURE_COPY_SRC = 0x01
const BUFFER_MAP_READ = 0x01
const BUFFER_COPY_DST = 0x08
const MAP_MODE_READ = 0x01
interface ReadbackBuffer { mapAsync(mode: number): Promise<void>; getMappedRange(): ArrayBuffer; unmap(): void; destroy(): void }
interface ReadbackDevice {
  createBuffer(descriptor: { size: number; usage: number }): unknown
  createCommandEncoder(): { copyTextureToBuffer(source: unknown, destination: unknown, size: unknown): void; finish(): unknown }
  queue: { submit(commands: unknown[]): void }
}
/** Usage a `rgba16float` texture needs to be read back by `readVideoEditPreciseRow`. */
export const VIDEO_EDIT_READBACK_USAGE = TEXTURE_COPY_SRC

/**
 * Reads one row of an `rgba16float` texture as raw half floats (4 per pixel). Diagnostics and tests only: it is a
 * separate submission with a mapped buffer, never part of a presented frame.
 */
export async function readVideoEditPreciseRow(device: unknown, texture: unknown, width: number, y: number): Promise<Uint16Array> {
  const gpu = device as ReadbackDevice
  const bytesPerRow = Math.ceil(width * 8 / 256) * 256
  const buffer = gpu.createBuffer({ size: bytesPerRow, usage: BUFFER_MAP_READ | BUFFER_COPY_DST }) as ReadbackBuffer
  try {
    const encoder = gpu.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture, origin: { x: 0, y, z: 0 } }, { buffer, bytesPerRow }, { width, height: 1, depthOrArrayLayers: 1 })
    gpu.queue.submit([encoder.finish()])
    await buffer.mapAsync(MAP_MODE_READ)
    const row = new Uint16Array(buffer.getMappedRange().slice(0, width * 8))
    buffer.unmap()
    return row
  } finally { buffer.destroy() }
}

/** IEEE half float to number. */
export function videoEditHalfToFloat(half: number): number {
  const sign = half & 0x8000 ? -1 : 1; const exponent = (half >> 10) & 0x1f; const fraction = half & 0x3ff
  if (exponent === 0) return sign * fraction * 2 ** -24
  if (exponent === 31) return fraction ? NaN : sign * Infinity
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15)
}

/** Number of distinct values of one channel (0 red … 3 alpha) in interleaved RGBA pixels: the gradient level count. */
export function videoEditGradientLevels(pixels: ArrayLike<number>, channel = 0): number {
  const values = new Set<number>()
  for (let index = channel; index < pixels.length; index += 4) values.add(pixels[index])
  return values.size
}
