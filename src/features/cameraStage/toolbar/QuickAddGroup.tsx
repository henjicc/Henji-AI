import React from 'react'
import { Box, Camera, Circle, Cone, Cylinder, Pyramid, Torus, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import { PRIMITIVE_KIND_LABELS } from '../domain/sceneDefaults'
import type { StagePrimitiveKind } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'

/** 顶部工具栏图标化快速添加栏：几何体/角色/摄像机一击添加并自动选中 */

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
    <div className="flex items-center gap-0.5 border-l border-border-dark pl-2">
      {QUICK_ADD_ORDER.map((value) => {
        const Icon = QUICK_ADD_ICONS[value]
        return (
          <UiIconButton
            key={value}
            showBorder={false}
            appearance="hover-only"
            className="h-7 w-7"
            title={`添加${QUICK_ADD_LABELS[value]}`}
            onClick={() => handleAdd(value)}
          >
            <Icon size={14} />
          </UiIconButton>
        )
      })}
    </div>
  )
}

export default QuickAddGroup
