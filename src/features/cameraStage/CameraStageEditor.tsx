import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Camera, Redo2, Undo2 } from 'lucide-react'
import { Dropdown, UiButton, UiIconButton, UiOptionButton } from '@/components/ui'
import { getCameraObjects } from './domain/cameraUtils'
import type { StageGizmoMode } from './domain/sceneTypes'
import { exportSceneScreenshot } from './export/cameraStageScreenshot'
import CameraStageDock from './layout/CameraStageDock'
import type { CameraStageDockHandle } from './layout/CameraStageDock'
import { saveCurrentProject } from './projects/cameraStageProjectService'
import type { StageCaptureFn } from './scene/StageCaptureBridge'
import { useCameraStageStore } from './store/cameraStageStore'
import { useCameraStageHistory } from './store/useCameraStageHistory'

/**
 * 运镜控制编辑器编排容器：顶部控制栏 + 停靠式面板工作区（视口/资源管理器/属性）。
 * 只做布局与接线，不承载业务实现；面板布局由 CameraStageDock（dockview）管理。
 */

const GIZMO_MODES: Array<{ id: StageGizmoMode; label: string }> = [
  { id: 'translate', label: '移动' },
  { id: 'rotate', label: '旋转' },
  { id: 'scale', label: '缩放' },
]

interface CameraStageEditorProps {
  /** 返回工程列表 */
  onBackToList?: () => void
}

const CameraStageEditor: React.FC<CameraStageEditorProps> = ({ onBackToList }) => {
  const objects = useCameraStageStore((state) => state.objects)
  const gizmoMode = useCameraStageStore((state) => state.gizmoMode)
  const viewMode = useCameraStageStore((state) => state.viewMode)
  const activeCameraId = useCameraStageStore((state) => state.activeCameraId)
  const setGizmoMode = useCameraStageStore((state) => state.setGizmoMode)
  const setViewMode = useCameraStageStore((state) => state.setViewMode)
  const setActiveCameraId = useCameraStageStore((state) => state.setActiveCameraId)
  const setSelected = useCameraStageStore((state) => state.setSelected)
  const projectName = useCameraStageStore((state) => state.currentProjectName)
  const cameras = getCameraObjects(objects)
  const activeCamera = cameras.find((item) => item.id === activeCameraId) ?? cameras[0]

  const { canUndo, canRedo, undo, redo } = useCameraStageHistory()

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [shotHint, setShotHint] = useState<string | null>(null)
  const [shooting, setShooting] = useState(false)
  const captureRef = useRef<StageCaptureFn | null>(null)
  const dockRef = useRef<CameraStageDockHandle>(null)

  const canScreenshot = viewMode === 'camera' && !!activeCamera

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

  const handleScreenshot = useCallback(async (): Promise<void> => {
    const dataUrl = captureRef.current?.()
    if (!dataUrl) {
      setShotHint('截图失败：未获取到画面')
      return
    }
    setShooting(true)
    try {
      const { savedPath } = await exportSceneScreenshot(
        dataUrl,
        useCameraStageStore.getState().currentProjectName,
      )
      const fileName = savedPath.split(/[\\/]/).pop() ?? savedPath
      setShotHint(`已保存到下载文件夹：${fileName}`)
    } catch {
      setShotHint('截图导出失败')
    } finally {
      setShooting(false)
    }
  }, [])

  // 保存成功/失败提示 1.6s 后回到常态
  useEffect(() => {
    if (saveState !== 'saved' && saveState !== 'error') return
    const timer = window.setTimeout(() => setSaveState('idle'), 1600)
    return () => window.clearTimeout(timer)
  }, [saveState])

  // 截图提示 3s 后消失
  useEffect(() => {
    if (!shotHint) return
    const timer = window.setTimeout(() => setShotHint(null), 3000)
    return () => window.clearTimeout(timer)
  }, [shotHint])

  // 编辑器作用域快捷键：Ctrl/Cmd+S 保存、Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z / Ctrl+Y 重做
  // （输入框内不拦截 S，交给原生行为；撤销重做直接读 temporal，避免依赖 canUndo 频繁重挂监听）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable
      const key = event.key.toLowerCase()
      if (key === 's') {
        if (inEditable) return
        event.preventDefault()
        void handleSave()
      } else if (key === 'z') {
        if (inEditable) return
        event.preventDefault()
        const temporal = useCameraStageStore.temporal.getState()
        if (event.shiftKey) temporal.redo()
        else temporal.undo()
      } else if (key === 'y') {
        if (inEditable) return
        event.preventDefault()
        useCameraStageStore.temporal.getState().redo()
      }
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
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-app">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-dark bg-surface-dark px-2">
        {onBackToList && (
          <UiIconButton
            showBorder={false}
            appearance="hover-only"
            className="h-7 w-7"
            title="返回工程列表"
            onClick={onBackToList}
          >
            <ArrowLeft size={15} />
          </UiIconButton>
        )}

        <div className="flex items-center gap-0.5 border-l border-border-dark pl-2">
          <UiIconButton
            showBorder={false}
            appearance="hover-only"
            disabled={!canUndo}
            className="h-7 w-7"
            title="撤销 (Ctrl+Z)"
            onClick={() => undo()}
          >
            <Undo2 size={14} />
          </UiIconButton>
          <UiIconButton
            showBorder={false}
            appearance="hover-only"
            disabled={!canRedo}
            className="h-7 w-7"
            title="重做 (Ctrl+Shift+Z)"
            onClick={() => redo()}
          >
            <Redo2 size={14} />
          </UiIconButton>
        </div>

        <div className="flex items-center gap-1.5">
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
          <div className="flex items-center gap-1.5 border-l border-border-dark pl-2">
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

        <div className="ml-auto flex items-center gap-2">
          {shotHint && <span className="max-w-64 truncate text-xs text-text-muted">{shotHint}</span>}
          <span className="max-w-40 truncate text-xs text-text-muted" title={projectName}>
            {projectName}
          </span>
          <UiButton
            size="sm"
            onClick={() => void handleScreenshot()}
            disabled={!canScreenshot || shooting}
            title={canScreenshot ? '导出当前机位取景截图' : '切换到机位视角后可截图'}
            className="py-1.5 text-xs"
          >
            <Camera size={13} className="mr-1" />
            {shooting ? '导出中…' : '截图'}
          </UiButton>
          <UiButton
            size="sm"
            variant="ghost"
            onClick={() => dockRef.current?.resetLayout()}
            title="恢复默认面板布局"
            className="py-1.5 text-xs"
          >
            重置布局
          </UiButton>
          <UiButton
            size="sm"
            onClick={() => void handleSave()}
            disabled={saveState === 'saving'}
            className="py-1.5 text-xs"
          >
            {saveLabel}
          </UiButton>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <CameraStageDock ref={dockRef} captureRef={captureRef} />
      </div>
    </div>
  )
}

export default CameraStageEditor
