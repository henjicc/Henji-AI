import { Pencil, Trash2 } from 'lucide-react'
import {
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiChipButton,
  UiEmpty,
  UiIconButton,
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
}: ProviderCenterModelListProps): JSX.Element => {
  const { t } = useI18n('settings')
  const counts = countProviderCategories(group.models)
  const categories = CATEGORY_ORDER.filter(item => (counts[item] ?? 0) > 0)
  const filtered = category === 'all' ? group.models : group.models.filter(model => model.category === category)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <UiChipButton
            type="button"
            active={category === 'all'}
            selectionRole="navigation"
            onClick={() => onCategoryChange('all')}
            className="h-8 px-3 text-xs"
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
              className="h-8 px-3 text-xs"
            >
              {categoryLabel(item, t)} {counts[item]}
            </UiChipButton>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <UiButton type="button" size="sm" variant="plain" onClick={() => void onSetFilteredEnabled(filtered, true)}>
            {t('modelSettings.actions.showAll')}
          </UiButton>
          <UiButton type="button" size="sm" variant="plain" onClick={() => void onSetFilteredEnabled(filtered, false)}>
            {t('modelSettings.actions.hideAll')}
          </UiButton>
        </div>
      </div>

      {filtered.length === 0 ? (
        <UiEmpty size="sm" title={t('providerCenter.emptyModels')} description={t('providerCenter.emptyModelsHint')} />
      ) : (
        <div className="divide-y divide-border-dark">
          <div className={`grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] gap-4 px-1 pb-2 ${UI_TEXT_META_CLASS}`}>
            <span>{t('providerCenter.columns.model')}</span>
            <span>{t('providerCenter.columns.capability')}</span>
            <span>{t('providerCenter.columns.visibility')}</span>
          </div>
          {filtered.map(model => (
            <div key={model.id} className="grid min-h-14 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-4 px-1 py-2.5">
              <div className="min-w-0">
                <div className={`truncate ${UI_TEXT_BODY_CLASS}`}>{model.name}</div>
                <div className={`truncate ${UI_TEXT_META_CLASS}`}>{model.modelId}</div>
              </div>
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {model.capabilityIds.slice(0, 4).map(capability => (
                  <span key={capability} className={`rounded-full bg-layer px-2 py-1 ${UI_TEXT_META_CLASS}`}>
                    {t(`providerCenter.capabilities.${capability}`, { defaultValue: capability })}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-end gap-1">
                {model.source === 'llm' ? (
                  <>
                    <UiIconButton
                      type="button"
                      showBorder={false}
                      appearance="hover-only"
                      aria-label={t('providerCenter.actions.editModel')}
                      title={t('providerCenter.actions.editModel')}
                      onClick={() => onEditModel(model)}
                    >
                      <Pencil size={15} />
                    </UiIconButton>
                    <UiIconButton
                      type="button"
                      showBorder={false}
                      appearance="hover-only"
                      hoverVariant="danger"
                      aria-label={t('providerCenter.actions.deleteModel')}
                      title={t('providerCenter.actions.deleteModel')}
                      onClick={() => void onDeleteModel(model)}
                    >
                      <Trash2 size={15} />
                    </UiIconButton>
                  </>
                ) : null}
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
      )}
    </div>
  )
}

export default ProviderCenterModelList
