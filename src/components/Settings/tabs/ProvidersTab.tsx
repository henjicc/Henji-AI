import React from 'react'
import { UiLoading } from '@/components/ui'
import SettingsSection from '../components/SettingsSection'
import { SETTINGS_CONTENT_CLASS } from '../settingsLayout'
import { useI18n } from '@/hooks/useI18n'
import { useLlmSettings } from '../hooks/useLlmSettings'
import ProviderCenterSection from '../sections/ProviderCenterSection'

/**
 * 供应商与模型：两栏控制台（供应商列表 + 密钥与模型列表），单独成页并铺满内容区；
 * 外层不滚动，只有模型列表与供应商列表各自滚动（见 Settings/index.tsx 的 FILL_TABS）。
 * 模型列表需要横向铺开，所以不套 `SETTINGS_CONTENT_MAX_WIDTH_CLASS` 的限宽。
 */
const ProvidersTab: React.FC = () => {
  const { t } = useI18n('settings')
  const llm = useLlmSettings()
  if (llm.loading) return <UiLoading message={t('providerCenter.loading')} />
  return (
    <div className={`flex h-full min-h-0 flex-col ${SETTINGS_CONTENT_CLASS}`}>
      <SettingsSection id="providers" fill>
        <ProviderCenterSection llm={llm} />
      </SettingsSection>
    </div>
  )
}

export default ProvidersTab
