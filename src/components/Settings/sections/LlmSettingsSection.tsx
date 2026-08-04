import React, { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import {
  Dropdown,
  UI_STACK_GAP_CLASS,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiDisclosurePanel,
  UiEmpty,
  UiFormRow,
  UiGroup,
  UiIconButton,
  UiInput,
  UiLoading,
  UiModal,
  UiOptionButton,
  UiPanel,
  UiSwitch,
} from '@/components/ui'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
import { useLlmSettings } from '../hooks/useLlmSettings'
import ApiKeyInput from '../components/ApiKeyInput'
import type { LlmModelConfig, LlmProviderConfig } from '@/core/llm/types'
import { DEFAULT_DEEPSEEK_BASE_URL, createDefaultProviderReasoning } from '@/core/llm/defaults'
import { createModelFromInput, fetchOpenAiCompatibleModels } from '@/services/llm/llmDiscoveryService'
import AgentModelProfilesSection from './AgentModelProfilesSection'
import LlmModelDialog from './LlmModelDialog'
import {
  createDefaultProvider,
  createEmptyModel,
  createProviderId,
  getApiKeyHint,
  getDefaultBaseUrlForAdapter,
  getReasoningModeLabel,
  providerTypes,
  reasoningModeOptions,
  resolveApiPreview,
  resolveProviderReasoning,
  resolveReasoningMode,
  type ReasoningModeValue,
} from './llmSettingsSectionHelpers'

const LlmSettingsSection: React.FC = () => {
  const { config, keys, visibility, loading, updateKey, toggleVisibility, saveConfig } = useLlmSettings()
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null)
  const [providerDraft, setProviderDraft] = useState<LlmProviderConfig | null>(null)
  const [modelDraft, setModelDraft] = useState<LlmModelConfig | null>(null)
  const [showProviderManager, setShowProviderManager] = useState(false)
  const [showModelDialog, setShowModelDialog] = useState(false)
  const [modelSearchMap, setModelSearchMap] = useState<Record<string, string>>({})
  const [isFetchingModels, setIsFetchingModels] = useState<Record<string, boolean>>({})

  const providers = useMemo(() => config.providers ?? [], [config.providers])
  const setProviderDraftPatch = (patch: Partial<LlmProviderConfig>): void => {
    setProviderDraft(prev => ({ ...(prev ?? (providers[0] ? { ...providers[0] } : createDefaultProvider())), ...patch }))
  }

  const openProviderManager = (provider?: LlmProviderConfig): void => {
    setProviderDraft(provider ? { ...provider } : providers[0] ? { ...providers[0] } : createDefaultProvider())
    setShowProviderManager(true)
  }

  const openModelDialog = (provider: LlmProviderConfig, model?: LlmModelConfig): void => {
    setExpandedProviderId(provider.providerId)
    setModelDraft(model ? { ...model } : createEmptyModel(provider))
    setShowModelDialog(true)
  }

  const persistConfig = async (nextConfig: typeof config): Promise<void> => {
    await saveConfig(nextConfig)
  }

  const handleSaveProvider = async (): Promise<void> => {
    if (!providerDraft) return
    const displayName = providerDraft.displayName.trim()
    if (!displayName) return
    const providerId = providerDraft.providerId.trim() || createProviderId(displayName, config.providers)
    const nextProvider: LlmProviderConfig = {
      ...providerDraft,
      providerId,
      displayName,
      adapter: providerDraft.adapter.trim() || 'openai',
      baseUrl: providerDraft.baseUrl?.trim()
        || (providerDraft.adapter === 'deepseek' ? DEFAULT_DEEPSEEK_BASE_URL : undefined),
      reasoning: resolveProviderReasoning(providerDraft),
    }
    const nextModels = config.models.map(model => (
      model.providerId === providerId
        ? { ...model, adapter: nextProvider.adapter, baseUrl: nextProvider.baseUrl }
        : model
    ))
    await persistConfig({
      ...config,
      providers: [
        ...config.providers.filter(item => item.providerId !== providerId),
        nextProvider,
      ],
      models: nextModels,
    })
    setProviderDraft(createDefaultProvider())
  }

  const handleFetchModels = async (provider: LlmProviderConfig): Promise<void> => {
    setIsFetchingModels(prev => ({ ...prev, [provider.providerId]: true }))
    try {
      const discovered = await fetchOpenAiCompatibleModels(provider)
      const nextModels = [...config.models]
      discovered.forEach((item) => {
        const index = nextModels.findIndex(model => (
          model.providerId === provider.providerId && model.modelId === item.modelId
        ))
        const discoveredCapabilities = {
          contextWindow: item.contextWindow,
          maxOutputTokens: item.maxOutputTokens,
        }
        if (index < 0) {
          nextModels.push(createModelFromInput(provider, item.modelId, item.displayName, discoveredCapabilities))
          return
        }
        const current = nextModels[index]
        nextModels[index] = {
          ...current,
          displayName: current.displayName || item.displayName,
          capabilities: {
            ...current.capabilities,
            contextWindow: item.contextWindow ?? current.capabilities.contextWindow,
            maxOutputTokens: item.maxOutputTokens ?? current.capabilities.maxOutputTokens,
          },
        }
      })
      await persistConfig({ ...config, models: nextModels })
    } finally {
      setIsFetchingModels(prev => ({ ...prev, [provider.providerId]: false }))
    }
  }

  const handleSaveModel = async (): Promise<void> => {
    if (!modelDraft) return
    const targetProvider = providers.find(provider => provider.providerId === modelDraft.providerId)
    if (!targetProvider) return
    const nextModel = {
      ...modelDraft,
      providerId: targetProvider.providerId,
      adapter: targetProvider.adapter,
      baseUrl: targetProvider.baseUrl,
      modelId: modelDraft.modelId.trim(),
      displayName: modelDraft.displayName.trim() || modelDraft.modelId.trim(),
    }
    await persistConfig({
      ...config,
      models: [
        ...config.models.filter(model => !(model.providerId === nextModel.providerId && model.modelId === nextModel.modelId)),
        nextModel,
      ],
    })
    setShowModelDialog(false)
  }

  const updateProviderField = async (providerId: string, patch: Partial<LlmProviderConfig>): Promise<void> => {
    const nextProviders = config.providers.map(provider => (
      provider.providerId === providerId
        ? { ...provider, ...patch }
        : provider
    ))
    await persistConfig({ ...config, providers: nextProviders })
  }

  if (loading) {
    return <UiLoading message="正在加载 LLM 配置…" />
  }

  const defaultProviderDraft = providers[0] ? { ...providers[0] } : createDefaultProvider()
  const activeProviderDraft = providerDraft ?? defaultProviderDraft

  return (
    // 外层宽度与内边距由 SettingsSection / 内容区统一给，这里不再自己套一层 max-w + p-4
    <div className={UI_STACK_GAP_CLASS}>
      <AgentModelProfilesSection config={config} saveConfig={saveConfig} />

      <UiGroup
        title="供应商配置"
        actions={
          <UiButton type="button" size="sm" variant="muted" className="px-4" onClick={() => openProviderManager()}>
            <Settings2 size={14} className="mr-1.5" />
            管理供应商
          </UiButton>
        }
      >
        <div className="space-y-3">
        {providers.length === 0 ? (
          <UiEmpty size="sm" title="还没有供应商" description="先添加一个供应商，然后就能配置模型了。" />
        ) : providers.map(provider => {
          const expanded = expandedProviderId === provider.providerId
          const providerModels = config.models.filter(model => model.providerId === provider.providerId)
          const reasoning = resolveProviderReasoning(provider)
          const modelKeyword = (modelSearchMap[provider.providerId] ?? '').trim().toLowerCase()
          const filteredModels = modelKeyword
            ? providerModels.filter(model => [model.modelId, model.displayName].some(value => value.toLowerCase().includes(modelKeyword)))
            : providerModels

          return (
            <UiPanel key={provider.providerId} variant="inset" className="overflow-hidden">
              <div
                role="button"
                tabIndex={0}
                className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-layer"
                onClick={() => setExpandedProviderId(expanded ? null : provider.providerId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setExpandedProviderId(expanded ? null : provider.providerId)
                  }
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className={`truncate ${UI_TEXT_LABEL_CLASS}`}>{provider.displayName}</div>
                </div>
                <div className="flex items-center gap-3" onClick={(event) => event.stopPropagation()}>
                  <UiSwitch
                    checked={provider.enabled}
                    onCheckedChange={async (checked) => {
                      await updateProviderField(provider.providerId, { enabled: checked })
                    }}
                  />
                  {expanded ? <ChevronUp size={18} className="text-text-muted" /> : <ChevronDown size={18} className="text-text-muted" />}
                </div>
              </div>

              <div className="border-t border-border-dark">
                <UiDisclosurePanel open={expanded} className="px-4 py-4">
                  <div className="space-y-4">
                      <div className={`flex items-center gap-2 ${UI_TEXT_LABEL_CLASS}`}>
                        <Settings2 size={15} />
                        <span>基础配置</span>
                      </div>

                      <ApiKeyInput
                        label="API 密钥"
                        value={keys[provider.providerId] ?? ''}
                        visible={visibility[provider.providerId] === true}
                        onChange={(value) => updateKey(provider.providerId, value)}
                        onToggleVisibility={() => toggleVisibility(provider.providerId)}
                        placeholder={`请输入 ${provider.displayName} API Key`}
                        showLabel="显示"
                        hideLabel="隐藏"
                        hint={getApiKeyHint(provider)}
                      />

                      <UiInput
                        value={provider.baseUrl ?? ''}
                        onChange={async (event) => {
                          await updateProviderField(provider.providerId, { baseUrl: event.target.value })
                        }}
                        placeholder="API 地址，例如 https://api.deepseek.com"
                      />
                      <div className={UI_TEXT_META_CLASS}>
                        预览：{resolveApiPreview(provider) || '请先填写 API 地址'}
                      </div>

                      {provider.reasoningConfigurable !== false ? (
                        <UiFormRow
                          label="思考模式"
                          info="关闭表示不请求思考过程；选择档位后会在优化时流式展示思考内容。"
                          inline
                        >
                          <Dropdown<ReasoningModeValue>
                            value={resolveReasoningMode(provider)}
                            display={getReasoningModeLabel(resolveReasoningMode(provider))}
                            options={reasoningModeOptions}
                            className={SETTINGS_INLINE_CONTROL_CLASS}
                            buttonClassName="w-full"
                            onSelect={async (mode) => {
                              await updateProviderField(provider.providerId, {
                                reasoning: mode === 'off'
                                  ? { ...reasoning, enabled: false }
                                  : { enabled: true, effort: mode },
                              })
                            }}
                          />
                        </UiFormRow>
                      ) : null}

                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className={UI_TEXT_LABEL_CLASS}>模型</div>
                          <div className="flex flex-wrap items-center gap-2">
                            <UiButton
                              type="button"
                              size="sm"
                              variant="muted"
                              onClick={() => void handleFetchModels(provider)}
                              disabled={isFetchingModels[provider.providerId]}
                            >
                              <RefreshCw size={14} className="mr-1.5" />
                              {isFetchingModels[provider.providerId] ? '获取中' : '获取模型列表'}
                            </UiButton>
                            <UiButton type="button" size="sm" variant="muted" onClick={() => openModelDialog(provider)}>
                              <Plus size={14} className="mr-1.5" />
                              手动添加
                            </UiButton>
                          </div>
                        </div>

                        <UiInput
                          value={modelSearchMap[provider.providerId] ?? ''}
                          onChange={(event) => setModelSearchMap(prev => ({ ...prev, [provider.providerId]: event.target.value }))}
                          placeholder="搜索模型"
                        />

                        <div className="space-y-2">
                          {filteredModels.length === 0 ? (
                            <UiEmpty
                              size="sm"
                              title={modelKeyword ? '没有匹配的模型' : '暂无模型'}
                              description={modelKeyword ? '请调整搜索关键词后重试。' : '点击“获取模型列表”或“手动添加”。'}
                            />
                          ) : filteredModels.map(model => (
                            <UiPanel
                              key={`${model.providerId}-${model.modelId}`}
                              variant="inset"
                              className="flex w-full items-center justify-between gap-3 p-3 text-left"
                            >
                              <div className="min-w-0 text-left">
                                <div className={`truncate ${UI_TEXT_BODY_CLASS}`}>{model.displayName}</div>
                                <div className={`truncate ${UI_TEXT_META_CLASS}`}>{model.modelId}</div>
                              </div>
                              <div className="flex items-center gap-1">
                                <UiIconButton
                                  onClick={() => openModelDialog(provider, model)}
                                  aria-label="编辑模型"
                                  title="编辑模型"
                                  showBorder={false}
                                  appearance="hover-only"
                                  className="h-9 w-9"
                                >
                                  <Pencil size={15} />
                                </UiIconButton>
                                <UiIconButton
                                  onClick={async (event) => {
                                    event.stopPropagation()
                                    await persistConfig({
                                      ...config,
                                      models: config.models.filter(item => !(item.providerId === model.providerId && item.modelId === model.modelId)),
                                    })
                                  }}
                                  aria-label="删除模型"
                                  showBorder={false}
                                  appearance="hover-only"
                                  hoverVariant="danger"
                                >
                                  <Trash2 size={15} />
                                </UiIconButton>
                              </div>
                            </UiPanel>
                          ))}
                        </div>
                      </div>
                    </div>
                </UiDisclosurePanel>
              </div>
            </UiPanel>
          )
        })}
        </div>
      </UiGroup>

      <UiModal
        isOpen={showProviderManager}
        title="管理供应商"
        onClose={() => setShowProviderManager(false)}
        widthClassName="w-[min(860px,calc(100vw-32px))]"
        footer={(
          <>
            <UiButton type="button" variant="muted" onClick={() => setShowProviderManager(false)}>关闭</UiButton>
            <UiButton type="button" variant="primary" onClick={() => void handleSaveProvider()}>
              {providerDraft?.providerId ? '保存供应商' : '添加供应商'}
            </UiButton>
          </>
        )}
      >
        <div className="grid max-h-[min(680px,calc(100vh-150px))] grid-cols-[240px_minmax(0,1fr)] gap-4 overflow-hidden">
          <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
            {providers.map(provider => (
              <UiOptionButton
                key={provider.providerId}
                type="button"
                active={providerDraft?.providerId === provider.providerId}
                variant="menu"
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5"
                onClick={() => setProviderDraft({ ...provider })}
              >
                <span className="min-w-0 text-left">
                  <span className="block truncate text-sm">{provider.displayName}</span>
                  <span className="block truncate text-xs text-text-muted">{provider.adapter}</span>
                </span>
                <span className={`text-xs ${provider.enabled ? 'text-green-400' : 'text-text-muted'}`}>{provider.enabled ? 'ON' : 'OFF'}</span>
              </UiOptionButton>
            ))}
            <UiButton type="button" variant="muted" className="w-full" onClick={() => setProviderDraft(createDefaultProvider())}>
              <Plus size={14} className="mr-1.5" />
              新建供应商
            </UiButton>
          </div>

          <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
            <UiPanel variant="inset" className="px-3 py-2">
              <div className={UI_TEXT_META_CLASS}>当前编辑</div>
              <div className={`truncate ${UI_TEXT_LABEL_CLASS}`}>
                {activeProviderDraft.displayName || '新建供应商'}
              </div>
            </UiPanel>
            <UiInput
              value={activeProviderDraft.displayName}
              onChange={(e) => setProviderDraftPatch({ displayName: e.target.value })}
              placeholder="供应商名称，例如 DeepSeek"
            />
            <Dropdown
              value={activeProviderDraft.adapter}
              display={providerTypes.find(type => type.value === activeProviderDraft.adapter)?.label ?? activeProviderDraft.adapter}
              options={providerTypes}
              className="w-full"
              buttonClassName="w-full"
              onSelect={(adapter) => {
                setProviderDraftPatch({
                  adapter,
                  baseUrl: activeProviderDraft.baseUrl || getDefaultBaseUrlForAdapter(adapter),
                  reasoning: createDefaultProviderReasoning(adapter),
                })
              }}
            />
            <UiInput
              value={activeProviderDraft.baseUrl ?? ''}
              onChange={(e) => setProviderDraftPatch({ baseUrl: e.target.value })}
              placeholder="API 地址，例如 https://api.deepseek.com"
            />
            <div className={UI_TEXT_META_CLASS}>
              预览：{resolveApiPreview(activeProviderDraft) || '请先填写 API 地址'}
            </div>
            <label className={`inline-flex items-center gap-2 ${UI_TEXT_BODY_CLASS}`}>
              <UiSwitch
                checked={activeProviderDraft.enabled !== false}
                onCheckedChange={(checked) => setProviderDraftPatch({ enabled: checked })}
              />
              启用供应商
            </label>
            {providerDraft?.providerId ? (
              <UiButton
                type="button"
                variant="ghost"
                className="text-text-muted hover:text-text-dark"
                onClick={async () => {
                  const providerId = providerDraft.providerId
                  await persistConfig({
                    ...config,
                    providers: config.providers.filter(provider => provider.providerId !== providerId),
                    models: config.models.filter(model => model.providerId !== providerId),
                  })
                  setExpandedProviderId(prev => prev === providerId ? null : prev)
                  setProviderDraft(createDefaultProvider())
                }}
              >
                <Trash2 size={14} className="mr-1.5" />
                删除该供应商
              </UiButton>
            ) : null}
          </div>
        </div>
      </UiModal>

      <LlmModelDialog
        isOpen={showModelDialog}
        model={modelDraft}
        onChange={setModelDraft}
        onClose={() => setShowModelDialog(false)}
        onSave={handleSaveModel}
      />
    </div>
  )
}

export default LlmSettingsSection
