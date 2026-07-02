import React from 'react'
import { Dropdown, UiOptionButton } from '@/components/ui'
import { getCameraObjects } from './domain/cameraUtils'
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
  const objects = useCameraStageStore((state) => state.objects)
  const gizmoMode = useCameraStageStore((state) => state.gizmoMode)
  const viewMode = useCameraStageStore((state) => state.viewMode)
  const activeCameraId = useCameraStageStore((state) => state.activeCameraId)
  const setGizmoMode = useCameraStageStore((state) => state.setGizmoMode)
  const setViewMode = useCameraStageStore((state) => state.setViewMode)
  const setActiveCameraId = useCameraStageStore((state) => state.setActiveCameraId)
  const selectedId = useCameraStageStore((state) => state.selectedId)
  const setSelected = useCameraStageStore((state) => state.setSelected)
  const cameras = getCameraObjects(objects)
  const activeCamera = cameras.find((item) => item.id === activeCameraId) ?? cameras[0]

  const handleCameraSelect = (cameraId: string): void => {
    setActiveCameraId(cameraId)
    setSelected(cameraId)
  }

  return (
    <div className="flex h-full flex-1 overflow-hidden bg-app">
      <ObjectListPanel />
      <div className="relative min-w-0 flex-1">
        <StageScene />
        <div className="absolute left-3 top-3 flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            <UiOptionButton
              active={viewMode === 'director'}
              onClick={() => setViewMode('director')}
              className="py-1.5 text-xs"
            >
              导演视角
            </UiOptionButton>
            <UiOptionButton
              active={viewMode === 'camera'}
              disabled={!activeCamera}
              onClick={() => setViewMode('camera')}
              className="py-1.5 text-xs"
            >
              机位视角
            </UiOptionButton>
            {activeCamera && (
              <Dropdown<string>
                value={activeCamera.id}
                display={activeCamera.name}
                options={cameras.map((camera) => ({ label: camera.name, value: camera.id }))}
                onSelect={handleCameraSelect}
                className="min-w-28"
                buttonClassName="h-7 py-1.5 text-xs"
                buttonLabelClassName="text-xs"
                optionLabelClassName="text-xs"
                minWidthStrategy="options"
                panelWidthStrategy="options"
              />
            )}
          </div>
          {viewMode === 'director' && (
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
          )}
          <div className="text-xs text-text-muted">
            {viewMode === 'camera'
              ? `当前取景：${activeCamera?.name ?? '未选择机位'}`
              : selectedId
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
