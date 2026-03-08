import React from 'react'
import { UiButton } from '@/components/ui'
import { useApiKeys } from '../hooks/useApiKeys'
import ApiKeyInput from '../components/ApiKeyInput'
import { useI18n } from '@/hooks/useI18n'
import SectionCard from '../components/SectionCard'
import UploadSection from '../sections/UploadSection'
import { API_KEY_PROVIDERS } from '@/core/config/providers'
import { useExternalLink } from '../hooks/useExternalLink'
import { ExternalLink } from 'lucide-react'

const ApiKeysTab: React.FC = () => {
  const { t } = useI18n('settings')
  const { openExternal } = useExternalLink()
  const { keys, visibility, updateKey, toggleVisibility } = useApiKeys()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-2">{t('apiKeys.title')}</h3>
        <p className="text-sm text-zinc-400">{t('apiKeys.description')}</p>
      </div>

      {API_KEY_PROVIDERS.map(provider => {
        const label = t(`apiKeys.providers.${provider.id}.label`)
        const placeholder = t(`apiKeys.providers.${provider.id}.placeholder`)
        const title = t(`apiKeys.providers.${provider.id}.title`)
        const help = t(`apiKeys.providers.${provider.id}.help`)
        const links = provider.links.map(link => ({
          label: t(`apiKeys.providers.${provider.id}.links.${link.id}`),
          url: link.url,
          highlight: link.highlight
        }))
        return (
          <SectionCard key={provider.id} title={title} description={help}>
            <ApiKeyInput
              label={label}
              value={keys[provider.id]}
              visible={visibility[provider.id]}
              onChange={(value) => updateKey(provider.id, value)}
              onToggleVisibility={() => toggleVisibility(provider.id)}
              placeholder={placeholder}
              showLabel={t('apiKeys.visibility.show')}
              hideLabel={t('apiKeys.visibility.hide')}
            />
            {links.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {links.map(link => (
                  <UiButton
                    key={link.url}
                    onClick={() => openExternal(link.url)}
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 border-accent/40 bg-accent/10 px-3 text-xs text-brand-300 hover:bg-accent/20"
                  >
                    {link.label}
                    <ExternalLink size={12} />
                  </UiButton>
                ))}
              </div>
            ) : null}
          </SectionCard>
        )
      })}

      <UploadSection />
    </div>
  )
}

export default ApiKeysTab

