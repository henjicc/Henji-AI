import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { useRef, useState } from 'react'
import { Check, Settings2 } from 'lucide-react'

import {
  PanelTrigger,
  UI_TEXT_PANEL_TITLE_CLASS,
  UiButton,
  UiFieldTrigger,
  UiOptionButton,
} from '@/components/ui'
import type { TextProcessingPromptTemplate } from '@henjicc/ai-sdk'
import { TEXT_PROCESSING_CUSTOM_TEMPLATE_ID } from '@/features/canvas/application/textProcessing'
import {
  NODE_CONTROL_MODEL_CHIP_CLASS,
  NODE_ROW_CLASS,
  NODE_ROW_CONTROL_SLOT_CLASS,
  NODE_ROW_LABEL_CLASS,
} from '@/features/canvas/ui/nodeControlStyles'
import { TextProcessingPromptTemplateManager } from './TextProcessingPromptTemplateManager'

interface TextProcessingPromptTemplateSelectorProps {
  label: string
  customLabel: string
  editLabel: string
  selectedTemplateId: string
  templates: TextProcessingPromptTemplate[]
  onSelect: (templateId: string) => void
  onSaveTemplates: (templates: TextProcessingPromptTemplate[]) => Promise<boolean>
}

export function TextProcessingPromptTemplateSelector({
  label,
  customLabel,
  editLabel,
  selectedTemplateId,
  templates,
  onSelect,
  onSaveTemplates,
}: TextProcessingPromptTemplateSelectorProps): JSX.Element {
  const [managerOpen, setManagerOpen] = useState(false)
  const closePanelRef = useRef<() => void>(() => undefined)
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId)
  const display = selectedTemplate?.name ?? customLabel

  const select = (templateId: string): void => {
    onSelect(templateId)
    closePanelRef.current()
  }

  const openManager = (): void => {
    closePanelRef.current()
    setManagerOpen(true)
  }

  return (
    <>
      <div className={NODE_ROW_CLASS}>
        <span className={NODE_ROW_LABEL_CLASS}>{label}</span>
        <div className={NODE_ROW_CONTROL_SLOT_CLASS}>
          <PanelTrigger
            display={display}
            panelSize="compact"
            panelPadding="none"
            alignment="aboveCenter"
            gap={8}
            closeOnPanelClick={false}
            className="min-w-0"
            renderPanel={() => (
              <div className="flex max-h-[min(460px,calc(100vh-96px))] flex-col p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className={UI_TEXT_PANEL_TITLE_CLASS}>{label}</div>
                  <UiButton type="button" onClick={openManager}>
                    <Settings2 className={`mr-1.5`} />
                    {editLabel}
                  </UiButton>
                </div>
                <div className="min-h-0 space-y-1 overflow-y-auto">
                  <UiOptionButton
                    type="button"
                    active={selectedTemplateId === TEXT_PROCESSING_CUSTOM_TEMPLATE_ID}
                    variant="menu"
                    onClick={() => select(TEXT_PROCESSING_CUSTOM_TEMPLATE_ID)}
                    className="w-full justify-between gap-2"
                  >
                    <span className="truncate">{customLabel}</span>
                    {selectedTemplateId === TEXT_PROCESSING_CUSTOM_TEMPLATE_ID
                      ? <Check className={`${UI_ICON_SIZE_CLASS.md} shrink-0`} />
                      : null}
                  </UiOptionButton>
                  {templates.map((template) => (
                    <UiOptionButton
                      key={template.id}
                      type="button"
                      active={template.id === selectedTemplateId}
                      variant="menu"
                      onClick={() => select(template.id)}
                      className="w-full justify-between gap-2"
                    >
                      <span className="truncate">{template.name}</span>
                      {template.id === selectedTemplateId
                        ? <Check className={`${UI_ICON_SIZE_CLASS.md} shrink-0`} />
                        : null}
                    </UiOptionButton>
                  ))}
                </div>
              </div>
            )}
          >
            {({ open, togglePanel, closePanel }) => {
              closePanelRef.current = closePanel
              return (
                <UiFieldTrigger
                  appearance="quiet"
                  open={open}
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation()
                    togglePanel()
                  }}
                  data-panel-trigger-button
                  aria-label={label}
                  aria-expanded={open}
                  className={NODE_CONTROL_MODEL_CHIP_CLASS}
                >
                  {display}
                </UiFieldTrigger>
              )
            }}
          </PanelTrigger>
        </div>
      </div>

      <TextProcessingPromptTemplateManager
        isOpen={managerOpen}
        templates={templates}
        onClose={() => setManagerOpen(false)}
        onSave={onSaveTemplates}
      />
    </>
  )
}
