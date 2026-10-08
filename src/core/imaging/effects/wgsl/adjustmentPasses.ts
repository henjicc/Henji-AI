import { COLOR_GRADE_WGSL } from './colorGrade'
export function adjustmentPassesWgsl({ extendedRange = false, globalCoordinates = false }: { extendedRange?: boolean; globalCoordinates?: boolean } = {}): string {
return `
${COLOR_GRADE_WGSL}
struct Params { size: vec4f, a: vec4f, b: vec4f, c: vec4f }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
@group(0) @binding(2) var<uniform> u: Params;
@group(0) @binding(3) var original: texture_2d<f32>;
@group(0) @binding(4) var colorLut: texture_3d<f32>;
@group(0) @binding(5) var gradeMask: texture_2d<f32>;
struct Vertex { @builtin(position) position: vec4f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Vertex {
 let p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3))[i];
 return Vertex(vec4f(p, 0, 1));
}
const LUMA = vec3f(0.2126, 0.7152, 0.0722);
fn uvOf(v: Vertex) -> vec2f { return v.position.xy / u.size.xy; }
fn tap(uv: vec2f) -> vec4f { return textureSampleLevel(source, s, uv, 0.0); }
fn tapOriginal(uv: vec2f) -> vec4f { return textureSampleLevel(original, s, uv, 0.0); }
fn colorGradeSelectionSaturation(chroma: f32, light: f32) -> f32 { let value = chroma / max(0.000001, 1.0 - abs(2.0 * light - 1.0)); return ${extendedRange ? 'clamp(value, 0.0, 1.0)' : 'value'}; }
fn colorGradePosition(v: Vertex) -> vec2f { return ${globalCoordinates ? 'u.b.zw + (v.position.x - 0.5) * u.c.xy + (v.position.y - 0.5) * u.c.zw' : 'uvOf(v)'}; }
fn inside(uv: vec2f) -> bool { return all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)); }
/** repeat = 0 时画面外是透明（边缘向外渐隐）。 */
fn tapEdge(uv: vec2f, repeat: f32) -> vec4f { if (repeat < 0.5 && !inside(uv)) { return vec4f(0.0); } return tap(uv); }
fn straight(c: vec4f) -> vec3f { if (c.a <= 0.00001) { return vec3f(0.0); } return c.rgb / c.a; }
fn premul(rgb: vec3f, a: f32) -> vec4f { return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)) * a, a); }
fn toLinear(c: vec3f) -> vec3f { let x = ${extendedRange ? 'abs(c)' : 'max(c, vec3f(0.0))'}; return ${extendedRange ? 'sign(c) * ' : ''}select(pow((x + 0.055) / 1.055, vec3f(2.4)), x / 12.92, x <= vec3f(0.04045)); }
fn toSrgb(c: vec3f) -> vec3f { let x = ${extendedRange ? 'abs(c)' : 'max(c, vec3f(0.0))'}; return ${extendedRange ? 'sign(c) * ' : ''}select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308)); }

/** 直接取样（目标是输入的一半时就是 2×2 平均的降采样，目标更大时是双线性放大）。 */
@fragment fn copy(v: Vertex) -> @location(0) vec4f { return tap(uvOf(v)); }

/** 一维高斯：a = (步长 u, 步长 v, sigma（输入像素）, 半径（取样数）)，b.x 重复边缘。 */
@fragment fn blur(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let n = i32(u.a.w); let k = -0.5 / max(u.a.z * u.a.z, 0.0001);
 var sum = vec4f(0.0); var weight = 0.0;
 for (var i = -n; i <= n; i++) {
  let w = exp(f32(i * i) * k);
  sum += tapEdge(uv + u.a.xy * f32(i), u.b.x) * w; weight += w;
 }
 return sum / weight;
}

/** 反锐化掩模：source 是模糊后的画面，original 是原画面；a.x 锐化量。 */
@fragment fn unsharp(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let o = tapOriginal(uv); let b = tap(uv);
 let rgb = o.rgb + (o.rgb - b.rgb) * u.a.x;
 return vec4f(${extendedRange ? 'rgb' : 'clamp(rgb, vec3f(0.0), vec3f(o.a))'}, o.a);
}

`
}
export const ADJUSTMENT_PASSES_WGSL = adjustmentPassesWgsl()
