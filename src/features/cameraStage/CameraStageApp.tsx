import React, { useEffect, useRef, useState } from 'react'
import CameraStageEditor from './CameraStageEditor'
import CameraStageErrorBoundary from './CameraStageErrorBoundary'
import CameraStageProjectList from './projects/CameraStageProjectList'
import { loadProjectIntoScene } from './projects/cameraStageProjectService'
import { persistDirectorView } from './scene/directorViewState'
import { useCameraStageSessionStore } from './store/cameraStageSessionStore'
import { useCameraStageStore } from './store/cameraStageStore'

/**
 * 3D 镜头参考入口：管理"工程列表 ↔ 场景编辑器"两级视图。
 * 列表页负责新建/打开/重命名/删除并把场景加载进 store，编辑器负责场景搭建与截图。
 */

interface CameraStageAppProps {
  /** 返回工具箱；由工具箱外壳注入，最终落在列表页标题左侧的返回按钮上 */
  onBackToToolbox?: () => void
}

const CameraStageAppInner: React.FC<CameraStageAppProps> = ({ onBackToToolbox }) => {
  const view = useCameraStageSessionStore((state) => state.appView)
  const lastProjectId = useCameraStageSessionStore((state) => state.lastProjectId)
  const stageViewMode = useCameraStageSessionStore((state) => state.stageViewMode)
  const setAppView = useCameraStageSessionStore((state) => state.setAppView)
  const setLastProjectId = useCameraStageSessionStore((state) => state.setLastProjectId)
  const [restoring, setRestoring] = useState(true)
  const restoredProjectIdRef = useRef<string | null>(null)
  const restoreQueueRef = useRef<Promise<void>>(Promise.resolve())
  const restoreTargetRef = useRef({ projectId: lastProjectId, viewMode: stageViewMode })
  if (restoreTargetRef.current.projectId !== lastProjectId) {
    restoreTargetRef.current = { projectId: lastProjectId, viewMode: stageViewMode }
  }

  useEffect(() => {
    let cancelled = false

    const restoreLastSession = async (): Promise<void> => {
      const currentSession = useCameraStageSessionStore.getState()
      if (cancelled || currentSession.appView !== view
        || currentSession.lastProjectId !== lastProjectId) return
      if (view !== 'editor') {
        if (!cancelled) setRestoring(false)
        return
      }
      if (!lastProjectId) {
        setAppView('list')
        if (!cancelled) setRestoring(false)
        return
      }

      if (restoredProjectIdRef.current === lastProjectId) {
        if (!cancelled) setRestoring(false)
        return
      }
      restoredProjectIdRef.current = lastProjectId
      const restoreViewMode = restoreTargetRef.current.projectId === lastProjectId
        ? restoreTargetRef.current.viewMode
        : useCameraStageSessionStore.getState().stageViewMode

      const currentProjectId = useCameraStageStore.getState().currentProjectId
      const shouldLoadProject = currentProjectId !== lastProjectId
      let ok = true
      if (shouldLoadProject) {
        ok = await loadProjectIntoScene(lastProjectId, { updateSession: false })
      }
      if (!ok) {
        if (cancelled || useCameraStageSessionStore.getState().lastProjectId !== lastProjectId) return
        setAppView('list')
        setLastProjectId(null)
        if (!cancelled) setRestoring(false)
        return
      }

      if (cancelled || useCameraStageSessionStore.getState().lastProjectId !== lastProjectId) return
      const stage = useCameraStageStore.getState()
      if (stage.currentProjectId !== lastProjectId) return
      if (stage.viewMode !== restoreViewMode) stage.setViewMode(restoreViewMode)
      if (!cancelled) setRestoring(false)
    }

    restoreQueueRef.current = restoreQueueRef.current.then(restoreLastSession, restoreLastSession)

    return () => {
      cancelled = true
      persistDirectorView()
    }
  }, [lastProjectId, setAppView, setLastProjectId, view])

  if (restoring) {
    return <div className="flex h-full items-center justify-center bg-app text-sm text-text-muted">恢复上次视图中…</div>
  }

  if (view === 'editor') {
    return <CameraStageEditor onBackToList={() => setAppView('list')} />
  }
  return (
    <CameraStageProjectList
      onEnterEditor={() => setAppView('editor')}
      onBackToToolbox={onBackToToolbox}
    />
  )
}

const CameraStageApp: React.FC<CameraStageAppProps> = ({ onBackToToolbox }) => (
  <CameraStageErrorBoundary>
    <CameraStageAppInner onBackToToolbox={onBackToToolbox} />
  </CameraStageErrorBoundary>
)

export default CameraStageApp
