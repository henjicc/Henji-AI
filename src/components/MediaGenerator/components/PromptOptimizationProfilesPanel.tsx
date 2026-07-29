import React, { useMemo } from 'react'
import { Plus, Save, Star, Trash2 } from 'lucide-react'
import {
  PromptEditor,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_SECTION_CLASS,
  UiButton,
  UiCheckbox,
  UiInput,
  UiOptionButton,
} from '@/components/ui'
import Dropdown from '@/components/ui/Dropdown'
import { toLegacyPromptString, type PromptDocumentV1 } from '@/core/inputs/promptDocument'
import { DEFAULT_DEEPSEEK_PROVIDER_ID, createDefaultLlmConfig } from '@/core/llm/defaults'
import {
  getDefaultPromptProfile,
  normalizePromptOptimizationProfileDocuments,
  PROMPT_OPTIMIZATION_EDITOR_VARIABLES,
  readPromptOptimizationProfileDocument,
} from '@/core/llm/promptOptimization'
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
  return normalizePromptOptimizationProfileDocuments({
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
  })
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

function PromptTemplateEditor({
  value,
  onChange,
  rows,
  placeholder,
}: {
  value: PromptDocumentV1
  onChange: (value: PromptDocumentV1) => void
  rows: number
  placeholder: string
}): JSX.Element {
  return (
    <PromptEditor
      value={value}
      onChange={onChange}
      preset="template-variables"
      layout="fill-scroll"
      variables={PROMPT_OPTIMIZATION_EDITOR_VARIABLES}
      ariaLabel={placeholder}
      placeholder={placeholder}
      className="relative isolate"
      editorClassName={`ui-scrollbar max-h-[260px] ${rows > 4 ? 'min-h-[120px]' : 'min-h-[96px]'}`}
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
      <div className={`p-4 ${UI_TEXT_BODY_CLASS}`}>
        正在加载提示词优化配置...
      </div>
    )
  }

  const providerOptions = buildProviderOptions(activeConfig)
  const modelOptions = buildModelOptions(activeConfig, selectedProfile.providerId)
  const systemPromptDocument = readPromptOptimizationProfileDocument(selectedProfile, 'systemPrompt')
  const userTemplateDocument = readPromptOptimizationProfileDocument(selectedProfile, 'userTemplate')

  const patchTemplateDocument = (
    field: 'systemPrompt' | 'userTemplate',
    document: PromptDocumentV1,
  ): void => {
    if (field === 'systemPrompt') {
      patchProfile({
        systemPromptDocument: document,
        systemPrompt: toLegacyPromptString(document),
      })
      return
    }
    patchProfile({
      userTemplateDocument: document,
      userTemplate: toLegacyPromptString(document),
    })
  }

  return (
    <div className="flex max-h-[min(680px,calc(100vh-96px))] flex-col p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className={UI_TEXT_SECTION_CLASS}>提示词优化配置</div>
        </div>
        <div className={UI_TEXT_META_CLASS}>
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
              variant="menu"
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

        <div className="min-h-0 space-y-3 overflow-y-auto p-1">
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

          <PromptTemplateEditor
            value={systemPromptDocument}
            onChange={(value) => patchTemplateDocument('systemPrompt', value)}
            rows={4}
            placeholder="System Prompt"
          />
          <PromptTemplateEditor
            value={userTemplateDocument}
            onChange={(value) => patchTemplateDocument('userTemplate', value)}
            rows={5}
            placeholder="User Template，使用 {{prompt}} 插入当前提示词"
          />
          <div className={`flex flex-wrap items-center gap-4 ${UI_TEXT_BODY_CLASS}`}>
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
