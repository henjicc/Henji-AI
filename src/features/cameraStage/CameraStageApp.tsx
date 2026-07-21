import React, { useEffect, useRef, useState } from 'react'
import CameraStageEditor from './CameraStageEditor'
import CameraStageErrorBoundary from './CameraStageErrorBoundary'
import { loadProjectIntoScene } from './projects/cameraStageProjectService'
import CameraStageProjectList from './projects/CameraStageProjectList'
import { persistDirectorView } from './scene/directorViewState'
import { useCameraStageSessionStore } from './store/cameraStageSessionStore'
import { useCameraStageStore } from './store/cameraStageStore'

/**
 * 3D 镜头参考入口：管理"工程列表 ↔ 场景编辑器"两级视图。
 * 列表页负责新建/打开/重命名/删除并把场景加载进 store，编辑器负责场景搭建与截图。
 */

const CameraStageAppInner: React.FC = () => {
  const view = useCameraStageSessionStore((state) => state.appView)
  const lastProjectId = useCameraStageSessionStore((state) => state.lastProjectId)
  const stageViewMode = useCameraStageSessionStore((state) => state.stageViewMode)
  const setAppView = useCameraStageSessionStore((state) => state.setAppView)
  const setLastProjectId = useCameraStageSessionStore((state) => state.setLastProjectId)
  const [restoring, setRestoring] = useState(true)
  const restoredSessionKeyRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const restoreLastSession = async (): Promise<void> => {
      if (view !== 'editor') {
        if (!cancelled) setRestoring(false)
        return
      }
      if (!lastProjectId) {
        setAppView('list')
        if (!cancelled) setRestoring(false)
        return
      }

      const sessionKey = `${lastProjectId}:${stageViewMode}`
      if (restoredSessionKeyRef.current === sessionKey) {
        if (!cancelled) setRestoring(false)
        return
      }
      restoredSessionKeyRef.current = sessionKey

      const currentProjectId = useCameraStageStore.getState().currentProjectId
      const shouldLoadProject = currentProjectId !== lastProjectId
      const ok = shouldLoadProject ? await loadProjectIntoScene(lastProjectId) : true
      if (!ok) {
        setAppView('list')
        setLastProjectId(null)
        if (!cancelled) setRestoring(false)
        return
      }

      const stage = useCameraStageStore.getState()
      if (stage.viewMode !== stageViewMode) stage.setViewMode(stageViewMode)
      if (!cancelled) setRestoring(false)
    }

    void restoreLastSession()

    return () => {
      cancelled = true
      persistDirectorView()
    }
  }, [lastProjectId, setAppView, setLastProjectId, stageViewMode, view])

  if (restoring) {
    return <div className="flex h-full items-center justify-center bg-app text-sm text-text-muted">恢复上次视图中…</div>
  }

  if (view === 'editor') {
    return <CameraStageEditor onBackToList={() => setAppView('list')} />
  }
  return <CameraStageProjectList onEnterEditor={() => setAppView('editor')} />
}

const CameraStageApp: React.FC = () => (
  <CameraStageErrorBoundary>
    <CameraStageAppInner />
  </CameraStageErrorBoundary>
)

export default CameraStageApp
