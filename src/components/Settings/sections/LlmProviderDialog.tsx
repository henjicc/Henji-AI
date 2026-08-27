import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import {
  Dropdown,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiInput,
  UiModal,
  UiOptionButton,
  UiPanel,
  UiSwitch,
} from '@/components/ui'
import { createDefaultProviderReasoning } from '@/core/llm/defaults'
import {
  LLM_PROVIDER_PRESETS,
  createModelsFromPreset,
  createProviderFromPreset,
  findLlmProviderPreset,
} from '@henjicc/ai-sdk'
import type { LlmModelConfig, LlmProviderConfig } from '@henjicc/ai-sdk'
import {
  createDefaultProvider,
  createProviderId,
  getDefaultBaseUrlForAdapter,
  providerTypes,
  resolveApiPreview,
  resolveProviderReasoning,
} from './llmSettingsSectionHelpers'

const CUSTOM_PRESET = '__custom__'

interface LlmProviderDialogProps {
  isOpen: boolean
  providers: LlmProviderConfig[]
  onClose: () => void
  /** `seedModels` 是预设推荐模型；调用方负责跳过已存在的模型。 */
  onSave: (provider: LlmProviderConfig, seedModels: LlmModelConfig[]) => Promise<void>
  onDelete: (providerId: string) => Promise<void>
}

const presetOptions = [
  { value: CUSTOM_PRESET, label: '自定义（手动填写）' },
  ...LLM_PROVIDER_PRESETS.map(preset => ({ value: preset.providerId, label: preset.displayName })),
]

