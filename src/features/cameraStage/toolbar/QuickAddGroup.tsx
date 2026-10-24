import React from 'react'
import { Box, Camera, Circle, Cone, Cylinder, Plus, Pyramid, Torus, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PanelTrigger, UiIconButton, UiOptionButton, UiOverflowRow } from '@/components/ui'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { PRIMITIVE_KIND_LABELS } from '../domain/sceneDefaults'
import type { StagePrimitiveKind } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'

/**
 * 顶部工具栏图标化快速添加栏：几何体/角色/摄像机一击添加并自动选中。
 * 命令带放不下时（960 宽），从不常用的几何体开始收进“更多添加”菜单，角色与摄像机最后收；
 * 收纳行借用命令带左端的空余宽度（命令带 leadingLayout="share"），窗口放宽后能把收起的按钮放回来。
 * 此前八个按钮硬挤，后面的“超级关键帧”与右侧布局按钮叠在一起，路径参数条被挤成零宽（重要记录 020）。
 */

type QuickAddValue = StagePrimitiveKind | 'character' | 'camera'

const QUICK_ADD_ICONS: Record<QuickAddValue, LucideIcon> = {
  box: Box,
  sphere: Circle,
  cylinder: Cylinder,
  cone: Cone,
  pyramid: Pyramid,
  torus: Torus,
  character: User,
  camera: Camera,
}

const QUICK_ADD_LABELS: Record<QuickAddValue, string> = {
  ...PRIMITIVE_KIND_LABELS,
  character: '角色',
  camera: '摄像机',
}

const QUICK_ADD_ORDER: QuickAddValue[] = [
  'box',
  'sphere',
  'cylinder',
  'cone',
  'pyramid',
  'torus',
  'character',
  'camera',
]

/** 收进“更多添加”的先后：数值越小越先收 */
const QUICK_ADD_PRIORITY: Record<QuickAddValue, number> = {
  torus: 1,
  pyramid: 2,
  cone: 3,
  cylinder: 4,
  sphere: 5,
  box: 6,
  camera: 7,
  character: 8,
}

const QuickAddGroup: React.FC = () => {
  const addPrimitive = useCameraStageStore((state) => state.addPrimitive)
  const addCharacter = useCameraStageStore((state) => state.addCharacter)
  const addCamera = useCameraStageStore((state) => state.addCamera)

  const handleAdd = (value: QuickAddValue): void => {
    if (value === 'character') addCharacter()
    else if (value === 'camera') addCamera()
    else addPrimitive(value)
  }

  return (
    <UiOverflowRow
      growIntoParent
      className="min-w-0 shrink gap-0.5"
      items={QUICK_ADD_ORDER.map((value) => {
        const Icon = QUICK_ADD_ICONS[value]
        return {
          id: value,
          priority: QUICK_ADD_PRIORITY[value],
          node: (
            <UiIconButton
              size="md"
              tooltip={`添加${QUICK_ADD_LABELS[value]}`}
              onClick={() => handleAdd(value)}
            >
              <Icon  />
            </UiIconButton>
          ),
        }
      })}
      renderOverflow={(hiddenIds) => (
        <PanelTrigger
          panelSize="menu"
          panelPadding="menu"
          zIndex={Z_LAYERS.dropdown}
          closeOnPanelClick
          renderPanel={() => (
            <div className="flex flex-col gap-1" role="group" aria-label="更多添加">
              {QUICK_ADD_ORDER.filter((value) => hiddenIds.includes(value)).map((value) => {
                const Icon = QUICK_ADD_ICONS[value]
                return (
                  <UiOptionButton key={value} variant="menu" size="sm" className="gap-2" onClick={() => handleAdd(value)}>
                    <Icon size={UI_ICON_SIZE.sm} />
                    添加{QUICK_ADD_LABELS[value]}
                  </UiOptionButton>
                )
              })}
            </div>
          )}
        >
          {({ open, togglePanel }) => (
            <UiIconButton size="md" aria-label="更多添加" tooltip="更多添加" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}>
              <Plus />
            </UiIconButton>
          )}
        </PanelTrigger>
      )}
    />
  )
}

export default QuickAddGroup
