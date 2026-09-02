import {
  reconstructVirtualRadiance,
  resolveEmissionPeak,
  resolveSoftChannelPeak,
  type VgpuGlowRecipe,
} from '../../vgpuGlowRecipe'
import {
  assertFloat32PremultipliedRgbaTile,
  createFloat32PremultipliedRgbaTile,
  mixProcessedWithMask,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
} from './contracts'

const WHITE_HEAT_START = 0.78
const WHITE_HEAT_END = 0.995

interface FloatRgbaSurface {
  width: number
  height: number
  data: Float32Array
}

export interface VgpuGlowGlobalScatterV4 {
  readonly tile: Float32PremultipliedRgbaTile
  readonly documentWidth: number
  readonly documentHeight: number
  readonly sourceX: number
  readonly sourceY: number
  readonly sourceWidth: number
  readonly sourceHeight: number
}

export interface ApplyVgpuGlowV4Options {
  readonly mask?: Float32MaskTile
  readonly globalScatter?: VgpuGlowGlobalScatterV4
  readonly dither?: boolean
}

const DOWNSAMPLE_TAPS = [
  [-2, -2, 0.03125], [0, -2, 0.0625], [2, -2, 0.03125],
  [-2, 0, 0.0625], [0, 0, 0.125], [2, 0, 0.0625],
  [-2, 2, 0.03125], [0, 2, 0.0625], [2, 2, 0.03125],
  [-1, -1, 0.125], [1, -1, 0.125], [-1, 1, 0.125], [1, 1, 0.125],
] as const

const TENT_TAPS = [
  [-1, -1, 0.0625], [0, -1, 0.125], [1, -1, 0.0625],
  [-1, 0, 0.125], [0, 0, 0.25], [1, 0, 0.125],
  [-1, 1, 0.0625], [0, 1, 0.125], [1, 1, 0.0625],
] as const

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function smootherstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / Math.max(edge1 - edge0, 0.000001))
  return amount * amount * amount * (amount * (amount * 6 - 15) + 10)
}

function linearToSrgb(value: number): number {
  const safe = Math.max(0, value)
  return safe <= 0.0031308 ? safe * 12.92 : 1.055 * (safe ** (1 / 2.4)) - 0.055
}

function srgbToLinear(value: number): number {
  const safe = Math.max(0, value)
  return safe <= 0.04045 ? safe / 12.92 : ((safe + 0.055) / 1.055) ** 2.4
}

