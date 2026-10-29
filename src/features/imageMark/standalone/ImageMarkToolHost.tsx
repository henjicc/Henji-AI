import { ApplicationOperationReviewBanner } from '@/features/application-control'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  UiButton,
  UiError,
  UiIconButton,
  UiLoading,
  UiPageHeader,
  UiRegion,
} from '@/components/ui'
import { ImageEditorV3 } from '@/features/imageEdit/v3/editor'
import { useEmbeddedHost } from '@/features/documents/embeddedDocuments'
import { ImageMarkToolToolbarActions } from './ImageMarkToolToolbarActions'
import {
  useImageMarkToolHost,
  type ImageMarkToolHostProps,
} from './useImageMarkToolHost'

export type { ImageMarkToolHostProps } from './useImageMarkToolHost'

export function ImageMarkToolHost(props: ImageMarkToolHostProps): JSX.Element {
  const { t } = useTranslation('ui')
  const host = useImageMarkToolHost(props)
  // 嵌入文档的返回动作需要携带剪辑名称，避免混淆导航目标。
  const embeddedHost = useEmbeddedHost(props.document.id)
  const {
    onBack,
    onOpenFile,
    onPasteFromClipboard,
    onCreateBlank,
    onSave,
    onSaveAs,
  } = props

  if (host.bootstrap.kind !== 'ready') {
    return (
      <div
        data-image-editor-v3-host-state={host.bootstrap.kind}
        className="flex h-full flex-col overflow-hidden bg-window p-6"
      >
        <UiRegion maxWidthClassName="max-w-6xl" className="mx-auto w-full">
          <UiPageHeader
            title={t('imageEditor.v3.title')}
            onBack={onBack}
            backLabel={t('imageEditor.v3.host.backToList')}
          />
        </UiRegion>
        {host.bootstrap.kind === 'loading' ? (
          <UiLoading
            message={t('imageEditor.v3.host.loading')}
            className="min-h-0 flex-1"
          />
        ) : (
          <UiError
            className="min-h-0 flex-1"
            title={t('imageEditor.v3.host.bootstrapError.title')}
            message={t('imageEditor.v3.host.bootstrapError.message')}
            onRetry={host.retryBootstrap}
          />
        )}
      </div>
    )
  }

  const backButton = onBack && embeddedHost ? (
    <UiButton disabled={host.isHostBusy} onClick={onBack}>
      <ArrowLeft  />
      {t('documentLibrary.embedded.returnTo', { name: embeddedHost.label })}
    </UiButton>
  ) : onBack ? (
    <UiIconButton
      size="md"
      tooltip={t('imageEditor.v3.host.backToList')}
      aria-label={t('imageEditor.v3.host.backToList')}
      disabled={host.isHostBusy}
      onClick={onBack}
    >
      <ArrowLeft  />
    </UiIconButton>
  ) : null

  return (
    <>
    <ApplicationOperationReviewBanner documentId={props.document.id} domain="image_edit" label="图片" />
    <ImageEditorV3
      layoutWorkspaceId="toolbox"
      sourceImageUrl={host.sourceImageUrl}
      document={host.bootstrap.document}
      historySnapshot={host.bootstrap.history}
      resourceByteSizes={host.bootstrap.resourceByteSizes}
      resourceDescriptors={host.bootstrap.resourceDescriptors}
      profileId="full"
      onDocumentChange={host.handleDocumentChange}
      onPersistenceChange={host.handlePersistenceChange}
      persistenceHost={host.persistenceHost}
      onPackageThumbnailChange={host.handlePackageThumbnailChange}
      onReloadEditor={host.retryBootstrap}
      recoveryKey={props.document.id}
      toolbarLeading={backButton}
      toolbarActions={(
        <ImageMarkToolToolbarActions
          host={host}
          onOpenFile={onOpenFile}
          onPasteFromClipboard={onPasteFromClipboard}
          onCreateBlank={onCreateBlank}
          onSave={onSave}
          onSaveAs={onSaveAs}
          videoEditReturn={props.videoEditReturn}
        />
      )}
      className="min-h-0 flex-1"
    />
    </>
  )
}
