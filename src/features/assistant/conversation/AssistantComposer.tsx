import { useCallback } from 'react'
import { Send, Square } from 'lucide-react'

import { Dropdown, PromptEditor, UI_TEXT_BODY_CLASS, UiButton } from '@/components/ui'
import type { AgentApprovalMode } from '@/core/assistant/runtimeContracts'
import type { AgentQueuedMessagePayload } from '@/core/assistant/session'
import {
  toModelPromptText,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'

interface AssistantComposerProps {
  value: PromptDocumentV1
  onChange: (value: PromptDocumentV1) => void
  onSubmit: (goal: string) => void
  disabled: boolean
  busy: boolean
  waitingForAnswer: boolean
  messageMode: AgentQueuedMessagePayload['mode']
  onMessageModeChange: (mode: AgentQueuedMessagePayload['mode']) => void
  submitting: boolean
  approvalMode: AgentApprovalMode
  onApprovalModeChange: (mode: AgentApprovalMode) => void
}

const approvalModeOptions: Array<{ value: AgentApprovalMode; label: string }> = [
  { value: 'ask', label: '严格确认' },
  { value: 'assistant_decides', label: '助手判断' },
  { value: 'full_access', label: '充分访问' },
]

export function AssistantComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  busy,
  waitingForAnswer,
  messageMode,
  onMessageModeChange,
  submitting,
  approvalMode,
  onApprovalModeChange,
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
        layout="fill-scroll"
        value={value}
        onChange={onChange}
        ariaLabel="向智能助手描述任务"
        placeholder={waitingForAnswer
          ? '回答助手刚才的问题…'
          : busy ? '可补充当前任务，或安排任务结束后继续…' : '描述目标，或粘贴错误信息…'}
        disabled={submitting}
        maxCharacters={32 * 1024}
        submitShortcut="enter"
        onSubmit={submit}
        editorShellClassName="!rounded-xl !border-border-dark bg-surface-dark"
        editorClassName={`max-h-32 min-h-[72px] px-3 py-2.5 ${UI_TEXT_BODY_CLASS}`}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {busy ? (
            <Dropdown<AgentQueuedMessagePayload['mode']>
              value={messageMode}
              options={[
                ...(waitingForAnswer
                  ? [{ value: 'clarification' as const, label: '回答当前问题' }]
                  : [
                      { value: 'current_task' as const, label: '补充当前任务' },
                      { value: 'after_task' as const, label: '任务结束后继续' },
                    ]),
              ]}
              onSelect={onMessageModeChange}
              minWidthStrategy="options"
              panelWidthStrategy="options"
              buttonClassName="!h-7 !rounded-lg !px-2 text-2xs"
            />
          ) : null}
          <Dropdown<AgentApprovalMode>
            value={approvalMode}
            options={approvalModeOptions}
            onSelect={onApprovalModeChange}
            minWidthStrategy="options"
            panelWidthStrategy="options"
            buttonClassName="!h-7 !rounded-lg !px-2 text-2xs"
          />
        </div>
        <UiButton
          type="button"
          size="sm"
          variant="primary"
          disabled={submitting || !toModelPromptText(value).trim()}
          onClick={submit}
          className="gap-1.5"
        >
          {submitting ? <Square className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          {submitting ? '提交中' : '发送'}
        </UiButton>
      </div>
    </div>
  )
}
