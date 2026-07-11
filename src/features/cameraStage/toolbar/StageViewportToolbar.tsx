import React from 'react'
import { MousePointer2, Move3D, PenTool, Rotate3D, Scaling } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import type { StageGizmoMode } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import {
  resolvePathShotId,
  useCameraStageToolStore,
  type StageEditorTool,
} from '../store/cameraStageToolStore'
import { useCameraStageViewportStore } from '../store/cameraStageViewportStore'

interface ToolDefinition {
  id: StageEditorTool
  label: string
  shortcut: string
  icon: LucideIcon
  gizmo?: StageGizmoMode
}

const TOOLS: ToolDefinition[] = [
  { id: 'select', label: '选择', shortcut: 'V', icon: MousePointer2 },
  { id: 'translate', label: '移动', shortcut: 'W', icon: Move3D, gizmo: 'translate' },
  { id: 'rotate', label: '旋转', shortcut: 'E', icon: Rotate3D, gizmo: 'rotate' },
  { id: 'scale', label: '缩放', shortcut: 'R', icon: Scaling, gizmo: 'scale' },
  { id: 'path', label: '编辑路径', shortcut: 'G', icon: PenTool },
]

const StageViewportToolbar: React.FC = () => {
  const activeTool = useCameraStageToolStore((state) => state.tool)
  const setTool = useCameraStageToolStore((state) => state.setTool)
  const selectPath = useCameraStageToolStore((state) => state.selectPath)
  const selectedId = useCameraStageStore((state) => state.selectedId)
  const selectedShotId = useCameraStageStore((state) => state.selectedShotId)
  const editorMode = useCameraStageStore((state) => state.editorMode)
  const activeViewportId = useCameraStageViewportStore((state) => state.activeViewportId)
  const activeViewportSource = useCameraStageViewportStore((state) => state.viewports[activeViewportId].source)
  const shots = useCameraStageStore((state) => state.shots)
  const currentTime = useCameraStageStore((state) => state.playback.currentTime)
  const setGizmoMode = useCameraStageStore((state) => state.setGizmoMode)

  const activateTool = (definition: ToolDefinition): void => {
    if (definition.gizmo) setGizmoMode(definition.gizmo)
    if (definition.id !== 'path') {
      setTool(definition.id)
      return
    }
    if (!selectedId) return
    const shotId = resolvePathShotId(shots, currentTime, selectedShotId)
    if (shotId) {
      selectPath({ shotId, objectId: selectedId })
    } else {
      setTool('path')
    }
  }

  const pathDisabled = editorMode !== 'simple'
    || activeViewportSource.kind === 'camera'
    || !selectedId
    || shots.length < 2

  return (
    <div className="flex items-center gap-0.5">
      {TOOLS.map((definition, index) => {
        const Icon = definition.icon
        const disabled = definition.id === 'path' && pathDisabled
        return (
          <React.Fragment key={definition.id}>
            {index === 4 && <span className="mx-1 h-5 w-px bg-border-dark" />}
            <UiIconButton
              showBorder={false}
              active={activeTool === definition.id}
              disabled={disabled}
              className="h-8 w-8 rounded-md disabled:cursor-not-allowed disabled:opacity-40"
              title={`${definition.label}（${definition.shortcut}）`}
              aria-label={`${definition.label}，快捷键 ${definition.shortcut}`}
              onClick={() => activateTool(definition)}
            >
              <Icon size={15} strokeWidth={1.8} />
            </UiIconButton>
          </React.Fragment>
        )
      })}
    </div>
  )
}

export default StageViewportToolbar
