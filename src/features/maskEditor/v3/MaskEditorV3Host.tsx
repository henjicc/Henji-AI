import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { UiError, UiLoading } from '@/components/ui'
import {
  ImageEditorV3CommandRepository,
  createImageEditorV3RequestId,
  loadImageEditorV3Document,
} from '@/commands/imageEditorV3'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import { collectImageEditLayerIdsV3 } from '@/core/imageEdit/v3/layerTypes'
import type {
  ImageEditDocumentRepositoryV3,
  ImageEditPersistenceSnapshotV3,
} from '@/core/imageEdit/v3/serviceContracts'
import { createLogger } from '@/core/logging'
import {
  createImageEditorV3ResourceByteSizes,
  reconcileImageEditorV3ResourceDescriptors,
} from '@/features/imageEdit/v3/application/imageEditorResourceDescriptorsV3'
import { ImageEditorV3 } from '@/features/imageEdit/v3/editor'
import {
  ImageMarkV3PersistenceQueue,
  type ImageMarkV3PersistenceStatus,
} from '@/features/imageMark/standalone/imageMarkV3Persistence'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'

const AUTOSAVE_DELAY_MS = 500
const logger = createLogger('features.mask_editor.v3.host')

interface ReadyState {
  document: ImageEditDocumentV3
  persistence: ImageEditPersistenceSnapshotV3
  descriptors: readonly ImageEditorV3ResourceDescriptor[]
}

type HostState = { kind: 'loading' } | { kind: 'failed'; message: string } | {
  kind: 'ready'
  value: ReadyState
}

export interface MaskEditorV3HostHandle {
  flush(): Promise<ImageEditSessionReferenceV3>
}

export interface MaskEditorV3HostProps {
  sourceImageUrl: string
  sessionReference: ImageEditSessionReferenceV3
  targetLayerId: string
  onSessionChange?: (reference: ImageEditSessionReferenceV3) => void
  toolbarActions?: ReactNode
  className?: string
  repository?: Pick<ImageEditDocumentRepositoryV3, 'save'>
  loadSnapshot?: typeof loadImageEditorV3Document
}

function restorePersistence(
  document: ImageEditDocumentV3,
  historySnapshot: Parameters<ImageEditCommandHistoryV3['restore']>[1] | null,
): ImageEditPersistenceSnapshotV3 {
  const history = new ImageEditCommandHistoryV3()
  if (historySnapshot) history.restore(document, historySnapshot)
  else history.clear(document)
  return {
    document,
    history: history.createSnapshot(),
    retainedResources: history.getRetainedResources(),
  }
}

function toSessionReference(
  sourceUrl: string,
  documentId: string,
  revision: number,
  previewRef: string | null,
): ImageEditSessionReferenceV3 {
  return {
    kind: 'image-edit-v3',
    sourceUrl,
    documentRef: `image-edit-v3:${documentId}`,
    revision,
    previewRef: previewRef as ImageEditSessionReferenceV3['previewRef'],
  }
}

