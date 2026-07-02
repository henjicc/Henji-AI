import React from 'react'
import { UiOptionButton } from '@/components/ui'
import type { StageGizmoMode } from './domain/sceneTypes'
import ObjectListPanel from './panels/ObjectListPanel'
import PropertyPanel from './panels/PropertyPanel'
import StageScene from './scene/StageScene'
import { useCameraStageStore } from './store/cameraStageStore'

/**
 * 运镜控制编辑器编排容器：左对象列表 + 中三维视图 + 右属性面板。
 * 只做布局与接线，不承载业务实现。
 */

const GIZMO_MODES: Array<{ id: StageGizmoMode; label: string }> = [
  { id: 'translate', label: '移动' },
  { id: 'rotate', label: '旋转' },
  { id: 'scale', label: '缩放' },
]

const CameraStageEditor: React.FC = () => {
  const gizmoMode = useCameraStageStore((state) => state.gizmoMode)
  const setGizmoMode = useCameraStageStore((state) => state.setGizmoMode)
  const selectedId = useCameraStageStore((state) => state.selectedId)

  return (
    <div className="flex h-full flex-1 overflow-hidden bg-app">
      <ObjectListPanel />
      <div className="relative min-w-0 flex-1">
        <StageScene />
        <div className="absolute left-3 top-3 flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            {GIZMO_MODES.map((item) => (
              <UiOptionButton
                key={item.id}
                active={gizmoMode === item.id}
                onClick={() => setGizmoMode(item.id)}
                className="py-1.5 text-xs"
              >
                {item.label}
              </UiOptionButton>
            ))}
          </div>
          <div className="text-xs text-text-muted">
            {selectedId
              ? '拖拽 gizmo 变换选中对象，点空白处取消选中'
              : '左键点击选中对象，左键拖拽环绕，滚轮缩放，右键拖拽平移'}
          </div>
        </div>
      </div>
      <PropertyPanel />
    </div>
  )
}

export default CameraStageEditor
