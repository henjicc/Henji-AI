import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Settings2 } from 'lucide-react'
import {
  UI_TEXT_BODY_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_SECTION_CLASS,
  UiButton,
  UiEmpty,
  UiError,
  UiLoading,
  UiOptionButton,
  UiPanel,
  UiSwitch,
  UiSearchInput,
} from '@/components/ui'
import { API_KEY_PROVIDERS, type ApiKeyProvider } from '@/core/config/providers'
import { providerServiceLabel } from '@/core/config/providerBrands'
import { getProviders } from '@/config/providers'
import type { LlmCredentialMutationDto } from '@/platform/contracts/llmRuntime'
import type { LlmModelConfig, LlmProviderConfig } from '@henjicc/ai-sdk'
import { findProviderMetadata } from '@henjicc/ai-sdk'
import { createModelFromInput, fetchOpenAiCompatibleModels } from '@/services/llm/llmDiscoveryService'
import { useI18n } from '@/hooks/useI18n'
import { createLogger } from '@/core/logging'
import { useApiKeys } from '../hooks/useApiKeys'
import type { UseLlmSettingsResult } from '../hooks/useLlmSettings'
import { useExternalLink } from '../hooks/useExternalLink'
import ApiKeyInput from '../components/ApiKeyInput'
import LlmModelDialog from './LlmModelDialog'
import LlmProviderDialog from './LlmProviderDialog'
import { ModelSyncDialog } from './ModelSyncDialog'
import ProviderCenterModelList from './ProviderCenterModelList'
import ProviderCredentialGuide from './ProviderCredentialGuide'
import { buildProviderCenterGroups, type ProviderCenterCategory, type ProviderCenterModelItem } from './providerCenterModel'
import { useGenerationModelVisibility } from './useGenerationModelVisibility'
import { createEmptyModel } from './llmSettingsSectionHelpers'

interface ProviderCenterSectionProps {
  llm: UseLlmSettingsResult
}

interface DiscoveredModelDraft {
  modelId: string
  displayName: string
  contextWindow: number | null
  maxOutputTokens: number | null
}

const logger = createLogger('components.Settings.sections.ProviderCenterSection')

const apiKeyProviderIds = new Set<string>(API_KEY_PROVIDERS.map(provider => provider.id))

