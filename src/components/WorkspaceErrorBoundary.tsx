import type { ReactNode } from 'react'

import { UiErrorBoundary, type UiErrorBoundaryScope } from '@/components/ui'

/**
 * 工作区、浮层与停靠面板的错误边界：一处渲染出错只换掉这一块，标题栏、导航、助手与其他工作区照常可用。
 * 两者都只是 `UiErrorBoundary` 的配置，统一日志域与事件名，按 `surfaceId` / `panelId` 查是哪一块出的错。
 */

export function WorkspaceErrorBoundary({ surfaceId, scope = 'workspace', resetKeys, actions, children }: {
  surfaceId: string
  /** 浮层里的一块（助手、设置分类、资产浮层）用 `panel` 的文案 */
  scope?: Exclude<UiErrorBoundaryScope, 'app'>
  /** 任一值变化时自动清除错误，如切到另一个工具或设置分类 */
  resetKeys?: readonly unknown[]
  /** 重试之外的离开动作 */
  actions?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <UiErrorBoundary scope={scope} loggerDomain="app.workspace" event="workspace.ui.crashed" logFields={{ surfaceId }} resetKeys={resetKeys} actions={actions}>
      {children}
    </UiErrorBoundary>
  )
}

export function DockPanelErrorBoundary({ workspace, panelId, resetKeys, children }: {
  /** 停靠工作区，如 `video_edit` */
  workspace: string
  panelId: string
  resetKeys?: readonly unknown[]
  children: ReactNode
}): JSX.Element {
  return (
    <UiErrorBoundary scope="panel" loggerDomain="app.workspace" event="dock_panel.ui.crashed" logFields={{ workspace, panelId }} resetKeys={resetKeys}>
      {children}
    </UiErrorBoundary>
  )
}
