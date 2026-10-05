import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { useContextMenu } from '@/hooks/useContextMenu'
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
import { setModelAlias } from '@/config/modelAliases'
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
  // 改名后模型名称要重新解析：版本号跟着语言一起作为重新读取目录的依据
  const [aliasRevision, setAliasRevision] = useState(0)
  const generationProviders = useMemo(() => {
    void currentLanguage
    void aliasRevision
    return getProviders()
  }, [aliasRevision, currentLanguage])
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
  const providerMenu = useContextMenu()
  const [deleting, setDeleting] = useState<{ providerId: string; name: string } | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

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

  /**
   * 供应商列表右键菜单：编辑连接（只有自定义供应商）与删除（用户添加的供应商，含从预设添加的）。
   * 内置供应商（派欧云等随软件提供的）连接由软件维护、也不能删，右键不弹菜单。
   */
  const openProviderMenu = (event: MouseEvent, group: (typeof groups)[number]): void => {
    const provider = group.llmProvider
    if (!provider) return
    const editable = provider.setup?.kind === 'custom'
    const deletable = !(provider.setup?.kind === 'preset' && provider.setup.lifecycle === 'builtin')
    if (!editable && !deletable) return
    setSelectedId(group.id)
    providerMenu.showMenu(event, [
      ...(editable ? [{
        id: 'edit', label: t('providerCenter.actions.editConnection'), icon: <Pencil className="h-4 w-4" />,
        onClick: () => { setProviderDialogCreate(false); setProviderDialogOpen(true) },
      }] : []),
      ...(deletable ? [{
        id: 'delete', label: t('providerCenter.actions.deleteProvider'), icon: <Trash2 className="h-4 w-4" />,
        onClick: () => setDeleting({ providerId: provider.providerId, name: group.displayName }),
      }] : []),
    ])
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await llm.deleteProviderSettings(deleting.providerId)
      setDeleting(null)
    } catch (error) {
      logger.warn('删除供应商失败', { event: 'provider_center.delete_provider.failed', error, context: { providerId: deleting.providerId } })
      setDeleting(null)
      setFetchError(error instanceof Error && error.message ? error.message : t('llmProvider.errors.deleteFailed'))
    } finally {
      setDeleteBusy(false)
    }
  }

  if (llm.loading) return <UiLoading message={t('providerCenter.loading')} />

  return (
    /*
     * 供应商与模型单独成页、铺满设置内容区（外层不滚动）：上方的供应商信息、密钥、模型筛选固定不动，
     * 只有模型列表自己滚动；左侧供应商列表在供应商很多时也只滚它自己。
     * 以前整页跟着设置内容区滚动，模型多时密钥与筛选被一起滚走，切到这页还会因为分区定位往上跳一下。
     */
    <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] gap-5">
      <UiPanel variant="inset" className="flex min-h-0 flex-col overflow-hidden p-2">
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <UiSearchInput value={providerSearch} onChange={event => setProviderSearch(event.target.value)} placeholder={t('providerCenter.searchPlaceholder')} aria-label={t('providerCenter.searchPlaceholder')} />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">
            {filteredGroups.length === 0 ? <UiEmpty size="xs" title={t('providerCenter.searchNoResults')} /> : null}
            {filteredGroups.map(group => (
              <UiOptionButton key={group.id} type="button" variant="menu" size="lg" active={group.id === selected?.id} className="w-full text-left" onClick={() => { setSelectedId(group.id); setCategory('all'); setFetchError(null) }} onContextMenu={(event) => openProviderMenu(event, group)} title={group.llmProvider && !(group.llmProvider.setup?.kind === 'preset' && group.llmProvider.setup.lifecycle === 'builtin') ? t('providerCenter.menuHint') : undefined}>
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
        <div className="flex min-h-0 min-w-0 flex-col gap-5">
          <div className="shrink-0">
            <div className="flex items-start justify-between gap-4">
              {/* 分节标题“供应商与模型”已是 20 号，供应商名降一档（16），层级才读得出来 */}
              <h3 className={UI_TEXT_SECTION_CLASS}>{selected.displayName}</h3>
              <div className="flex shrink-0 items-center gap-2">
                {/* 编辑连接与删除在左侧列表的右键菜单里（openProviderMenu），不占页面 */}
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

          <div className="shrink-0 border-t border-line pt-5">
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

          <div className="flex min-h-0 flex-1 flex-col border-t border-line pt-5">
            <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
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
              onRenameModel={(model, name) => {
                const canonicalModelId = model.generationModel?.canonicalModelId
                if (!canonicalModelId) return
                setModelAlias(canonicalModelId, name === model.generationModel?.originalName ? '' : name)
                setAliasRevision(value => value + 1)
              }}
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
      <ContextMenu items={providerMenu.menuItems} position={providerMenu.menuPosition} onClose={providerMenu.hideMenu} visible={providerMenu.menuVisible} />
      <DeleteConfirmDialog
        isOpen={deleting !== null}
        title={t('providerCenter.deleteTitle', { name: deleting?.name ?? '' })}
        message={t('providerCenter.deleteMessage')}
        cancelLabel={t('llmProvider.actions.cancel')}
        confirmLabel={t('providerCenter.actions.deleteProvider')}
        busy={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
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
