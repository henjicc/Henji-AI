import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Layers3,
  ShieldCheck,
  WandSparkles,
} from 'lucide-react'

import {
  UI_COLOR_ACCENT_TEXT_CLASS,
  UI_META_BADGE_ACCENT_CLASS,
  UI_META_BADGE_CLASS,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_SECTION_CLASS,
  UI_TEXT_TITLE_CLASS,
  Dropdown,
  UiButton,
  UiModal,
  UiOptionButton,
  UiPanel,
} from '@/components/ui'
import ApiKeyInput from '@/components/Settings/components/ApiKeyInput'
import { useDataPath } from '@/components/Settings/hooks/useDataPath'
import { aiGetProviderApiKey, aiSetProviderApiKey, aiTestProviderConnection } from '@/commands/aiRuntime'
import { API_KEY_PROVIDERS, type ApiKeyProvider } from '@/core/config/providers'
import { emitApplicationEvent } from '@/core/events/applicationEvents'
import { createLogger } from '@/core/logging'
import { registry } from '@/core/ModelRegistry'
import type { ProviderConnectionTestResultDto } from '@/platform/contracts/aiRuntime'
import { openExternal } from '@/platform/desktopApi'
import { useSettingsStore } from '@/stores/settingsStore'
import { switchWorkspace } from '@/stores/navigationStore'
import { changeLanguage, getCurrentLanguage, type LanguageOption } from '@/utils/language'
import { getProviderDisplayName } from '@/utils/modelHelpers'
import { useI18n } from '@/hooks/useI18n'
import { useGenerationDraftStore } from '@/features/generation/store/generationDraftStore'
import {
  ONBOARDING_STEP_IDS,
  onboardingManager,
} from '../application/onboardingManager'
import { useOnboardingState } from '../application/useOnboardingState'
import { OnboardingBasicsStep, OnboardingDataPathDialogs } from './OnboardingBasicsStep'

const logger = createLogger('features.onboarding.modal')

const PRIMARY_PROVIDER_IDS: ApiKeyProvider[] = ['kie', 'apimart', 'fal', 'ppio']
const LANGUAGE_OPTIONS: LanguageOption[] = ['auto', 'zh-CN', 'en-US']
const appIconUrl = new URL('../../../../resources/icons/128x128@2x.png', import.meta.url).href

function ProviderConnectionResult({
  value,
}: {
  value: ProviderConnectionTestResultDto
}): JSX.Element {
  const { t, currentLanguage } = useI18n('onboarding')
  const positive = value.verified || value.status === 'connected'
  return (
    <UiPanel variant="inset" className="mt-4 p-4" role="status" aria-live="polite">
      <div className={`flex items-center gap-2 ${positive ? 'text-success' : value.status === 'saved_unverified' ? 'text-warning' : 'text-danger'}`}>
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium">{t(`apiKey.results.${value.status}`)}</span>
      </div>
      <div className={`mt-3 grid gap-1 sm:grid-cols-2 ${UI_TEXT_META_CLASS}`}>
        <span>{t('apiKey.details.verified', { value: t(value.verified ? 'apiKey.details.yes' : 'apiKey.details.no') })}</span>
        <span>{t('apiKey.details.duration', { value: value.durationMs })}</span>
        {value.httpStatus ? <span>{t('apiKey.details.http', { value: value.httpStatus })}</span> : null}
        {value.unlimitedBalance ? (
          <span>{t('apiKey.details.balanceUnlimited')}</span>
        ) : value.remainingBalance !== undefined ? (
          <span>{t('apiKey.details.balance', {
            value: value.remainingBalance,
            unit: value.balanceUnit ? t(`apiKey.details.units.${value.balanceUnit}`) : '',
          })}</span>
        ) : null}
        <span>{t('apiKey.details.checkedAt', {
          value: new Date(value.checkedAt).toLocaleString(currentLanguage),
        })}</span>
      </div>
    </UiPanel>
  )
}

