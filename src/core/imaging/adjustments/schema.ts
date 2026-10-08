import type { ImagingParams } from '../parameterDefinition'
import { z } from 'zod'
import { COLOR_GRADE_BASIC_PARAMS, COLOR_GRADE_CREATIVE_PARAMS, COLOR_GRADE_POINT_PARAMS, COLOR_GRADE_CURVE_PARAMS, COLOR_GRADE_LUT_PARAMS, COLOR_GRADE_WHEEL_PARAMS, COLOR_GRADE_HSL_PARAMS, COLOR_GRADE_VIGNETTE_PARAMS } from './colorGrade'
import { parseColorGradeCurve } from './curves'

export const COLOR_GRADE_PARAMETERS = [...COLOR_GRADE_BASIC_PARAMS, ...COLOR_GRADE_CREATIVE_PARAMS, ...COLOR_GRADE_POINT_PARAMS, ...COLOR_GRADE_LUT_PARAMS, ...COLOR_GRADE_WHEEL_PARAMS, ...COLOR_GRADE_HSL_PARAMS, ...COLOR_GRADE_VIGNETTE_PARAMS]
const point = z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).strict()
const shape: Record<string, z.ZodType> = {}
for (const parameter of COLOR_GRADE_PARAMETERS) {
  if (parameter.key === 'hsl_show_mask') continue // Observation belongs to the image edit session.
  const schema: z.ZodType = parameter.type === 'number' ? z.number().min(parameter.min).max(parameter.max)
    : parameter.type === 'boolean' ? z.boolean()
      : parameter.type === 'curve' ? z.array(point)
        : z.string().regex(/^(?:sha256:[a-f0-9]{64})?$/, '需要已导入的颜色查找表资源引用')
  const fallback = parameter.type === 'curve' ? [] : parameter.default
  shape[parameter.key] = schema.default(fallback)
}

/** Structured curves, closed fields and stable LUT references for static image adjustments. */
export const imageColorGradeParamsSchema = z.object(shape).strict().superRefine((params, context) => {
  for (const parameter of COLOR_GRADE_POINT_PARAMS) {
    const points = params[parameter.key]
    if (!Array.isArray(points) || points.length === 0) continue
    try {
      const curve = parseColorGradeCurve(points)
      if (parameter.key.startsWith('curve_hue_') && curve[0].y !== curve[curve.length - 1].y) throw new Error('周期色相曲线两端 y 必须相等')
    } catch (error) {
      context.addIssue({ code: 'custom', path: [parameter.key], message: error instanceof Error ? error.message : String(error) })
    }
  }
  for (const channel of ['saturation', 'luminance']) {
    if (Number(params[`hsl_${channel}_start`]) > Number(params[`hsl_${channel}_end`])) context.addIssue({ code: 'custom', path: [`hsl_${channel}_end`], message: '终点必须大于等于起点' })
  }
})

export type ImageColorGradeParams = Record<string, number | boolean | string | { x: number; y: number }[]>
export function parseImageColorGradeParams(value: unknown): ImageColorGradeParams {
  return imageColorGradeParamsSchema.parse(value) as ImageColorGradeParams
}
export function imageColorGradeRuntimeParams(value: unknown, showMask = false): Record<string, unknown> {
  const observed = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const { hsl_show_mask: observation, ...persisted } = observed
  const params = parseImageColorGradeParams(persisted)
  showMask = showMask || observation === true
  const result: Record<string, unknown> = {}
  for (const parameter of [...COLOR_GRADE_PARAMETERS, ...COLOR_GRADE_CURVE_PARAMS]) {
    const value = params[parameter.key] ?? parameter.default
    result[parameter.key] = value
  }
  result.hsl_show_mask = showMask
  return result
}

export function colorGradeDefaults(): ImagingParams { return Object.fromEntries([...COLOR_GRADE_PARAMETERS, ...COLOR_GRADE_CURVE_PARAMS].map(parameter => [parameter.key, parameter.default])) }

/** Discovery metadata derives from the same formal schema; prose is not persisted in document data. */
export function imageColorGradeJsonSchema() {
  const schema = z.toJSONSchema(imageColorGradeParamsSchema, { io: 'input' })
  for (const parameter of COLOR_GRADE_PARAMETERS) {
    const property = schema.properties?.[parameter.key]
    if (property && typeof property === 'object') property.description = parameter.type === 'curve'
      ? '静态结构化控制点数组：x/y 为 0–100 百分比，x 严格递增；至少两点，空数组为中性。色相周期曲线两端 y 相等。'
      : parameter.type === 'lut' ? '已导入 .cube 查找表的 sha256 资源引用；空字符串关闭。仅适用于 sRGB 工作空间与 sRGB 传递函数，不接受本地路径或网络 URL。' : parameter.description
  }
  return schema
}
