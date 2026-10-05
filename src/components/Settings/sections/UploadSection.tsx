import React from 'react'
import { UiFormRow, UiSwitch } from '@/components/ui'
import SettingsSegmented from '../components/SettingsSegmented'
import { useUploadSettings } from '../hooks/useUploadSettings'
import { UPLOAD_PROVIDERS, type UploadProvider } from '@/core/config/providers'
import { useI18n } from '@/hooks/useI18n'

const UploadSection: React.FC = () => {
  const { t } = useI18n('settings')
  const { provider, fallbackEnabled, setProvider, setFallbackEnabled } = useUploadSettings()

  const options = UPLOAD_PROVIDERS.map(item => ({
    value: item.id,
    label: t(`sections.upload.providers.${item.id}`)
  }))

  return (
    <>
      {/* 常驻说明：不看不知道这个提供商是给 ModelScope/PPIO 这类模型托管文件用的 */}
      <UiFormRow
        label={t('sections.upload.providerLabel')}
        hint={t('sections.upload.description')}
        inline
      >
        <SettingsSegmented<UploadProvider>
          value={provider}
          options={options}
          onChange={setProvider}
          ariaLabel={t('sections.upload.providerLabel')}
        />
      </UiFormRow>

      <UiFormRow label={t('sections.upload.fallbackLabel')} info={t('sections.upload.fallbackHint')} inline>
        <UiSwitch checked={fallbackEnabled} onCheckedChange={setFallbackEnabled} />
      </UiFormRow>
    </>
  )
}

export default UploadSection
