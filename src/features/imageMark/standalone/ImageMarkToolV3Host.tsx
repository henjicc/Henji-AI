import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  UiError,
  UiIconButton,
  UiLoading,
  UiPageHeader,
  UiRegion,
} from '@/components/ui'
import { ImageEditorV3 } from '@/features/imageEdit/v3/editor'
import { ImageMarkToolV3ToolbarActions } from './ImageMarkToolV3ToolbarActions'
import {
  useImageMarkToolV3Host,
  type ImageMarkToolV3HostProps,
} from './useImageMarkToolV3Host'

export type { ImageMarkToolV3HostProps } from './useImageMarkToolV3Host'

export function ImageMarkToolV3Host(props: ImageMarkToolV3HostProps): JSX.Element {
  const { t } = useTranslation('ui')
  const host = useImageMarkToolV3Host(props)
  const {
    sourceImageUrl,
    onBack,
    onOpenFile,
    onPasteFromClipboard,
    onCreateBlank,
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
            backLabel={t('imageEditor.v3.host.backToToolbox')}
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

  const backButton = onBack ? (
    <UiIconButton
      size="lg"
      title={t('imageEditor.v3.host.backToToolbox')}
      aria-label={t('imageEditor.v3.host.backToToolbox')}
      onClick={() => void host.runAfterSave(onBack)}
    >
      <ArrowLeft size={16} />
    </UiIconButton>
  ) : null

  return (
    <ImageEditorV3
      sourceImageUrl={sourceImageUrl}
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
      recoveryKey={props.sourceSessionKey}
      toolbarLeading={backButton}
      toolbarActions={(
        <ImageMarkToolV3ToolbarActions
          host={host}
          onOpenFile={onOpenFile}
          onPasteFromClipboard={onPasteFromClipboard}
          onCreateBlank={onCreateBlank}
          videoEditReturn={props.videoEditReturn}
        />
      )}
      className="min-h-0 flex-1"
    />
  )
}
