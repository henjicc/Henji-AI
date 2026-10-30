/**
 * 色差的工序与 WGSL（剪辑内置效果 ABI）。一道工序：沿错开方向取若干点，每个颜色通道按自己的偏移位置加权。
 * 既作为独立效果作用在画面上，也被发光包含、只作用在光晕上（光是线性光、可以超过 1，不按透明度截断）。
 */
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'

export const CHROMATIC_ENTRIES = ['chromatic'] as const
type V4 = [number, number, number, number]
/** 数量 100 时最大错开距离占画面高度的比例。 */
const MAX_OFFSET = 0.02
/**
 * 每个通道取样的中心位置（-1..1，沿偏移方向）。在里侧取样，这个颜色的图像就往外移：
 * 所以“前一种往外”的通道取 -1，“后一种往里”的取 1，第三种不动取 0。
 */
const CENTERS: Readonly<Record<string, readonly [number, number, number]>> = { red_blue: [-1, 0, 1], red_green: [-1, 1, 0], green_blue: [0, -1, 1] }

/**
 * 色差这道工序的参数；数量为 0 时返回 undefined（不加工序）。`width`/`height` 是整幅画面的尺寸，
 * 偏移按 uv 给出，所以在半分辨率的光晕上调用时错开的距离与画面上一致。`light` 为真时输入是线性光。
 */
export function chromaticAberrationPass(params: VideoEditBuiltinParams, width: number, height: number, light: boolean): { entry: typeof CHROMATIC_ENTRIES[number]; a: V4; b: V4; c: V4 } | undefined {
  const amount = typeof params.amount === 'number' ? params.amount / 100 : 0
  if (amount <= 0) return undefined
  const offset = amount * MAX_OFFSET * height
  const radial = params.mode !== 'directional'
  const angle = (typeof params.angle === 'number' ? params.angle : 0) * Math.PI / 180
  const smoothness = typeof params.smoothness === 'number' ? params.smoothness / 100 : 0.5
  const centers = CENTERS[String(params.channels)] ?? CENTERS.red_blue
  const step: [number, number] = radial ? [offset / width, offset / height] : [Math.cos(angle) * offset / width, Math.sin(angle) * offset / height]
  return {
    entry: 'chromatic',
    a: [step[0], step[1], radial ? 1 : 0, smoothness > 0 ? 9 : 3],
    b: [centers[0], centers[1], centers[2], light ? 1 : 0],
    c: [0.08 + smoothness * 0.9, 0, 0, 0],
  }
}

export const CHROMATIC_WGSL = `
// a = (每单位偏移 u, v, 从中心向外, 取样数)，b.rgb = 各通道取样中心（-1..1），b.w = 输入是线性光，c.x = 通道取样的宽度。
// 柔和度 0 时只取 -1、0、1 三点，三种颜色硬分开；越柔和，每个通道在越宽的一段上加权平均，彩边连成彩虹色带。
@fragment fn chromatic(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let n = i32(u.a.w);
 let offset = select(u.a.xy, (uv - 0.5) * 2.0 * u.a.xy, u.a.z > 0.5);
 var sum = vec3f(0.0); var weight = vec3f(0.0); var cover = vec3f(0.0);
 for (var i = 0; i < n; i++) {
  let s = -1.0 + 2.0 * f32(i) / f32(n - 1);
  let c = tap(uv + offset * s);
  let d = (vec3f(s) - u.b.rgb) / u.c.x; let w = exp(-d * d);
  sum += c.rgb * w; cover += vec3f(c.a) * w; weight += w;
 }
 let rgb = sum / weight;
 if (u.b.w > 0.5) { return vec4f(rgb, 1.0); }
 // 错开后三个通道各有各的遮挡，只能用一个透明度近似：取三者平均，但不低于颜色本身，
 // 只落了一个通道的彩边保持原来的亮度，其余通道空着的地方不会变成一条黑边。
 let cover3 = cover / weight;
 let alpha = clamp(max((cover3.r + cover3.g + cover3.b) / 3.0, max(rgb.r, max(rgb.g, rgb.b))), 0.0, 1.0);
 return vec4f(min(rgb, vec3f(alpha)), alpha);
}
`
