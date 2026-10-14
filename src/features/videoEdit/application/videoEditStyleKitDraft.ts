import type { StyleKit, StyleRule } from '@/core/videoEdit/styleKit'

export const RULE_KIND_LABELS: Record<StyleRule['kind'], string> = { do: '做', dont: '不做', keep: '统一', vary: '可变' }
export const STRENGTH_LABELS: Record<StyleRule['strength'], string> = { must: '必须', prefer: '倾向', flexible: '可破例' }
/** Plain-language completeness check before a draft is applied or saved; schema errors would read as field paths. */
export function styleKitDraftProblem(kit: StyleKit): string {
  for (const concept of kit.profile.concepts) {
    if (!concept.name.trim()) return '有概念还没有名称。'
    if (!concept.meaning.trim() || !concept.criteria.some(item => item.trim())) return `概念“${concept.name}”需要含义和至少一条判据。`
  }
  if (kit.rules.some(rule => !rule.text.trim())) return '有规则还没有内容。'
  return ''
}
/** Drop blank criteria lines the multi-line editor keeps while typing. */
export function normalizeStyleKitDraft(kit: StyleKit): StyleKit { return { ...kit, profile: { ...kit.profile, concepts: kit.profile.concepts.map(concept => ({ ...concept, criteria: concept.criteria.map(item => item.trim()).filter(Boolean) })) } } }
