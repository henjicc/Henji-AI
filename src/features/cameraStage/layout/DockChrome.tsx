import React, { useEffect, useRef, useState } from 'react'
import { Menu, RotateCcw } from 'lucide-react'
import type { IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from 'dockview-react'
import { UI_TRIGGER_PANEL_CLASS, UiIconButton, UiOptionButton } from '@/components/ui'
import { resetLayout } from './dockLayout'

/**
 * dockview 面板外壳（AE 化）：
 * - DockTab：只渲染标题、去掉突兀的关闭 X，保留 dockview 拖拽/停靠能力（tab 仍是拖拽把手）。
 * - DockHeaderActions：分组头右侧「≡」菜单，承载面板操作（当前：重置布局）。
 */

export const DockTab: React.FC<IDockviewPanelHeaderProps> = (props) => {
  const [title, setTitle] = useState(props.api.title ?? '')
  useEffect(() => {
    const disposable = props.api.onDidTitleChange((event) => setTitle(event.title))
    return () => disposable.dispose()
  }, [props.api])
  // 文字色交给 dockview 的标签色变量（选中主要文字、其余辅助文字，见 index.css 面板标签映射）
  return <span className="px-2 text-xs">{title}</span>
}

export const DockHeaderActions: React.FC<IDockviewHeaderActionsProps> = ({ containerApi }) => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div ref={rootRef} className="relative flex h-full items-center pr-1">
      <UiIconButton size="sm"
        on={open}
        title="面板菜单"
        onClick={() => setOpen((prev) => !prev)}
      >
        <Menu size={14} />
      </UiIconButton>
      {/* 与下拉同一浮层表面；非 portal，只需盖住同一层叠上下文里的兄弟内容 */}
      {open && (
        <div className={`absolute right-1 top-full z-dropdown mt-1 min-w-32 p-1 ${UI_TRIGGER_PANEL_CLASS}`}>
          <UiOptionButton
            variant="menu"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => {
              resetLayout(containerApi)
              setOpen(false)
            }}
          >
            <RotateCcw size={13} />
            重置布局
          </UiOptionButton>
        </div>
      )}
    </div>
  )
}
