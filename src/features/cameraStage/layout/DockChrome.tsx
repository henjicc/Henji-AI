import React, { useEffect, useRef, useState } from 'react'
import { Menu, RotateCcw } from 'lucide-react'
import type { IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from 'dockview-react'
import { UiButton, UiIconButton } from '@/components/ui'
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
  return <span className="px-2 text-xs text-text-dark">{title}</span>
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
      <UiIconButton
        showBorder={false}
        appearance="hover-only"
        active={open}
        className="h-6 w-6"
        title="面板菜单"
        onClick={() => setOpen((prev) => !prev)}
      >
        <Menu size={14} />
      </UiIconButton>
      {open && (
        <div className="absolute right-1 top-full z-50 mt-1 min-w-32 rounded-md border border-border-dark bg-surface-dark p-1 shadow-panel">
          <UiButton
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs"
            onClick={() => {
              resetLayout(containerApi)
              setOpen(false)
            }}
          >
            <RotateCcw size={13} />
            重置布局
          </UiButton>
        </div>
      )}
    </div>
  )
}
