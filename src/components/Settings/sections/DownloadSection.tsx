import React from 'react'
import { openDialog } from '@/platform/desktopApi'
import {
  UI_FIELD_CONTROL_HEIGHT_SM_CLASS,
  UiButton,
  UiFormRow,
  UiInput,
  UiSwitch,
} from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'

interface DownloadSectionProps {
  enableQuickDownload: boolean
  quickDownloadButtonOnly: boolean
  quickDownloadPath: string
  onToggleQuickDownload: (value: boolean) => void
  onToggleButtonOnly: (value: boolean) => void
  onChangePath: (value: string) => void
}

const DownloadSection: React.FC<DownloadSectionProps> = ({
  enableQuickDownload,
  quickDownloadButtonOnly,
  quickDownloadPath,
  onToggleQuickDownload,
  onToggleButtonOnly,
  onChangePath
}) => {
  const { t } = useI18n('settings')

  const handleSelectPath = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false
    })
    if (!selected || Array.isArray(selected)) {
      return
    }
    onChangePath(selected)
  }

  return (
    <>
      <UiFormRow label={t('sections.download.enableLabel')} info={t('sections.download.enableHint')} inline>
        <UiSwitch checked={enableQuickDownload} onCheckedChange={onToggleQuickDownload} />
      </UiFormRow>

      <UiFormRow
        label={t('sections.download.buttonOnlyLabel')}
        info={t('sections.download.buttonOnlyHint')}
        inline
        className={enableQuickDownload ? '' : 'opacity-50'}
      >
        <UiSwitch
          checked={quickDownloadButtonOnly}
          onCheckedChange={onToggleButtonOnly}
          disabled={!enableQuickDownload}
        />
      </UiFormRow>

      <UiFormRow
        label={t('sections.download.pathLabel')}
        info={t('sections.download.pathHint')}
        className={enableQuickDownload ? '' : 'opacity-50'}
      >
        <div className="flex items-stretch gap-2">
          <UiInput
            value={quickDownloadPath}
            onChange={(e) => onChangePath(e.target.value)}
            placeholder={t('sections.download.pathPlaceholder')}
            disabled={!enableQuickDownload}
            className={`${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} flex-1`}
          />
          <UiButton
            onClick={handleSelectPath}
            disabled={!enableQuickDownload}
            variant="primary"
            size="sm"
            className="shrink-0 whitespace-nowrap px-4"
          >
            {t('actions.select')}
          </UiButton>
        </div>
      </UiFormRow>
    </>
  )
}

export default DownloadSection
