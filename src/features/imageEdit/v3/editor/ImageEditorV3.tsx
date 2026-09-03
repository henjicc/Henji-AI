import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { exportDiagnosticBundle } from '@/commands/logging'
import { UiButton, UiError, UiErrorBoundary } from '@/components/ui'
import { ImageEditorCommandBarV3 } from './ImageEditorCommandBarV3'
import { ImageEditorFloatingPanelsV3 } from './ImageEditorFloatingPanelsV3'
import { ImageEditorPreviewV3 } from './ImageEditorPreviewV3'
import { ImageEditorToolRailV3 } from './ImageEditorToolRailV3'
import type { ImageEditorV3Props } from './types'
import { useImageEditorControllerV3 } from './useImageEditorControllerV3'
import { createImageEditorDiagnosticSummaryV3 } from './imageEditorDiagnosticSummaryV3'

function ImageEditorWorkspaceV3(props: ImageEditorV3Props): JSX.Element {
  const { controller, bus } = useImageEditorControllerV3(props)
  const { onEditorContextChange } = props
  const showLayers = controller.profile.panels.includes('layers')
  const showProperties = controller.profile.panels.includes('properties')
  const showSidebar = showLayers || showProperties

  useEffect(() => {
    onEditorContextChange?.({
      sessionId: controller.sessionId,
      document: controller.document,
    })
    return () => onEditorContextChange?.(null)
  }, [controller.document, controller.sessionId, onEditorContextChange])

  return (
    <div
      data-image-editor-v3
      data-host-profile={controller.profile.id}
      className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-bg-dark text-text-dark ${props.className ?? ''}`}
    >
      <ImageEditorCommandBarV3
        controller={controller}
        bus={bus}
        toolbarLeading={props.toolbarLeading}
        toolbarActions={props.toolbarActions}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <ImageEditorToolRailV3 controller={controller} />
        {showSidebar ? (
          <ImageEditorFloatingPanelsV3
            controller={controller}
            showLayers={showLayers}
            showProperties={showProperties}
          >
            <ImageEditorPreviewV3
              sourceImageUrl={props.sourceImageUrl}
              previewRenderer={props.previewRenderer}
              annotationOverlay={props.annotationOverlay}
              resourceByteSizes={props.resourceByteSizes}
              resourceDescriptors={props.resourceDescriptors}
              onPackageThumbnailChange={props.onPackageThumbnailChange}
              bus={bus}
              controller={controller}
            />
          </ImageEditorFloatingPanelsV3>
        ) : (
          <ImageEditorPreviewV3
            sourceImageUrl={props.sourceImageUrl}
            previewRenderer={props.previewRenderer}
            annotationOverlay={props.annotationOverlay}
            resourceByteSizes={props.resourceByteSizes}
            resourceDescriptors={props.resourceDescriptors}
            onPackageThumbnailChange={props.onPackageThumbnailChange}
            bus={bus}
            controller={controller}
          />
        )}
      </div>
    </div>
  )
}

function ImageEditorRecoveryFallbackV3({
  props,
  retry,
}: {
  props: ImageEditorV3Props
  retry: () => void
}): JSX.Element {
  const { t } = useTranslation('ui')
  const [exporting, setExporting] = useState(false)
  const [exportFailed, setExportFailed] = useState(false)
  const exportDiagnostics = async (): Promise<void> => {
    setExporting(true)
    setExportFailed(false)
    try {
      await exportDiagnosticBundle(createImageEditorDiagnosticSummaryV3(
        props.document,
        props.profileId,
        props.resourceDescriptors ?? [],
      ))
    } catch {
      setExportFailed(true)
    } finally {
      setExporting(false)
    }
  }
  return (
    <UiError
      className={props.className ?? 'h-full'}
      title={t('imageEditor.v3.recovery.title')}
      message={exportFailed
        ? t('imageEditor.v3.recovery.diagnosticFailed')
        : t('imageEditor.v3.recovery.message')}
      retryLabel={t('imageEditor.v3.recovery.reload')}
      onRetry={retry}
      actions={(
        <>
          <UiButton
            variant="ghost"
            size="sm"
            disabled={exporting}
            onClick={() => { void exportDiagnostics() }}
          >
            {exporting
              ? t('imageEditor.v3.recovery.exporting')
              : t('imageEditor.v3.recovery.exportDiagnostics')}
          </UiButton>
          {props.onOpenLegacyEditor ? (
            <UiButton variant="ghost" size="sm" onClick={props.onOpenLegacyEditor}>
              {t('imageEditor.v3.recovery.openLegacy')}
            </UiButton>
          ) : null}
        </>
      )}
    />
  )
}

export function ImageEditorV3(props: ImageEditorV3Props): JSX.Element {
  const { t } = useTranslation('ui')
  return (
    <UiErrorBoundary
      loggerDomain="features.imageEdit.v3.workspace"
      event="image_editor_v3.workspace.crashed"
      title={t('imageEditor.v3.recovery.title')}
      resetKeys={[props.document.id, props.document.revision, props.recoveryKey]}
      onReset={props.onReloadEditor}
      fallback={({ retry }) => <ImageEditorRecoveryFallbackV3 props={props} retry={retry} />}
    >
      <ImageEditorWorkspaceV3 {...props} />
    </UiErrorBoundary>
  )
}
