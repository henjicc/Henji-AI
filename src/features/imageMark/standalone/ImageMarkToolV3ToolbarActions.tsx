import { Download, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { UI_TEXT_META_CLASS, UiButton } from '@/components/ui'
import { resolveImageEditorReadinessReasonV3 } from '@/features/imageEdit/v3/editor/readinessPresentationV3'
import { ImageMarkSourceMenu } from './ImageMarkSourceMenu'
import type {
  ImageMarkToolV3HostController,
  ImageMarkToolV3HostProps,
} from './useImageMarkToolV3Host'

interface ImageMarkToolV3ToolbarActionsProps extends Pick<
  ImageMarkToolV3HostProps,
  'onOpenFile' | 'onPasteFromClipboard' | 'onCreateBlank'
> {
  host: ImageMarkToolV3HostController
}

export function ImageMarkToolV3ToolbarActions({
  host,
  onOpenFile,
  onPasteFromClipboard,
  onCreateBlank,
}: ImageMarkToolV3ToolbarActionsProps): JSX.Element {
  const { t } = useTranslation('ui')
  const saveFailed = host.persistenceStatus?.kind === 'failed'
  const saving = host.persistenceStatus?.kind === 'saving'
  const exportUnavailable = host.rasterExportReadiness.state !== 'ready'
  const exportReason = exportUnavailable
    ? resolveImageEditorReadinessReasonV3(host.rasterExportReadiness, t)
      ?? t('imageEditor.v3.host.export.defaultUnavailable')
    : undefined

  return (
    <>
      <ImageMarkSourceMenu
        disabled={host.isHostBusy}
        onOpenFile={() => void host.runAfterSave(onOpenFile)}
        onOpenPackage={() => void host.handleOpenPackage()}
        onPasteFromClipboard={() => void host.runAfterSave(onPasteFromClipboard)}
        onCreateBlank={() => void host.runAfterSave(onCreateBlank)}
      />
      {saving ? (
        <span className={UI_TEXT_META_CLASS}>{t('imageEditor.v3.host.toolbar.saving')}</span>
      ) : null}
      {saveFailed ? (
        <UiButton
          variant="ghost"
          size="sm"
          disabled={host.isHostBusy}
          onClick={() => void host.flushPending().catch(() => undefined)}
        >
          {t('imageEditor.v3.host.toolbar.retrySave')}
        </UiButton>
      ) : null}
      {host.rasterExport ? (
        <>
          <span className={UI_TEXT_META_CLASS}>
            {host.rasterExport.cancelling
              ? t('imageEditor.v3.host.toolbar.exportCancelling')
              : host.rasterExport.total > 0
                ? t('imageEditor.v3.host.toolbar.exportProgress', {
                    completed: host.rasterExport.completed,
                    total: host.rasterExport.total,
                  })
                : t('imageEditor.v3.host.toolbar.exportPreparing')}
          </span>
          <UiButton
            variant="ghost"
            size="sm"
            disabled={host.rasterExport.cancelling}
            onClick={host.handleCancelRasterExport}
          >
            {t('imageEditor.v3.host.toolbar.cancelExport')}
          </UiButton>
        </>
      ) : (
        <>
          {exportReason ? (
            <span
              role="status"
              className="hidden max-w-64 truncate text-xs text-warning xl:inline"
              title={exportReason}
            >
              {exportReason}
            </span>
          ) : null}
          <UiButton
            data-export-readiness={host.rasterExportReadiness.state}
            variant="primary"
            size="sm"
            disabled={host.isHostBusy || exportUnavailable}
            title={exportReason}
            aria-label={exportReason
              ? t('imageEditor.v3.host.toolbar.exportUnavailableAria', { reason: exportReason })
              : undefined}
            onClick={() => void host.handleRasterExport()}
          >
            <Download size={15} className="mr-1.5" />
            {exportUnavailable
              ? t('imageEditor.v3.host.toolbar.exportUnavailable')
              : t('imageEditor.v3.host.toolbar.exportPng')}
          </UiButton>
        </>
      )}
      <UiButton
        variant="muted"
        size="sm"
        disabled={host.isHostBusy}
        onClick={() => void host.handleSavePackage()}
      >
        <Save size={15} className="mr-1.5" />
        {host.isHostBusy && !host.rasterExport
          ? t('imageEditor.v3.host.toolbar.saving')
          : t('imageEditor.v3.host.toolbar.savePackage')}
      </UiButton>
    </>
  )
}
