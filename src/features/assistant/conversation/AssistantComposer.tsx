import { useCallback } from 'react'
import { Send, Square } from 'lucide-react'

import { PromptEditor, UiButton } from '@/components/ui'
import {
  toModelPromptText,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'

interface AssistantComposerProps {
  value: PromptDocumentV1
  onChange: (value: PromptDocumentV1) => void
  onSubmit: (goal: string) => void
  disabled: boolean
  submitting: boolean
}

export function AssistantComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  submitting,
}: AssistantComposerProps): JSX.Element {
  const submit = useCallback((): void => {
    const goal = toModelPromptText(value).trim()
    if (!goal || disabled || submitting) return
    onSubmit(goal)
  }, [disabled, onSubmit, submitting, value])

  return (
    <div className="border-t border-border-dark bg-panel p-3">
      <PromptEditor
        mode="edit"
        preset="plain"
        value={value}
        onChange={onChange}
        ariaLabel="向智能助手描述任务"
        placeholder={disabled ? '当前任务结束后可继续提问' : '描述目标，或粘贴错误信息…'}
        disabled={disabled || submitting}
        maxCharacters={32 * 1024}
        submitShortcut="enter"
        onSubmit={submit}
        editorShellClassName="!rounded-xl !border-border-dark bg-surface-dark"
        editorClassName="max-h-32 min-h-[72px] overflow-y-auto px-3 py-2.5 text-sm"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-[11px] text-text-muted">Enter 发送 · Shift+Enter 换行</span>
        <UiButton
          type="button"
          size="sm"
          variant="primary"
          disabled={disabled || submitting || !toModelPromptText(value).trim()}
          onClick={submit}
          className="gap-1.5"
        >
          {submitting ? <Square className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          {submitting ? '启动中' : '发送'}
        </UiButton>
      </div>
    </div>
  )
}
