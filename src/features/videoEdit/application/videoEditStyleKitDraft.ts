import { styleGuideProblems, type StyleKit } from '@/core/videoEdit/styleKit'

/** Plain-language completeness check before a draft is applied or saved; schema errors would read as field paths. */
export function styleKitDraftProblem(kit: StyleKit): string {
  const problems = styleGuideProblems(kit.guide)
  if (problems.length) return `说明书${problems.slice(0, 3).join('、')}${problems.length > 3 ? ' 等' : ''}。`
  if (kit.examples.some(example => !example.title.trim())) return '有示例还没有标题。'
  return ''
}
