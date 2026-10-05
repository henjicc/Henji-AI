import { useCallback } from 'react'
import type { DocumentSessionState } from '@/features/documents/documentSessionTypes'
import { useDocumentSessionState } from '@/features/documents/useDocumentSessionState'
import { findCameraStageProjectInstance } from '../application/cameraStageProjectRuntime'
import { useCameraStageStore } from '../store/cameraStageStore'

/**
 * 编辑器订阅当前镜头参考文档的保存状态（通用文档会话负责自动保存与失败重试，3.2）。
 * `retry` 手动重试一次（保存失败时提供给用户）。
 */
export function useCameraStageAutosave(): { saveState: DocumentSessionState | null; retry: () => Promise<void> } {
  const documentId = useCameraStageStore((state) => state.currentProjectId)
  const session = documentId ? findCameraStageProjectInstance(documentId)?.session ?? null : null
  const saveState = useDocumentSessionState(session)
  const retry = useCallback(async () => { if (session) await session.retry() }, [session])
  return { saveState, retry }
}
