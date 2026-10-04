import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { touchAsset } from '@/commands/assetLibrary'
import { AudioViewerModal } from '@/components/mediaViewer/AudioViewerModal'
import { ImageViewerModal } from '@/components/mediaViewer/ImageViewerModal'
import { VideoViewerModal } from '@/components/mediaViewer/VideoViewerModal'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { UiButton, UiEmpty, UiError, UiLoading, UiModal, UI_TEXT_BODY_CLASS, UI_TEXT_META_CLASS } from '@/components/ui'
import { useUiOverlayLayer } from '@/components/ui/overlayOwnership'
import { ICON_ASSET_CODE } from '@/core/theme/icons'
import { createLogger } from '@/core/logging'
import { useI18n } from '@/hooks/useI18n'
import { activeVideoEditInstance, subscribeVideoEdit } from '@/features/videoEdit/application/videoEditService'
import { importVideoEditCodeAsset, readVideoEditCodeAsset } from '@/features/videoEdit/application/videoEditCodeAssets'

interface Props { asset: AssetRecord | null; onClose: () => void }
const logger = createLogger('features.assets.preview')
type CodeAssetRead = Awaited<ReturnType<typeof readVideoEditCodeAsset>>
type CodePreviewState = { status: 'loading' } | { status: 'ready'; result: CodeAssetRead } | { status: 'error'; message: string }

/** A library preview reads a bounded manifest. Compilation belongs to import. */
function CodeAssetPreview({ asset, onClose }: { asset: AssetRecord; onClose: () => void }): JSX.Element {
  const { t } = useI18n('ui')
  const owner = useSyncExternalStore(subscribeVideoEdit, activeVideoEditInstance)
  const [state, setState] = useState<CodePreviewState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [imported, setImported] = useState<'item' | 'effect' | null>(null)
  const readController = useRef<AbortController | null>(null)
  const importController = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    readController.current = controller
    setState({ status: 'loading' })
    void readVideoEditCodeAsset(asset.id, controller.signal).then(result => {
      if (!controller.signal.aborted) setState({ status: 'ready', result })
    }).catch(reason => {
      if (controller.signal.aborted) return
      logger.warn('代码资产预览未能读取', { event: 'asset.code_preview.read.failed', error: reason, context: { assetId: asset.id } })
      setState({ status: 'error', message: reason instanceof Error ? reason.message : t('assetLibrary.codeReadFailed') })
    })
    return () => {
      controller.abort(new Error('代码资产预览已关闭或切换。'))
      if (readController.current === controller) readController.current = null
    }
  }, [asset.id, attempt, t])

  useEffect(() => {
    importController.current?.abort(new Error('原剪辑工程已切换。'))
    importController.current = null
    setBusy(false)
    setImportError(null)
    setImported(null)
    return () => {
      importController.current?.abort(new Error('代码资产导入界面已关闭。'))
      importController.current = null
    }
  }, [owner])

  const close = (): void => {
    readController.current?.abort(new Error('代码资产预览已关闭。'))
    importController.current?.abort(new Error('代码资产导入界面已关闭。'))
    onClose()
  }

  const importAsset = async (): Promise<void> => {
    if (state.status !== 'ready' || importController.current) return
    const originalOwner = activeVideoEditInstance()
    if (!originalOwner) { setImportError(t('assetLibrary.codeOpenProject')); return }
    const projectId = originalOwner.document.id
    const options = {
      ...(originalOwner.selectedBinId ? { binId: originalOwner.selectedBinId } : {}),
      ...(originalOwner.selection ? { filterTarget: { sequenceId: originalOwner.activeSequenceId, clipId: originalOwner.selection } } : {}),
    }
    const controller = new AbortController()
    importController.current = controller
    setBusy(true); setImportError(null); setImported(null)
    try {
      const result = await importVideoEditCodeAsset(projectId, asset.id, options, controller.signal)
      if (!controller.signal.aborted && activeVideoEditInstance() === originalOwner) setImported(result.itemId ? 'item' : 'effect')
    } catch (reason) {
      if (!controller.signal.aborted && activeVideoEditInstance() === originalOwner) setImportError(reason instanceof Error ? reason.message : t('assetLibrary.codeImportFailed'))
    } finally {
      if (importController.current === controller) { importController.current = null; setBusy(false) }
    }
  }

  return (
    <UiModal isOpen title={t('assetLibrary.code')} onClose={close} footer={state.status === 'ready' && (
      <UiButton variant="primary" data-asset-code-import disabled={state.status !== 'ready' || !owner || busy} onClick={() => void importAsset()}>
        {busy ? t('assetLibrary.codeImporting') : t('assetLibrary.codeImport')}
      </UiButton>
    )}>
      <div data-asset-code-preview className="space-y-4">
        {state.status === 'loading' ? <UiLoading size="sm" message={t('assetLibrary.codeReading')} /> : state.status === 'error' ? (
          <UiError size="sm" message={state.message} onRetry={() => setAttempt(value => value + 1)} retryLabel={t('assetLibrary.retry')} />
        ) : (
          <>
            <div className="flex items-center gap-3"><ICON_ASSET_CODE className="h-8 w-8 shrink-0 text-text-muted" /><div className="min-w-0"><div className={`break-words ${UI_TEXT_BODY_CLASS}`}>{state.result.manifest.name}</div><div className={UI_TEXT_META_CLASS}>{t('assetLibrary.codeParameters', { count: Object.keys(state.result.manifest.parameters).length })}</div></div></div>
            <p className={UI_TEXT_META_CLASS}>{t('assetLibrary.codeEditableHint')}</p>
            {state.result.manifest.images.length > 0 && <p className={UI_TEXT_META_CLASS}>{t('assetLibrary.codeImages', { count: state.result.manifest.images.length })}</p>}
            {!owner && <UiEmpty size="xs" title={t('assetLibrary.codeOpenProject')} />}
            {busy && <UiLoading size="xs" message={t('assetLibrary.codeImporting')} />}
            {importError && <UiError size="xs" message={importError} />}
            {imported && <UiEmpty size="xs" title={t(imported === 'item' ? 'assetLibrary.codeImportedItem' : 'assetLibrary.codeImportedEffect')} />}
          </>
        )}
      </div>
    </UiModal>
  )
}