function sampleBilinear(
  surface: FloatRgbaSurface,
  pixelX: number,
  pixelY: number,
  channel: number,
  zeroOutside = false,
): number {
  if (zeroOutside && (pixelX < -0.5 || pixelY < -0.5
    || pixelX > surface.width - 0.5 || pixelY > surface.height - 0.5)) return 0
  const x = clamp(pixelX, 0, surface.width - 1)
  const y = clamp(pixelY, 0, surface.height - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(surface.width - 1, x0 + 1)
  const y1 = Math.min(surface.height - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const top = surface.data[(y0 * surface.width + x0) * 4 + channel] * (1 - fx)
    + surface.data[(y0 * surface.width + x1) * 4 + channel] * fx
  const bottom = surface.data[(y1 * surface.width + x0) * 4 + channel] * (1 - fx)
    + surface.data[(y1 * surface.width + x1) * 4 + channel] * fx
  return top * (1 - fy) + bottom * fy
}

function extractEmitters(
  source: Float32PremultipliedRgbaTile,
  recipe: VgpuGlowRecipe,
): FloatRgbaSurface {
  const data = new Float32Array(source.data.length)
  for (let offset = 0; offset < source.data.length; offset += 4) {
    const alpha = clamp(source.data[offset + 3])
    if (alpha <= 0.000001) continue
    const linear = [
      source.data[offset] / alpha,
      source.data[offset + 1] / alpha,
      source.data[offset + 2] / alpha,
    ] as const
    const display = linear.map((value) => clamp(linearToSrgb(value))) as [number, number, number]
    const channelPeak = resolveSoftChannelPeak(display)
    const displayPeak = resolveEmissionPeak(display)
    if (channelPeak <= 0.000001 || displayPeak <= 0.000001) continue
    const confidence = smootherstep(
      recipe.sourceThresholdDisplay - recipe.sourceKneeDisplay,
      recipe.sourceThresholdDisplay + recipe.sourceKneeDisplay,
      displayPeak,
    )
    const radiance = reconstructVirtualRadiance(
      displayPeak,
      recipe.sourceThresholdDisplay,
      recipe.sourceKneeDisplay,
      recipe.sourceMaximumRadiance,
    ) * confidence * recipe.sourceGain
    const reference = Math.max(srgbToLinear(channelPeak), 0.000001)
    const tintPeak = Math.max(...recipe.tintLinear, 0.000001)
    for (let channel = 0; channel < 3; channel += 1) {
      const sourceDirection = linear[channel] / reference
      const tintDirection = recipe.tintLinear[channel] / tintPeak
      const direction = recipe.tintEnabled ? tintDirection : sourceDirection
      data[offset + channel] = direction * radiance * alpha
    }
    const heat = smootherstep(WHITE_HEAT_START, WHITE_HEAT_END, channelPeak) ** 1.4
    data[offset + 3] = Math.max(data[offset], data[offset + 1], data[offset + 2])
      * heat * clamp(recipe.whiteHeat)
  }
  return { width: source.width, height: source.height, data }
}

function downsample13(source: FloatRgbaSurface, width: number, height: number): FloatRgbaSurface {
  const data = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const centerX = (x + 0.5) * 2 - 0.5
      const centerY = (y + 0.5) * 2 - 0.5
      const target = (y * width + x) * 4
      for (const [dx, dy, weight] of DOWNSAMPLE_TAPS) {
        for (let channel = 0; channel < 4; channel += 1) {
          data[target + channel] += sampleBilinear(
            source, centerX + dx, centerY + dy, channel, true,
          ) * weight
        }
      }
    }
  }
  return { width, height, data }
}

function upsampleAccumulation(
  high: FloatRgbaSurface,
  low: FloatRgbaSurface,
  highWeight: readonly [number, number, number, number],
  lowWeight: readonly [number, number, number, number],
): FloatRgbaSurface {
  const data = new Float32Array(high.data.length)
  for (let y = 0; y < high.height; y += 1) {
    for (let x = 0; x < high.width; x += 1) {
      const lowX = (x + 0.5) / 2 - 0.5
      const lowY = (y + 0.5) / 2 - 0.5
      const target = (y * high.width + x) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        let sampled = 0
        for (const [dx, dy, weight] of TENT_TAPS) {
          sampled += sampleBilinear(low, lowX + dx, lowY + dy, channel, true) * weight
        }
        data[target + channel] = high.data[target + channel] * highWeight[channel]
          + sampled * lowWeight[channel]
      }
    }
  }
  return { width: high.width, height: high.height, data }
}

export function buildVgpuGlowScatterV4(
  source: Float32PremultipliedRgbaTile,
  recipe: VgpuGlowRecipe,
): Float32PremultipliedRgbaTile {
  assertFloat32PremultipliedRgbaTile(source, 'linear-light')
  const levels: FloatRgbaSurface[] = []
  let current = extractEmitters(source, recipe)
  for (const level of recipe.scatterLevels) {
    current = downsample13(
      current,
      Math.max(1, Math.ceil(source.width / level.divisor)),
      Math.max(1, Math.ceil(source.height / level.divisor)),
    )
    levels.push(current)
  }
  let accumulated = levels[levels.length - 1]
  if (!accumulated) throw new Error('辉光 Pro 配方缺少散射层')
  for (let index = levels.length - 2; index >= 0; index -= 1) {
    const high = levels[index]
    const highLevel = recipe.scatterLevels[index]
    const lowLevel = recipe.scatterLevels[index + 1]
    if (!high || !highLevel || !lowLevel) throw new Error('辉光 Pro 散射层不完整')
    accumulated = upsampleAccumulation(
      high,
      accumulated,
      [...highLevel.weight, highLevel.whiteCoreWeight],
      index === levels.length - 2
        ? [...lowLevel.weight, lowLevel.whiteCoreWeight]
        : [1, 1, 1, 1],
    )
  }
  return createFloat32PremultipliedRgbaTile(
    accumulated.width,
    accumulated.height,
    'linear-light',
    accumulated.data,
    source.workingSpace,
    source.transferFunction,
    source.referenceWhiteNits,
  )
}

