import React, { useMemo } from 'react'
import { Plus, Save, Star, Trash2 } from 'lucide-react'
import { ReferenceTextarea, UiButton, UiCheckbox, UiInput, UiOptionButton } from '@/components/ui'
import Dropdown from '@/components/ui/Dropdown'
import { renderHighlightedTemplateText } from '@/components/ui/referenceTextareaUtils'
import { DEFAULT_DEEPSEEK_PROVIDER_ID, createDefaultLlmConfig } from '@/core/llm/defaults'
import { getDefaultPromptProfile, PROMPT_OPTIMIZATION_VARIABLES } from '@/core/llm/promptOptimization'
import type { LlmConfigState, LlmModelConfig, LlmProviderConfig, PromptOptimizationProfile } from '@/core/llm/types'
import { llmConfigService } from '@/services/llm'

interface PromptOptimizationProfilesPanelProps {
  config: LlmConfigState | null
  selectedProfileId: string
  onSelectedProfileIdChange: (profileId: string) => void
  onConfigChange: (config: LlmConfigState) => void
}

function createProfile(config: LlmConfigState): PromptOptimizationProfile {
  const now = new Date().toISOString()
  const provider = config.providers.find(item => item.enabled) ?? config.providers[0]
  const model = config.models.find(item => item.enabled && item.providerId === provider?.providerId)
    ?? config.models.find(item => item.enabled)
    ?? config.models[0]
  const providerId = provider?.providerId ?? DEFAULT_DEEPSEEK_PROVIDER_ID
  const modelId = model?.modelId ?? createDefaultLlmConfig().models[0].modelId
  return {
    id: `prompt-profile-${Date.now()}`,
    name: '新的优化提示词',
    providerId,
    modelId,
    systemPrompt: '你是提示词优化助手。只输出优化后的提示词。',
    userTemplate: '请优化以下提示词：\n\n{{prompt}}',
    capabilities: { text: true, image: false, video: false },
    isDefault: false,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

function buildProviderOptions(config: LlmConfigState): LlmProviderConfig[] {
  const referencedProviderIds = new Set(config.promptProfiles.map(profile => profile.providerId))
  referencedProviderIds.add(DEFAULT_DEEPSEEK_PROVIDER_ID)
  return config.providers.filter(provider => provider.enabled || referencedProviderIds.has(provider.providerId))
}

function buildModelOptions(config: LlmConfigState, providerId: string): LlmModelConfig[] {
  return config.models.filter(model => model.providerId === providerId && (model.enabled || model.modelId.length > 0))
}

function buildProfileCapabilities(model?: LlmModelConfig): PromptOptimizationProfile['capabilities'] {
  return {
    text: true,
    image: model?.capabilities.image === true,
    video: model?.capabilities.video === true,
  }
}

const variableReferences = PROMPT_OPTIMIZATION_VARIABLES.map(variable => ({
  id: variable.token,
  label: variable.label,
}))

const variableTokenSet = PROMPT_OPTIMIZATION_VARIABLES.map(variable => variable.token)

function PromptTemplateTextarea({
  value,
  onChange,
  rows,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  rows: number
  placeholder: string
}): JSX.Element {
  return (
    <ReferenceTextarea
      value={value}
      onChange={onChange}
      references={variableReferences}
      getReferenceToken={(item) => item.id}
      triggerKey="/"
      literalTokens={variableTokenSet}
      renderHighlightedValue={renderHighlightedTemplateText}
      rows={rows}
      placeholder={placeholder}
      className="relative isolate overflow-visible rounded-lg border border-border-dark bg-surface-dark"
      highlightLayerClassName="text-sm leading-6 text-white"
      highlightContentClassName="min-h-full px-3 py-2.5"
      textareaClassName="ui-scrollbar !border-0 !bg-transparent !shadow-none w-full resize-none px-3 py-2.5 text-sm leading-6 text-transparent caret-white placeholder-zinc-400 focus:!ring-0 focus:!shadow-none whitespace-pre-wrap break-words"
      pickerClassName="z-50 w-[330px]"
      pickerListClassName="max-h-[260px]"
      pickerOffsetY={24}
      pickerPortal
      renderPickerItem={({ item }) => {
        const variable = PROMPT_OPTIMIZATION_VARIABLES.find(option => option.token === item.id)
        return (
          <div className="min-w-0 space-y-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{variable?.label ?? item.label}</span>
              <span className="rounded border border-border-dark px-1.5 py-0.5 text-[10px] text-text-muted">
                {variable?.group ?? '变量'}
              </span>
            </div>
            <div className="truncate text-xs text-text-muted">{item.id}</div>
            <div className="line-clamp-2 text-xs text-text-muted">{variable?.description}</div>
          </div>
        )
      }}
    />
  )
}

export function PromptOptimizationProfilesPanel({
  config,
  selectedProfileId,
  onSelectedProfileIdChange,
  onConfigChange,
}: PromptOptimizationProfilesPanelProps): JSX.Element {
  const profiles = useMemo(() => config?.promptProfiles ?? [], [config?.promptProfiles])
  const activeConfig = useMemo(() => config ?? createDefaultLlmConfig(), [config])
  const selectedProfile = useMemo(() => {
    if (!config) return null
    return profiles.find(profile => profile.id === selectedProfileId)
      ?? getDefaultPromptProfile(config)
      ?? profiles[0]
      ?? null
  }, [config, profiles, selectedProfileId])

  const patchConfig = (updater: (current: LlmConfigState) => LlmConfigState): void => {
    if (!config) return
    const nextConfig = updater(config)
    onConfigChange(nextConfig)
    void llmConfigService.saveConfig(nextConfig)
  }

  const selectProfile = (profileId: string): void => {
    onSelectedProfileIdChange(profileId)
    patchConfig(current => ({
      ...current,
      selectedPromptProfileId: profileId,
    }))
  }

  const patchProfile = (patch: Partial<PromptOptimizationProfile>): void => {
    if (!selectedProfile) return
    const nextProfile = { ...selectedProfile, ...patch, updatedAt: new Date().toISOString() }
    patchConfig(current => ({
      ...current,
      promptProfiles: current.promptProfiles.map(profile => (
        profile.id === nextProfile.id ? nextProfile : profile
      )),
    }))
  }

  const setDefaultProfile = (profileId: string): void => {
    patchConfig(current => ({
      ...current,
      promptProfiles: current.promptProfiles.map(profile => ({
        ...profile,
        isDefault: profile.id === profileId,
      })),
    }))
  }

  const addProfile = (): void => {
    if (!config) return
    const profile = createProfile(config)
    patchConfig(current => ({
      ...current,
      promptProfiles: [...current.promptProfiles, profile],
      selectedPromptProfileId: profile.id,
    }))
    onSelectedProfileIdChange(profile.id)
  }

  const deleteSelected = (): void => {
    if (!selectedProfile || profiles.length <= 1) return
    const nextProfiles = profiles.filter(profile => profile.id !== selectedProfile.id)
    const hasDefault = nextProfiles.some(profile => profile.isDefault)
    if (!hasDefault && nextProfiles[0]) {
      nextProfiles[0] = { ...nextProfiles[0], isDefault: true }
    }
    const nextSelectedProfileId = nextProfiles[0]?.id ?? ''
    onSelectedProfileIdChange(nextSelectedProfileId)
    patchConfig(current => ({
      ...current,
      promptProfiles: nextProfiles,
      selectedPromptProfileId: nextSelectedProfileId,
    }))
  }

  if (!config || !selectedProfile) {
    return (
      <div className="p-4 text-sm text-text-muted">
        正在加载提示词优化配置...
      </div>
    )
  }

  const providerOptions = buildProviderOptions(activeConfig)
  const modelOptions = buildModelOptions(activeConfig, selectedProfile.providerId)

  return (
    <div className="flex max-h-[min(680px,calc(100vh-96px))] flex-col p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-text-dark">提示词优化配置</div>
        </div>
        <div className="text-xs text-text-muted">
          {selectedProfile.isDefault ? '默认配置' : '非默认配置'}
        </div>
      </div>

      <div className="grid min-h-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
          {profiles.map(profile => (
            <UiOptionButton
              key={profile.id}
              type="button"
              active={profile.id === selectedProfile.id}
              variant="card"
              onClick={() => selectProfile(profile.id)}
              className="w-full justify-between gap-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm">{profile.name}</span>
                <span className={`block truncate text-xs ${profile.id === selectedProfile.id ? 'text-white/80' : 'text-text-muted'}`}>
                  {profile.providerId} / {profile.modelId}
                </span>
              </span>
              {profile.isDefault ? <Star size={14} className={profile.id === selectedProfile.id ? 'text-white/90' : ''} /> : null}
            </UiOptionButton>
          ))}
          <UiButton type="button" variant="muted" className="w-full" onClick={addProfile}>
            <Plus size={15} className="mr-2" />
            新增配置
          </UiButton>
        </div>

        <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
          <UiInput
            value={selectedProfile.name}
            onChange={(event) => patchProfile({ name: event.target.value })}
            placeholder="配置名称"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Dropdown
              label="供应商"
              value={selectedProfile.providerId}
              display={providerOptions.find(provider => provider.providerId === selectedProfile.providerId)?.displayName ?? selectedProfile.providerId}
              options={providerOptions.map(provider => ({
                value: provider.providerId,
                label: provider.displayName,
              }))}
              onSelect={(providerId) => {
                const nextProviderId = String(providerId)
                const model = activeConfig.models.find(item => item.providerId === nextProviderId && item.enabled)
                  ?? activeConfig.models.find(item => item.providerId === nextProviderId)
                patchProfile({
                  providerId: nextProviderId,
                  modelId: model?.modelId ?? '',
                  capabilities: buildProfileCapabilities(model),
                })
              }}
              className="w-full"
            />

            <Dropdown
              label="模型"
              value={selectedProfile.modelId}
              display={modelOptions.find(model => model.modelId === selectedProfile.modelId)?.displayName ?? selectedProfile.modelId}
              options={modelOptions.map(model => ({
                value: model.modelId,
                label: model.displayName,
              }))}
              onSelect={(modelId) => {
                const nextModelId = String(modelId)
                const nextModel = modelOptions.find(model => model.modelId === nextModelId)
                patchProfile({
                  modelId: nextModelId,
                  capabilities: buildProfileCapabilities(nextModel),
                })
              }}
              className="w-full"
            />
          </div>

          <PromptTemplateTextarea
            value={selectedProfile.systemPrompt}
            onChange={(value) => patchProfile({ systemPrompt: value })}
            rows={4}
            placeholder="System Prompt"
          />
          <PromptTemplateTextarea
            value={selectedProfile.userTemplate}
            onChange={(value) => patchProfile({ userTemplate: value })}
            rows={5}
            placeholder="User Template，使用 {{prompt}} 插入当前提示词"
          />
          <div className="flex flex-wrap items-center gap-4 text-sm text-text-dark">
            <label className="inline-flex items-center gap-2">
              <UiCheckbox
                checked={selectedProfile.capabilities.image}
                onCheckedChange={(checked) => patchProfile({ capabilities: { ...selectedProfile.capabilities, image: checked } })}
              />
              图片输入
            </label>
            <label className="inline-flex items-center gap-2">
              <UiCheckbox
                checked={selectedProfile.capabilities.video}
                onCheckedChange={(checked) => patchProfile({ capabilities: { ...selectedProfile.capabilities, video: checked } })}
              />
              视频输入
            </label>
            <label className="inline-flex items-center gap-2">
              <UiCheckbox
                checked={selectedProfile.enabled}
                onCheckedChange={(checked) => patchProfile({ enabled: checked })}
              />
              启用
            </label>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <UiButton
              type="button"
              variant="primary"
              onClick={() => setDefaultProfile(selectedProfile.id)}
              disabled={selectedProfile.isDefault}
            >
              <Save size={15} className="mr-2" />
              设为默认
            </UiButton>
            <UiButton
              type="button"
              variant="ghost"
              onClick={deleteSelected}
              disabled={profiles.length <= 1}
            >
              <Trash2 size={15} className="mr-2" />
              删除配置
            </UiButton>
          </div>
        </div>
      </div>
    </div>
  )
}
