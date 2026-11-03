import type * as Three from 'three'
import type { VideoEditSpaceEnvironment } from '@/core/videoEdit/document'

/**
 * 序列三维环境的程序化预设：等距柱状的线性 HDR 图，确定、无外部文件。玻璃、金属反射出来的是连续的明暗渐变，
 * 而不是一块块色块；亮度与位置按摄影棚常见布光取。实时（PMREM）与路径追踪（按亮度重要性采样）读同一张图。
 *
 * 坐标与 three（及追踪器）的等距柱状约定一致：u = atan2(z, x)/2π + 0.5，于是 u 0 在画面左（−X）、0.25 在主体身后（−Z）、
 * 0.5 在画面右（+X）、0.75 在相机身后（+Z，相机默认在 +Z 看向 −Z）。下面每盏灯的 v 以 0 为天顶、1 为地底书写，
 * 存放时第 0 行是地底（three 按 v = 0 取正下方，DataTexture 不翻转）。每盏灯是一块按高斯衰减的柔光面。
 */
interface Light { u: number; v: number; w: number; h: number; color: readonly [number, number, number] }
interface Preset { sky: (v: number) => readonly [number, number, number]; lights: readonly Light[] }

const WIDTH = 1024, HEIGHT = 512

const dark = (top: number, bottom: number, tint: readonly [number, number, number] = [1, 1, 1]) => (v: number): readonly [number, number, number] => {
  const value = top + (bottom - top) * v
  return [value * tint[0], value * tint[1], value * tint[2]]
}

/** 水平方向（x 向右、z 向相机）在等距柱状图上的 u。 */
const azimuth = (x: number, z: number): number => Math.atan2(z, x) / (2 * Math.PI) + .5

/** 摄影棚：相机这一侧上方一块大柔光（主光）、左右偏前两条细长条灯（玻璃、金属边缘的亮线）、地面一点反光。 */
function studio(tint: readonly [number, number, number], strip: readonly [number, number, number]): Preset {
  return {
    sky: dark(.03, .006, tint),
    lights: [
      { u: azimuth(0, 1), v: .12, w: .3, h: .07, color: [4.5 * tint[0], 4.5 * tint[1], 4.5 * tint[2]] },
      { u: azimuth(-1, .3), v: .46, w: .018, h: .3, color: [3.2 * strip[0], 3.2 * strip[1], 3.2 * strip[2]] },
      { u: azimuth(1, .3), v: .46, w: .018, h: .3, color: [3.2 * strip[0], 3.2 * strip[1], 3.2 * strip[2]] },
      { u: azimuth(0, 1), v: .86, w: .5, h: .08, color: [.12 * tint[0], .12 * tint[1], .12 * tint[2]] },
    ],
  }
}

const PRESETS: Record<Exclude<VideoEditSpaceEnvironment, 'none'>, Preset> = {
  studioNeutral: studio([1, 1, 1], [1, 1, 1]),
  studioWarm: studio([1, .86, .7], [1, .78, .55]),
  studioCool: studio([.78, .88, 1], [.7, .85, 1]),
  // 黑棚轮廓光：几乎全黑，只有身后两侧的强条灯勾出边缘，正面不打光。
  rim: {
    sky: dark(.004, .002),
    lights: [
      { u: azimuth(-1, -.6), v: .45, w: .02, h: .32, color: [7, 7, 7.5] },
      { u: azimuth(1, -.6), v: .45, w: .02, h: .32, color: [7, 7, 7.5] },
      { u: azimuth(0, -1), v: .08, w: .2, h: .05, color: [1.2, 1.2, 1.3] },
    ],
  },
  // 天光：天顶蓝、地平线偏白、地面暗褐，一个柔和的太阳。
  sky: {
    sky: v => v < .5
      ? [.35 + (.9 - .35) * (v / .5), .55 + (.95 - .55) * (v / .5), 1.1 + (1 - 1.1) * (v / .5)]
      : [.12 * (1 - (v - .5)), .1 * (1 - (v - .5)), .08 * (1 - (v - .5))],
    // 太阳在左前上方。
    lights: [{ u: azimuth(-.7, .7), v: .22, w: .012, h: .024, color: [60, 56, 48] }, { u: azimuth(-.7, .7), v: .22, w: .06, h: .1, color: [1.5, 1.4, 1.2] }],
  },
}

function pixels(preset: Preset): Float32Array {
  const data = new Float32Array(WIDTH * HEIGHT * 4)
  for (let y = 0; y < HEIGHT; y++) {
    const v = 1 - (y + .5) / HEIGHT, base = preset.sky(v)
    for (let x = 0; x < WIDTH; x++) {
      const u = (x + .5) / WIDTH, index = (y * WIDTH + x) * 4
      let r = base[0], g = base[1], b = base[2]
      for (const light of preset.lights) {
        const du = Math.min(Math.abs(u - light.u), 1 - Math.abs(u - light.u)) / light.w, dv = Math.abs(v - light.v) / light.h
        const k = Math.exp(-(du * du + dv * dv) * 2)
        r += light.color[0] * k; g += light.color[1] * k; b += light.color[2] * k
      }
      data[index] = r; data[index + 1] = g; data[index + 2] = b; data[index + 3] = 1
    }
  }
  return data
}

type Library = typeof Three
const cache = new WeakMap<Library, Map<VideoEditSpaceEnvironment, Three.DataTexture>>()

/** 预设环境图（半精度，可过滤采样）；同一份 three 库按预设缓存，一个 Worker 只生成一次。 */
export function videoEditSpaceEnvironment(library: Library, preset: VideoEditSpaceEnvironment): Three.DataTexture | null {
  if (preset === 'none') return null
  let textures = cache.get(library)
  if (!textures) { textures = new Map(); cache.set(library, textures) }
  let texture = textures.get(preset)
  if (!texture) {
    const source = pixels(PRESETS[preset]), half = new Uint16Array(source.length)
    for (let index = 0; index < source.length; index++) half[index] = library.DataUtils.toHalfFloat(source[index])
    texture = new library.DataTexture(half, WIDTH, HEIGHT, library.RGBAFormat, library.HalfFloatType)
    texture.mapping = library.EquirectangularReflectionMapping
    texture.colorSpace = library.LinearSRGBColorSpace
    texture.magFilter = texture.minFilter = library.LinearFilter
    texture.needsUpdate = true
    textures.set(preset, texture)
  }
  return texture
}
