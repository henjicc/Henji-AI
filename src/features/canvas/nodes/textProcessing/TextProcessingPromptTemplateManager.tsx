import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

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
import type { TextProcessingPromptTemplate } from '@/core/llm/types'

interface TextProcessingPromptTemplateManagerProps {
  isOpen: boolean
  templates: TextProcessingPromptTemplate[]
  onClose: () => void
  onSave: (templates: TextProcessingPromptTemplate[]) => Promise<boolean>
}

function createTemplate(): TextProcessingPromptTemplate {
  const now = new Date().toISOString()
  return {
    id: `text-processing-template-${crypto.randomUUID()}`,
    name: '新的提示词模板',
    systemPrompt: '你是提示词优化助手。只输出优化后的提示词。',
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
    const template = createTemplate()
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
      title="管理提示词模板"
      widthClassName="w-[min(760px,92vw)]"
      contentClassName="max-h-[min(620px,74vh)] overflow-hidden p-4"
      footer={(
        <>
          <UiButton type="button" variant="ghost" onClick={onClose} disabled={saving}>
            取消
          </UiButton>
          <UiButton type="button" variant="primary" onClick={() => void save()} disabled={!canSave || saving}>
            {saving ? '保存中…' : '保存'}
          </UiButton>
        </>
      )}
    >
      <div className="grid min-h-[360px] gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
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
          <UiButton type="button" variant="muted" size="field-sm" onClick={addTemplate}>
            <Plus className="mr-2 h-4 w-4" />
            新增模板
          </UiButton>
        </div>

        {selectedTemplate ? (
          <div className="flex min-h-0 flex-col gap-3">
            <UiInput
              value={selectedTemplate.name}
              onChange={(event) => patchSelected({ name: event.target.value })}
              placeholder="模板名称"
              aria-label="模板名称"
            />
            <PromptEditor
              value={createPlainTextPromptDocument(selectedTemplate.systemPrompt)}
              onChange={(document) => patchSelected({ systemPrompt: toLegacyPromptString(document) })}
              preset="plain"
              layout="fill-scroll"
              ariaLabel="系统提示词"
              placeholder="输入这个模板使用的系统提示词"
              className="min-h-0 flex-1"
              editorClassName="ui-scrollbar min-h-[240px] max-h-[420px]"
            />
            <div className="flex items-center justify-between gap-3">
              <span className={UI_TEXT_META_CLASS}>模板仅包含纯文本，不支持变量。</span>
              <UiButton type="button" variant="plain" size="sm" onClick={deleteSelected}>
                <Trash2 className="mr-2 h-4 w-4" />
                删除模板
              </UiButton>
            </div>
          </div>
        ) : (
          <UiEmpty
            size="sm"
            title="还没有提示词模板"
            description="点击左下角新增模板开始创建。"
          />
        )}
      </div>
    </UiModal>
  )
}
