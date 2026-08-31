import { ChevronDown, Download, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PanelTrigger, UI_TEXT_META_CLASS, UiButton, UiOptionButton } from '@/components/ui'
import { resolveImageEditorReadinessReasonV3 } from '@/features/imageEdit/v3/editor/readinessPresentationV3'
import type { ImageEditorV3RasterExportFormat } from '@/platform/contracts/imageEditorV3'
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

function rasterExportFormatLabel(
  format: ImageEditorV3RasterExportFormat,
  translate: (key: string) => string,
): string {
  switch (format) {
    case 'png8': return translate('imageEditor.v3.host.export.formats.png8')
    case 'png16': return translate('imageEditor.v3.host.export.formats.png16')
    case 'jpeg': return translate('imageEditor.v3.host.export.formats.jpeg')
    case 'webp': return translate('imageEditor.v3.host.export.formats.webp')
    case 'tiff8': return translate('imageEditor.v3.host.export.formats.tiff8')
    case 'tiff16': return translate('imageEditor.v3.host.export.formats.tiff16')
    case 'avif10': return translate('imageEditor.v3.host.export.formats.avif10')
    case 'avif12': return translate('imageEditor.v3.host.export.formats.avif12')
    case 'bigtiff': return translate('imageEditor.v3.host.export.formats.bigtiff')
  }
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
          <PanelTrigger
            disabled={host.isHostBusy || exportUnavailable}
            panelWidth={190}
            panelClassName="p-1"
            closeOnPanelClick
            renderPanel={() => (
              <div
                role="menu"
                aria-label={t('imageEditor.v3.host.toolbar.exportMenuAria')}
                className="flex flex-col gap-0.5"
              >
                {host.rasterExportOptions.map(({ format, readiness }) => {
                  const disabled = readiness.state !== 'ready'
                  const reason = disabled
                    ? resolveImageEditorReadinessReasonV3(readiness, t)
                    : undefined
                  return (
                    <UiOptionButton
                      key={format}
                      type="button"
                      role="menuitem"
                      variant="menu"
                      disabled={disabled}
                      title={reason}
                      data-export-format={format}
                      data-export-readiness={readiness.state}
                      className="w-full gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => void host.handleRasterExport(format)}
                    >
                      {rasterExportFormatLabel(format, t)}
                    </UiOptionButton>
                  )
                })}
              </div>
            )}
          >
            {({ open, togglePanel }) => (
              <UiButton
                type="button"
                data-panel-trigger-button
                data-export-readiness={host.rasterExportReadiness.state}
                variant="primary"
                size="sm"
                disabled={host.isHostBusy || exportUnavailable}
                title={exportReason}
                aria-expanded={open}
                aria-haspopup="menu"
                aria-label={exportReason
                  ? t('imageEditor.v3.host.toolbar.exportUnavailableAria', { reason: exportReason })
                  : t('imageEditor.v3.host.toolbar.exportMenuAria')}
                onClick={togglePanel}
              >
                <Download size={15} className="mr-1.5" />
                {exportUnavailable
                  ? t('imageEditor.v3.host.toolbar.exportUnavailable')
                  : t('imageEditor.v3.host.toolbar.export')}
                <ChevronDown size={14} className="ml-1.5" />
              </UiButton>
            )}
          </PanelTrigger>
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
