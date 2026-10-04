import React from 'react'
import { UI_TEXT_BODY_CLASS, UI_TEXT_TITLE_CLASS, UiButton, UiModal } from '@/components/ui'

type DialogActionVariant = 'primary' | 'secondary' | 'danger'

export interface DialogAction {
  label: string
  onClick: () => void
  variant?: DialogActionVariant
}

export interface SettingsDialogProps {
  open: boolean
  title: string
  description?: string
  actions: DialogAction[]
  onClose?: () => void
}

/**
 * danger 是确认弹窗里的破坏性确认，用 dangerSolid；其余按主次映射。
 * 同一个弹窗已有主按钮时（如数据目录冲突的“合并 / 覆盖 / 取消”），破坏性选项降为 danger 档
 * （静息静默、悬停显红）：一个表面只留一个实底按钮。
 */
const resolveActionVariant = (
  variant: DialogActionVariant | undefined,
  hasPrimary: boolean,
): 'primary' | 'secondary' | 'danger' | 'dangerSolid' => {
  if (variant === 'danger') return hasPrimary ? 'danger' : 'dangerSolid'
  return variant === 'primary' ? 'primary' : 'secondary'
}

/**
 * 设置内的确认弹窗（6 处调用点共用）。
 * 外壳统一走 UiModal：遮罩、portal、过渡、data-dialog 都由 primitive 负责，
 * 这里只描述标题/说明/操作按钮。
 */
const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, title, description, actions, onClose }) => {
  const hasPrimary = actions.some(action => action.variant === 'primary')
  return (
  <UiModal
    isOpen={open}
    title={title}
    onClose={() => onClose?.()}
    hideHeader
    size="compact"
    contentClassName="p-4"
    footer={actions.map(action => (
      <UiButton
        key={action.label}
        size="lg"
        variant={resolveActionVariant(action.variant, hasPrimary)}
        onClick={action.onClick}
      >
        {action.label}
      </UiButton>
    ))}
  >
    <div className={UI_TEXT_TITLE_CLASS}>{title}</div>
    {description ? <div className={`mt-2 ${UI_TEXT_BODY_CLASS}`}>{description}</div> : null}
  </UiModal>
  )
}

export default SettingsDialog
