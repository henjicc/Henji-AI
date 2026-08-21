import { useMemo, useRef, useState } from 'react'
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
  NODE_CONTROL_CHIP_CLASS,
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

const MODEL_PANEL_FALLBACK_CONTENT_WIDTH = 302
const MODEL_PANEL_HORIZONTAL_CHROME = 18

export function TextProcessingModelRow({
  choices,
  selectedKey,
  onSelect,
}: TextProcessingModelRowProps): JSX.Element {
  const { t } = useTranslation()
  const closePanelRef = useRef<() => void>(() => undefined)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [modelPanelContentWidth, setModelPanelContentWidth] = useState(0)
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
  const panelWidth = (
    modelPanelContentWidth || MODEL_PANEL_FALLBACK_CONTENT_WIDTH
  ) + MODEL_PANEL_HORIZONTAL_CHROME

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
          panelWidth={panelWidth}
          alignment="aboveCenter"
          gap={8}
          closeOnPanelClick={false}
          className="min-w-0"
          renderPanel={() => (
            <div className="p-2">
              <ModelPickerList
                variant="floating"
                modelSearchQuery={modelSearchQuery}
                onSearchChange={setModelSearchQuery}
                searchInputRef={searchInputRef}
                providerFilter={providerFilter}
                onProviderFilterChange={setProviderFilter}
                providerOptions={providerOptions}
                modelsForWidthMeasurement={providerModels}
                onPreferredWidthChange={setModelPanelContentWidth}
                filteredModels={filteredModels}
                selectedModel={selectedModelOption}
                revealSelectedModel
                onModelChange={selectModel}
              />
            </div>
          )}
        >
          {({ open, togglePanel, closePanel }) => {
            closePanelRef.current = closePanel
            return (
              <UiButton
                type="button"
                variant="muted"
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
                className={`nodrag nowheel ${NODE_CONTROL_CHIP_CLASS} ${NODE_CONTROL_MODEL_CHIP_CLASS}`}
              >
                <span className="min-w-0 flex-1 truncate text-left">
                  {selectedModelOption?.displayName ?? t('node.textProcessing.noModel')}
                </span>
                {selectedModelOption ? (
                  <span className="shrink-0 text-xs leading-none text-text-muted/80">
                    {selectedModelOption.providerName}
                  </span>
                ) : null}
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
              </UiButton>
            )
          }}
        </PanelTrigger>
      </div>
    </div>
  )
}
