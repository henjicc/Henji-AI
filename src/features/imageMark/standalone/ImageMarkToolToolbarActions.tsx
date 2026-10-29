import { ChevronDown, Download, FilePenLine, Save } from 'lucide-react'
import { ImageEditorFileAppMenus } from './ImageEditorFileAppMenus'
import { useTranslation } from 'react-i18next'

import { PanelTrigger, UI_TEXT_META_CLASS, UiButton, UiIconButton, UiOptionButton } from '@/components/ui'
import { resolveImageEditorReadinessReasonV3 } from '@/features/imageEdit/v3/editor/readinessPresentationV3'
import type { ImageEditorV3RasterExportFormat } from '@/platform/contracts/imageEditorV3'
import { ImageMarkSourceMenu } from './ImageMarkSourceMenu'
import { useNotification } from '@/contexts/NotificationContext'
import { VideoEditSendMenu } from '@/features/videoEdit/panels/VideoEditSendMenu'
import { readVideoEditImageReturn } from '@/features/videoEdit/application/videoEditFrameEdit'
import { videoEditDocumentRef } from '@/features/videoEdit/application/videoEditSourceRefs'
import type {
  ImageMarkToolHostController,
  ImageMarkToolHostProps,
} from './useImageMarkToolHost'

interface ImageMarkToolToolbarActionsProps extends Pick<
  ImageMarkToolHostProps,
  'onOpenFile' | 'onPasteFromClipboard' | 'onCreateBlank' | 'onSave' | 'onSaveAs' | 'videoEditReturn'
> {
  host: ImageMarkToolHostController
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

export function ImageMarkToolToolbarActions({
  host,
  onOpenFile,
  onPasteFromClipboard,
  onCreateBlank,
  onSave,
  onSaveAs,
  videoEditReturn,
}: ImageMarkToolToolbarActionsProps): JSX.Element {
  const { t } = useTranslation('ui')
  const { showNotification } = useNotification()
  const boundReturn = readVideoEditImageReturn(videoEditReturn)
  const saveFailed = host.persistenceStatus?.kind === 'failed'
  const exportUnavailable = host.rasterExportReadiness.state !== 'ready'
  const exportReason = exportUnavailable
    ? resolveImageEditorReadinessReasonV3(host.rasterExportReadiness, t)
      ?? t('imageEditor.v3.host.export.defaultUnavailable')
    : undefined
  // 两种菜单共用格式名称和不可用原因，不让标题栏另维护一套导出判断。
  const exportOptions = host.rasterExportOptions.map(({ format, readiness }) => ({
    format, readiness, label: rasterExportFormatLabel(format, t),
    disabledReason: readiness.state === 'ready' ? undefined
      : resolveImageEditorReadinessReasonV3(readiness, t) ?? t('imageEditor.v3.host.export.defaultUnavailable'),
  }))

  return (
    <>
      <ImageEditorFileAppMenus host={host} onSave={onSave} onSaveAs={onSaveAs} exportOptions={exportOptions} />
      <ImageMarkSourceMenu
        disabled={host.isHostBusy}
        onOpenFile={() => void host.runAfterSave(onOpenFile)}
        onPasteFromClipboard={() => void host.runAfterSave(onPasteFromClipboard)}
        onCreateBlank={() => void host.runAfterSave(onCreateBlank)}
      />
      {/* 保存 / 另存为：写回图片文档（草稿先起名）；与“打开”同属文件类动作，同为图标按钮，悬停给名称 */}
      <UiIconButton
        aria-label={t('imageEditor.v3.host.toolbar.save')}
        tooltip={t('imageEditor.v3.host.toolbar.save')}
        disabled={host.isHostBusy}
        onClick={() => void onSave()}
      >
        <Save />
      </UiIconButton>
      <UiIconButton
        aria-label={t('imageEditor.v3.host.toolbar.saveAs')}
        tooltip={t('imageEditor.v3.host.toolbar.saveAs')}
        disabled={host.isHostBusy}
        onClick={() => void onSaveAs()}
      >
        <FilePenLine />
      </UiIconButton>
      {saveFailed ? (
        <UiButton
          variant="secondary"
          disabled={host.isHostBusy}
          onClick={() => void host.flushPending().catch(() => undefined)}
        >
          {t('imageEditor.v3.host.toolbar.retrySave')}
        </UiButton>
      ) : null}
      <VideoEditSendMenu
        mediaKind="image"
        disabled={host.isHostBusy || saveFailed}
        notify={showNotification}
        boundTarget={boundReturn}
        resolveSource={async () => {
          // 引用已保存的文档版本，剪辑才能读取一致的图片内容。
          const reference = await host.flushPending()
          return { type: 'document', docRef: await videoEditDocumentRef(reference.documentId), revision: reference.revision }
        }}
      />
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
            variant="secondary"
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
              className="hidden max-w-64 truncate text-xs text-warning-text xl:inline"
              title={exportReason}
            >
              {exportReason}
            </span>
          ) : null}
          <PanelTrigger
            disabled={host.isHostBusy || exportUnavailable}
            panelSize="menu"
            panelPadding="menu"
            closeOnPanelClick
            renderPanel={() => (
              <div
                role="menu"
                aria-label={t('imageEditor.v3.host.toolbar.exportMenuAria')}
                className="flex flex-col gap-0.5"
              >
                {exportOptions
                  .map(({ format, readiness, label, disabledReason }) => {
                  const disabled = readiness.state !== 'ready'
                  const reason = disabledReason
                  return (
                    <UiOptionButton
                      key={format}
                      type="button"
                      role="menuitem"
                      variant="menu"
                      disabled={disabled}
                      disabledReason={reason}
                      data-export-format={format}
                      data-export-readiness={readiness.state}
                      size="md" className="w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => void host.handleRasterExport(format)}
                    >
                      {label}
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
                className="shrink-0"
                disabled={host.isHostBusy || exportUnavailable}
                disabledReason={exportReason}
                aria-expanded={open}
                aria-haspopup="menu"
                aria-label={exportReason
                  ? t('imageEditor.v3.host.toolbar.exportUnavailableAria', { reason: exportReason })
                  : t('imageEditor.v3.host.toolbar.exportMenuAria')}
                onClick={togglePanel}
              >
                <Download  className="mr-1.5" />
                {exportUnavailable
                  ? t('imageEditor.v3.host.toolbar.exportUnavailable')
                  : t('imageEditor.v3.host.toolbar.export')}
                <ChevronDown  className="ml-1.5" />
              </UiButton>
            )}
          </PanelTrigger>
        </>
      )}
    </>
  )
}
