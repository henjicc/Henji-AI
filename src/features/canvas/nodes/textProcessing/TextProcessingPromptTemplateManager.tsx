import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  PromptEditor,
  UI_TEXT_META_CLASS,
  UiButton,
  UiEmpty,
  UiInput,
  UiModal,
  UiOptionButton,
} from '@/components/ui'
import {
  createPlainTextPromptDocument,
  toLegacyPromptString,
} from '@/core/inputs/promptDocument'
import type { TextProcessingPromptTemplate } from '@henjicc/ai-sdk'

interface TextProcessingPromptTemplateManagerProps {
  isOpen: boolean
  templates: TextProcessingPromptTemplate[]
  onClose: () => void
  onSave: (templates: TextProcessingPromptTemplate[]) => Promise<boolean>
}

function createTemplate(name: string, systemPrompt: string): TextProcessingPromptTemplate {
  const now = new Date().toISOString()
  return {
    id: `text-processing-template-${crypto.randomUUID()}`,
    name,
    systemPrompt,
    createdAt: now,
    updatedAt: now,
  }
}

export function TextProcessingPromptTemplateManager({
  isOpen,
  templates,
  onClose,
  onSave,
}: TextProcessingPromptTemplateManagerProps): JSX.Element {
  const { t } = useTranslation()
  const [drafts, setDrafts] = useState<TextProcessingPromptTemplate[]>(templates)
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setDrafts(templates.map((template) => ({ ...template })))
    setSelectedId((current) => (
      templates.some((template) => template.id === current)
        ? current
        : templates[0]?.id ?? ''
    ))
  }, [isOpen, templates])

  const selectedTemplate = useMemo(
    () => drafts.find((template) => template.id === selectedId) ?? null,
    [drafts, selectedId],
  )
  const canSave = drafts.every((template) => template.name.trim().length > 0)

  const patchSelected = (patch: Partial<TextProcessingPromptTemplate>): void => {
    if (!selectedTemplate) return
    setDrafts((current) => current.map((template) => (
      template.id === selectedTemplate.id
        ? { ...template, ...patch, updatedAt: new Date().toISOString() }
        : template
    )))
  }

  const addTemplate = (): void => {
    const template = createTemplate(t('node.templateManager.defaultName'), t('node.templateManager.defaultSystemPrompt'))
    setDrafts((current) => [...current, template])
    setSelectedId(template.id)
  }

  const deleteSelected = (): void => {
    if (!selectedTemplate) return
    const nextDrafts = drafts.filter((template) => template.id !== selectedTemplate.id)
    setDrafts(nextDrafts)
    setSelectedId(nextDrafts[0]?.id ?? '')
  }

  const save = async (): Promise<void> => {
    if (!canSave || saving) return
    setSaving(true)
    try {
      const saved = await onSave(drafts.map((template) => ({
        ...template,
        name: template.name.trim(),
      })))
      if (saved) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <UiModal
      isOpen={isOpen}
      onClose={onClose}
      title={t('node.templateManager.title')}
      size="editor"
      contentClassName="overflow-hidden p-4"
      footer={(
        <>
          <UiButton type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </UiButton>
          <UiButton type="button" variant="primary" onClick={() => void save()} disabled={!canSave || saving}>
            {saving ? t('node.templateManager.saving') : t('node.templateManager.save')}
          </UiButton>
        </>
      )}
    >
      <div className="grid min-h-0 flex-1 gap-4 sm:grid-cols-[240px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {drafts.map((template) => (
              <UiOptionButton
                key={template.id}
                type="button"
                active={template.id === selectedId}
                variant="menu"
                onClick={() => setSelectedId(template.id)}
                className="w-full justify-start"
              >
                <span className="truncate text-sm">{template.name}</span>
              </UiOptionButton>
            ))}
          </div>
          <UiButton type="button" variant="secondary" size="lg" onClick={addTemplate}>
            <Plus className="mr-2 h-4 w-4" />
            {t('node.templateManager.add')}
          </UiButton>
        </div>

        {selectedTemplate ? (
          <div className="flex min-h-0 flex-col gap-3">
            <UiInput
              value={selectedTemplate.name}
              onChange={(event) => patchSelected({ name: event.target.value })}
              placeholder={t('node.templateManager.name')}
              aria-label={t('node.templateManager.name')}
            />
            <PromptEditor
              value={createPlainTextPromptDocument(selectedTemplate.systemPrompt)}
              onChange={(document) => patchSelected({ systemPrompt: toLegacyPromptString(document) })}
              preset="plain"
              layout="fill-scroll"
              ariaLabel={t('node.templateManager.systemPrompt')}
              placeholder={t('node.templateManager.systemPromptPlaceholder')}
              className="min-h-0 flex-1"
              editorClassName="min-h-0"
            />
            <div className="flex items-center justify-between gap-3">
              <span className={UI_TEXT_META_CLASS}>{t('node.templateManager.plainTextOnly')}</span>
              <UiButton type="button" variant="danger" onClick={deleteSelected}>
                <Trash2 className="mr-2 h-4 w-4" />
                {t('node.templateManager.delete')}
              </UiButton>
            </div>
          </div>
        ) : (
          <UiEmpty
            size="sm"
            title={t('node.templateManager.emptyTitle')}
            description={t('node.templateManager.emptyDescription')}
          />
        )}
      </div>
    </UiModal>
  )
}
