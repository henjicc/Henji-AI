import React, { useCallback, useEffect, useState } from 'react'
import { Dropdown, UiButton, UiOptionButton } from '@/components/ui'
import { getCameraObjects } from './domain/cameraUtils'
import type { StageGizmoMode } from './domain/sceneTypes'
import ObjectListPanel from './panels/ObjectListPanel'
import PropertyPanel from './panels/PropertyPanel'
import { saveCurrentProject } from './projects/cameraStageProjectService'
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
  const projectName = useCameraStageStore((state) => state.currentProjectName)
  const cameras = getCameraObjects(objects)
  const activeCamera = cameras.find((item) => item.id === activeCameraId) ?? cameras[0]

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const handleCameraSelect = (cameraId: string): void => {
    setActiveCameraId(cameraId)
    setSelected(cameraId)
  }

  const handleSave = useCallback(async (): Promise<void> => {
    setSaveState('saving')
    try {
      await saveCurrentProject()
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }, [])

  // 保存成功/失败提示 1.6s 后回到常态
  useEffect(() => {
    if (saveState !== 'saved' && saveState !== 'error') return
    const timer = window.setTimeout(() => setSaveState('idle'), 1600)
    return () => window.clearTimeout(timer)
  }, [saveState])

  // 编辑器作用域 Ctrl/Cmd+S 保存（输入框内不拦截，交给原生行为）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      event.preventDefault()
      void handleSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  const saveLabel =
    saveState === 'saving'
      ? '保存中…'
      : saveState === 'saved'
      ? '已保存'
      : saveState === 'error'
      ? '保存失败'
      : '保存'

  return (
    <div className="flex h-full flex-1 overflow-hidden bg-app">
      <ObjectListPanel />
      <div className="relative min-w-0 flex-1">
        <StageScene />
        <div className="absolute right-3 top-3 flex items-center gap-2">
          <span className="max-w-40 truncate text-xs text-text-muted" title={projectName}>
            {projectName}
          </span>
          <UiButton
            size="sm"
            onClick={() => void handleSave()}
            disabled={saveState === 'saving'}
            className="py-1.5 text-xs"
          >
            {saveLabel}
          </UiButton>
        </div>
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