const ProviderCenterSection = ({ llm }: ProviderCenterSectionProps): JSX.Element => {
  const { t, currentLanguage } = useI18n('settings')
  const { openExternal } = useExternalLink()
  const generationProviders = useMemo(() => {
    void currentLanguage
    return getProviders()
  }, [currentLanguage])
  const generationKeys = useApiKeys()
  const generationVisibility = useGenerationModelVisibility(generationProviders)
  const [selectedId, setSelectedId] = useState('')
  const [providerSearch, setProviderSearch] = useState('')
  const [category, setCategory] = useState<'all' | ProviderCenterCategory>('all')
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [providerDialogCreate, setProviderDialogCreate] = useState(false)
  const [modelDraft, setModelDraft] = useState<LlmModelConfig | null>(null)
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  // 同步模型失败（密钥、地址或网络）要留在原位说明原因，否则按钮恢复后像什么都没发生
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [syncProvider, setSyncProvider] = useState<LlmProviderConfig | null>(null)
  const [syncDiscovered, setSyncDiscovered] = useState<DiscoveredModelDraft[]>([])

  const groups = useMemo(() => buildProviderCenterGroups({
    generationProviders,
    llmProviders: llm.config.providers,
    llmModels: llm.config.models,
    hiddenProviders: generationVisibility.hiddenProviders,
    hiddenModels: generationVisibility.hiddenModels,
  })
    .filter(group => !(group.canonicalProviderId === 'bigmodel' && group.llmProvider?.endpointProfile === 'global'))
    .map(group => group.canonicalProviderId === 'bigmodel'
      ? { ...group, displayName: t('providerCenter.providers.bigmodel') }
      : group), [generationProviders, generationVisibility.hiddenModels, generationVisibility.hiddenProviders, llm.config.models, llm.config.providers, t])

  const filteredGroups = useMemo(() => {
    const query = providerSearch.trim().toLowerCase()
    return query
      ? groups.filter(group => [group.displayName, group.canonicalProviderId].some(value => value.toLowerCase().includes(query)))
      : groups
  }, [groups, providerSearch])

  useEffect(() => {
    if (groups.length === 0) return
    if (!groups.some(group => group.id === selectedId)) setSelectedId(groups[0].id)
  }, [groups, selectedId])

  const selected = groups.find(group => group.id === selectedId) ?? groups[0]
  const metadata = selected
    ? findProviderMetadata(selected.canonicalProviderId, { endpointProfile: selected.llmProvider?.endpointProfile })
    : null
  const generationCredential = selected?.generationProvider && apiKeyProviderIds.has(selected.generationProvider.id)
    ? selected.generationProvider.id as ApiKeyProvider
    : null
  const credentialProvider = selected?.llmProvider
  const credentialValue = generationCredential
    ? generationKeys.keys[generationCredential]
    : credentialProvider ? (llm.keys[credentialProvider.providerId] ?? '') : ''
  const credentialVisible = generationCredential
    ? generationKeys.visibility[generationCredential]
    : credentialProvider ? llm.visibility[credentialProvider.providerId] === true : false

  const saveProvider = async (
    provider: LlmProviderConfig,
    seedModels: LlmModelConfig[],
    credential: LlmCredentialMutationDto,
  ): Promise<void> => {
    await llm.commitProviderSettings(provider, seedModels, credential)
    setSelectedId(`llm:${provider.providerId}`)
  }

  const setProviderEnabled = async (enabled: boolean): Promise<void> => {
    if (!selected) return
    for (const provider of selected.generationProviders ?? []) generationVisibility.setProviderEnabled(provider.id, enabled)
    if (selected.llmProvider) {
      await llm.commitProviderSettings({ ...selected.llmProvider, enabled }, [], { kind: 'unchanged' })
    }
  }

  const setModelEnabled = async (model: ProviderCenterModelItem, enabled: boolean): Promise<void> => {
    if (model.source === 'generation') {
      generationVisibility.setModelEnabled(model.providerId, model.modelId, enabled)
      return
    }
    await llm.saveConfig({
      ...llm.config,
      models: llm.config.models.map(item => item.providerId === model.providerId && item.modelId === model.modelId
        ? { ...item, enabled }
        : item),
    })
  }

  const setFilteredEnabled = async (models: ProviderCenterModelItem[], enabled: boolean): Promise<void> => {
    const generationModels = models.filter(model => model.source === 'generation')
    if (generationModels.length > 0) generationVisibility.setModelsEnabled(generationModels, enabled)
    const llmIds = new Set(models.filter(model => model.source === 'llm').map(model => `${model.providerId}:${model.modelId}`))
    if (llmIds.size > 0) {
      await llm.saveConfig({
        ...llm.config,
        models: llm.config.models.map(model => llmIds.has(`${model.providerId}:${model.modelId}`) ? { ...model, enabled } : model),
      })
    }
  }

  const openModelDialog = (model?: ProviderCenterModelItem): void => {
    if (!selected?.llmProvider) return
    setModelDraft(model?.llmModel ? { ...model.llmModel } : createEmptyModel(selected.llmProvider))
    setModelDialogOpen(true)
  }

  const saveModel = async (): Promise<void> => {
    if (!modelDraft || !selected?.llmProvider) return
    const provider = selected.llmProvider
    const nextModel = {
      ...modelDraft,
      providerId: provider.providerId,
      adapter: provider.adapter,
      baseUrl: provider.baseUrl,
      modelId: modelDraft.modelId.trim(),
      displayName: modelDraft.displayName.trim() || modelDraft.modelId.trim(),
    }
    await llm.saveConfig({
      ...llm.config,
      models: [
        ...llm.config.models.filter(model => !(model.providerId === nextModel.providerId && model.modelId === nextModel.modelId)),
        nextModel,
      ],
    })
    setModelDialogOpen(false)
  }

  const fetchModels = async (): Promise<void> => {
    if (!selected?.llmProvider || fetchingModels) return
    setFetchingModels(true)
    setFetchError(null)
    try {
      const discovered = await fetchOpenAiCompatibleModels(selected.llmProvider)
      setSyncProvider(selected.llmProvider)
      setSyncDiscovered(discovered.map(item => ({
        modelId: item.modelId,
        displayName: item.displayName || item.modelId,
        contextWindow: item.contextWindow,
        maxOutputTokens: item.maxOutputTokens,
      })))
    } catch (error) {
      logger.warn('供应商模型列表同步失败', { event: 'provider_center.sync_models.failed', error, context: { providerId: selected.llmProvider.providerId } })
      setFetchError(error instanceof Error && error.message ? error.message : t('providerCenter.syncFailedHint'))
    } finally {
      setFetchingModels(false)
    }
  }

  const syncAdd = async (modelIds: string[]): Promise<void> => {
    if (!syncProvider) return
    const found = new Map(syncDiscovered.map(item => [item.modelId, item]))
    const existing = new Set(llm.config.models.filter(model => model.providerId === syncProvider.providerId).map(model => model.modelId))
    const additions = modelIds.filter(id => !existing.has(id)).flatMap(id => {
      const item = found.get(id)
      return item ? [createModelFromInput(syncProvider, item.modelId, item.displayName, {
        contextWindow: item.contextWindow,
        maxOutputTokens: item.maxOutputTokens,
      })] : []
    })
    if (additions.length > 0) await llm.saveConfig({ ...llm.config, models: [...llm.config.models, ...additions] })
  }

  const syncRemove = async (modelIds: string[]): Promise<void> => {
    if (!syncProvider) return
    const removing = new Set(modelIds)
    await llm.saveConfig({
      ...llm.config,
      models: llm.config.models.filter(model => !(model.providerId === syncProvider.providerId && removing.has(model.modelId))),
    })
  }

  if (llm.loading) return <UiLoading message={t('providerCenter.loading')} />

  return (
    /*
     * 整页只有设置内容区一条竖向滚动（任务 5.8，B-49）：原来这里固定高度、左右两栏各自滚动，
     * 960 下和外层设置页并排出现两条竖向滚动条。现在详情栏随内容自然增高、跟着设置页滚动；
     * 供应商列表吸顶，只有它在供应商很多时自己滚动（左侧的局部列表，不与页面滚动条并排）。
     */
    <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-5">
      <UiPanel variant="inset" className="sticky top-0 flex max-h-[calc(min(88vh,64rem)-8.5rem)] min-h-0 flex-col overflow-hidden p-2">
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <UiSearchInput value={providerSearch} onChange={event => setProviderSearch(event.target.value)} placeholder={t('providerCenter.searchPlaceholder')} aria-label={t('providerCenter.searchPlaceholder')} />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">
            {filteredGroups.map(group => (
              <UiOptionButton key={group.id} type="button" variant="menu" size="lg" active={group.id === selected?.id} className="w-full text-left" onClick={() => { setSelectedId(group.id); setCategory('all'); setFetchError(null) }}>
                <span className="block truncate text-sm font-medium">{group.displayName}</span>
              </UiOptionButton>
            ))}
          </div>
          <div className="border-t border-line pt-2">
            <UiButton type="button" variant="primary" className="w-full" onClick={() => { setProviderDialogCreate(true); setProviderDialogOpen(true) }}>
              <Plus className="h-4 w-4" />
              {t('providerCenter.actions.addProvider')}
            </UiButton>
          </div>
        </div>
      </UiPanel>

      {selected ? (
        <div className="min-w-0 space-y-5">
          <div>
            <div className="flex items-start justify-between gap-4">
              {/* 分节标题“供应商与模型”已是 20 号，供应商名降一档（16），层级才读得出来 */}
              <h3 className={UI_TEXT_SECTION_CLASS}>{selected.displayName}</h3>
              <div className="flex shrink-0 items-center gap-2">
                {selected.llmProvider ? (
                  <UiButton type="button" variant="secondary" onClick={() => { setProviderDialogCreate(false); setProviderDialogOpen(true) }}>
                    <Settings2 className="h-4 w-4" />
                    {t('providerCenter.actions.connectionSettings')}
                  </UiButton>
                ) : null}
                <span className={UI_TEXT_LABEL_CLASS}>{t('providerCenter.enabled')}</span>
                <UiSwitch checked={selected.enabled} onCheckedChange={enabled => void setProviderEnabled(enabled)} />
              </div>
            </div>
            <div className="mt-1 min-w-0 overflow-x-auto">
              <ProviderCredentialGuide
                providerName={selected.displayName}
                websiteUrl={metadata?.websiteUrl}
                apiKeyUrl={(selected.generationProviders?.length ?? 0) > 1 ? undefined : metadata?.apiKeyUrl ?? (selected.llmProvider?.setup?.kind === 'custom'
                  ? selected.llmProvider.setup.apiKeyManagementUrl
                  : undefined)}
                onOpenUrl={(url) => { void openExternal(url) }}
              />
            </div>
          </div>

          <div className="border-t border-line pt-5">
            <div className={`mb-3 ${UI_TEXT_LABEL_CLASS}`}>{t('providerCenter.apiKey')}</div>
            {(selected.generationProviders?.length ?? 0) > 1 ? (
              <div className="space-y-4">
                {selected.generationProviders!.map(provider => {
                  const id = provider.id as ApiKeyProvider
                  const service = providerServiceLabel(id, currentLanguage.startsWith('en'))
                  const serviceMetadata = findProviderMetadata(id)
                  return <div key={id} className="space-y-2">
                    <div className={UI_TEXT_LABEL_CLASS}>{service}</div>
                    <ApiKeyInput value={generationKeys.keys[id]} visible={generationKeys.visibility[id]}
                      onChange={value => generationKeys.updateKey(id, value)}
                      onToggleVisibility={() => generationKeys.toggleVisibility(id)}
                      placeholder={t('providerCenter.apiKeyPlaceholder', { provider: service })}
                      showLabel={t('apiKeys.visibility.show')} hideLabel={t('apiKeys.visibility.hide')} />
                    <ProviderCredentialGuide providerName={service} apiKeyUrl={serviceMetadata?.apiKeyUrl} onOpenUrl={openExternal} />
                  </div>
                })}
              </div>
            ) : generationCredential || credentialProvider ? (
              <ApiKeyInput
                value={credentialValue}
                visible={credentialVisible}
                onChange={value => generationCredential
                  ? generationKeys.updateKey(generationCredential, value)
                  : credentialProvider && llm.updateKey(credentialProvider.providerId, value)}
                onToggleVisibility={() => generationCredential
                  ? generationKeys.toggleVisibility(generationCredential)
                  : credentialProvider && llm.toggleVisibility(credentialProvider.providerId)}
                placeholder={t('providerCenter.apiKeyPlaceholder', { provider: selected.displayName })}
                showLabel={t('apiKeys.visibility.show')}
                hideLabel={t('apiKeys.visibility.hide')}
              />
            ) : <div className={UI_TEXT_BODY_CLASS}>{t('providerCenter.noCredential')}</div>}
          </div>

          <div className="border-t border-line pt-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className={UI_TEXT_LABEL_CLASS}>{t('providerCenter.models')}</div>
              <div className="flex items-center gap-2">
                {selected.llmProvider ? (
                  <>
                    <UiButton type="button" variant="secondary" disabled={fetchingModels} onClick={() => void fetchModels()}>
                      <RefreshCw className={`h-4 w-4 ${fetchingModels ? 'motion-safe:animate-spin' : ''}`} />{fetchingModels ? t('providerCenter.actions.syncingModels') : t('providerCenter.actions.syncModels')}
                    </UiButton>
                    <UiButton type="button" variant="secondary" onClick={() => openModelDialog()}>
                      <Plus className="h-4 w-4" />{t('providerCenter.actions.addModel')}
                    </UiButton>
                  </>
                ) : null}
              </div>
            </div>
            {fetchError ? (
              <UiError size="xs" align="start" className="pt-0" title={t('providerCenter.syncFailed')} message={fetchError} />
            ) : null}
            <ProviderCenterModelList
              group={selected}
              category={category}
              onCategoryChange={setCategory}
              onModelEnabledChange={setModelEnabled}
              onSetFilteredEnabled={setFilteredEnabled}
              onEditModel={openModelDialog}
              onDeleteModel={async model => {
                await llm.saveConfig({ ...llm.config, models: llm.config.models.filter(item => !(item.providerId === model.providerId && item.modelId === model.modelId)) })
              }}
            />
          </div>
        </div>
      ) : <UiEmpty title={t('providerCenter.emptyProviders')} description={t('providerCenter.emptyProvidersHint')} />}

      <LlmProviderDialog
        isOpen={providerDialogOpen}
        providers={llm.config.providers}
        initialProviderId={providerDialogCreate ? undefined : selected?.llmProvider?.providerId}
        startInCreateMode={providerDialogCreate}
        onClose={() => setProviderDialogOpen(false)}
        onSave={saveProvider}
        onDelete={async providerId => { await llm.deleteProviderSettings(providerId) }}
      />
      <LlmModelDialog isOpen={modelDialogOpen} model={modelDraft} onChange={setModelDraft} onClose={() => setModelDialogOpen(false)} onSave={saveModel} />
      <ModelSyncDialog
        open={syncProvider !== null}
        providerName={syncProvider?.displayName ?? ''}
        discovered={syncDiscovered}
        addedModelIds={new Set(syncProvider
          ? llm.config.models.filter(model => model.providerId === syncProvider.providerId).map(model => model.modelId)
          : [])}
        onClose={() => setSyncProvider(null)}
        onAdd={syncAdd}
        onRemove={syncRemove}
      />
    </div>
  )
}

export default ProviderCenterSection
