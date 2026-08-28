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

  const linkClassName = 'inline-flex !h-auto !min-h-0 items-center rounded-none !px-0 !py-0 align-baseline !text-sm font-medium leading-6 !text-brand-300 hover:bg-transparent hover:!text-brand-300 hover:underline'
  return (
    <p className={`whitespace-nowrap leading-6 ${UI_TEXT_BODY_CLASS}`}>
      {websiteUrl ? (
        <>
          {t('providerCenter.guide.beforeWebsite')}{' '}
          <UiButton type="button" variant="plain" size="md" className={linkClassName} onClick={() => onOpenUrl(websiteUrl)}>
            {t('apiKeys.providerGuideLinks.website', { provider: providerName })}
            <ExternalLink className="ml-1 h-3 w-3" />
          </UiButton>{' '}
          {t('providerCenter.guide.afterWebsite')}{' '}
        </>
      ) : null}
      {apiKeyUrl ? (
        <>
          {websiteUrl ? null : <>{t('providerCenter.guide.onlyApiKey')}{' '}</>}
          <UiButton type="button" variant="plain" size="md" className={linkClassName} onClick={() => onOpenUrl(apiKeyUrl)}>
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
