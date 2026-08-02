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
import { ExternalLink } from 'lucide-react'
import type { ProviderLink } from '@/core/config/providers'
import { detectShell } from '@/platform/runtime'

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
          const title = t(`apiKeys.providers.${provider.id}.title`)
          const guide = t(`apiKeys.providers.${provider.id}.guide`)
          const linkLabels = Object.fromEntries(
            provider.links.map(link => [link.id, t(`apiKeys.providers.${provider.id}.links.${link.id}`)])
          )
          return (
            // 供应商是「≥2 组同构重复单元」，是唯一还保留小分类的场景；
            // 它们之间靠标题和间距区分，不画线——线只出现在分节之间。
            <UiGroup key={provider.id} title={title}>
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
                <p className={`leading-6 ${UI_TEXT_META_CLASS}`}>
                  {renderGuideParts(guide, provider.links, linkLabels, openExternal)}
                </p>
              ) : null}
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
