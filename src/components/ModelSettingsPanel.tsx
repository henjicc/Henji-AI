import React, { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { getAvailableProviders } from '../utils/modelHelpers'
import { getHiddenProviders, saveHiddenProviders, getHiddenTypes, saveHiddenTypes, getHiddenModels, saveHiddenModels, type Provider } from '../config/providers'
import { useI18n } from '@/hooks/useI18n'
import {
  UI_TEXT_BODY_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiChipButton,
  UiDisclosurePanel,
  UiGroup,
  UiPanel,
} from '@/components/ui'
import Toggle from '@/components/ui/Toggle'
import ModelTypeBadge from './ModelTypeBadge'

const ModelSettingsPanel: React.FC = () => {
  const { t } = useI18n('settings')
  // 获取所有可用的 providers
  const providers = getAvailableProviders()

  // 使用惰性初始化，直接从 localStorage 读取初始值
  const [hiddenProviders, setHiddenProviders] = useState<Set<string>>(() => getHiddenProviders())
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => getHiddenTypes())
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(() => getHiddenModels())
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(() => new Set())

  const toggleProviderExpanded = (providerId: string): void => {
    setExpandedProviders(prev => {
      const next = new Set(prev)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      return next
    })
  }

  const toggleModelVisibility = (providerId: string, modelId: string): void => {
    const key = `${providerId}-${modelId}`
    const newHiddenModels = new Set(hiddenModels)

    if (newHiddenModels.has(key)) {
      newHiddenModels.delete(key)
    } else {
      newHiddenModels.add(key)
    }

    setHiddenModels(newHiddenModels)
    saveHiddenModels(newHiddenModels)

    // 触发事件通知其他组件更新
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const isProviderVisible = (providerId: string): boolean => {
    // 检查该供应商是否在隐藏列表中
    return !hiddenProviders.has(providerId)
  }

  const isTypeVisible = (type: 'image' | 'video' | 'audio'): boolean => {
    // 检查该类型是否在隐藏列表中
    return !hiddenTypes.has(type)
  }

  const toggleProviderVisibility = (providerId: string): void => {
    const newHiddenProviders = new Set(hiddenProviders)

    if (newHiddenProviders.has(providerId)) {
      newHiddenProviders.delete(providerId)
    } else {
      newHiddenProviders.add(providerId)
    }

    setHiddenProviders(newHiddenProviders)
    saveHiddenProviders(newHiddenProviders)
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const showAllModelsForProvider = (providerId: string): void => {
    const provider = providers.find(p => p.id === providerId)
    if (!provider) return

    const newHiddenModels = new Set(hiddenModels)
    provider.models.forEach(model => {
      const key = `${providerId}-${model.id}`
      newHiddenModels.delete(key)
    })

    setHiddenModels(newHiddenModels)
    saveHiddenModels(newHiddenModels)
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const hideAllModelsForProvider = (providerId: string): void => {
    const provider = providers.find(p => p.id === providerId)
    if (!provider) return

    const newHiddenModels = new Set(hiddenModels)
    provider.models.forEach(model => {
      const key = `${providerId}-${model.id}`
      newHiddenModels.add(key)
    })

    setHiddenModels(newHiddenModels)
    saveHiddenModels(newHiddenModels)
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const toggleTypeVisibility = (type: 'image' | 'video' | 'audio'): void => {
    const newHiddenTypes = new Set(hiddenTypes)

    if (newHiddenTypes.has(type)) {
      newHiddenTypes.delete(type)
    } else {
      newHiddenTypes.add(type)
    }

    setHiddenTypes(newHiddenTypes)
    saveHiddenTypes(newHiddenTypes)
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const showAll = (): void => {
    setHiddenProviders(new Set())
    saveHiddenProviders(new Set())
    setHiddenTypes(new Set())
    saveHiddenTypes(new Set())
    setHiddenModels(new Set())
    saveHiddenModels(new Set())
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const hideAll = (): void => {
    const allProviders = new Set(providers.map(p => p.id))
    setHiddenProviders(allProviders)
    saveHiddenProviders(allProviders)
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const resetToDefault = (): void => {
    setHiddenProviders(new Set())
    saveHiddenProviders(new Set())
    setHiddenTypes(new Set())
    saveHiddenTypes(new Set())
    setHiddenModels(new Set())
    saveHiddenModels(new Set())
    window.dispatchEvent(new Event('modelVisibilityChanged'))
  }

  const getTypeLabel = (type: string): string => {
    switch (type) {
      case 'image': return t('modelSettings.types.image')
      case 'video': return t('modelSettings.types.video')
      case 'audio': return t('modelSettings.types.audio')
      default: return type
    }
  }

  const isModelHidden = (providerId: string, modelId: string, modelType: string): boolean => {
    // 供应商被隐藏
    if (hiddenProviders.has(providerId)) return true
    // 类型被隐藏
    if (hiddenTypes.has(modelType)) return true
    // 单个模型被隐藏
    if (hiddenModels.has(`${providerId}-${modelId}`)) return true
    return false
  }

  const getProviderStats = (provider: Provider): { total: number; visible: number } => {
    const total = provider.models.length
    const hidden = provider.models.filter(model =>
      isModelHidden(provider.id, model.id, model.type)
    ).length
    const visible = total - hidden
    return { total, visible }
  }

  return (
    <div className="animate-fade-in space-y-8">
      <UiGroup title={t('modelSettings.quickActionsTitle')} titleTone="overline" gap="stack">
        <div className="flex flex-wrap gap-2">
            <UiButton
              type="button"
              size="sm"
              variant="muted"
              onClick={showAll}
            >
              {t('modelSettings.actions.showAll')}
            </UiButton>
            <UiButton
              type="button"
              size="sm"
              variant="muted"
              onClick={hideAll}
            >
              {t('modelSettings.actions.hideAll')}
            </UiButton>
            <UiButton
              type="button"
              size="sm"
              variant="muted"
              onClick={resetToDefault}
            >
              {t('modelSettings.actions.resetDefault')}
            </UiButton>
        </div>

        <div>
          <p className={`mb-2 ${UI_TEXT_LABEL_CLASS}`}>{t('modelSettings.byProvider')}</p>
          <div className="flex flex-wrap gap-2">
              {providers.map(provider => {
                const isVisible = isProviderVisible(provider.id)
                return (
                  <UiChipButton
                    key={provider.id}
                    type="button"
                    active={isVisible}
                    onClick={() => toggleProviderVisibility(provider.id)}
                    className="h-8 px-3 text-xs"
                  >
                    {provider.name}
                  </UiChipButton>
                )
              })}
          </div>
        </div>

        <div>
          <p className={`mb-2 ${UI_TEXT_LABEL_CLASS}`}>{t('modelSettings.byType')}</p>
          <div className="flex flex-wrap gap-2">
              {(['image', 'video', 'audio'] as const).map(type => {
                const isVisible = isTypeVisible(type)
                return (
                  <UiChipButton
                    key={type}
                    type="button"
                    active={isVisible}
                    onClick={() => toggleTypeVisibility(type)}
                    className="h-8 px-3 text-xs"
                  >
                    {getTypeLabel(type)}
                  </UiChipButton>
                )
              })}
          </div>
        </div>
      </UiGroup>

      <UiGroup title={t('modelSettings.listTitle')} titleTone="overline" gap="stack">
        <div className="space-y-3">
          {providers.map(provider => {
            const stats = getProviderStats(provider)
            const expanded = expandedProviders.has(provider.id)
            return (
              <UiPanel key={provider.id} variant="inset" className="overflow-hidden">
                <div
                  role="button"
                  tabIndex={0}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-layer"
                  onClick={() => toggleProviderExpanded(provider.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      toggleProviderExpanded(provider.id)
                    }
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className={`truncate ${UI_TEXT_LABEL_CLASS}`}>{provider.name}</div>
                    <div className={UI_TEXT_META_CLASS}>
                      {t('modelSettings.visibleCount', { visible: stats.visible, total: stats.total })}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                      <UiButton
                        type="button"
                        size="sm"
                        variant="muted"
                        onClick={() => showAllModelsForProvider(provider.id)}
                        className="h-7 px-2.5 text-xs"
                      >
                        {t('modelSettings.actions.showAll')}
                      </UiButton>
                      <UiButton
                        type="button"
                        size="sm"
                        variant="muted"
                        onClick={() => hideAllModelsForProvider(provider.id)}
                        className="h-7 px-2.5 text-xs"
                      >
                        {t('modelSettings.actions.hideAll')}
                      </UiButton>
                    </span>
                    {expanded ? <ChevronUp size={18} className="shrink-0 text-text-muted" /> : <ChevronDown size={18} className="shrink-0 text-text-muted" />}
                  </div>
                </div>

                <div className="border-t border-border-dark">
                  <UiDisclosurePanel open={expanded} className="px-4 py-2">
                    <div className="divide-y divide-border-dark/60">
                      {provider.models.map(model => {
                        const isHidden = isModelHidden(provider.id, model.id, model.type)
                        const statusText = isHidden
                          ? t('modelSettings.status.hidden')
                          : t('modelSettings.status.visible')
                        return (
                          <div
                            key={model.id}
                            className="flex min-h-12 items-center justify-between gap-4 py-2.5"
                          >
                            <div className={`flex min-w-0 items-center gap-3 ${isHidden ? 'opacity-60' : ''}`}>
                              <span className={`truncate ${UI_TEXT_BODY_CLASS}`}>{model.name}</span>
                              <ModelTypeBadge type={model.type} />
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                              <span className={UI_TEXT_META_CLASS}>{statusText}</span>
                              <Toggle
                                checked={!isHidden}
                                onChange={() => toggleModelVisibility(provider.id, model.id)}
                                onText={t('modelSettings.status.visible')}
                                offText={t('modelSettings.status.hidden')}
                                ariaLabel={`${model.name} · ${statusText}`}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </UiDisclosurePanel>
                </div>
              </UiPanel>
            )
          })}
        </div>
      </UiGroup>
    </div>
  )
}

export default ModelSettingsPanel