function WelcomeStep(): JSX.Element {
  const { t } = useI18n('onboarding')
  const features = [
    { icon: Layers3, text: t('welcome.features.models') },
    { icon: WandSparkles, text: t('welcome.features.canvas') },
    { icon: ShieldCheck, text: t('welcome.features.local') },
  ]
  return (
    <div className="flex min-h-[25rem] flex-col justify-center">
      <div className="mb-7 flex items-center gap-4">
        <img src={appIconUrl} alt="" className="h-16 w-16 rounded-2xl" />
        <div>
          <div className={`text-xs font-medium uppercase tracking-wider ${UI_COLOR_ACCENT_TEXT_CLASS}`}>
            {t('welcome.eyebrow')}
          </div>
          <div className="mt-1 text-2xl font-semibold text-text-dark">{t('productName')}</div>
        </div>
      </div>
      <h3 className="max-w-xl text-2xl font-semibold leading-tight text-text-dark">{t('welcome.headline')}</h3>
      <p className={`mt-3 max-w-xl leading-6 ${UI_TEXT_BODY_CLASS}`}>{t('welcome.description')}</p>
      <div className="mt-7 space-y-3">
        {features.map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-3">
            <Icon className={`h-4 w-4 shrink-0 ${UI_COLOR_ACCENT_TEXT_CLASS}`} />
            <span className={UI_TEXT_BODY_CLASS}>{text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProviderStep({
  primaryProvider,
}: {
  primaryProvider: ApiKeyProvider
}): JSX.Element {
  const { t } = useI18n('onboarding')
  return (
    <div className="min-h-[25rem]">
      <h3 className={UI_TEXT_TITLE_CLASS}>{t('provider.headline')}</h3>
      <p className={`mt-2 leading-6 ${UI_TEXT_BODY_CLASS}`}>{t('provider.description')}</p>
      <div className="mt-6 grid grid-cols-2 gap-3">
        {PRIMARY_PROVIDER_IDS.map((providerId) => (
          <UiOptionButton
            key={providerId}
            variant="card"
            active={primaryProvider === providerId}
            className="min-h-24 items-start p-3"
            onClick={() => onboardingManager.setPrimaryProvider(providerId)}
          >
            <div>
              <div className="flex items-center gap-2">
                <span className={UI_TEXT_SECTION_CLASS}>{t(`provider.items.${providerId}.name`)}</span>
                {providerId === 'kie' ? (
                  <span className={`text-3xs font-medium ${
                    primaryProvider === providerId ? UI_META_BADGE_CLASS : UI_META_BADGE_ACCENT_CLASS
                  }`}>
                    {t('provider.recommended')}
                  </span>
                ) : null}
              </div>
              <p className={`mt-1.5 leading-5 ${
                primaryProvider === providerId ? 'text-xs text-white/80' : UI_TEXT_META_CLASS
              }`}>
                {t(`provider.items.${providerId}.description`)}
              </p>
            </div>
          </UiOptionButton>
        ))}
      </div>
      <p className={`mt-5 ${UI_TEXT_META_CLASS}`}>{t('provider.more')}</p>
    </div>
  )
}

function ApiKeyStep({
  providerId,
  apiKey,
  visible,
  configured,
  connectionResult,
  onApiKeyChange,
  onVisibilityChange,
}: {
  providerId: ApiKeyProvider
  apiKey: string
  visible: boolean
  configured: boolean
  connectionResult: ProviderConnectionTestResultDto | null
  onApiKeyChange: (value: string) => void
  onVisibilityChange: () => void
}): JSX.Element {
  const { t } = useI18n('onboarding')
  const providerName = getProviderDisplayName(providerId)
  const provider = API_KEY_PROVIDERS.find((item) => item.id === providerId)
  const keyLink = provider?.links.find((link) => ['keys', 'console', 'token'].includes(link.id))
    ?? provider?.links[0]
  return (
    <div className="min-h-[25rem]">
      <h3 className={UI_TEXT_TITLE_CLASS}>{t('apiKey.headline', { provider: providerName })}</h3>
      <p className={`mt-2 leading-6 ${UI_TEXT_BODY_CLASS}`}>{t('apiKey.description')}</p>
      <div className="mt-7">
        <ApiKeyInput
          value={apiKey}
          visible={visible}
          onChange={onApiKeyChange}
          onToggleVisibility={onVisibilityChange}
          placeholder={t('apiKey.placeholder', { provider: providerName })}
          showLabel={t('apiKey.show')}
          hideLabel={t('apiKey.hide')}
          hint={configured ? t('apiKey.configured') : undefined}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className={`leading-5 ${UI_TEXT_META_CLASS}`}>{t('apiKey.testNote')}</p>
        {keyLink ? (
          <UiButton
            variant="plain"
            size="sm"
            className="shrink-0"
            onClick={() => void openExternal(keyLink.url)}
          >
            {t('actions.openGuide')}
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </UiButton>
        ) : null}
      </div>
      {connectionResult ? <ProviderConnectionResult value={connectionResult} /> : null}
    </div>
  )
}

function FirstTaskStep({
  providerId,
  configured,
}: {
  providerId: ApiKeyProvider
  configured: boolean
}): JSX.Element {
  const { t } = useI18n('onboarding')
  const providerName = getProviderDisplayName(providerId)
  return (
    <div className="min-h-[25rem]">
      <h3 className={UI_TEXT_TITLE_CLASS}>{t('firstTask.headline')}</h3>
      <p className={`mt-2 leading-6 ${UI_TEXT_BODY_CLASS}`}>{t('firstTask.description')}</p>
      <UiPanel variant="inset" className="mt-7 p-4">
        <div className={UI_TEXT_META_CLASS}>{t('firstTask.promptLabel')}</div>
        <p className={`mt-2 leading-6 ${UI_TEXT_BODY_CLASS}`}>{t('firstTask.prompt')}</p>
      </UiPanel>
      <div className={`mt-5 flex items-center gap-2 ${configured ? 'text-success' : 'text-warning'}`}>
        {configured ? <CheckCircle2 className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
        <span className="text-sm">{t(configured ? 'firstTask.ready' : 'firstTask.notReady', { provider: providerName })}</span>
      </div>
    </div>
  )
}

export function OnboardingModal(): JSX.Element {
  const { t } = useI18n('onboarding')
  const state = useOnboardingState()
  const setProviderKeyStatus = useSettingsStore((value) => value.setProviderKeyStatus)
  const [apiKey, setApiKey] = useState('')
  const [keyVisible, setKeyVisible] = useState(false)
  const [testing, setTesting] = useState(false)
  const [connectionResult, setConnectionResult] = useState<ProviderConnectionTestResultDto | null>(null)
  const [language, setLanguage] = useState<LanguageOption>(getCurrentLanguage())
  const dataPath = useDataPath(state.isOpen)
  const stepIndex = ONBOARDING_STEP_IDS.indexOf(state.activeStepId)
  const providerConfigured = state.configuredProviders.includes(state.primaryProvider)

  useEffect(() => {
    if (state.isOpen) onboardingManager.open()
  }, [state.isOpen])

  useEffect(() => {
    if (!state.isOpen) return undefined
    let disposed = false
    setConnectionResult(null)
    setKeyVisible(false)
    void aiGetProviderApiKey(state.primaryProvider)
      .then((value) => {
        if (!disposed) setApiKey(value ?? '')
      })
      .catch((error) => {
        logger.error('读取首次设置密钥失败', error, {
          event: 'onboarding.provider_key.load.failed',
          providerId: state.primaryProvider,
        })
        if (!disposed) setApiKey('')
      })
    return () => { disposed = true }
  }, [state.isOpen, state.primaryProvider])

  const step = useMemo(() => {
    const props = { primaryProvider: state.primaryProvider }
    switch (state.activeStepId) {
      case 'welcome': return <WelcomeStep />
      case 'basics': return <OnboardingBasicsStep dataPath={dataPath} />
      case 'provider': return <ProviderStep {...props} />
      case 'api-key': return (
        <ApiKeyStep
          providerId={state.primaryProvider}
          apiKey={apiKey}
          visible={keyVisible}
          configured={providerConfigured}
          connectionResult={connectionResult}
          onApiKeyChange={(value) => {
            setApiKey(value)
            setConnectionResult(null)
          }}
          onVisibilityChange={() => setKeyVisible((value) => !value)}
        />
      )
      case 'first-task': return (
        <FirstTaskStep providerId={state.primaryProvider} configured={providerConfigured} />
      )
    }
  }, [apiKey, connectionResult, dataPath, keyVisible, providerConfigured, state.activeStepId, state.primaryProvider])

  const saveAndTest = async (): Promise<void> => {
    const trimmed = apiKey.trim()
    if (!trimmed || testing) return
    setTesting(true)
    setConnectionResult(null)
    try {
      await aiSetProviderApiKey(state.primaryProvider, trimmed)
      setProviderKeyStatus(state.primaryProvider, true)
      emitApplicationEvent('provider-key-configured', { providerId: state.primaryProvider })
      const tested = await aiTestProviderConnection(state.primaryProvider)
      setConnectionResult(tested)
      emitApplicationEvent('provider-connection-tested', {
        providerId: state.primaryProvider,
        verified: tested.verified,
      })
    } catch (error) {
      logger.error('首次设置保存或检测密钥失败', error, {
        event: 'onboarding.provider_connection.failed',
        providerId: state.primaryProvider,
      })
      setConnectionResult({
        providerId: state.primaryProvider,
        status: 'service_error',
        verified: false,
        checkedAt: new Date().toISOString(),
        durationMs: 0,
      })
    } finally {
      setTesting(false)
    }
  }

  const prepareFirstTask = (): void => {
    const preferredModel = registry
      .getModelsByProvider(state.primaryProvider)
      .find((model) => model.meta.type === 'image')
    useGenerationDraftStore.getState().setLegacyInput(t('firstTask.prompt'))
    if (preferredModel) {
      useGenerationDraftStore.getState().patch({
        selectedProvider: state.primaryProvider,
        selectedModel: preferredModel.meta.id,
        modelFilterProvider: state.primaryProvider,
        modelFilterType: 'image',
      })
    }
    switchWorkspace('generation')
    onboardingManager.prepareFirstTask()
  }

  const primaryAction = (): void => {
    if (state.activeStepId === 'api-key') {
      if (connectionResult) onboardingManager.next()
      else void saveAndTest()
      return
    }
    if (state.activeStepId === 'first-task') {
      prepareFirstTask()
      return
    }
    onboardingManager.next()
  }

  const primaryLabel = state.activeStepId === 'welcome'
    ? t('actions.start')
    : state.activeStepId === 'api-key'
      ? connectionResult ? t('actions.continue') : testing ? t('actions.testing') : t('actions.saveAndTest')
      : state.activeStepId === 'first-task'
        ? t('actions.prepareTask')
        : t('actions.continue')

  const footer = (
    <div className="flex w-full items-center justify-between gap-4">
      <div className="flex items-center gap-1">
        <UiButton variant="plain" size="sm" onClick={() => onboardingManager.skip()}>
          {t('actions.skipAll')}
        </UiButton>
        <UiButton variant="plain" size="sm" onClick={() => onboardingManager.defer()}>
          {t('actions.later')}
        </UiButton>
      </div>
      <div className="flex items-center gap-2">
        {stepIndex > 0 ? (
          <UiButton variant="muted" onClick={() => onboardingManager.back()}>
            {t('actions.back')}
          </UiButton>
        ) : null}
        {state.activeStepId === 'api-key' ? (
          <UiButton variant="plain" onClick={() => onboardingManager.next()}>
            {t('actions.skipStep')}
          </UiButton>
        ) : null}
        {state.activeStepId === 'first-task' ? (
          <UiButton variant="muted" onClick={() => onboardingManager.complete()}>
            {t('actions.createLater')}
          </UiButton>
        ) : null}
        <UiButton
          variant="primary"
          disabled={dataPath.isMigrating || testing || (state.activeStepId === 'api-key' && !connectionResult && !apiKey.trim())}
          onClick={primaryAction}
        >
          {primaryLabel}
        </UiButton>
      </div>
    </div>
  )

  return (
    <UiModal
      isOpen={state.isOpen}
      title={t('title')}
      headerActions={(
        <Dropdown
          appearance="text"
          value={language}
          options={LANGUAGE_OPTIONS.map((option) => ({
            value: option,
            label: t(`basics.languageOptions.${option}`),
          }))}
          ariaLabel={t('actions.language')}
          minWidthStrategy="none"
          panelWidthStrategy="options"
          buttonClassName="w-auto"
          onSelect={(option) => {
            changeLanguage(option)
            setLanguage(option)
          }}
        />
      )}
      onClose={() => onboardingManager.defer()}
      size="form"
      contentClassName="px-6 py-5"
      footer={footer}
    >
      <div className="mb-5 flex items-center gap-3">
        <span className={`shrink-0 ${UI_TEXT_META_CLASS}`}>{t('progress', {
          current: stepIndex + 1,
          total: ONBOARDING_STEP_IDS.length,
        })}</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-layer">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${((stepIndex + 1) / ONBOARDING_STEP_IDS.length) * 100}%` }}
          />
        </div>
        <span className={`shrink-0 ${UI_TEXT_META_CLASS}`}>{t(`steps.${state.activeStepId}`)}</span>
      </div>
      {step}
      <OnboardingDataPathDialogs dataPath={dataPath} />
    </UiModal>
  )
}
