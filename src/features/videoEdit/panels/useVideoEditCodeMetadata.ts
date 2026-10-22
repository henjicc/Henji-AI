import { useEffect, useState, useSyncExternalStore } from 'react'
import type { CodeMaterialInstance } from '@/core/videoEdit/codeMaterialPersistence'
import type { VideoEditInstance } from '../application/videoEditService'
import { ensureVideoEditCodeParameterMetadata, peekVideoEditCodeProgram, subscribeVideoEditCodeMetadata, videoEditCodeMetadataRevision } from '../application/videoEditCodeState'

/** 参数和元素编辑共享同一按需读取状态；切换片段后不接收旧请求的错误。 */
export function useVideoEditCodeMetadata(owner: VideoEditInstance, code?: CodeMaterialInstance) {
  useSyncExternalStore(subscribeVideoEditCodeMetadata, videoEditCodeMetadataRevision)
  const [failure, setFailure] = useState<{ key: string; error: unknown }>()
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([owner.document.id, code?.definitionId, code?.versionId])
  useEffect(() => {
    let current = true
    if (code) void ensureVideoEditCodeParameterMetadata(owner, owner.document, code.definitionId, code.versionId).catch(error => { if (current) setFailure({ key, error }) })
    return () => { current = false }
  }, [owner, key, code, attempt])
  return {
    ready: !code || Boolean(peekVideoEditCodeProgram(owner, code.versionId)),
    error: failure?.key === key ? failure.error : undefined,
    retry: () => { setFailure(undefined); setAttempt(value => value + 1) },
  }
}
