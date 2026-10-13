import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { UI_DIVIDER_CLASS, UI_TEXT_META_CLASS, UI_TEXT_PANEL_TITLE_CLASS } from './styleTokens'

interface UiRecordListProps extends HTMLAttributes<HTMLDivElement> {}
interface UiRecordItemProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** 完整列表中的索引，不能使用虚拟窗口内的相对位置。 */
  index: number
  density?: 'page' | 'panel' | 'compact'
  title?: ReactNode
  meta?: ReactNode[]
  status?: ReactNode
  actions?: ReactNode
}
const RECORD_PADDING = { page: 'py-5', panel: 'py-3', compact: 'py-1' } as const

/** 不增加记录间距，边界和留白由记录本身承担，支持虚拟列表测量。 */
export function UiRecordList({ className = '', ...props }: UiRecordListProps): JSX.Element {
  return <div role="list" data-ui-record-list className={`min-w-0 ${className}`} {...props} />
}

export const UiRecordItem = forwardRef<HTMLDivElement, UiRecordItemProps>(function UiRecordItem(
  { index, density = 'page', title, meta, children, status, actions, className = '', ...props }, ref,
) {
  return <div ref={ref} role="listitem" data-ui-record-item={density} data-ui-record-divider={index > 0}
    className={`${RECORD_PADDING[density]} ${index > 0 ? UI_DIVIDER_CLASS : ''} ${className}`} {...props}>
    <div className="flex min-w-0 flex-col gap-2">
      {title != null && <div className={UI_TEXT_PANEL_TITLE_CLASS}>{title}</div>}
      {meta?.length ? <div className={UI_TEXT_META_CLASS}>{meta.map((value, part) => <span key={part}>{part > 0 ? ' · ' : ''}{value}</span>)}</div> : null}
      {children}
      {status}
      {actions != null && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  </div>
})
