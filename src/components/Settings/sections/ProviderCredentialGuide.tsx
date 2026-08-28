import React from 'react'
import { ExternalLink } from 'lucide-react'
import { UI_TEXT_BODY_CLASS, UiButton } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'

interface ProviderCredentialGuideProps {
  providerName: string
  websiteUrl?: string | null
  apiKeyUrl?: string | null
  onOpenUrl: (url: string) => void
}

const ProviderCredentialGuide = ({
  providerName,
  websiteUrl,
  apiKeyUrl,
  onOpenUrl,
}: ProviderCredentialGuideProps): JSX.Element | null => {
  const { t } = useI18n('settings')
  if (!websiteUrl && !apiKeyUrl) return null

  const linkClassName = 'inline-flex h-auto min-h-0 items-center rounded-none px-0 py-0 align-baseline font-medium leading-6 !text-brand-300 hover:bg-transparent hover:!text-brand-300 hover:underline'
  return (
    <p className={`flex flex-wrap items-center gap-x-1 gap-y-1 leading-6 ${UI_TEXT_BODY_CLASS}`}>
      {websiteUrl ? (
        <>
          <span>{t('providerCenter.guide.beforeWebsite')}</span>
          <UiButton type="button" variant="plain" size="sm" className={linkClassName} onClick={() => onOpenUrl(websiteUrl)}>
            {t('apiKeys.providerGuideLinks.website', { provider: providerName })}
            <ExternalLink className="ml-1 h-3 w-3" />
          </UiButton>
          <span>{t('providerCenter.guide.afterWebsite')}</span>
        </>
      ) : null}
      {apiKeyUrl ? (
        <>
          {websiteUrl ? null : <span>{t('providerCenter.guide.onlyApiKey')}</span>}
          <UiButton type="button" variant="plain" size="sm" className={linkClassName} onClick={() => onOpenUrl(apiKeyUrl)}>
            {t('apiKeys.providerGuideLinks.apiKey')}
            <ExternalLink className="ml-1 h-3 w-3" />
          </UiButton>
          <span>{t('providerCenter.guide.afterApiKey')}</span>
        </>
      ) : null}
    </p>
  )
}

export default ProviderCredentialGuide