function sampleScatter(
  scatter: FloatRgbaSurface,
  source: Float32PremultipliedRgbaTile,
  x: number,
  y: number,
  channel: number,
  global: VgpuGlowGlobalScatterV4 | undefined,
  shiftX = 0,
  shiftY = 0,
): number {
  const documentWidth = global?.documentWidth ?? source.width
  const documentHeight = global?.documentHeight ?? source.height
  const documentX = global
    ? global.sourceX + (x + 0.5) * global.sourceWidth / source.width + shiftX
    : x + 0.5 + shiftX
  const documentY = global
    ? global.sourceY + (y + 0.5) * global.sourceHeight / source.height + shiftY
    : y + 0.5 + shiftY
  return sampleBilinear(
    scatter,
    documentX * scatter.width / documentWidth - 0.5,
    documentY * scatter.height / documentHeight - 0.5,
    channel,
    true,
  )
}

function hash12(x: number, y: number): number {
  const fract = (value: number): number => value - Math.floor(value)
  let px = fract(x * 0.1031)
  let py = fract(y * 0.1031)
  let pz = fract(x * 0.1031)
  const dot = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33)
  px += dot
  py += dot
  pz += dot
  return fract((px + py) * pz)
}

function sampleChromaticScatter(
  scatter: FloatRgbaSurface,
  source: Float32PremultipliedRgbaTile,
  x: number,
  y: number,
  channel: number,
  global: VgpuGlowGlobalScatterV4 | undefined,
  shift: number,
  softness: number,
): number {
  return (
    sampleScatter(scatter, source, x, y, channel, global, shift - softness, -softness)
    + sampleScatter(scatter, source, x, y, channel, global, shift + softness, -softness)
    + sampleScatter(scatter, source, x, y, channel, global, shift - softness, softness)
    + sampleScatter(scatter, source, x, y, channel, global, shift + softness, softness)
  ) * 0.25
}

function composeGlowChannel(
  base: number,
  glow: number,
  glowAlpha: number,
  baseAlpha: number,
): number {
  const glowStraight = clamp(glow / Math.max(glowAlpha, 0.000001))
  const screened = base + glowStraight - base * glowStraight
  return glowStraight * glowAlpha * (1 - baseAlpha)
    + screened * glowAlpha * baseAlpha
    + base * baseAlpha * (1 - glowAlpha)
}