/** Media keeps its existing viewer; editable code has a read-only manifest view. */
export const AssetPreviewOverlay: React.FC<Props> = ({ asset, onClose }) => {
  const [lastAsset, setLastAsset] = useState<AssetRecord | null>(asset)
  useEffect(() => {
    if (asset) {
      setLastAsset(asset)
      void touchAsset(asset.id).catch(reason => logger.warn('资产最近使用记录未更新', { event: 'asset.preview.touch.failed', error: reason, context: { assetId: asset.id } }))
    }
  }, [asset])
  const media = asset ?? lastAsset
  // 预览是资产面板的子浮层：打开期间入栈，面板的点外关闭与 Escape 让位（任务 4.3 浮层归属）
  const overlay = useUiOverlayLayer(Boolean(asset), { modal: true })

  return createPortal(
    <div className="contents" data-asset-preview={asset ? 'open' : 'closed'} {...overlay.layerProps}>
      <ImageViewerModal
        open={asset?.mediaType === 'image'}
        imageUrl={media?.mediaType === 'image' ? media.displayUrl : ''}
        imageList={media?.mediaType === 'image' ? [media.displayUrl] : []}
        filePaths={media?.mediaType === 'image' ? [media.filePath] : []}
        infoSource={media?.mediaType === 'image' ? media.filePath : undefined}
        currentIndex={0}
        onClose={onClose}
        onNavigate={() => undefined}
      />
      <VideoViewerModal
        open={asset?.mediaType === 'video'}
        videoUrl={media?.mediaType === 'video' ? media.displayUrl : ''}
        filePath={media?.mediaType === 'video' ? media.filePath : undefined}
        onClose={onClose}
      />
      <AudioViewerModal
        open={asset?.mediaType === 'audio'}
        audioUrl={media?.mediaType === 'audio' ? media.displayUrl : ''}
        filePath={media?.mediaType === 'audio' ? media.filePath : undefined}
        autoPlay
        onClose={onClose}
      />
      {asset?.mediaType === 'code' && <CodeAssetPreview key={JSON.stringify([asset.id, asset.filePath, asset.contentIdentity])} asset={asset} onClose={onClose} />}
    </div>,
    document.body,
  )
}
