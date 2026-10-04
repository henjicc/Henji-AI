/** 单行溢出收纳的纯计算（`UiOverflowRow` 使用，单独成文件便于测试）。任务 4.3。 */

export interface OverflowLayoutItem {
  id: string
  /** 越大越晚收起 */
  priority: number
  /** 永不收起（如模型选择、主选择器） */
  pinned?: boolean
}

export interface OverflowLayoutInput {
  items: readonly OverflowLayoutItem[]
  widths: ReadonlyMap<string, number>
  available: number
  gap: number
  overflowWidth: number
  alwaysShowOverflow?: boolean
}

/** 首次出现溢出入口、尚未测得宽度时的估值（静默字段触发器“更多参数 N”）。 */
export const UI_OVERFLOW_TRIGGER_FALLBACK_WIDTH = 104

/** 纯函数：给定各项宽度与可用宽度，返回应收起的项（文档顺序）。 */
export function resolveOverflowHiddenIds({
  items,
  widths,
  available,
  gap,
  overflowWidth,
  alwaysShowOverflow = false,
}: OverflowLayoutInput): string[] {
  const widthOf = (id: string): number => widths.get(id) ?? 0
  const total = items.reduce((sum, item, index) => sum + widthOf(item.id) + (index > 0 ? gap : 0), 0)
  const overflowReserve = alwaysShowOverflow ? overflowWidth + (items.length > 0 ? gap : 0) : 0
  if (total + overflowReserve <= available) return []

  const order = new Map(items.map((item, index) => [item.id, index]))
  const ranked = [...items].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1
    if (left.priority !== right.priority) return right.priority - left.priority
    return (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0)
  })
  const reserve = overflowWidth + gap
  const visible = new Set<string>()
  let used = 0
  let stopped = false
  for (const item of ranked) {
    const next = used + (visible.size > 0 ? gap : 0) + widthOf(item.id)
    if (item.pinned) {
      visible.add(item.id)
      used = next
      continue
    }
    if (stopped || next + reserve > available) {
      stopped = true
      continue
    }
    visible.add(item.id)
    used = next
  }
  return items.filter((item) => !visible.has(item.id)).map((item) => item.id)
}

