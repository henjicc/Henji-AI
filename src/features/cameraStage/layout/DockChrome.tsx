import React, { useEffect, useState } from 'react'
import { Menu, RotateCcw } from 'lucide-react'
import type { IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from 'dockview-react'
import { PanelTrigger, UiIconButton, UiOptionButton } from '@/components/ui'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { useCameraStageStore } from '../store/cameraStageStore'
import { resetCameraStageWorkspace } from './dockLayout'

/**
 * dockview 面板外壳（AE 化）：
 * - DockTab：只渲染标题、去掉突兀的关闭 X，保留 dockview 拖拽/停靠能力（tab 仍是拖拽把手）。
 * - DockHeaderActions：分组头右侧「≡」菜单，承载面板操作（当前：重置布局）。
 *   菜单走共享 `PanelTrigger`（与剪辑工作区面板菜单同一套浮层：点外关闭、Esc、方向键），
 *   重置动作与命令带的“重置布局”是同一个函数，两处结果一致。
 */

export const DockTab: React.FC<IDockviewPanelHeaderProps> = (props) => {
  const [title, setTitle] = useState(props.api.title ?? '')
  useEffect(() => {
    const disposable = props.api.onDidTitleChange((event) => setTitle(event.title))
    return () => disposable.dispose()
  }, [props.api])
  // 未选中对象时属性面板显示的是场景设置，标签跟着内容叫“场景设置”（标签由内容决定，不写回布局）
  const showsSceneSettings = useCameraStageStore((state) => !state.objects.some((item) => item.id === state.selectedId))
  const label = props.api.id === 'properties' && showsSceneSettings ? '场景设置' : title
  // 文字色交给 dockview 的标签色变量（选中主要文字、其余辅助文字，见 index.css 面板标签映射）
  return <span className="px-2 text-xs">{label}</span>
}

export const DockHeaderActions: React.FC<IDockviewHeaderActionsProps> = ({ containerApi }) => (
  <PanelTrigger
    panelWidth={160}
    zIndex={Z_LAYERS.dropdown}
    closeOnPanelClick
    panelPadding="menu"
    renderPanel={() => (
      <div className="flex flex-col gap-0.5" role="menu" aria-label="面板菜单">
        <UiOptionButton
          role="menuitem"
          variant="menu"
          size="sm"
          className="w-full gap-2"
          onClick={() => resetCameraStageWorkspace(containerApi)}
        >
          <RotateCcw size={14} />
          重置布局
        </UiOptionButton>
      </div>
    )}
  >
    {({ open, togglePanel }) => (
      <div className="flex h-full items-center pr-1">
        <UiIconButton
          size="sm"
          on={open}
          title="面板菜单"
          aria-label="面板菜单"
          aria-haspopup="menu"
          aria-expanded={open}
          data-panel-trigger-button
          onClick={togglePanel}
        >
          <Menu size={14} />
        </UiIconButton>
      </div>
    )}
  </PanelTrigger>
)
