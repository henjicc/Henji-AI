import { useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  PanelTrigger,
  UiButton,
  UiChipButton,
  UiOptionButton,
} from '@/components/ui'
import type { TextProcessingModelChoice } from '@/features/canvas/application/textProcessing'
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

interface ProviderOption {
  id: string
  label: string
  count: number
}

const ALL_PROVIDERS = 'all'

export function TextProcessingModelRow({
  choices,
  selectedKey,
  onSelect,
}: TextProcessingModelRowProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const closePanelRef = useRef<() => void>(() => undefined)
  const selectedChoice = choices.find((choice) => choice.key === selectedKey) ?? null
  const [providerFilter, setProviderFilter] = useState(
    selectedChoice?.provider.providerId ?? ALL_PROVIDERS,
  )
  const providerOptions = useMemo<ProviderOption[]>(() => {
    const providers = new Map<string, ProviderOption>()
    for (const choice of choices) {
      const providerId = choice.provider.providerId
      const existing = providers.get(providerId)
      if (existing) {
        existing.count += 1
        continue
      }
      providers.set(providerId, {
        id: providerId,
        label: choice.provider.displayName,
        count: 1,
      })
    }
    return Array.from(providers.values())
      .sort((a, b) => a.label.localeCompare(b.label, i18n.language))
  }, [choices, i18n.language])
  const filteredChoices = useMemo(
    () => providerFilter === ALL_PROVIDERS
      ? choices
      : choices.filter((choice) => choice.provider.providerId === providerFilter),
    [choices, providerFilter],
  )

  const selectModel = (key: string): void => {
    onSelect(key)
    closePanelRef.current()
  }

  return (
    <div className={`${NODE_ROW_CLASS} ${NODE_ROW_HOVER_CLASS}`}>
      <span className={NODE_ROW_LABEL_CLASS}>{t('node.modelRow.label')}</span>
      <div className={NODE_ROW_CONTROL_SLOT_CLASS}>
        <PanelTrigger
          display={selectedChoice?.label ?? t('node.textProcessing.noModel')}
          disabled={choices.length === 0}
          panelWidth={360}
          alignment="aboveCenter"
          gap={8}
          closeOnPanelClick={false}
          className="min-w-0"
          renderPanel={() => (
            <div className="flex max-h-[min(460px,calc(100vh-96px))] min-h-0 flex-col p-2">
              <div className="ui-scrollbar flex max-w-full shrink-0 gap-1 overflow-x-auto border-b border-border-dark/70 pb-2">
                <UiChipButton
                  type="button"
                  active={providerFilter === ALL_PROVIDERS}
                  onClick={(event) => {
                    event.stopPropagation()
                    setProviderFilter(ALL_PROVIDERS)
                  }}
                  className="!h-6 shrink-0 !rounded-md !px-2 !text-2xs"
                >
                  {t('modelParams.allProviders', { defaultValue: '全部' })}
                </UiChipButton>
                {providerOptions.map((provider) => (
                  <UiChipButton
                    key={provider.id}
                    type="button"
                    active={providerFilter === provider.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      setProviderFilter(provider.id)
                    }}
                    className="!h-6 shrink-0 !rounded-md !px-2 !text-2xs"
                  >
                    <span>{provider.label}</span>
                    <span className="text-3xs text-text-muted/80">{provider.count}</span>
                  </UiChipButton>
                ))}
              </div>

              <div className="ui-scrollbar mt-2 min-h-0 space-y-1 overflow-y-auto pr-1">
                {filteredChoices.map((choice) => {
                  const active = choice.key === selectedKey
                  return (
                    <UiOptionButton
                      key={choice.key}
                      type="button"
                      active={active}
                      variant="menu"
                      onClick={() => selectModel(choice.key)}
                      className="w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5"
                    >
                      <div className="min-w-0 flex-1 text-left">
                        <div className={`truncate text-13 ${active ? 'text-white' : 'text-text-dark'}`}>
                          {choice.model.displayName}
                        </div>
                        <div className={`truncate text-2xs ${active ? 'text-white/70' : 'text-text-muted'}`}>
                          {choice.provider.displayName}
                        </div>
                      </div>
                      {active ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white" /> : null}
                    </UiOptionButton>
                  )
                })}
              </div>
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
                    setProviderFilter(selectedChoice?.provider.providerId ?? ALL_PROVIDERS)
                  }
                  togglePanel()
                }}
                data-panel-trigger-button
                aria-label={t('node.modelRow.label')}
                aria-expanded={open}
                className={`nodrag nowheel ${NODE_CONTROL_CHIP_CLASS} ${NODE_CONTROL_MODEL_CHIP_CLASS}`}
              >
                <span className="min-w-0 flex-1 truncate text-left">
                  {selectedChoice?.model.displayName ?? t('node.textProcessing.noModel')}
                </span>
                {selectedChoice ? (
                  <span className="shrink-0 text-xs leading-none text-text-muted/80">
                    {selectedChoice.provider.displayName}
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
