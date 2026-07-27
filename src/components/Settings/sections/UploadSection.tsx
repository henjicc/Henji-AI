import React from 'react'
import Dropdown from '@/components/ui/Dropdown'
import Toggle from '@/components/ui/Toggle'
import SectionCard from '../components/SectionCard'
import { useUploadSettings } from '../hooks/useUploadSettings'
import { UPLOAD_PROVIDERS, type UploadProvider } from '@/core/config/providers'
import { useI18n } from '@/hooks/useI18n'
import { UI_TEXT_LABEL_CLASS, UI_TEXT_META_CLASS } from '@/components/ui'

const UploadSection: React.FC = () => {
  const { t } = useI18n('settings')
  const { provider, fallbackEnabled, setProvider, setFallbackEnabled } = useUploadSettings()
  const onText = t('actions.toggleOn')
  const offText = t('actions.toggleOff')

  const options = UPLOAD_PROVIDERS.map(item => ({
    value: item.id,
    label: t(`sections.upload.providers.${item.id}`)
  }))

  return (
    <SectionCard
      title={t('sections.upload.title')}
      description={t('sections.upload.description')}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <label className={UI_TEXT_LABEL_CLASS}>
            {t('sections.upload.providerLabel')}
          </label>
          <Dropdown
            value={provider}
            display={options.find(option => option.value === provider)?.label}
            options={options}
            onSelect={(value) => setProvider(value as UploadProvider)}
            className="w-40"
            buttonClassName="h-[34px] w-full bg-surface-dark border-border-dark"
          />
        </div>

        <div className="border-t border-border-dark pt-4">
          <Toggle
            label={t('sections.upload.fallbackLabel')}
            checked={fallbackEnabled}
            onChange={setFallbackEnabled}
            className="w-full"
            onText={onText}
            offText={offText}
          />
          <p className={`mt-2 ${UI_TEXT_META_CLASS}`}>{t('sections.upload.fallbackHint')}</p>
        </div>
      </div>
    </SectionCard>
  )
}

export default UploadSection
