import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { ownerWindowOf } from '@/utils/crossRealmDom'
import { resolveOverflowHiddenIds, UI_OVERFLOW_TRIGGER_FALLBACK_WIDTH, type OverflowLayoutItem } from './overflowLayout'

/**
 * 单行溢出收纳（任务 4.3）：一行放不下时，按优先级从低到高把项收进行末的溢出入口，变宽时按相反顺序放回。
 *
 * 选型：比较过 Fluent UI v9 的 `@fluentui/priority-overflow`（MIT，Toolbar/TabList 溢出引擎）。它在每次
 * 计算时直接读取被收起项的 `offsetWidth`，要求收起项留在 DOM 里只切 `display`；而生成参数的控件有挂载副作用
 * （下拉会自动回填默认值），收起项必须**不挂载**、改到浮层里渲染，两者冲突，且它不观察项自身宽度变化。
 * 因此沿用它的语义（pinned 永不收起、按 priority 收起、同优先级按文档顺序从尾部收起、预留溢出入口宽度）自研。
 *
 * - 收起的项不渲染；放回判定用它最后一次可见时测得的宽度。
 * - pinned 项永不收起；当只剩 pinned 项仍放不下时，pinned 项允许收缩（由其内部截断），而不是换行。
 * - `alwaysShowOverflow`：即使没有项被收起也显示溢出入口（例如浮层里有固定收纳的大块控件）。
 */

export interface UiOverflowRowItem extends OverflowLayoutItem {
  node: ReactNode
}

export interface UiOverflowRowProps {
  items: readonly UiOverflowRowItem[]
  /** 行末溢出入口；`hiddenIds` 按文档顺序 */
  renderOverflow: (hiddenIds: readonly string[]) => ReactNode
  alwaysShowOverflow?: boolean
  /** 布局类（外观不在此覆盖） */
  className?: string
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function UiOverflowRow({
  items,
  renderOverflow,
  alwaysShowOverflow = false,
  className = '',
}: UiOverflowRowProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const overflowRef = useRef<HTMLDivElement | null>(null)
  const itemElements = useRef(new Map<string, HTMLDivElement>())
  const widths = useRef(new Map<string, number>())
  const overflowWidth = useRef<number | null>(null)
  const [hiddenIds, setHiddenIds] = useState<string[]>([])
  const [compressPinned, setCompressPinned] = useState(false)
  const [measureTick, setMeasureTick] = useState(0)
  const mountedKey = items.map((item) => item.id).join('|') + '#' + hiddenIds.join('|')

  // 每次渲染后测量可见项与入口，再算一次收纳；结果不变时不触发重渲染。
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    for (const [id, element] of itemElements.current) {
      const pinned = items.find((item) => item.id === id)?.pinned
      // 被压缩的 pinned 项保留压缩前的自然宽度
      if (pinned && compressPinned) continue
      widths.current.set(id, element.getBoundingClientRect().width)
    }
    if (overflowRef.current) overflowWidth.current = overflowRef.current.getBoundingClientRect().width
    const style = ownerWindowOf(container).getComputedStyle(container)
    const gap = Number.parseFloat(style.columnGap || '0') || 0
    const available = container.clientWidth
    const next = resolveOverflowHiddenIds({
      items,
      widths: widths.current,
      available,
      gap,
      overflowWidth: overflowWidth.current ?? UI_OVERFLOW_TRIGGER_FALLBACK_WIDTH,
      alwaysShowOverflow,
    })
    if (!sameIds(next, hiddenIds)) {
      setHiddenIds(next)
      return
    }
    const pinnedWidth = items
      .filter((item) => item.pinned)
      .reduce((sum, item, index) => sum + (widths.current.get(item.id) ?? 0) + (index > 0 ? gap : 0), 0)
    const showsOverflow = next.length > 0 || alwaysShowOverflow
    const reserve = showsOverflow ? (overflowWidth.current ?? UI_OVERFLOW_TRIGGER_FALLBACK_WIDTH) + gap : 0
    const shouldCompress = pinnedWidth + reserve > available
    if (shouldCompress !== compressPinned) setCompressPinned(shouldCompress)
    // measureTick：尺寸观察器触发的重测
  }, [alwaysShowOverflow, compressPinned, hiddenIds, items, measureTick])

  // 容器或任一项尺寸变化（窗口缩放、参数值改变了触发器文字）时重算
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ResizeObserverCtor = ownerWindowOf(container).ResizeObserver
    if (!ResizeObserverCtor) return
    let frame = 0
    const observer = new ResizeObserverCtor(() => {
      ownerWindowOf(container).cancelAnimationFrame(frame)
      frame = ownerWindowOf(container).requestAnimationFrame(() => setMeasureTick((tick) => tick + 1))
    })
    observer.observe(container)
    for (const element of itemElements.current.values()) observer.observe(element)
    return () => {
      ownerWindowOf(container).cancelAnimationFrame(frame)
      observer.disconnect()
    }
    // 只在挂载的项集合变化时重建观察器（观察器建立时会回调一次，依赖不能含它触发的状态）
  }, [mountedKey])

  const hidden = new Set(hiddenIds)
  const showOverflow = hiddenIds.length > 0 || alwaysShowOverflow

  return (
    <div
      ref={containerRef}
      data-ui-overflow-row
      className={`flex min-w-0 flex-nowrap items-center overflow-hidden ${className}`}
    >
      {items.map((item) => hidden.has(item.id) ? null : (
        <div
          key={item.id}
          data-overflow-item={item.id}
          ref={(element) => {
            if (element) itemElements.current.set(item.id, element)
            else itemElements.current.delete(item.id)
          }}
          className={item.pinned && compressPinned ? 'flex min-w-0 shrink items-center' : 'flex shrink-0 items-center'}
        >
          {item.node}
        </div>
      ))}
      {showOverflow ? (
        <div ref={overflowRef} data-overflow-menu className="flex shrink-0 items-center">
          {renderOverflow(hiddenIds)}
        </div>
      ) : null}
    </div>
  )
}
