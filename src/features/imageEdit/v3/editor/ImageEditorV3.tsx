import { ImageEditorSubjectProviderV3 } from './ImageEditorSubjectContextV3'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { exportDiagnosticBundle } from '@/commands/logging'
import { UiButton, UiError, UiErrorBoundary, UiToolbar } from '@/components/ui'
import { ImageEditorCommandBarV3 } from './ImageEditorCommandBarV3'
import { ImageEditorShellV3 } from '../shell/ImageEditorShellV3'
import { imageEditorWorkspaceLayoutStoreV3 } from '../panelFramework/layout'
import { builtInToolRegistration } from '../toolFramework/builtInRegistry'
import { ImageEditorPreviewV3 } from './ImageEditorPreviewV3'
import { ImageEditorToolRailV3 } from './ImageEditorToolRailV3'
import type { ImageEditorV3Props } from './types'
import { useImageEditorControllerV3 } from './useImageEditorControllerV3'
import { createImageEditorDiagnosticSummaryV3 } from './imageEditorDiagnosticSummaryV3'
import { ImageEditorRepairProviderV3 } from './ImageEditorRepairContextV3'

function ImageEditorWorkspaceV3(props: ImageEditorV3Props): JSX.Element {
  const { controller, bus } = useImageEditorControllerV3(props)
  const { t } = useTranslation('ui')
  const rootRef = useRef<HTMLDivElement>(null)
  const { onEditorContextChange } = props

  useEffect(() => {
    onEditorContextChange?.({
      sessionId: controller.sessionId,
      document: controller.document,
    })
    return () => onEditorContextChange?.(null)
  }, [controller.document, controller.sessionId, onEditorContextChange])

  return (
    <ImageEditorSubjectProviderV3 bus={bus} controller={controller}>
    <ImageEditorRepairProviderV3 bus={bus} controller={controller}>
    <div
      ref={rootRef}
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        const target = event.target instanceof Element ? event.target : null
        if (!target?.closest('button, input, textarea, select, a, [contenteditable], [role="tab"], [role="separator"], .dv-tabs-and-actions-container')) {
          rootRef.current?.focus({ preventScroll: true })
        }
      }}
      data-image-editor-v3
      data-host-profile={controller.profile.id}
      className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-gap text-text1 ${props.className ?? ''}`}
    >
      {builtInToolRegistration.failed ? <>
        <UiToolbar variant="command" trailing={props.toolbarActions}>{props.toolbarLeading}</UiToolbar>
        <UiError className="flex-1" message={t('imageEditor.v3.tools.loadFailed')} />
      </> : <ImageEditorShellV3
        controller={controller}
        layoutStore={imageEditorWorkspaceLayoutStoreV3(props.layoutWorkspaceId ?? props.profileId)}
        commandBar={panelActions => (
          <ImageEditorCommandBarV3
            controller={controller}
            bus={bus}
            toolbarLeading={props.toolbarLeading}
            toolbarActions={props.toolbarActions}
            panelActions={panelActions}
          />
        )}
        toolRail={<ImageEditorToolRailV3 controller={controller} />}
        preview={(
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
      />}
    </div>
    </ImageEditorRepairProviderV3>
    </ImageEditorSubjectProviderV3>
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
        <UiButton
          variant="secondary"
          disabled={exporting}
          onClick={() => { void exportDiagnostics() }}
        >
          {exporting
            ? t('imageEditor.v3.recovery.exporting')
            : t('imageEditor.v3.recovery.exportDiagnostics')}
        </UiButton>
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