export const MaskEditorV3Host = forwardRef<MaskEditorV3HostHandle, MaskEditorV3HostProps>(
  function MaskEditorV3Host({
    sourceImageUrl,
    sessionReference,
    targetLayerId,
    onSessionChange,
    toolbarActions,
    className,
    repository: repositoryOverride,
    loadSnapshot = loadImageEditorV3Document,
  }, ref): JSX.Element {
    const repository = useMemo(
      () => repositoryOverride ?? new ImageEditorV3CommandRepository(),
      [repositoryOverride],
    )
    const [state, setState] = useState<HostState>({ kind: 'loading' })
    const [attempt, setAttempt] = useState(0)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState(false)
    const queueRef = useRef<ImageMarkV3PersistenceQueue | null>(null)
    const snapshotRef = useRef<ImageEditPersistenceSnapshotV3 | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const persistedSessionRef = useRef(sessionReference)
    const effectiveSession = attempt > 0 ? persistedSessionRef.current : sessionReference
    const referenceDocumentRef = effectiveSession.documentRef
    const referencePreviewRef = effectiveSession.previewRef
    const referenceRevision = effectiveSession.revision
    const referenceSourceUrl = effectiveSession.sourceUrl
    const onSessionChangeRef = useRef(onSessionChange)
    onSessionChangeRef.current = onSessionChange

    const handleStatus = useCallback((status: ImageMarkV3PersistenceStatus): void => {
      setSaving(status.kind === 'saving')
      if (status.kind === 'failed') {
        setSaveError(true)
        logger.error('V3 蒙版自动保存失败', status.error, {
          event: 'mask_editor.v3.autosave.failed',
          context: { documentRef: referenceDocumentRef },
        })
        return
      }
      if (status.kind !== 'idle') return
      setSaveError(false)
      const reference = toSessionReference(
        sourceImageUrl,
        status.reference.documentId,
        status.reference.revision,
        status.reference.previewRef,
      )
      persistedSessionRef.current = reference
      onSessionChangeRef.current?.(reference)
    }, [referenceDocumentRef, sourceImageUrl])

    useEffect(() => {
      const controller = new AbortController()
      setState({ kind: 'loading' })
      queueRef.current = null
      snapshotRef.current = null
      persistedSessionRef.current = {
        kind: 'image-edit-v3',
        sourceUrl: referenceSourceUrl,
        documentRef: referenceDocumentRef,
        revision: referenceRevision,
        previewRef: referencePreviewRef,
      }
      logger.info('V3 蒙版宿主开始加载权威会话', {
        event: 'mask_editor.v3.bootstrap.start',
        context: { documentRef: referenceDocumentRef, revision: referenceRevision },
      })
      void loadSnapshot({
        requestId: createImageEditorV3RequestId('mask-host-load'),
        documentRef: referenceDocumentRef,
      }, controller.signal).then((snapshot) => {
        if (controller.signal.aborted) return
        const documentId = referenceDocumentRef.slice('image-edit-v3:'.length)
        if (!snapshot
          || referenceSourceUrl !== sourceImageUrl
          || snapshot.documentRef !== referenceDocumentRef
          || snapshot.document.id !== documentId
          || snapshot.revision !== referenceRevision
          || snapshot.document.revision !== referenceRevision
          || snapshot.previewRef !== referencePreviewRef) {
          throw new Error('蒙版会话 source/ref/revision 与权威快照不一致')
        }
        if (!collectImageEditLayerIdsV3(snapshot.document.layers).includes(targetLayerId)) {
          throw new Error('蒙版会话目标图层不存在')
        }
        const persistence = restorePersistence(snapshot.document, snapshot.history)
        snapshotRef.current = persistence
        queueRef.current = new ImageMarkV3PersistenceQueue({
          repository,
          initialReference: {
            documentId,
            revision: snapshot.revision,
            previewRef: snapshot.previewRef,
          },
          initialHistory: persistence.history,
          onStatusChange: handleStatus,
        })
        setState({
          kind: 'ready',
          value: { document: snapshot.document, persistence, descriptors: snapshot.resources },
        })
        logger.info('V3 蒙版宿主权威会话加载完成', {
          event: 'mask_editor.v3.bootstrap.completed',
          context: { documentId, revision: snapshot.revision, targetLayerId },
        })
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        setState({ kind: 'failed', message })
        logger.error('V3 蒙版宿主权威会话加载失败', error, {
          event: 'mask_editor.v3.bootstrap.failed',
          context: { documentRef: referenceDocumentRef, targetLayerId },
        })
      })
      return () => controller.abort()
    }, [
      attempt,
      handleStatus,
      loadSnapshot,
      referenceDocumentRef,
      referencePreviewRef,
      referenceRevision,
      referenceSourceUrl,
      repository,
      sourceImageUrl,
      targetLayerId,
    ])

    const flush = useCallback(async (): Promise<ImageEditSessionReferenceV3> => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const queue = queueRef.current
      const snapshot = snapshotRef.current
      if (!queue || !snapshot) throw new Error('V3 蒙版宿主尚未加载完成')
      queue.enqueue(snapshot)
      await queue.flush()
      return persistedSessionRef.current
    }, [])

    useImperativeHandle(ref, () => ({ flush }), [flush])
    useEffect(() => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }, [])

    const handlePersistenceChange = useCallback((snapshot: ImageEditPersistenceSnapshotV3): void => {
      snapshotRef.current = snapshot
      setState((current) => {
        if (current.kind !== 'ready') return current
        const descriptors = reconcileImageEditorV3ResourceDescriptors(
          snapshot.document,
          current.value.descriptors,
          snapshot.retainedResources,
        )
        return {
          kind: 'ready',
          value: { document: snapshot.document, persistence: snapshot, descriptors },
        }
      })
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void flush().catch(() => undefined)
      }, AUTOSAVE_DELAY_MS)
    }, [flush])

    if (state.kind === 'loading') return <UiLoading message="正在打开可编辑蒙版…" className={className} />
    if (state.kind === 'failed') {
      return (
        <UiError
          title="无法打开可编辑蒙版"
          message={state.message}
          onRetry={() => setAttempt((value) => value + 1)}
          className={className}
        />
      )
    }
    return (
      <ImageEditorV3
        sourceImageUrl={sourceImageUrl}
        document={state.value.document}
        historySnapshot={state.value.persistence.history}
        resourceByteSizes={createImageEditorV3ResourceByteSizes(state.value.descriptors)}
        resourceDescriptors={state.value.descriptors}
        profileId="mask"
        initialSelectedLayerId={targetLayerId}
        initialToolId="mask-edit"
        onDocumentChange={(document) => setState((current) => current.kind === 'ready'
          ? { ...current, value: { ...current.value, document } }
          : current)}
        onPersistenceChange={handlePersistenceChange}
        onReloadEditor={() => setAttempt((value) => value + 1)}
        toolbarActions={(
          <>
            {saving ? <span role="status" className="text-xs text-text-muted">正在保存…</span> : null}
            {saveError ? <span role="alert" className="text-xs text-danger">自动保存失败，请重试</span> : null}
            {toolbarActions}
          </>
        )}
        className={className}
      />
    )
  },
)
