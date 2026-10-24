import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Key, type ReactNode } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'

export interface UiVirtualListProps<T> {
  data: readonly T[]
  getKey: (item: T) => Key
  renderItem: (item: T, index: number) => ReactNode
  emptyState?: ReactNode
  /** 过滤语义改变时回到首屏，避免靠未挂载的 DOM 找高亮项。 */
  resetKey?: Key
  highlightedIndex?: number
}

/**
 * 共享虚拟列表。放在有确定高度的容器里时铺满容器；放在高度随内容的容器里（浮层的模型、音色选择）时，
 * 按列表总高度自撑并封顶到 `max-h-virtual-list`、超出在列表里滚动。
 * Virtuoso 的视口是绝对定位的，不给高度时贡献 0：浮层里的网格曾因此高度为 0，一个模型都看不见（重要记录 020）。
 */
export function UiVirtualList<T>({ data, getKey, renderItem, emptyState, resetKey = '', highlightedIndex }: UiVirtualListProps<T>): JSX.Element {
  const ref = useRef<VirtuosoHandle>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  // null：还没量；true：容器高度随内容，按总高度自撑；false：容器给了确定高度，铺满
  const [autoHeight, setAutoHeight] = useState<boolean | null>(null)
  const [listHeight, setListHeight] = useState(0)
  useLayoutEffect(() => {
    if (autoHeight === null && boxRef.current) setAutoHeight(boxRef.current.clientHeight < 1)
  }, [autoHeight, data.length])
  useEffect(() => {
    if (highlightedIndex !== undefined && highlightedIndex >= 0 && highlightedIndex < data.length) {
      ref.current?.scrollIntoView({ index: highlightedIndex, behavior: 'auto' })
    }
  }, [highlightedIndex, data.length, resetKey])
  if (!data.length) return <div className="flex h-full min-h-0 flex-col">{emptyState}</div>
  return <div ref={boxRef} className={autoHeight ? 'max-h-virtual-list min-h-0' : 'h-full min-h-0'} style={autoHeight ? { height: listHeight } : undefined}>
    <Virtuoso
      key={`${resetKey}:${data.length}`}
      ref={ref}
      className="h-full min-h-0 overscroll-contain"
      data={data as T[]}
      initialItemCount={Math.min(4, data.length)}
      overscan={120}
      computeItemKey={(_index, item) => getKey(item)}
      itemContent={(index, item) => renderItem(item, index)}
      totalListHeightChanged={setListHeight}
    />
  </div>
}

export interface UiVirtualGridProps<T> extends UiVirtualListProps<T> {
  columns: 2 | 3 | 4 | 5
}

const GRID_CLASSES = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' }

/** 按网格行虚拟化，行高由正式 Virtuoso 测量，允许内容和状态操作改变卡片高度。 */
export function UiVirtualGrid<T>({ data, columns, getKey, renderItem, highlightedIndex, resetKey = '', emptyState }: UiVirtualGridProps<T>): JSX.Element {
  const rows = useMemo(() => {
    const result: T[][] = []
    for (let index = 0; index < data.length; index += columns) result.push(data.slice(index, index + columns))
    return result
  }, [data, columns])
  return <UiVirtualList
    data={rows}
    getKey={row => getKey(row[0])}
    resetKey={`${resetKey}:${columns}`}
    highlightedIndex={highlightedIndex === undefined ? undefined : Math.floor(highlightedIndex / columns)}
    emptyState={emptyState}
    renderItem={(row, rowIndex) => <div className={`grid gap-2 pb-2 ${GRID_CLASSES[columns]}`}>{row.map((item, column) => <div className="min-w-0" key={getKey(item)}>{renderItem(item, rowIndex * columns + column)}</div>)}</div>}
  />
}
