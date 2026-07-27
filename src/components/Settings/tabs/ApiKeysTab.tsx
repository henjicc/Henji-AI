import React from 'react'
import { UI_SECTION_STACK_CLASS, UI_TEXT_BODY_CLASS, UiButton } from '@/components/ui'
import { useApiKeys } from '../hooks/useApiKeys'
import ApiKeyInput from '../components/ApiKeyInput'
import { useI18n } from '@/hooks/useI18n'
import SectionCard from '../components/SectionCard'
import UploadSection from '../sections/UploadSection'
import LlmSettingsSection from '../sections/LlmSettingsSection'
import AgentUserInstructionsSection from '../sections/AgentUserInstructionsSection'
import { API_KEY_PROVIDERS } from '@/core/config/providers'
import { useExternalLink } from '../hooks/useExternalLink'
import { ExternalLink } from 'lucide-react'
import type { ProviderLink } from '@/core/config/providers'
import { detectShell } from '@/platform/runtime'

interface ApiKeysTabProps {
  sectionId?: string
}

const GUIDE_PLACEHOLDER_PATTERN = /(\{\{[a-z0-9_-]+\}\})/gi

function renderGuideParts(
  guide: string,
  links: ProviderLink[],
  labels: Record<string, string>,
  openExternal: (url: string) => void
): React.ReactNode[] {
  const linksById = new Map(links.map(link => [link.id, link]))

  return guide.split(GUIDE_PLACEHOLDER_PATTERN).map((part, index) => {
    const match = part.match(/^\{\{([a-z0-9_-]+)\}\}$/i)

    if (!match) {
      return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>
    }

    const link = linksById.get(match[1])
    if (!link) {
      return <React.Fragment key={`missing-${index}`}>{part}</React.Fragment>
    }

    return (
      <UiButton
        key={`link-${link.id}-${index}`}
        onClick={() => openExternal(link.url)}
        variant="ghost"
        size="sm"
        className={`!inline !h-auto !min-h-0 !rounded-none !border-0 !bg-transparent !px-0 !py-0 align-baseline !font-medium !leading-6 !text-brand-300 hover:!bg-transparent hover:!text-brand-300 hover:underline [&_svg]:ml-0.5 [&_svg]:inline-block [&_svg]:translate-y-[-1px] ${UI_TEXT_BODY_CLASS}`}
      >
        {labels[link.id] ?? link.id}
        <ExternalLink size={12} />
      </UiButton>
    )
  })
}

const ApiKeysTab: React.FC<ApiKeysTabProps> = ({ sectionId }) => {
  const { t } = useI18n('settings')
  const { openExternal } = useExternalLink()
  const { keys, visibility, updateKey, toggleVisibility } = useApiKeys()
  const currentSectionId = sectionId ?? 'api-keys'
  const showKeyMigrationHint = detectShell() === 'electron'

  return (
    <div className="p-4 space-y-5">
      {showKeyMigrationHint ? (
        <p className={`rounded-lg border border-border-dark bg-layer px-3 py-2 leading-6 ${UI_TEXT_BODY_CLASS}`}>
          {t('apiKeys.migrationHint')}
        </p>
      ) : null}

      {currentSectionId === 'api-keys' && (
        <section className={UI_SECTION_STACK_CLASS}>
          {API_KEY_PROVIDERS.map(provider => {
            const placeholder = t(`apiKeys.providers.${provider.id}.placeholder`)
            const title = t(`apiKeys.providers.${provider.id}.title`)
            const guide = t(`apiKeys.providers.${provider.id}.guide`)
            const linkLabels = Object.fromEntries(
              provider.links.map(link => [link.id, t(`apiKeys.providers.${provider.id}.links.${link.id}`)])
            )
            return (
              <SectionCard
                key={provider.id}
                title={title}
              >
                <ApiKeyInput
                  value={keys[provider.id]}
                  visible={visibility[provider.id]}
                  onChange={(value) => updateKey(provider.id, value)}
                  onToggleVisibility={() => toggleVisibility(provider.id)}
                  placeholder={placeholder}
                  showLabel={t('apiKeys.visibility.show')}
                  hideLabel={t('apiKeys.visibility.hide')}
                />
                {provider.links.length > 0 ? (
                  <p className={`leading-6 ${UI_TEXT_BODY_CLASS}`}>
                    {renderGuideParts(guide, provider.links, linkLabels, openExternal)}
                  </p>
                ) : null}
              </SectionCard>
            )
          })}
        </section>
      )}

      {currentSectionId === 'api-upload' && (
        <section className={UI_SECTION_STACK_CLASS}>
          <UploadSection />
        </section>
      )}

      {currentSectionId === 'api-llm' && (
        <section className={UI_SECTION_STACK_CLASS}>
          <LlmSettingsSection />
        </section>
      )}

      {currentSectionId === 'api-agent-preferences' && (
        <section className={UI_SECTION_STACK_CLASS}>
          <AgentUserInstructionsSection />
        </section>
      )}
    </div>
  )
}

export default ApiKeysTab
