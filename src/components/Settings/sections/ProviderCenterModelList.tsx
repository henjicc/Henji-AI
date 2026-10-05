import { useRef, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import {
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiChipButton,
  UiEmpty,
  UiIconButton,
  UiInput,
  UiSwitch,
} from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type {
  ProviderCenterCategory,
  ProviderCenterGroup,
  ProviderCenterModelItem,
} from './providerCenterModel'
import { countProviderCategories } from './providerCenterModel'

interface ProviderCenterModelListProps {
  group: ProviderCenterGroup
  category: 'all' | ProviderCenterCategory
  onCategoryChange: (category: 'all' | ProviderCenterCategory) => void
  onModelEnabledChange: (model: ProviderCenterModelItem, enabled: boolean) => void | Promise<void>
  onSetFilteredEnabled: (models: ProviderCenterModelItem[], enabled: boolean) => void | Promise<void>
  onEditModel: (model: ProviderCenterModelItem) => void
  onDeleteModel: (model: ProviderCenterModelItem) => void | Promise<void>
  /** 生成模型改名：按模型本身生效，同一模型在所有供应商下同步；空字符串恢复原名 */
  onRenameModel: (model: ProviderCenterModelItem, name: string) => void
}

const CATEGORY_ORDER: ProviderCenterCategory[] = [
  'image-generation',
  'video-generation',
  'audio-generation',
  'speech-recognition',
  'ocr',
  'text-generation',
]

function categoryLabel(category: ProviderCenterCategory, t: (key: string) => string): string {
  return t(`providerCenter.categories.${category}`)
}

const ProviderCenterModelList = ({
  group,
  category,
  onCategoryChange,
  onModelEnabledChange,
  onSetFilteredEnabled,
  onEditModel,
  onDeleteModel,
  onRenameModel,
}: ProviderCenterModelListProps): JSX.Element => {
  const { t } = useI18n('settings')
  // 正在改名的行与草稿。改名就地进行，不再另开一个"别名"分区把全部模型重新列一遍。
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null)
  // Esc 取消后输入框卸载；个别环境卸载时仍会触发 blur，用它挡住那次提交
  const cancelledRef = useRef(false)
  const commitRename = (model: ProviderCenterModelItem): void => {
    if (cancelledRef.current || renaming?.id !== model.id) return
    onRenameModel(model, renaming.draft)
    setRenaming(null)
  }
  const counts = countProviderCategories(group.models)
  const categories = CATEGORY_ORDER.filter(item => (counts[item] ?? 0) > 0)
  const filtered = category === 'all' ? group.models : group.models.filter(model => model.category === category)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <UiChipButton
            type="button"
            active={category === 'all'}
            selectionRole="navigation"
            onClick={() => onCategoryChange('all')}
            size="md"
          >
            {t('providerCenter.categories.all')} {group.models.length}
          </UiChipButton>
          {categories.map(item => (
            <UiChipButton
              key={item}
              type="button"
              active={category === item}
              selectionRole="navigation"
              onClick={() => onCategoryChange(item)}
              size="md"
            >
              {categoryLabel(item, t)} {counts[item]}
            </UiChipButton>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <UiButton type="button" onClick={() => void onSetFilteredEnabled(filtered, true)}>
            {t('modelSettings.actions.showAll')}
          </UiButton>
          <UiButton type="button" onClick={() => void onSetFilteredEnabled(filtered, false)}>
            {t('modelSettings.actions.hideAll')}
          </UiButton>
        </div>
      </div>

      {filtered.length === 0 ? (
        <UiEmpty size="sm" title={t('providerCenter.emptyModels')} description={t('providerCenter.emptyModelsHint')} />
      ) : (
        // 第三列定宽：可编辑的模型多了编辑、删除两个按钮，`auto` 列会让每行的“能力”列左缘各不相同
        // 表头固定，只有模型行在下面滚动（上方的密钥、筛选都不动）
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={`grid shrink-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_8rem] gap-4 border-b border-line px-1 pb-2 ${UI_TEXT_META_CLASS}`}>
            <span>{t('providerCenter.columns.model')}</span>
            <span>{t('providerCenter.columns.capability')}</span>
            <span className="text-right">{t('providerCenter.columns.visibility')}</span>
          </div>
          <div data-provider-model-list className="min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain">
            {filtered.map(model => (
              <div key={model.id} className="grid min-h-14 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_8rem] items-center gap-4 px-1 py-2.5">
                <div className="min-w-0">
                  {renaming?.id === model.id ? (
                    <UiInput
                      autoFocus
                      value={renaming.draft}
                      placeholder={model.generationModel?.originalName}
                      title={t('providerCenter.renameHint')}
                      aria-label={t('providerCenter.actions.renameModel')}
                      onChange={(event) => setRenaming({ id: model.id, draft: event.target.value })}
                      onBlur={() => commitRename(model)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                        if (event.key === 'Escape') { event.stopPropagation(); cancelledRef.current = true; setRenaming(null) }
                      }}
                    />
                  ) : (
                    <div className={`truncate ${UI_TEXT_BODY_CLASS}`}>{model.name}</div>
                  )}
                  <div className={`truncate ${UI_TEXT_META_CLASS}`}>
                    {model.generationModel && model.name !== model.generationModel.originalName
                      ? `${t('providerCenter.originalName', { name: model.generationModel.originalName })} · ${model.modelId}`
                      : model.modelId}
                  </div>
                </div>
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {model.capabilityIds.slice(0, 4).map(capability => (
                    // 能力徽标：中性 raised 浅底、圆角 4、12 号次要文字
                    <span key={capability} className="shrink-0 rounded bg-raised px-2 py-0.5 text-xs text-text2">
                      {t(`providerCenter.capabilities.${capability}`, { defaultValue: capability })}
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-end gap-1">
                  {model.source === 'llm' ? (
                    <>
                      <UiIconButton size="lg"
                        type="button"
                        aria-label={t('providerCenter.actions.editModel')}
                        title={t('providerCenter.actions.editModel')}
                        onClick={() => onEditModel(model)}
                      >
                        <Pencil className="h-4 w-4" />
                      </UiIconButton>
                      <UiIconButton size="lg" tone="danger"
                        type="button"
                        aria-label={t('providerCenter.actions.deleteModel')}
                        title={t('providerCenter.actions.deleteModel')}
                        onClick={() => void onDeleteModel(model)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </UiIconButton>
                    </>
                  ) : (
                    <UiIconButton size="lg"
                      type="button"
                      aria-label={t('providerCenter.actions.renameModel')}
                      title={t('providerCenter.renameHint')}
                      onClick={() => { cancelledRef.current = false; setRenaming({
                        id: model.id,
                        draft: model.name === model.generationModel?.originalName ? '' : model.name,
                      }) }}
                    >
                      <Pencil className="h-4 w-4" />
                    </UiIconButton>
                  )}
                  <span className="ml-1">
                    <UiSwitch
                      checked={model.enabled}
                      onCheckedChange={(enabled) => void onModelEnabledChange(model, enabled)}
                      aria-label={`${model.name} · ${model.enabled ? t('modelSettings.status.visible') : t('modelSettings.status.hidden')}`}
                    />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default ProviderCenterModelList
