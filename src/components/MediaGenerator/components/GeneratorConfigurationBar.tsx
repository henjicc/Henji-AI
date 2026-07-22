import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import PanelTrigger from '@/components/ui/PanelTrigger'
import { getAvailableProviders, getModelInfo } from '@/utils/modelHelpers'
import type { ModelState } from '../state/useModelState'
import type { UIState } from '../state/useUIState'
import ModelSelectorPanel from './ModelSelectorPanel'
import ParameterPanel from './ParameterPanel'

interface GeneratorConfigurationBarProps {
  uiState: UIState
  modelState: ModelState
}

export function GeneratorConfigurationBar({
  uiState,
  modelState,
}: GeneratorConfigurationBarProps): JSX.Element {
  const { t } = useTranslation('models')
  const providers = getAvailableProviders()
  const currentProvider = providers.find((provider) => provider.id === uiState.selectedProvider)
  const currentModel = getModelInfo(uiState.selectedModel)

  const handleToggleFavorite = (event: MouseEvent, providerId: string, modelId: string): void => {
    event.stopPropagation()
    const key = `${providerId}-${modelId}`
    uiState.setFavoriteModels((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <div className="mb-2.5 flex flex-wrap items-end gap-3 px-1">
      <PanelTrigger
        label={t('title')}
        display={`${currentProvider?.name}：${currentModel?.name || t('selectModel')}`}
        className="w-auto min-w-[180px] flex-shrink-0"
        panelWidth={1100}
        panelClassName="border-border-dark bg-surface-dark shadow-xl"
        alignment="aboveCenter"
        stableHeight
        closeOnPanelClick={(target) => {
          if ((target as HTMLElement).closest('[data-prevent-close]')) return false
          return Boolean((target as HTMLElement).closest('[data-close-on-select]'))
        }}
        renderPanel={() => (
          <ModelSelectorPanel
            selectedProvider={uiState.selectedProvider}
            selectedModel={uiState.selectedModel}
            modelFilterProvider={uiState.modelFilterProvider}
            modelFilterType={uiState.modelFilterType}
            modelFilterFunction={uiState.modelFilterFunction}
            favoriteModels={uiState.favoriteModels}
            onModelSelect={(providerId, modelId) => {
              uiState.setSelectedProvider(providerId)
              uiState.setSelectedModel(modelId)
              modelState.resetParams()
            }}
            onFilterProviderChange={uiState.setModelFilterProvider}
            onFilterTypeChange={uiState.setModelFilterType}
            onFilterFunctionChange={uiState.setModelFilterFunction}
            onToggleFavorite={handleToggleFavorite}
          />
        )}
      />

      <ParameterPanel
        currentModel={currentModel}
        selectedModel={uiState.selectedModel}
        uploadedImages={uiState.uploadedImages}
        uploadedVideos={uiState.uploadedVideos}
        values={modelState.params}
        onChange={modelState.setParam}
      />
    </div>
  )
}
