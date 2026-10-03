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

  return (
    <p className={`whitespace-nowrap leading-6 ${UI_TEXT_BODY_CLASS}`}>
      {websiteUrl ? (
        <>
          {t('providerCenter.guide.beforeWebsite')}{' '}
          <UiButton type="button" variant="link" className="align-baseline" onClick={() => onOpenUrl(websiteUrl)}>
            {t('apiKeys.providerGuideLinks.website', { provider: providerName })}
            <ExternalLink className="ml-1 h-3 w-3" />
          </UiButton>{' '}
          {t('providerCenter.guide.afterWebsite')}{' '}
        </>
      ) : null}
      {apiKeyUrl ? (
        <>
          {websiteUrl ? null : <>{t('providerCenter.guide.onlyApiKey')}{' '}</>}
          <UiButton type="button" variant="link" className="align-baseline" onClick={() => onOpenUrl(apiKeyUrl)}>
            {t('apiKeys.providerGuideLinks.apiKey')}
            <ExternalLink className="ml-1 h-3 w-3" />
          </UiButton>{' '}
          {t('providerCenter.guide.afterApiKey')}
        </>
      ) : null}
    </p>
  )
}

export default ProviderCredentialGuide
