import {
  Dropdown,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiCheckbox,
  UiInput,
  UiModal,
} from '@/components/ui'
import {
  applyLlmModelCatalogEntry,
  describeCatalogInputModalities,
  findLlmModelCatalogEntry,
} from '@henjicc/ai-sdk'
import type { LlmCapabilities, LlmModelConfig } from '@henjicc/ai-sdk'

const capabilityItems: Array<{
  id: keyof Pick<LlmCapabilities, 'image' | 'video' | 'audio' | 'streaming' | 'toolCall' | 'parallelTools' | 'reasoning' | 'sampling' | 'usage'>
  label: string
}> = [
  { id: 'image', label: '图片输入' },
  { id: 'video', label: '视频输入' },
  { id: 'audio', label: '音频输入' },
  { id: 'streaming', label: '流式输出' },
  { id: 'toolCall', label: '工具调用' },
  { id: 'parallelTools', label: '并行工具' },
  { id: 'reasoning', label: '思考输出' },
  { id: 'sampling', label: '采样参数' },
  { id: 'usage', label: 'Token 用量' },
]

const structuredOutputOptions: Array<{ value: LlmCapabilities['structuredOutputMode']; label: string }> = [
  { value: 'none', label: '不支持结构化输出' },
  { value: 'json', label: 'JSON 模式' },
  { value: 'schema', label: 'JSON Schema 模式' },
]

interface LlmModelDialogProps {
  isOpen: boolean
  model: LlmModelConfig | null
  onChange: (model: LlmModelConfig) => void
  onClose: () => void
  onSave: () => Promise<void>
}

function parseOptionalPositiveInteger(value: string): number | null {
  if (!value.trim()) return null
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

const LlmModelDialog = ({ isOpen, model, onChange, onClose, onSave }: LlmModelDialogProps): JSX.Element => {
  const update = (patch: Partial<LlmModelConfig>): void => {
    if (model) onChange({ ...model, ...patch })
  }
  const updateCapabilities = (patch: Partial<LlmCapabilities>): void => {
    if (model) onChange({ ...model, capabilities: { ...model.capabilities, ...patch, text: true } })
  }

  /*
   * 模型 ID 命中内置目录时立刻把能力填好，用户不用自己去查"这个模型能不能看图"。
   *
   * 填完就盖上 catalogId 戳，之后用户手动改的任何一项都不会被保存时的归一化再覆盖回去。
   */
  const updateModelId = (modelId: string): void => {
    if (!model) return
    const entry = findLlmModelCatalogEntry(modelId)
    if (!entry || entry.id === model.catalogId) {
      onChange({ ...model, modelId })
      return
    }
    onChange({
      ...model,
      modelId,
      displayName: model.displayName.trim() || entry.displayName,
      capabilities: applyLlmModelCatalogEntry(model.capabilities, entry),
      catalogId: entry.id,
    })
  }

  const catalogEntry = model ? findLlmModelCatalogEntry(model.modelId) : null
  const structuredOutputMode = model?.capabilities.structuredOutputMode ?? 'none'

  return (
    <UiModal
      isOpen={isOpen}
      title={model?.modelId ? '编辑模型' : '添加模型'}
      onClose={onClose}
      size="form"
      footer={(
        <>
          <UiButton type="button" variant="muted" onClick={onClose}>取消</UiButton>
          <UiButton type="button" variant="primary" onClick={() => void onSave()}>确定</UiButton>
        </>
      )}
    >
      <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
        <div className="space-y-1.5">
          <div className={UI_TEXT_LABEL_CLASS}>模型 ID</div>
          <UiInput value={model?.modelId ?? ''} onChange={event => updateModelId(event.target.value)} placeholder="例如 deepseek-v4-flash" />
        </div>
        <div className="space-y-1.5">
          <div className={UI_TEXT_LABEL_CLASS}>模型名称</div>
          <UiInput value={model?.displayName ?? ''} onChange={event => update({ displayName: event.target.value })} placeholder="例如 DeepSeek V4 Flash" />
        </div>
        {catalogEntry ? (
          <div className={`space-y-1 ${UI_TEXT_META_CLASS}`}>
            <div>
              已按内置目录标注（{catalogEntry.vendor} · {catalogEntry.displayName}）；
              支持输入：{describeCatalogInputModalities(catalogEntry)}。下面的选项仍可手动修改。
            </div>
            {catalogEntry.note ? <div>{catalogEntry.note}</div> : null}
          </div>
        ) : null}
        <div className={`grid grid-cols-2 gap-2 ${UI_TEXT_BODY_CLASS}`}>
          {capabilityItems.map(item => (
            <label key={item.id} className="inline-flex items-center gap-2 rounded-lg border border-border-dark bg-app px-3 py-2">
              <UiCheckbox checked={model?.capabilities[item.id] === true} onCheckedChange={checked => updateCapabilities({ [item.id]: checked })} />
              {item.label}
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Dropdown<LlmCapabilities['structuredOutputMode']>
            value={structuredOutputMode}
            display={structuredOutputOptions.find(option => option.value === structuredOutputMode)?.label ?? structuredOutputMode}
            options={structuredOutputOptions}
            className="w-full"
            buttonClassName="w-full"
            onSelect={mode => updateCapabilities({ structuredOutputMode: mode, jsonOutput: mode !== 'none' })}
          />
          <UiInput
            type="number"
            min={1}
            value={model?.capabilities.contextWindow ?? ''}
            onChange={event => updateCapabilities({ contextWindow: parseOptionalPositiveInteger(event.target.value) })}
            placeholder="上下文 Token（未知）"
          />
          <UiInput
            type="number"
            min={1}
            value={model?.capabilities.maxOutputTokens ?? ''}
            onChange={event => updateCapabilities({ maxOutputTokens: parseOptionalPositiveInteger(event.target.value) })}
            placeholder="最大输出 Token（未知）"
          />
        </div>
      </div>
    </UiModal>
  )
}

export default LlmModelDialog
