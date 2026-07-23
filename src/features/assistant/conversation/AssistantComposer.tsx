import { useCallback } from 'react'
import { Send, Square } from 'lucide-react'

import { Dropdown, PromptEditor, UiButton } from '@/components/ui'
import type { AgentApprovalMode } from '@/core/assistant/runtimeContracts'
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
  approvalMode: AgentApprovalMode
  onApprovalModeChange: (mode: AgentApprovalMode) => void
}

const approvalModeOptions: Array<{ value: AgentApprovalMode; label: string }> = [
  { value: 'ask', label: '每次询问' },
  { value: 'assistant_decides', label: '助手判断' },
  { value: 'full_access', label: '充分访问' },
]

export function AssistantComposer({
  value,
  onChange,
  onSubmit,
  disabled,
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
        <div className="flex min-w-0 items-center gap-2">
          <Dropdown<AgentApprovalMode>
            value={approvalMode}
            options={approvalModeOptions}
            onSelect={onApprovalModeChange}
            minWidthStrategy="options"
            panelWidthStrategy="options"
            buttonClassName="!h-7 !rounded-md !px-2 text-[11px]"
            panelClassName="text-xs"
          />
          <span className="hidden truncate text-[10px] text-text-muted min-[440px]:inline">
            {approvalMode === 'ask'
              ? '风险操作逐次确认'
              : approvalMode === 'assistant_decides'
                ? '安全读取自动执行'
                : '允许操作自动执行，高风险仍确认'}
          </span>
        </div>
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
