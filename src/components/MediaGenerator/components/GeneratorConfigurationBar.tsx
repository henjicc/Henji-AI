import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import PanelTrigger from '@/components/ui/PanelTrigger'
import { UiFieldLayoutContext, UiFieldTrigger } from '@/components/ui'
import { getAvailableProviders, getModelInfo } from '@/utils/modelHelpers'
import type { ModelState } from '../state/useModelState'
import type { UIState } from '../state/useUIState'
import ModelSelectorPanel from './ModelSelectorPanel'
import ParameterPanel from './ParameterPanel'

interface GeneratorConfigurationBarProps {
  uiState: UIState
  modelState: ModelState
}

/**
 * 生成输入区底栏的模型与参数条（设计稿 Generation）：一行静默触发器，参数名在控件左侧，
 * 不再是“标签在上 + 字段框”的表单。参数本身仍由 `ParameterPanel` 按模型 schema 渲染。
 */
export function GeneratorConfigurationBar({
  uiState,
  modelState,
}: GeneratorConfigurationBarProps): JSX.Element {
  const { t } = useTranslation('models')
  const providers = getAvailableProviders()
  const currentProvider = providers.find((provider) => provider.id === uiState.selectedProvider)
  const currentModel = getModelInfo(uiState.selectedModel)
  const modelName = currentModel?.name || t('selectModel')

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
    <UiFieldLayoutContext.Provider value="toolbar">
      {/* 不另起换行容器：模型与各参数直接参与底栏左组的同一行换行，避免整组掉到“+”下一行 */}
      <div className="contents">
        <div data-onboarding-target="model" className="min-w-0">
          {/* 视觉上模型名自明，不显示“模型”标签；保留给读屏与按名称定位 */}
          <label className="sr-only">{t('title')}</label>
          <PanelTrigger
            className="min-w-0"
            panelWidth={1100}
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
                }}
                onFilterProviderChange={uiState.setModelFilterProvider}
                onFilterTypeChange={uiState.setModelFilterType}
                onFilterFunctionChange={uiState.setModelFilterFunction}
                onToggleFavorite={handleToggleFavorite}
              />
            )}
          >
            {({ open, togglePanel }) => (
              <UiFieldTrigger
                appearance="quiet"
                open={open}
                onClick={togglePanel}
                data-panel-trigger-button
                aria-expanded={open}
                aria-label={`${t('title')}：${currentProvider?.name ? `${currentProvider.name} ` : ''}${modelName}`}
                className="max-w-[20rem] cursor-pointer"
              >
                <span className="text-text1">{modelName}</span>
                {currentProvider?.name ? <span className="ml-1.5 text-text3">{currentProvider.name}</span> : null}
              </UiFieldTrigger>
            )}
          </PanelTrigger>
        </div>

        <ParameterPanel
          currentModel={currentModel}
          selectedModel={uiState.selectedModel}
          uploadedImages={uiState.uploadedImages}
          uploadedVideos={uiState.uploadedVideos}
          values={modelState.params}
          onChange={modelState.setParam}
          onChanges={modelState.setParams}
        />
      </div>
    </UiFieldLayoutContext.Provider>
  )
}
