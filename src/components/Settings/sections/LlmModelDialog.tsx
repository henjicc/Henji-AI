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
import { useI18n } from '@/hooks/useI18n'
import {
  applyLlmModelCatalogEntry,
  describeCatalogInputModalities,
  findLlmModelCatalogEntry,
} from '@henjicc/ai-sdk'
import type { LlmCapabilities, LlmModelConfig } from '@henjicc/ai-sdk'

// 文案在 settings.llmModelDialog.capabilities.<id> / structured.<mode>
const capabilityItems: Array<keyof Pick<LlmCapabilities, 'image' | 'video' | 'audio' | 'streaming' | 'toolCall' | 'parallelTools' | 'reasoning' | 'sampling' | 'usage'>> = [
  'image', 'video', 'audio', 'streaming', 'toolCall', 'parallelTools', 'reasoning', 'sampling', 'usage',
]

const structuredOutputModes: Array<LlmCapabilities['structuredOutputMode']> = ['none', 'json', 'schema']

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
  const { t } = useI18n('settings')
  const structuredOutputOptions = structuredOutputModes.map(value => ({ value, label: t(`llmModelDialog.structured.${value}`) }))
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
      title={model?.modelId ? t('llmModelDialog.editTitle') : t('llmModelDialog.addTitle')}
      onClose={onClose}
      size="form"
      footer={(
        <>
          <UiButton type="button" variant="secondary" onClick={onClose}>{t('llmModelDialog.cancel')}</UiButton>
          <UiButton type="button" variant="primary" onClick={() => void onSave()}>{t('llmModelDialog.confirm')}</UiButton>
        </>
      )}
    >
      <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
        <div className="space-y-1.5">
          <div className={UI_TEXT_LABEL_CLASS}>{t('llmModelDialog.modelId')}</div>
          <UiInput aria-label={t('llmModelDialog.modelId')} value={model?.modelId ?? ''} onChange={event => updateModelId(event.target.value)} placeholder={t('llmModelDialog.modelIdPlaceholder')} />
        </div>
        <div className="space-y-1.5">
          <div className={UI_TEXT_LABEL_CLASS}>{t('llmModelDialog.displayName')}</div>
          <UiInput aria-label={t('llmModelDialog.displayName')} value={model?.displayName ?? ''} onChange={event => update({ displayName: event.target.value })} placeholder={t('llmModelDialog.displayNamePlaceholder')} />
        </div>
        {catalogEntry ? (
          <div className={`space-y-1 ${UI_TEXT_META_CLASS}`}>
            <div>
              {t('llmModelDialog.catalogNote', { vendor: catalogEntry.vendor, name: catalogEntry.displayName, inputs: describeCatalogInputModalities(catalogEntry) })}
            </div>
            {catalogEntry.note ? <div>{catalogEntry.note}</div> : null}
          </div>
        ) : null}
        {/* 能力复选是同质选项集合：静息不描边、不铺底（复选框本体已是命中区），只靠排布成格 */}
        <div className="space-y-1.5">
          <div className={UI_TEXT_LABEL_CLASS}>{t('llmModelDialog.capabilitiesLabel')}</div>
          <div className={`grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 ${UI_TEXT_BODY_CLASS}`}>
            {capabilityItems.map(id => (
              <label key={id} className="inline-flex min-h-7 cursor-pointer items-center gap-2">
                <UiCheckbox aria-label={t(`llmModelDialog.capabilities.${id}`)} checked={model?.capabilities[id] === true} onCheckedChange={checked => updateCapabilities({ [id]: checked })} />
                {t(`llmModelDialog.capabilities.${id}`)}
              </label>
            ))}
          </div>
        </div>
        {/* 三个字段各自带标签：原来只有占位文字，填上数字后就看不出是哪一项 */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="min-w-0 space-y-1.5">
            <div className={UI_TEXT_LABEL_CLASS}>{t('llmModelDialog.structuredLabel')}</div>
            <Dropdown<LlmCapabilities['structuredOutputMode']>
              value={structuredOutputMode}
              display={structuredOutputOptions.find(option => option.value === structuredOutputMode)?.label ?? structuredOutputMode}
              options={structuredOutputOptions}
              ariaLabel={t('llmModelDialog.structuredLabel')}
              className="w-full"
              buttonClassName="w-full"
              onSelect={mode => updateCapabilities({ structuredOutputMode: mode, jsonOutput: mode !== 'none' })}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className={UI_TEXT_LABEL_CLASS}>{t('llmModelDialog.contextWindow')}</div>
            <UiInput
              type="number"
              min={1}
              aria-label={t('llmModelDialog.contextWindow')}
              value={model?.capabilities.contextWindow ?? ''}
              onChange={event => updateCapabilities({ contextWindow: parseOptionalPositiveInteger(event.target.value) })}
              placeholder={t('llmModelDialog.unknown')}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className={UI_TEXT_LABEL_CLASS}>{t('llmModelDialog.maxOutput')}</div>
            <UiInput
              type="number"
              min={1}
              aria-label={t('llmModelDialog.maxOutput')}
              value={model?.capabilities.maxOutputTokens ?? ''}
              onChange={event => updateCapabilities({ maxOutputTokens: parseOptionalPositiveInteger(event.target.value) })}
              placeholder={t('llmModelDialog.unknown')}
            />
          </div>
        </div>
      </div>
    </UiModal>
  )
}

export default LlmModelDialog
