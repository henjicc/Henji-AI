import type { MouseEvent, Ref } from 'react'
import { useTranslation } from 'react-i18next'

import PanelTrigger from '@/components/ui/PanelTrigger'
import { UiFieldLayoutContext, UiFieldTrigger } from '@/components/ui'
import { getAvailableProviders, getModelInfo } from '@/utils/modelHelpers'
import type { ModelState } from '../state/useModelState'
import type { UIState } from '../state/useUIState'
import ModelSelectorPanel from './ModelSelectorPanel'
import ParameterPanel, { type ParameterPanelController } from './ParameterPanel'

interface GeneratorConfigurationBarProps {
  uiState: UIState
  modelState: ModelState
  /** 生成前定位必填参数（打开“更多参数”并聚焦） */
  parameterPanelRef?: Ref<ParameterPanelController>
  /** `bar`：底部一行参数条；`side`：左侧输入面板，只渲染摊开的参数，模型另用 `GeneratorModelPicker` 放在面板顶端。 */
  arrangement?: 'bar' | 'side'
}

export function GeneratorModelPicker({ uiState, arrangement = 'bar' }: { uiState: UIState; arrangement?: 'bar' | 'side' }): JSX.Element {
  const { t } = useTranslation('models')
  const providers = getAvailableProviders()
  const currentProvider = providers.find((provider) => provider.id === uiState.selectedProvider)
  const currentModel = getModelInfo(uiState.selectedModel)
  const modelName = currentModel?.name || t('selectModel')
  const side = arrangement === 'side'

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
    <div data-onboarding-target="model" className={side ? 'w-full min-w-0' : 'min-w-0'}>
      {/* 视觉上模型名自明，不显示“模型”标签；保留给读屏与按名称定位 */}
      <label className="sr-only">{t('title')}</label>
      <PanelTrigger
        className={side ? 'w-full min-w-0' : 'min-w-0'}
        panelSize="special"
        // 底部时在模型按钮上方居中弹出（放不下时向窗口内平移）；左侧时左缘对齐按钮向下展开，与竖排面板同一条左缘
        alignment={side ? 'bottomLeft' : 'aboveCenter'}
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
            appearance={side ? 'field' : 'quiet'}
            size={side ? 'lg' : 'md'}
            open={open}
            onClick={togglePanel}
            data-panel-trigger-button
            aria-expanded={open}
            aria-label={`${t('title')}：${currentProvider?.name ? `${currentProvider.name} ` : ''}${modelName}`}
            className={side ? 'w-full cursor-pointer' : 'max-w-80 cursor-pointer'}
          >
            <span className="font-medium text-text1">{modelName}</span>
            {currentProvider?.name ? <span className="ml-1.5 text-text3">{currentProvider.name}</span> : null}
          </UiFieldTrigger>
        )}
      </PanelTrigger>
    </div>
  )
}

/**
 * 生成输入区的模型与参数（设计稿 Generation）。底部时是一行静默触发器，参数名在控件左侧，
 * 放不下的参数收进行末“更多参数”（任务 4.3），模型选择永不收起；左侧时参数一行一个全部摊开。
 * 参数本身都由 `ParameterPanel` 按模型 schema 渲染。
 */
export function GeneratorConfigurationBar({
  uiState,
  modelState,
  parameterPanelRef,
  arrangement = 'bar',
}: GeneratorConfigurationBarProps): JSX.Element {
  const currentModel = getModelInfo(uiState.selectedModel)
  return (
    <UiFieldLayoutContext.Provider value={arrangement === 'side' ? 'form' : 'toolbar'}>
      <ParameterPanel
        currentModel={currentModel}
        selectedModel={uiState.selectedModel}
        uploadedImages={uiState.uploadedImages}
        uploadedVideos={uiState.uploadedVideos}
        values={modelState.params}
        onChange={modelState.setParam}
        onChanges={modelState.setParams}
        toolbarLeading={arrangement === 'side' ? undefined : <GeneratorModelPicker uiState={uiState} />}
        controllerRef={parameterPanelRef}
        arrangement={arrangement}
      />
    </UiFieldLayoutContext.Provider>
  )
}
