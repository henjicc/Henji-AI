import React, { forwardRef } from 'react'
import { UI_GLASS_ADAPTIVE_DIVIDER_CLASS, UI_SPECIAL_PANEL_HEIGHT_CLASS } from './styleTokens'

/**
 * 特殊面板外壳（重要记录 021）：参数里点开的那块浮层——比例与分辨率、模型选择、音色选择、音色克隆、
 * 高级选项、魔搭自定义模型、画布节点的比例与模型——共用一副骨架：头部一行（搜索与筛选同一行）、
 * 可选左栏、正文唯一滚动区、需要提交时才有的底部操作行（左边状态或出错原因，右边主按钮）。
 *
 * 宽度跟内容走：外层 PanelTrigger 传 `panelSize="special"`，按最宽的内容定宽并夹在 240–760 之间。
 * 正文是虚拟列表或 `minmax(0, 1fr)` 网格这类没有固有宽度的内容时，传 `bodyWidth`（由列数与单元宽算出）。
 */
type UiSpecialPanelProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  /** 头部一行：搜索框、类型标签、紧凑筛选下拉 */
  header?: React.ReactNode
  /** 左栏（如模型选择的收藏与供应商）；固定 128 宽，自己滚动 */
  aside?: React.ReactNode
  /** 底部操作行左侧：状态、出错原因 */
  status?: React.ReactNode
  /** 底部操作行右侧：提交按钮。没有 status 与 action 时不出底部行 */
  action?: React.ReactNode
  /** 正文内容宽度（px，不含留白）；只给自身没有固有宽度的正文 */
  bodyWidth?: number
  /** fit：高度随内容、不超过上限；fill：直接占满上限，长列表筛选时面板不跳动 */
  height?: keyof typeof UI_SPECIAL_PANEL_HEIGHT_CLASS
  /** 正文留白：none（列表自己留白）/ sm 8 / md 12（默认） */
  bodyPadding?: keyof typeof BODY_PADDING
  children: React.ReactNode
}

const BODY_PADDING = { none: { className: '', px: 0 }, sm: { className: 'p-2', px: 8 }, md: { className: 'p-3', px: 12 } } as const

export const UiSpecialPanel = forwardRef<HTMLDivElement, UiSpecialPanelProps>(function UiSpecialPanel(
  { header, aside, status, action, bodyWidth, height = 'fit', bodyPadding = 'md', children, className, ...rest },
  ref,
) {
  const padding = BODY_PADDING[bodyPadding]
  return (
    <div ref={ref} data-special-panel className={`flex min-h-0 flex-col outline-none ${UI_SPECIAL_PANEL_HEIGHT_CLASS[height]} ${className ?? ''}`} {...rest}>
      {header ? <div data-special-panel-header className={`flex h-11 shrink-0 items-center gap-2 border-b px-3 ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS}`}>{header}</div> : null}
      <div className="flex min-h-0 flex-1">
        {aside ? <div data-special-panel-aside className={`w-32 shrink-0 overflow-y-auto overscroll-contain border-r bg-panel p-1.5 ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS}`}>{aside}</div> : null}
        <div
          data-special-panel-body
          data-layout-scroll-region
          className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain ${padding.className}`}
          style={bodyWidth === undefined ? undefined : { width: bodyWidth + padding.px * 2 }}
        >
          {children}
        </div>
      </div>
      {status || action ? (
        <div data-special-panel-footer className={`flex h-11 shrink-0 items-center gap-3 border-t pl-3 pr-2 ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS}`}>
          <div className="min-w-0 flex-1 truncate text-xs">{status}</div>
          {action}
        </div>
      ) : null}
    </div>
  )
})
