import type { ImagingParam } from '@/core/imaging/parameterDefinition'
import { COLOR_GRADE_BASIC_PARAMS, COLOR_GRADE_CREATIVE_PARAMS, COLOR_GRADE_CURVE_PARAMS, COLOR_GRADE_HSL_PARAMS, COLOR_GRADE_LUT_PARAMS, COLOR_GRADE_MIXER_PARAMS, COLOR_GRADE_POINT_PARAMS, COLOR_GRADE_TONE_PARAMS, COLOR_GRADE_VIGNETTE_PARAMS, COLOR_GRADE_WHEEL_PARAMS } from '@/core/imaging/adjustments/colorGrade'

/** Parameters each section owns; reset and the modified state read the same list. */
export const COLOR_GRADE_SECTIONS = {
  basic: COLOR_GRADE_BASIC_PARAMS,
  curves: [...COLOR_GRADE_TONE_PARAMS, ...COLOR_GRADE_POINT_PARAMS, ...COLOR_GRADE_CURVE_PARAMS],
  mixer: COLOR_GRADE_MIXER_PARAMS,
  grading: COLOR_GRADE_WHEEL_PARAMS,
  creative: [...COLOR_GRADE_LUT_PARAMS, ...COLOR_GRADE_CREATIVE_PARAMS],
  secondary: COLOR_GRADE_HSL_PARAMS.filter(value => value.key !== 'hsl_show_mask'),
  vignette: COLOR_GRADE_VIGNETTE_PARAMS,
} as const
function isDefault(parameter: ImagingParam, value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (parameter.type === 'curve') return value === '' || Array.isArray(value) && value.length === 0
  return value === parameter.default
}
export function isColorGradeSectionModified(params: readonly ImagingParam[], values: Readonly<Record<string, unknown>>): boolean {
  return params.some(parameter => !isDefault(parameter, values[parameter.key]))
}
