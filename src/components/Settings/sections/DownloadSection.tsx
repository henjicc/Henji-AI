import React from 'react'
import { openDialog } from '@/platform/desktopApi'
import Toggle from '@/components/ui/Toggle'
import { UI_FIELD_CONTROL_HEIGHT_CLASS, UI_FIELD_LABEL_CLASS, UI_TEXT_META_CLASS, UiButton, UiInput } from '@/components/ui'
import SectionCard from '../components/SectionCard'
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
  const onText = t('actions.toggleOn')
  const offText = t('actions.toggleOff')

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
    <SectionCard title={t('sections.download.title')}>
      <div className="space-y-5">
        <div>
          <Toggle
            label={t('sections.download.enableLabel')}
            checked={enableQuickDownload}
            onChange={onToggleQuickDownload}
            className="w-full"
            onText={onText}
            offText={offText}
          />
          <p className={`mt-2 ${UI_TEXT_META_CLASS}`}>{t('sections.download.enableHint')}</p>
        </div>

        <div className={`transition-colors duration-300 ${!enableQuickDownload ? 'pointer-events-none' : ''}`}>
          <Toggle
            label={t('sections.download.buttonOnlyLabel')}
            checked={quickDownloadButtonOnly}
            onChange={onToggleButtonOnly}
            className="w-full"
            disabled={!enableQuickDownload}
            onText={onText}
            offText={offText}
          />
          <p className={`mt-2 ${UI_TEXT_META_CLASS}`}>{t('sections.download.buttonOnlyHint')}</p>
        </div>

        <div className={`transition-colors duration-300 ${!enableQuickDownload ? 'pointer-events-none' : ''}`}>
          <label className={`${UI_FIELD_LABEL_CLASS} mb-2`}>
            {t('sections.download.pathLabel')}
          </label>
          <div className="flex items-stretch gap-2">
            <UiInput
              value={quickDownloadPath}
              onChange={(e) => onChangePath(e.target.value)}
              placeholder={t('sections.download.pathPlaceholder')}
              disabled={!enableQuickDownload}
              className={`${UI_FIELD_CONTROL_HEIGHT_CLASS} flex-1`}
            />
            <UiButton
              onClick={handleSelectPath}
              disabled={!enableQuickDownload}
              variant="primary"
              size="field"
              className="shrink-0 whitespace-nowrap"
            >
              {t('actions.select')}
            </UiButton>
          </div>
          <p className={`mt-2 ${UI_TEXT_META_CLASS}`}>{t('sections.download.pathHint')}</p>
        </div>
      </div>
    </SectionCard>
  )
}

export default DownloadSection
