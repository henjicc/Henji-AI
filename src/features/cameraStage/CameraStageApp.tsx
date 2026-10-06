import React, { useCallback, useEffect, useRef, useState } from 'react'
import { UiLoading } from '@/components/ui'
import { useNotification } from '@/contexts/NotificationContext'
import { ICON_TOOL_CAMERA_STAGE } from '@/core/theme/icons'
import { DocumentLibraryPage } from '@/features/documents/DocumentLibraryPage'
import { returnFromEmbedded } from '@/features/documents/embeddedDocuments'
import CameraStageEditor from './CameraStageEditor'
import CameraStageErrorBoundary from './CameraStageErrorBoundary'
import {
  CameraStageLeaveCancelledError,
  createDraftCameraStageDocument,
  leaveCameraStageEditor,
  loadProjectIntoScene,
  openCameraStageDocument,
} from './projects/cameraStageProjectService'
import { persistDirectorView } from './scene/directorViewState'
import { useCameraStageSessionStore } from './store/cameraStageSessionStore'
import { useCameraStageStore } from './store/cameraStageStore'

/**
 * 3D 镜头参考入口：“镜头参考列表 ↔ 场景编辑器”两级视图。
 *
 * 列表整页是通用文档页（DocumentLibraryPage kind="camera_stage"，3.2）：取数、筛选、草稿区与右键操作
 * （重命名、移到项目、移出项目、创建副本、在文件夹中显示、删除、从列表移除）都由通用组件负责；
 * 这里只提供“新建镜头参考”（草稿）与打开方式。编辑器返回时走通用离开流程（草稿询问保存）。
 */

interface CameraStageAppProps {
  /** 返回工具首页；由工具外壳注入，最终落在列表页标题左侧的返回按钮上 */
  onBackToToolbox?: () => void
}

const describeDocument = (document: { summary: Record<string, string | number | boolean | null> }): string => {
  const objects = Number(document.summary.objects ?? 0)
  return `${Number.isFinite(objects) ? objects : 0} 个对象`
}

const CameraStageAppInner: React.FC<CameraStageAppProps> = ({ onBackToToolbox }) => {
  const { showNotification } = useNotification()
  const view = useCameraStageSessionStore((state) => state.appView)
  const lastDocumentId = useCameraStageSessionStore((state) => state.lastDocumentId)
  const stageViewMode = useCameraStageSessionStore((state) => state.stageViewMode)
  const setAppView = useCameraStageSessionStore((state) => state.setAppView)
  const setLastDocumentId = useCameraStageSessionStore((state) => state.setLastDocumentId)
  const [restoring, setRestoring] = useState(true)
  const [busy, setBusy] = useState(false)
  const restoredDocumentIdRef = useRef<string | null>(null)
  const restoreQueueRef = useRef<Promise<void>>(Promise.resolve())
  const restoreTargetRef = useRef({ documentId: lastDocumentId, viewMode: stageViewMode })
  if (restoreTargetRef.current.documentId !== lastDocumentId) {
    restoreTargetRef.current = { documentId: lastDocumentId, viewMode: stageViewMode }
  }

  const notifyError = useCallback((error: unknown) => {
    if (error instanceof CameraStageLeaveCancelledError) return
    showNotification(error instanceof Error ? error.message : '操作失败，请重试', 'error')
  }, [showNotification])

  useEffect(() => {
    let cancelled = false

    const restoreLastSession = async (): Promise<void> => {
      const currentSession = useCameraStageSessionStore.getState()
      if (cancelled || currentSession.appView !== view
        || currentSession.lastDocumentId !== lastDocumentId) return
      if (view !== 'editor') {
        if (!cancelled) setRestoring(false)
        return
      }
      if (!lastDocumentId) {
        setAppView('list')
        if (!cancelled) setRestoring(false)
        return
      }

      if (restoredDocumentIdRef.current === lastDocumentId) {
        if (!cancelled) setRestoring(false)
        return
      }
      restoredDocumentIdRef.current = lastDocumentId
      const restoreViewMode = restoreTargetRef.current.documentId === lastDocumentId
        ? restoreTargetRef.current.viewMode
        : useCameraStageSessionStore.getState().stageViewMode

      const currentDocumentId = useCameraStageStore.getState().currentProjectId
      let ok = true
      if (currentDocumentId !== lastDocumentId) {
        ok = await loadProjectIntoScene(lastDocumentId, { updateSession: false }).catch(() => false)
      }
      if (!ok) {
        if (cancelled || useCameraStageSessionStore.getState().lastDocumentId !== lastDocumentId) return
        setAppView('list')
        setLastDocumentId(null)
        if (!cancelled) setRestoring(false)
        return
      }

      if (cancelled || useCameraStageSessionStore.getState().lastDocumentId !== lastDocumentId) return
      const stage = useCameraStageStore.getState()
      if (stage.currentProjectId !== lastDocumentId) return
      if (stage.viewMode !== restoreViewMode) stage.setViewMode(restoreViewMode)
      if (!cancelled) setRestoring(false)
    }

    restoreQueueRef.current = restoreQueueRef.current.then(restoreLastSession, restoreLastSession)

    return () => {
      cancelled = true
      persistDirectorView()
    }
  }, [lastDocumentId, setAppView, setLastDocumentId, view])

  const handleCreate = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      await createDraftCameraStageDocument()
    } catch (error) {
      notifyError(error)
    } finally {
      setBusy(false)
    }
  }, [notifyError])

  const handleBackToList = useCallback(async (): Promise<void> => {
    try {
      // 从剪辑里打开的（4.1 嵌入模式）离开后回到剪辑；其余回到列表
      const documentId = useCameraStageStore.getState().currentProjectId
      if (documentId) await returnFromEmbedded(documentId, leaveCameraStageEditor)
      else await leaveCameraStageEditor()
    } catch (error) {
      notifyError(error)
    }
  }, [notifyError])

  if (restoring) {
    return <div className="h-full bg-window"><UiLoading className="h-full" message="正在打开上次的镜头参考…" /></div>
  }

  if (view === 'editor') {
    return <CameraStageEditor onBackToList={handleBackToList} />
  }
  return (
    <DocumentLibraryPage
      kind="camera_stage"
      title="3D 镜头参考"
      onBack={onBackToToolbox}
      backLabel="返回工具"
      icon={ICON_TOOL_CAMERA_STAGE}
      describe={describeDocument}
      busy={busy}
      labels={{ emptyDescription: '新建第一个镜头参考，开始搭建场景。' }}
      create={{ kind: 'direct', onCreate: () => void handleCreate() }}
      onOpen={(document) => openCameraStageDocument({ id: document.id, path: document.path })}
    />
  )
}

const CameraStageApp: React.FC<CameraStageAppProps> = ({ onBackToToolbox }) => (
  <CameraStageErrorBoundary>
    <CameraStageAppInner onBackToToolbox={onBackToToolbox} />
  </CameraStageErrorBoundary>
)

export default CameraStageApp
