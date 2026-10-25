import { useMemo, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  PanelTrigger,
  UiButton,
} from '@/components/ui'
import type { TextProcessingModelChoice } from '@/features/canvas/application/textProcessing'
import { ModelPickerList } from '@/features/canvas/params/ModelPickerList'
import {
  type ModelPickerOption,
  useModelPickerOptions,
} from '@/features/canvas/params/useModelPickerList'
import {
  NODE_CONTROL_MODEL_CHIP_CLASS,
  NODE_ROW_CLASS,
  NODE_ROW_CONTROL_SLOT_CLASS,
  NODE_ROW_HOVER_CLASS,
  NODE_ROW_LABEL_CLASS,
} from '@/features/canvas/ui/nodeControlStyles'

interface TextProcessingModelRowProps {
  choices: TextProcessingModelChoice[]
  selectedKey: string
  onSelect: (key: string) => void
}


export function TextProcessingModelRow({
  choices,
  selectedKey,
  onSelect,
}: TextProcessingModelRowProps): JSX.Element {
  const { t } = useTranslation()
  const closePanelRef = useRef<() => void>(() => undefined)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const modelOptions = useMemo<ModelPickerOption[]>(() => choices.map((choice) => ({
    key: choice.key,
    displayName: choice.model.displayName,
    providerId: choice.provider.providerId,
    providerName: choice.provider.displayName,
    searchTerms: [
      choice.model.modelId,
      choice.model.adapter,
      choice.model.apiProtocol ?? '',
    ],
  })), [choices])
  const {
    modelSearchQuery,
    setModelSearchQuery,
    providerFilter,
    setProviderFilter,
    providerModels,
    providerOptions,
    filteredModels,
    selectedModelOption,
  } = useModelPickerOptions({ options: modelOptions, selectedKey })

  const selectModel = (key: string): void => {
    onSelect(key)
    closePanelRef.current()
  }

  return (
    <div className={`${NODE_ROW_CLASS} ${NODE_ROW_HOVER_CLASS}`}>
      <span className={NODE_ROW_LABEL_CLASS}>{t('node.modelRow.label')}</span>
      <div className={NODE_ROW_CONTROL_SLOT_CLASS}>
        <PanelTrigger
          display={selectedModelOption?.displayName ?? t('node.textProcessing.noModel')}
          disabled={choices.length === 0}
          panelSize="special"
          alignment="bottomLeft"
          closeOnPanelClick={false}
          className="min-w-0"
          renderPanel={() => (
              <ModelPickerList
                variant="floating"
                modelSearchQuery={modelSearchQuery}
                onSearchChange={setModelSearchQuery}
                searchInputRef={searchInputRef}
                providerFilter={providerFilter}
                onProviderFilterChange={setProviderFilter}
                providerOptions={providerOptions}
                modelsForWidthMeasurement={providerModels}
                filteredModels={filteredModels}
                selectedModel={selectedModelOption}
                revealSelectedModel
                onModelChange={selectModel}
              />
          )}
        >
          {({ open, togglePanel, closePanel }) => {
            closePanelRef.current = closePanel
            return (
              <UiButton
                type="button"
                variant="secondary"
                size="sm"
                disabled={choices.length === 0}
                onClick={(event) => {
                  event.stopPropagation()
                  if (!open) {
                    setModelSearchQuery('')
                    setProviderFilter(selectedModelOption?.providerId ?? 'all')
                  }
                  togglePanel()
                }}
                data-panel-trigger-button
                aria-label={t('node.modelRow.label')}
                aria-expanded={open}
                className={`nodrag nowheel font-normal ${NODE_CONTROL_MODEL_CHIP_CLASS}`}
              >
                <span className="min-w-0 flex-1 truncate text-left">
                  {selectedModelOption?.displayName ?? t('node.textProcessing.noModel')}
                </span>
                {selectedModelOption ? (
                  <span className="shrink-0 text-xs leading-none text-text2">
                    {selectedModelOption.providerName}
                  </span>
                ) : null}
                <ChevronDown className={`shrink-0 transition-transform duration-180 ${open ? 'rotate-180' : ''}`} />
              </UiButton>
            )
          }}
        </PanelTrigger>
      </div>
    </div>
  )
}
