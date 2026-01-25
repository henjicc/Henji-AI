import React from 'react'
import { useApiKeys } from '../hooks/useApiKeys'
import ApiKeyInput from '../components/ApiKeyInput'
import { useI18n } from '@/hooks/useI18n'

const ApiKeysTab: React.FC = () => {
  const { t } = useI18n('settings')
  const { keys, visibility, updateKey, toggleVisibility } = useApiKeys()
  const apiKeyConfigs = [
    { provider: 'ppio', label: t('apiKeys.providers.ppio.label'), placeholder: t('apiKeys.providers.ppio.placeholder') },
    { provider: 'fal', label: t('apiKeys.providers.fal.label'), placeholder: t('apiKeys.providers.fal.placeholder') },
    { provider: 'modelscope', label: t('apiKeys.providers.modelscope.label'), placeholder: t('apiKeys.providers.modelscope.placeholder') },
    { provider: 'kie', label: t('apiKeys.providers.kie.label'), placeholder: t('apiKeys.providers.kie.placeholder') },
    { provider: 'bizyair', label: t('apiKeys.providers.bizyair.label'), placeholder: t('apiKeys.providers.bizyair.placeholder') }
  ]

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-white mb-2">{t('apiKeys.title')}</h3>
      <p className="text-sm text-zinc-400 mb-6">
        {t('apiKeys.description')}
      </p>

      <div className="space-y-4">
        {apiKeyConfigs.map(config => (
          <ApiKeyInput
            key={config.provider}
            provider={config.provider}
            label={config.label}
            value={keys[config.provider as keyof typeof keys]}
            visible={visibility[config.provider] || false}
            onChange={(value) => updateKey(config.provider as any, value)}
            onToggleVisibility={() => toggleVisibility(config.provider)}
            placeholder={config.placeholder}
          />
        ))}
      </div>
    </div>
  )
}

export default ApiKeysTab
