import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDockHeaderSlot } from './dockHeaderSlots'

/*
 * 面板标签行插槽：面板把自己的工具（视图、新建、导入……）放到所在面板组标签行的右侧，
 * 标签行不再空着、面板内容区也少一行。面板不在停靠区（浮出为独立窗口）或不是组内当前标签时没有插槽，
 * 工具就留在面板内部原位，挪到哪里都能用。
 */
export function DockHeaderPortal({ panelId, children, fallback }: { panelId: string; children: ReactNode; fallback?: (children: ReactNode) => ReactNode }): ReactNode {
  const slot = useDockHeaderSlot(panelId)
  return slot ? createPortal(children, slot) : (fallback ? fallback(children) : children)
}
