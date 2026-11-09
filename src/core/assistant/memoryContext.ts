import { rankByKeywords } from '../search/keywordSearch'
import type { MemoryEntry, MemoryLayer } from './memoryEntries'

/**
 * 记忆进上下文的写法：每条一行正文，不带 id、修订号、理由等元数据（这些只占篇幅，模型用不上），
 * 每层按更新时间从新到旧排，矛盾时以靠前的为准。
 *
 * 记忆总量不设上限，所以不能整份注入。每层有自己的全列额度：项目与风格只管当前这一件事，额度给足，
 * 通常整层列出；全局最容易越积越多。超出额度的层只列常驻条目（结构化偏好、关于用户、定过冲突优先级的）
 * 和与本次请求最相关的若干条，其余给出条数与查法。召回按本次请求文本做本地关键词检索。
 */
export const INLINE_LAYER_CHARACTERS: Record<MemoryLayer, number> = { project: 2000, style: 1500, global: 2500 }
const RECALL_LIMIT = 15

const LAYER_TITLES: Record<MemoryLayer, string> = { global: '全局记忆', project: '项目记忆', style: '风格使用者偏好' }
export const MEMORY_ENTITY_TYPES: Record<MemoryLayer, string> = { global: 'assistant.memory', project: 'document.project_memory', style: 'video_edit.style_preference' }
const SECTION_TITLES: Record<string, string> = { about: '关于用户', creative: '创作偏好', habits: '工作习惯' }

type Layered = Partial<Record<MemoryLayer, readonly MemoryEntry[]>>

/** 结构化值是程序解析默认字体、音色、画幅的依据，正文未必写全，原样附在行尾。 */
function valueText(value: MemoryEntry['value']): string {
  if (!value) return ''
  const detail = 'fonts' in value ? value.fonts.join(' > ') : 'id' in value ? value.id : 'voiceId' in value ? `${value.providerId}/${value.voiceId}` : `${value.width}×${value.height}`
  return ` {${value.key}: ${detail}}`
}

function line(entry: MemoryEntry): string {
  return `- ${entry.section ? `[${SECTION_TITLES[entry.section] ?? entry.section}] ` : ''}${entry.content}${valueText(entry.value)}${entry.precedence ? `（冲突时听${entry.precedence === 'preference' ? '偏好' : '风格'}）` : ''}`
}

function isResident(entry: MemoryEntry): boolean {
  return entry.value !== undefined || entry.section === 'about' || entry.precedence !== undefined
}

const characters = (entries: readonly MemoryEntry[]): number => entries.reduce((sum, entry) => sum + entry.content.length, 0)

export function renderMemoryContext(layers: Layered, query: string): string {
  const order = (['project', 'style', 'global'] as const).filter(layer => layers[layer]?.length)
  if (!order.length) return '暂无记忆。'
  const sorted = Object.fromEntries(order.map(layer => [layer, [...layers[layer]!].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))])) as Record<MemoryLayer, MemoryEntry[]>
  const crowded = new Set(order.filter(layer => characters(sorted[layer]) > INLINE_LAYER_CHARACTERS[layer]))
  const candidates = order.filter(layer => crowded.has(layer)).flatMap(layer => sorted[layer].filter(entry => !isResident(entry)).map(entry => ({ layer, entry })))
  const recalled = new Set(rankByKeywords(candidates.map(({ entry }) => entry.content), query, RECALL_LIMIT).map(match => candidates[match.index].entry))

  const parts = order.map(layer => {
    const entries = sorted[layer]
    if (!crowded.has(layer)) return `${LAYER_TITLES[layer]}：\n${entries.map(line).join('\n')}`
    const resident = entries.filter(isResident)
    const related = entries.filter(entry => recalled.has(entry))
    const hidden = entries.filter(entry => !isResident(entry) && !recalled.has(entry))
    const counts = Object.entries(hidden.reduce<Record<string, number>>((result, entry) => {
      const key = entry.section ? SECTION_TITLES[entry.section] ?? entry.section : '其他'
      result[key] = (result[key] ?? 0) + 1
      return result
    }, {})).map(([key, count]) => `${key} ${count} 条`).join('、')
    return [
      `${LAYER_TITLES[layer]}（共 ${entries.length} 条，这里只列常驻与本次相关的）：`,
      ...(resident.length ? ['常驻：', ...resident.map(line)] : []),
      ...(related.length ? ['与本次请求相关：', ...related.map(line)] : []),
      ...(hidden.length ? [`未列出 ${hidden.length} 条（${counts}），用 list_application_entities 查：entityType=${MEMORY_ENTITY_TYPES[layer]}，text 写关键词，或 where 按 ${MEMORY_ENTITY_TYPES[layer]}.entry.section 筛选。`] : []),
    ].join('\n')
  })
  const note = crowded.size ? '部分记忆较多未全列；动手前若涉及字体、配色、节奏、口吻等偏好而这里没列，先按关键词查一次。\n\n' : ''
  return `${note}每层按更新时间从新到旧排列，矛盾时以靠前的为准。\n\n${parts.join('\n\n')}`
}