const LlmProviderDialog = ({
  isOpen,
  providers,
  onClose,
  onSave,
  onDelete,
}: LlmProviderDialogProps): JSX.Element => {
  const [draft, setDraft] = useState<LlmProviderConfig>(() => providers[0] ?? createDefaultProvider())
  /** 只影响"要不要一并建推荐模型"，选完之后所有字段仍可改。 */
  const [presetId, setPresetId] = useState<string>(CUSTOM_PRESET)

  useEffect(() => {
    if (!isOpen) return
    setDraft(providers[0] ? { ...providers[0] } : createDefaultProvider())
    setPresetId(providers[0] ? providers[0].providerId : CUSTOM_PRESET)
    // 只在打开时重置一次，之后的编辑不受外部 providers 变化影响。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const patch = (next: Partial<LlmProviderConfig>): void => {
    setDraft(prev => ({ ...prev, ...next }))
  }

  const selectExisting = (provider: LlmProviderConfig): void => {
    setDraft({ ...provider })
    setPresetId(findLlmProviderPreset(provider.providerId) ? provider.providerId : CUSTOM_PRESET)
  }

  const startNew = (): void => {
    setDraft(createDefaultProvider())
    setPresetId(CUSTOM_PRESET)
  }

  const selectPreset = (value: string): void => {
    setPresetId(value)
    const preset = value === CUSTOM_PRESET ? null : findLlmProviderPreset(value)
    if (!preset) {
      setDraft(createDefaultProvider())
      return
    }
    // 已经配过这家供应商时保留用户已填的 Base URL，避免把改过的地域地址冲掉。
    const existing = providers.find(provider => provider.providerId === preset.providerId)
    setDraft({
      ...createProviderFromPreset(preset),
      ...(existing ? { baseUrl: existing.baseUrl ?? (preset.baseUrl || undefined), enabled: existing.enabled } : {}),
    })
  }

  const activePreset = presetId === CUSTOM_PRESET ? null : findLlmProviderPreset(presetId)
  const isExisting = providers.some(provider => provider.providerId === draft.providerId)

  const handleSave = async (): Promise<void> => {
    const displayName = draft.displayName.trim()
    if (!displayName) return
    const providerId = draft.providerId.trim()
      || activePreset?.providerId
      || createProviderId(displayName, providers)
    const provider: LlmProviderConfig = {
      ...draft,
      providerId,
      displayName,
      adapter: draft.adapter.trim() || 'openai',
      baseUrl: draft.baseUrl?.trim() || undefined,
      reasoning: resolveProviderReasoning(draft),
    }
    /*
     * 推荐模型只在**新建**这家供应商时补。
     *
     * 已存在的供应商再保存一次也补的话，用户特意删掉的推荐模型会被重新塞回来。
     */
    const seedModels = activePreset && !isExisting ? createModelsFromPreset(activePreset, provider) : []
    await onSave(provider, seedModels)
    startNew()
  }

  return (
    <UiModal
      isOpen={isOpen}
      title="管理供应商"
      onClose={onClose}
      size="editor"
      footer={(
        <>
          <UiButton type="button" variant="muted" onClick={onClose}>关闭</UiButton>
          <UiButton type="button" variant="primary" onClick={() => void handleSave()}>
            {isExisting ? '保存供应商' : '添加供应商'}
          </UiButton>
        </>
      )}
    >
      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] gap-4 overflow-hidden">
        <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
          {providers.map(provider => (
            <UiOptionButton
              key={provider.providerId}
              type="button"
              active={draft.providerId === provider.providerId}
              variant="menu"
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5"
              onClick={() => selectExisting(provider)}
            >
              <span className="min-w-0 text-left">
                <span className="block truncate text-sm">{provider.displayName}</span>
                <span className="block truncate text-xs text-text-muted">{provider.adapter}</span>
              </span>
              <span className={`text-xs ${provider.enabled ? 'text-green-400' : 'text-text-muted'}`}>
                {provider.enabled ? 'ON' : 'OFF'}
              </span>
            </UiOptionButton>
          ))}
          <UiButton type="button" variant="muted" className="w-full" onClick={startNew}>
            <Plus size={14} className="mr-1.5" />
            新建供应商
          </UiButton>
        </div>

        <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
          <UiPanel variant="inset" className="px-3 py-2">
            <div className={UI_TEXT_META_CLASS}>当前编辑</div>
            <div className={`truncate ${UI_TEXT_LABEL_CLASS}`}>{draft.displayName || '新建供应商'}</div>
          </UiPanel>

          {/*
            预设把已核对过的 Base URL、思考参数默认值和推荐模型一次填好，
            资料出处见 packages/ai-sdk/docs/llm-adaptation/供应商/*.md。选完仍可逐项改。
          */}
          <Dropdown<string>
            value={presetId}
            display={presetOptions.find(option => option.value === presetId)?.label ?? '自定义（手动填写）'}
            options={presetOptions}
            className="w-full"
            buttonClassName="w-full"
            onSelect={selectPreset}
          />
          {activePreset ? (
            <div className={`space-y-1 ${UI_TEXT_META_CLASS}`}>
              <div>
                推荐模型：{activePreset.modelIds.join('、')}
                {isExisting ? '（该供应商已存在，不再重复添加）' : '（添加时一并建好，能力已按内置目录标好）'}
              </div>
              {activePreset.note ? <div>{activePreset.note}</div> : null}
            </div>
          ) : null}

          <UiInput
            value={draft.displayName}
            onChange={event => patch({ displayName: event.target.value })}
            placeholder="供应商名称，例如 DeepSeek"
          />
          <Dropdown
            value={draft.adapter}
            display={providerTypes.find(type => type.value === draft.adapter)?.label ?? draft.adapter}
            options={providerTypes}
            className="w-full"
            buttonClassName="w-full"
            onSelect={adapter => patch({
              adapter,
              baseUrl: draft.baseUrl || getDefaultBaseUrlForAdapter(adapter),
              reasoning: createDefaultProviderReasoning(adapter),
            })}
          />
          <UiInput
            value={draft.baseUrl ?? ''}
            onChange={event => patch({ baseUrl: event.target.value })}
            placeholder="API 地址，例如 https://api.deepseek.com"
          />
          <div className={UI_TEXT_META_CLASS}>
            {activePreset?.baseUrlHint && !draft.baseUrl?.trim()
              ? activePreset.baseUrlHint
              : `预览：${resolveApiPreview(draft) || '请先填写 API 地址'}`}
          </div>
          <label className={`inline-flex items-center gap-2 ${UI_TEXT_BODY_CLASS}`}>
            <UiSwitch
              checked={draft.enabled !== false}
              onCheckedChange={checked => patch({ enabled: checked })}
            />
            启用供应商
          </label>
          {isExisting ? (
            <UiButton
              type="button"
              variant="ghost"
              className="text-text-muted hover:text-text-dark"
              onClick={async () => {
                await onDelete(draft.providerId)
                startNew()
              }}
            >
              <Trash2 size={14} className="mr-1.5" />
              删除该供应商
            </UiButton>
          ) : null}
        </div>
      </div>
    </UiModal>
  )
}

export default LlmProviderDialog
