import type { ParamDef, ParamPresentationGroup } from '@/core/types'
import { resolveParamPresentationSections, type ResolvedParamPresentationSection } from '@/core/params/paramPresentation'

/**
 * 参数组浮层的分节排布（重要记录 021：竖向局促，横向一行跨度不超过 720）。
 * 分节多、参数多时把分节分到左右两列，每列定宽 320（标签 96 + 间隔 12 + 控件 212），
 * 控件不再被拉成长条；分节顺序不变，只在两节之间断开。
 */
export const PARAM_GROUP_COLUMN_WIDTH = 320
export const PARAM_GROUP_COLUMN_GAP = 24
const TWO_COLUMN_MIN_PARAMS = 8

/** 上传与多行文本占的高度约等于两行普通参数 */
function paramWeight(param: ParamDef): number {
  return param.type === 'image-upload' || param.type === 'file-upload' || param.type === 'textarea' ? 2 : 1
}

function sectionWeight(section: ResolvedParamPresentationSection): number {
  return section.params.reduce((sum, param) => sum + paramWeight(param), 0)
}

/** 返回一列或两列分节；两列时在使两列高度最接近的位置断开 */
export function splitParamGroupSections(
  sections: readonly ResolvedParamPresentationSection[]
): ResolvedParamPresentationSection[][] {
  const total = sections.reduce((sum, section) => sum + section.params.length, 0)
  if (sections.length < 2 || total < TWO_COLUMN_MIN_PARAMS) return [[...sections]]
  const weights = sections.map(sectionWeight)
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
  let best = 1
  let bestHeight = Number.POSITIVE_INFINITY
  let left = 0
  for (let split = 1; split < sections.length; split += 1) {
    left += weights[split - 1]
    const height = Math.max(left, weightTotal - left)
    if (height < bestHeight) {
      bestHeight = height
      best = split
    }
  }
  return [sections.slice(0, best), sections.slice(best)]
}

/** 参数组浮层的正文宽：两列时由列宽算出，一列时取分组声明的宽度 */
export function resolveParamGroupBodyWidth(group: ParamPresentationGroup, params: ParamDef[]): number | undefined {
  const columns = splitParamGroupSections(resolveParamPresentationSections(group, params))
  return columns.length === 2 ? PARAM_GROUP_COLUMN_WIDTH * 2 + PARAM_GROUP_COLUMN_GAP : group.panelWidth
}
