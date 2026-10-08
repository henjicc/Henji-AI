import { planColorGrade, isNeutralAdjustmentPlan } from '../../../imaging/adjustments/plan'
import { imageColorGradeRuntimeParams } from '../../../imaging/adjustments/schema'
import { executeColorGradeCpuPlan, type AdjustmentCoordinates } from '../../../imaging/effects/cpu/colorGrade'
import type { CubeLut } from '../../../imaging/lut/cube'
import { convertFloat32TileColorDomainV3, convertFloat32TileColorContractV3 } from '../execution/tileColor'
import { createFloat32PremultipliedRgbaTile, mixProcessedWithMask, type Float32PremultipliedRgbaTile, type Float32MaskTile } from './contracts'

export function assertImageColorGradeLutDomain(tile: Pick<Float32PremultipliedRgbaTile, 'workingSpace' | 'transferFunction'>, params: Readonly<Record<string, unknown>>): void {
  if ((params.input_lut || params.look_lut) && (tile.workingSpace !== 'srgb' || tile.transferFunction !== 'srgb')) throw new Error('颜色查找表当前适用于标准 sRGB 图片，请先转换图片色彩模式')
}
export async function applyImageColorGradeV3(source: Float32PremultipliedRgbaTile, value: unknown, mask?: Float32MaskTile, loadLut?: (ref: string) => Promise<CubeLut>, coordinates?: AdjustmentCoordinates): Promise<Float32PremultipliedRgbaTile> {
  const params = imageColorGradeRuntimeParams(value)
  assertImageColorGradeLutDomain(source, params)
  const plan = planColorGrade(params, source.width, source.height, coordinates?.size)
  if (isNeutralAdjustmentPlan(plan)) return convertFloat32TileColorDomainV3(source, 'linear-light')
  const luts = new Map<string, CubeLut>()
  for (const key of ['input_lut', 'look_lut']) {
    const ref = params[key]
    if (typeof ref === 'string' && ref) {
      if (!loadLut) throw new Error('颜色查找表资源读取不可用')
      luts.set(ref, await loadLut(ref))
    }
  }
  const encoded = convertFloat32TileColorContractV3(source, { ...source, workingSpace: 'srgb', transferFunction: 'srgb', colorDomain: 'perceptual-working' })
  const pixels = executeColorGradeCpuPlan(plan, encoded, luts, coordinates)
  const processed = convertFloat32TileColorContractV3(createFloat32PremultipliedRgbaTile(pixels.width, pixels.height, 'perceptual-working', pixels.data, 'srgb', 'srgb', source.referenceWhiteNits), { ...source, colorDomain: 'linear-light' })
  return mixProcessedWithMask(convertFloat32TileColorDomainV3(source, 'linear-light'), processed, mask)
}
