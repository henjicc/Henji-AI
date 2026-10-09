import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UiButton, UiError, UiLoading } from '@/components/ui'
import { createLogger } from '@/core/logging'
import { parseImageEditSessionReferenceV3, type ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import type { ImageEditPersistenceSnapshotV3 } from '@/core/imageEdit/v3/serviceContracts'
import { ImageEditorV3CommandRepository, loadImageEditorV3Document } from '@/commands/imageEditorV3'
import { ImageEditorV3 } from '@/features/imageEdit/v3/editor'
import { getOrCreateImageEditPersistenceQueueV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
import { flushImageEditHostPersistenceV3 } from '@/features/imageEdit/v3/application/imageEditPersistenceOperations'
import type { ImageEditPersistenceV3Queue } from '@/features/imageEdit/v3/application/imageEditPersistenceQueue'
import { prepareImageEditManagedSessionV3 } from '@/features/imageEdit/v3/application/imageEditManagedSessionV3'
import { materializeImageEditSnapshotV3 } from '@/features/imageEdit/v3/application/imageEditMaterializationV3'

const logger = createLogger('features.imageMark.viewer')
type Prepared = Awaited<ReturnType<typeof prepareImageEditManagedSessionV3>>

export interface ViewerMarkEditorProps {
  imageUrl: string
  session?: ImageEditSessionReferenceV3
  onClose: () => void
  onSave: (mediaUrl: string, session: ImageEditSessionReferenceV3) => void
  onSessionChange?: (session: ImageEditSessionReferenceV3) => void
}

/** 查看器仅裁剪工具集合；文档、命令、历史、保存及导出均复用 V3。 */
export function ViewerMarkEditor({ imageUrl, session, onClose, onSave, onSessionChange }: ViewerMarkEditorProps): JSX.Element {
  const { t } = useTranslation('ui')
  const repository = useMemo(() => new ImageEditorV3CommandRepository(), [])
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const queueRef = useRef<ImageEditPersistenceV3Queue | null>(null)
  const persistenceRef = useRef<ImageEditPersistenceSnapshotV3 | null>(null)
  const lifecycleRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const persistenceHost = useMemo(() => ({ getQueue: () => queueRef.current }), [])
  const sessionRef = useRef(session)
  sessionRef.current = session

  useEffect(() => {
    const controller = new AbortController()
    lifecycleRef.current = controller
    setPrepared(null)
    setFailed(false)
    queueRef.current = null
    persistenceRef.current = null
    void (async () => {
      await Promise.resolve()
      if (controller.signal.aborted) return
      try {
        const result = await prepareImageEditManagedSessionV3({
          sourceImageUrl: imageUrl, session: sessionRef.current, repository, signal: controller.signal,
        })
        if (controller.signal.aborted) return
        queueRef.current = getOrCreateImageEditPersistenceQueueV3({
          repository, initialReference: result.reference, initialHistory: result.history,
        })
        persistenceRef.current = result.persistence
        setPrepared(result)
      } catch (error) {
        if (controller.signal.aborted) return
        logger.error('快速标记准备失败', error, { event: 'image_mark.viewer.prepare.failed' })
        setFailed(true)
      }
    })()
    return () => controller.abort()
  }, [attempt, imageUrl, repository])

  const handleSave = useCallback(async (): Promise<void> => {
    const queue = queueRef.current
    const persistence = persistenceRef.current
    if (!queue || !persistence || busyRef.current) return
    busyRef.current = true
    setSaving(true)
    setFailed(false)
    const signal = lifecycleRef.current?.signal
    logger.info('快速标记保存开始', { event: 'image_mark.viewer.save.start' })
    try {
      const reference = await flushImageEditHostPersistenceV3(queue, persistence)
      const snapshot = await loadImageEditorV3Document({
        requestId: `viewer-export:${reference.documentId}:${reference.revision}`,
        documentRef: `image-edit-v3:${reference.documentId}`,
      }, signal)
      if (!snapshot || snapshot.document.id !== reference.documentId || snapshot.document.revision !== reference.revision || snapshot.revision !== reference.revision) {
        throw new Error('快速标记的保存结果与导出快照不一致')
      }
      const result = await materializeImageEditSnapshotV3(snapshot, 'edited.png', signal)
      if (signal?.aborted) return
      if (persistenceRef.current?.document.revision !== reference.revision) throw new Error('导出期间图片已修改，请再次保存')
      queue.confirmProjectionReference({ documentId: reference.documentId, revision: reference.revision, previewRef: result.session.previewRef })
      const nextSession = { ...result.session, sourceUrl: prepared?.sourceUrl ?? imageUrl }
      onSessionChange?.(nextSession)
      onSave(result.raster.mediaUrl, nextSession)
      logger.info('快速标记保存完成', { event: 'image_mark.viewer.save.completed' })
    } catch (error) {
      if (signal?.aborted) return
      logger.error('快速标记保存失败', error, { event: 'image_mark.viewer.save.failed' })
      setFailed(true)
    } finally {
      busyRef.current = false
      if (!signal?.aborted) setSaving(false)
    }
  }, [imageUrl, onSave, onSessionChange, prepared?.sourceUrl])

  const handleClose = async (): Promise<void> => {
    const queue = queueRef.current
    const persistence = persistenceRef.current
    if (!queue || !persistence || busyRef.current) return
    busyRef.current = true
    setSaving(true)
    try {
      const reference = await flushImageEditHostPersistenceV3(queue, persistence)
      if (lifecycleRef.current?.signal.aborted) return
      const nextSession = parseImageEditSessionReferenceV3({ kind: 'image-edit-v3', documentRef: `image-edit-v3:${reference.documentId}`, revision: reference.revision, previewRef: reference.previewRef, sourceUrl: prepared?.sourceUrl ?? imageUrl }, imageUrl)
      if (!nextSession) throw new Error('图片保存引用无效')
      onSessionChange?.(nextSession)
      onClose()
    } catch (error) {
      logger.error('快速标记关闭前保存失败', error, { event: 'image_mark.viewer.close.failed' })
      if (!lifecycleRef.current?.signal.aborted) setFailed(true)
    } finally { busyRef.current = false; if (!lifecycleRef.current?.signal.aborted) setSaving(false) }
  }

  if (!prepared) return failed
    ? <UiError title={t('imageEditor.v3.host.bootstrapError.title')} message={t('imageEditor.v3.host.bootstrapError.message')} onRetry={() => setAttempt(value => value + 1)} />
    : <UiLoading message={t('imageEditor.v3.host.loading')} />
  return (
    <div className="h-full w-full bg-window">
      {failed && <UiError title={t('imageEditor.v3.host.notifications.autosaveFailed')} message={t('imageEditor.v3.host.notifications.saveBeforeReplaceFailed')} onRetry={() => void handleSave()} />}
      <ImageEditorV3
        key={prepared.document.id}
        sourceImageUrl={prepared.sourceUrl}
        document={prepared.document}
        historySnapshot={prepared.history}
        resourceByteSizes={prepared.resourceByteSizes}
        resourceDescriptors={prepared.resourceDescriptors}
        profileId="quick"
        persistenceHost={persistenceHost}
        onDocumentChange={document => setPrepared(current => current ? { ...current, document } : current)}
        onPersistenceChange={snapshot => { persistenceRef.current = snapshot }}
        toolbarActions={<>
          <UiButton variant="secondary" disabled={saving} onClick={() => void handleClose()}>{t('common.close', '关闭')}</UiButton>
          <UiButton variant="primary" disabled={saving} onClick={() => void handleSave()}>{t('common.save')}</UiButton>
        </>}
        className="h-full"
      />
    </div>
  )
}
