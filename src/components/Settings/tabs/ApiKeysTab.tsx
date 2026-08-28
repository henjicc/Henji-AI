import React from 'react'
import { UI_TEXT_BODY_CLASS, UI_TEXT_META_CLASS, UiButton, UiGroup, UiRegion } from '@/components/ui'
import { useApiKeys } from '../hooks/useApiKeys'
import ApiKeyInput from '../components/ApiKeyInput'
import { useI18n } from '@/hooks/useI18n'
import SettingsSection from '../components/SettingsSection'
import { SETTINGS_CONTENT_CLASS, SETTINGS_CONTENT_MAX_WIDTH_CLASS } from '../settingsLayout'
import UploadSection from '../sections/UploadSection'
import LlmSettingsSection from '../sections/LlmSettingsSection'
import AgentSkillsSection from '../sections/AgentSkillsSection'
import AgentUserInstructionsSection from '../sections/AgentUserInstructionsSection'
import { API_KEY_PROVIDERS } from '@/core/config/providers'
import { useExternalLink } from '../hooks/useExternalLink'
import { detectShell } from '@/platform/runtime'
import { getProviderDisplayName } from '@/utils/modelHelpers'
import { ExternalLink } from 'lucide-react'

const GUIDE_PLACEHOLDER_PATTERN = /(\{\{[a-z0-9_-]+\}\})/gi

type ProviderGuideLink = {
  id: 'website' | 'apiKey'
  url: string
}

function renderGuideParts(
  guide: string,
  links: ProviderGuideLink[],
  labels: Record<ProviderGuideLink['id'], string>,
  openExternal: (url: string) => void
): React.ReactNode[] {
  const linksById = new Map(links.map(link => [link.id.toLowerCase(), link]))

  return guide.split(GUIDE_PLACEHOLDER_PATTERN).map((part, index) => {
    const match = part.match(/^\{\{([a-z0-9_-]+)\}\}$/i)
    const link = match ? linksById.get(match[1].toLowerCase()) : undefined

    if (!link) {
      return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>
    }

    return (
      <UiButton
        key={`link-${link.id}-${index}`}
        onClick={() => openExternal(link.url)}
        variant="plain"
        size="sm"
        className={`!inline !h-auto !min-h-0 !rounded-none !px-0 !py-0 align-baseline !font-medium !leading-6 !text-brand-300 hover:!bg-transparent hover:!text-brand-300 hover:underline [&_svg]:ml-0.5 [&_svg]:inline-block [&_svg]:translate-y-[-1px] ${UI_TEXT_BODY_CLASS}`}
      >
        {labels[link.id]}
        <ExternalLink size={12} />
      </UiButton>
    )
  })
}

const ApiKeysTab: React.FC = () => {
  const { t } = useI18n('settings')
  const { openExternal } = useExternalLink()
  const { keys, visibility, updateKey, toggleVisibility } = useApiKeys()
  const showKeyMigrationHint = detectShell() === 'electron'

  return (
    <UiRegion maxWidthClassName={SETTINGS_CONTENT_MAX_WIDTH_CLASS} className={SETTINGS_CONTENT_CLASS}>
      {/*
        迁移提示原来是页面顶部一个手写的 bg-layer 框——它比父级更亮，等于凭空多一层卡片，
        而且悬在第一个分节标题之上、不属于任何分节。改成分节说明后归属明确，也不再画框。
      */}
      <SettingsSection id="api-keys" description={showKeyMigrationHint ? t('apiKeys.migrationHint') : undefined}>
        {API_KEY_PROVIDERS.map(provider => {
          const placeholder = t(`apiKeys.providers.${provider.id}.placeholder`)
          const title = getProviderDisplayName(provider.id)
          const guideLinks: ProviderGuideLink[] = [
            { id: 'website', url: provider.websiteUrl },
            { id: 'apiKey', url: provider.apiKeyUrl },
          ]
          return (
            // 供应商是「≥2 组同构重复单元」，是唯一还保留小分类的场景；
            // 它们之间靠标题和间距区分，不画线——线只出现在分节之间。
            <UiGroup key={provider.id} title={title}>
              <p className={`leading-6 ${UI_TEXT_META_CLASS}`}>
                {renderGuideParts(
                  t('apiKeys.providerGuide'),
                  guideLinks,
                  {
                    website: t('apiKeys.providerGuideLinks.website', { provider: title }),
                    apiKey: t('apiKeys.providerGuideLinks.apiKey'),
                  },
                  openExternal
                )}
              </p>
              <ApiKeyInput
                value={keys[provider.id]}
                visible={visibility[provider.id]}
                onChange={(value) => updateKey(provider.id, value)}
                onToggleVisibility={() => toggleVisibility(provider.id)}
                placeholder={placeholder}
                showLabel={t('apiKeys.visibility.show')}
                hideLabel={t('apiKeys.visibility.hide')}
              />
            </UiGroup>
          )
        })}
      </SettingsSection>

      <SettingsSection id="api-upload">
        <UploadSection />
      </SettingsSection>

      <SettingsSection id="api-llm">
        <LlmSettingsSection />
      </SettingsSection>

      <SettingsSection id="api-agent-preferences">
        <AgentUserInstructionsSection />
      </SettingsSection>

      <SettingsSection id="api-agent-skills">
        <AgentSkillsSection />
      </SettingsSection>
    </UiRegion>
  )
}

export default ApiKeysTab