export function applyVgpuGlowV4(
  source: Float32PremultipliedRgbaTile,
  recipe: VgpuGlowRecipe,
  options: ApplyVgpuGlowV4Options = {},
): Float32PremultipliedRgbaTile {
  assertFloat32PremultipliedRgbaTile(source, 'linear-light')
  const scatterTile = options.globalScatter?.tile ?? buildVgpuGlowScatterV4(source, recipe)
  const scatter: FloatRgbaSurface = scatterTile
  const output = new Float32Array(source.data.length)
  const [leftChannel, rightChannel] = recipe.chromaticChannelIndices
  const responseScale = recipe.intensity * recipe.responseExposure
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4
      const centered0 = Math.max(0, sampleScatter(
        scatter, source, x, y, 0, options.globalScatter,
      ))
      const centered1 = Math.max(0, sampleScatter(
        scatter, source, x, y, 1, options.globalScatter,
      ))
      const centered2 = Math.max(0, sampleScatter(
        scatter, source, x, y, 2, options.globalScatter,
      ))
      let diffuse0 = centered0
      let diffuse1 = centered1
      let diffuse2 = centered2
      if (recipe.chromaticAberration > 0.0001) {
        const softness = 0.75 * recipe.chromaticAberration
        const left = Math.max(0, sampleChromaticScatter(
          scatter, source, x, y, leftChannel, options.globalScatter,
          recipe.chromaticOffsetPx, softness,
        ))
        const right = Math.max(0, sampleChromaticScatter(
          scatter, source, x, y, rightChannel, options.globalScatter,
          -recipe.chromaticOffsetPx, softness,
        ))
        if (leftChannel === 0) diffuse0 = left
        else if (leftChannel === 1) diffuse1 = left
        else diffuse2 = left
        if (rightChannel === 0) diffuse0 = right
        else if (rightChannel === 1) diffuse1 = right
        else diffuse2 = right
      }
      const centeredPeak = Math.max(centered0, centered1, centered2)
      const white = Math.max(0, sampleScatter(scatter, source, x, y, 3, options.globalScatter))
      const whiteBlend = clamp(white / Math.max(centeredPeak, 0.000001))
      const energy0 = Math.max(0, diffuse0 + (centeredPeak - centered0) * whiteBlend)
      const energy1 = Math.max(0, diffuse1 + (centeredPeak - centered1) * whiteBlend)
      const energy2 = Math.max(0, diffuse2 + (centeredPeak - centered2) * whiteBlend)
      const emitted0 = energy0 * responseScale
      const emitted1 = energy1 * responseScale
      const emitted2 = energy2 * responseScale
      const peak = Math.max(emitted0, emitted1, emitted2)
      let response = 1 - Math.exp(-peak)
      if (options.dither !== false) {
        const presence = smootherstep(0.001, 0.04, response)
        const ditherX = options.globalScatter
          ? options.globalScatter.sourceX
            + (x + 0.5) * options.globalScatter.sourceWidth / source.width
          : x
        const ditherY = options.globalScatter
          ? options.globalScatter.sourceY
            + (y + 0.5) * options.globalScatter.sourceHeight / source.height
          : y
        response = clamp(response + (hash12(ditherX, ditherY) - 0.5) * recipe.ditherAmount * presence)
      }
      const inversePeak = response / Math.max(peak, 0.000001)
      const glow0 = emitted0 * inversePeak
      const glow1 = emitted1 * inversePeak
      const glow2 = emitted2 * inversePeak
      const baseAlpha = clamp(source.data[offset + 3])
      const inverseBaseAlpha = baseAlpha > 0.000001 ? 1 / baseAlpha : 0
      const base0 = clamp(source.data[offset] * inverseBaseAlpha)
      const base1 = clamp(source.data[offset + 1] * inverseBaseAlpha)
      const base2 = clamp(source.data[offset + 2] * inverseBaseAlpha)
      const glowAlpha = clamp(Math.max(glow0, glow1, glow2))
      const outAlpha = glowAlpha + baseAlpha * (1 - glowAlpha)
      output[offset] = composeGlowChannel(base0, glow0, glowAlpha, baseAlpha)
      output[offset + 1] = composeGlowChannel(base1, glow1, glowAlpha, baseAlpha)
      output[offset + 2] = composeGlowChannel(base2, glow2, glowAlpha, baseAlpha)
      output[offset + 3] = outAlpha
    }
  }
  const processed = createFloat32PremultipliedRgbaTile(
    source.width,
    source.height,
    'linear-light',
    output,
    source.workingSpace,
    source.transferFunction,
    source.referenceWhiteNits,
  )
  return mixProcessedWithMask(source, processed, options.mask)
}
