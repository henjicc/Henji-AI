import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

type AppRegionStyle = CSSProperties & { WebkitAppRegion: 'drag' | 'no-drag' }
const DRAG_REGION: AppRegionStyle = { WebkitAppRegion: 'drag' }
const NO_DRAG_REGION: AppRegionStyle = { WebkitAppRegion: 'no-drag' }

export interface WindowTitleBarProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'style'> {
  /** 左侧：窗口标题或面板标签。 */
  children: ReactNode
  /** 右侧：窗口控件（`UiWindowControl`）与窗口级动作。 */
  actions: ReactNode
  /** `window` 40 高（独立工具窗口，如日志）；`panel` 32 高（剪辑独立面板窗口，与停靠面板标签条等高）。 */
  size?: 'window' | 'panel'
  /**
   * `native`：系统拖动区域（`-webkit-app-region: drag`），有 preload 窗口控制的窗口用，系统负责移动、贴边与双击最大化。
   * `custom`：不设拖动区域，调用方用指针事件自己移动窗口（剪辑独立面板窗口要在拖动中判断能否停靠回主窗口，
   * 系统拖动区域会吞掉指针事件）。
   */
  dragRegion?: 'native' | 'custom'
}

/**
 * 应用次级系统窗口（无系统边框）共用的标题栏：日志窗口与剪辑独立面板窗口。
 * 主窗口标题栏（WindowControls）承载工作区导航，结构不同，不走这里。
 * 外观与主窗口一致：window 底 + 下发丝线；右侧动作区不参与拖动，按下与双击不会传到标题栏。
 */
export function WindowTitleBar({ children, actions, size = 'window', dragRegion = 'native', className = '', ...props }: WindowTitleBarProps): JSX.Element {
  const native = dragRegion === 'native'
  return (
    <header
      {...props}
      data-window-titlebar={size}
      className={`flex shrink-0 select-none items-center justify-between gap-3 border-b border-line bg-window text-text1 ${size === 'window' ? 'h-10 pl-4 pr-1.5' : 'h-8 pl-1 pr-1'} ${className}`}
      style={native ? DRAG_REGION : undefined}
    >
      <div className="flex h-full min-w-0 flex-1 items-center">{children}</div>
      <div
        className="flex shrink-0 items-center gap-0.5"
        style={native ? NO_DRAG_REGION : undefined}
        data-window-nodrag
        onPointerDown={native ? undefined : event => event.stopPropagation()}
        onDoubleClick={native ? undefined : event => event.stopPropagation()}
      >
        {actions}
      </div>
    </header>
  )
}
