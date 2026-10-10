import { z } from 'zod'
import type { EffectDescriptor, EffectEvaluationContext } from './descriptor'
import type { ImagingParam } from '../parameterDefinition'

export const MOSAIC_PARAMETERS: readonly ImagingParam[] = [{
  key: 'block_fraction_height', name: '色块大小', type: 'number', unit: 'fraction_height',
  min: 0, max: 1, step: 0.001, default: 0.02, animatable: true,
  tooltip: '色块边长占画面高度的比例',
  description: '马赛克色块的边长占完整画面高度的比例。0 保持原图；0.01 为细小色块，0.02 常规打码，0.05 为粗大色块。与选区、视口及瓦片大小无关。',
}]
export const mosaicParameterSchema = z.object({ block_fraction_height: z.number().finite().min(0).max(1).default(0.02).describe(MOSAIC_PARAMETERS[0].description) }).strict()
export type MosaicParameters = z.infer<typeof mosaicParameterSchema>
export interface MosaicRegion { x: number; y: number; width: number; height: number }
export interface MosaicPlan { blockSize: number; width: number; height: number }

export function resolveMosaicPlan(parameters: MosaicParameters, context: EffectEvaluationContext): MosaicPlan {
  const parsed = mosaicParameterSchema.parse(parameters)
  for (const size of [context.referenceSize, context.outputSize]) {
    if (![size.width, size.height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('马赛克需要完整画面尺寸')
  }
  return { blockSize: Math.max(1, Math.round(parsed.block_fraction_height * context.outputSize.height)), ...context.outputSize }
}

/** 区域必须读取完整色块，网格固定在完整输出画面的原点。 */
export function mosaicInputRegion(plan: MosaicPlan, output: MosaicRegion): MosaicRegion {
  const x = Math.max(0, Math.floor(output.x / plan.blockSize) * plan.blockSize)
  const y = Math.max(0, Math.floor(output.y / plan.blockSize) * plan.blockSize)
  return { x, y, width: Math.min(plan.width, Math.ceil((output.x + output.width) / plan.blockSize) * plan.blockSize) - x,
    height: Math.min(plan.height, Math.ceil((output.y + output.height) / plan.blockSize) * plan.blockSize) - y }
}

export const MOSAIC_EFFECT: EffectDescriptor<MosaicParameters, MosaicPlan> = {
  id: 'mosaic', name: '马赛克', aliases: ['像素化', '打码', 'Pixelate'], description: '把画面分成方块并取每块平均颜色，色块大小按完整画面高度计算。可通过蒙版限制在选区或画笔区域。',
  parameterSchema: mosaicParameterSchema, parameters: MOSAIC_PARAMETERS, inputs: 1,
  colorDomain: 'linear-light', workingSpaces: ['srgb', 'display-p3', 'rec2020'], alpha: 'premultiplied', boundary: ['clip'], temporal: 'none', hosts: ['image', 'video'],
  backends: [{ kind: 'cpu-reference', module: 'effects/cpu/mosaic' }, { kind: 'wgsl', module: 'effects/wgsl/mosaic' }],
  fixtures: ['odd-size', 'transparent-edge', 'halo-tile', 'zero-strength'], resolve: resolveMosaicPlan,
}
