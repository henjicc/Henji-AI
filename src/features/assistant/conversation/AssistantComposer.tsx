import { useCallback } from 'react'
import { Send, Square } from 'lucide-react'

import { Dropdown, PromptEditor, UI_TEXT_BODY_CLASS, UI_TEXT_META_CLASS, UiButton } from '@/components/ui'
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
  { value: 'ask', label: '严格确认' },
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
        layout="fill-scroll"
        value={value}
        onChange={onChange}
        ariaLabel="向智能助手描述任务"
        placeholder={disabled ? '当前任务结束后可继续提问' : '描述目标，或粘贴错误信息…'}
        disabled={disabled || submitting}
        maxCharacters={32 * 1024}
        submitShortcut="enter"
        onSubmit={submit}
        editorShellClassName="!rounded-xl !border-border-dark bg-surface-dark"
        editorClassName={`max-h-32 min-h-[72px] px-3 py-2.5 ${UI_TEXT_BODY_CLASS}`}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Dropdown<AgentApprovalMode>
            value={approvalMode}
            options={approvalModeOptions}
            onSelect={onApprovalModeChange}
            minWidthStrategy="options"
            panelWidthStrategy="options"
            buttonClassName="!h-7 !rounded-md !px-2 text-2xs"
            panelClassName="text-xs"
          />
          <span className={`hidden truncate min-[440px]:inline ${UI_TEXT_META_CLASS}`}>
            {approvalMode === 'ask'
              ? '安全读取与轻量操作自动，其余需确认'
              : approvalMode === 'assistant_decides'
                ? 'R0 轻量与安全读取自动，R1+ 写入需确认'
                : 'R0–R2 自动，R3/C2 确认，C3/R4 禁止'}
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
