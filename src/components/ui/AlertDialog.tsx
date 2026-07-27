import { useEffect, useId, useRef, useState } from 'react'
import { UiButton, UiPanel } from './primitives'
import { useI18n } from '@/hooks/useI18n'
import { UI_DIALOG_TRANSITION_MS, uiTransition } from './motion'
import { useDialogFocusTrap } from './useDialogFocusTrap'
import { UI_TEXT_BODY_CLASS, UI_TEXT_TITLE_CLASS } from './styleTokens'
import { Info, TriangleAlert, X } from 'lucide-react'

/** 弹窗底部的一个动作按钮 */
export interface AlertDialogAction {
  label: string
  onClick: () => void
  variant?: 'primary' | 'muted'
}

interface AlertDialogProps {
  isOpen: boolean
  title: string
  message: string
  onClose: () => void
  type?: 'info' | 'warning' | 'error'
  scope?: 'viewport' | 'container'
  /**
   * 关闭按钮左侧的额外动作（如「去设置」「复制错误详情」）。
   * 省略时只渲染一个关闭按钮，行为与升级前一致。
   */
  actions?: AlertDialogAction[]
}

/**
 * 统一的提示/报错弹窗组件。
 * 全局报错请走 GlobalAlertDialog + alertDialogStore，不要在业务组件里自建开关 state。
 */
export default function AlertDialog({
  isOpen,
  title,
  message,
  onClose,
  type = 'warning',
  scope = 'viewport',
  actions,
}: AlertDialogProps): JSX.Element | null {
  const { t } = useI18n('common')
  const [opacity, setOpacity] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const messageId = useId()

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setOpacity(1))
    }
  }, [isOpen])

  const handleClose = () => {
    setOpacity(0)
    setTimeout(() => onClose(), UI_DIALOG_TRANSITION_MS)
  }
  useDialogFocusTrap({
    active: isOpen,
    dialogRef,
    onClose: handleClose,
  })

  if (!isOpen) return null

  // 根据类型选择图标和颜色
  const getIconAndColor = () => {
    switch (type) {
      case 'error':
        return {
          icon: (
            <X className="h-5 w-5" />
          ),
          color: 'text-red-500'
        }
      case 'info':
        return {
          icon: (
            <Info className="h-5 w-5" />
          ),
          color: 'text-blue-500'
        }
      case 'warning':
      default:
        return {
          icon: (
            <TriangleAlert className="h-5 w-5" />
          ),
          color: 'text-yellow-500'
        }
    }
  }

  const { icon, color } = getIconAndColor()
  const rootClassName = scope === 'container'
    ? 'absolute inset-0 z-modal flex items-center justify-center'
    : 'fixed inset-0 z-modal flex items-center justify-center'

  return (
    <div
      ref={dialogRef}
      data-dialog="true"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      tabIndex={-1}
      className={`${rootClassName} outline-none`}
    >
      {/* 背景遮罩 */}
      <div
        className="ui-glass-scrim absolute inset-0"
        style={{ opacity, transition: uiTransition(['opacity'], UI_DIALOG_TRANSITION_MS) }}
        onClick={handleClose}
      />

      {/* 弹窗内容 */}
      <UiPanel
        className="relative p-4 w-[400px] shadow-panel"
        style={{
          opacity,
          transform: `scale(${0.97 + 0.03 * opacity})`,
          transition: uiTransition(['opacity', 'transform'], UI_DIALOG_TRANSITION_MS)
        }}
      >
        {/* 标题 */}
        <div className="flex items-center gap-2">
          <div className={color}>{icon}</div>
          <div id={titleId} className={UI_TEXT_TITLE_CLASS}>{title}</div>
        </div>

        {/* 消息内容 */}
        <div id={messageId} className={`ui-scrollbar mt-2 max-h-[280px] overflow-y-auto whitespace-pre-line break-words ${UI_TEXT_BODY_CLASS}`}>
          {message}
        </div>

        {/* 动作按钮：额外动作在左，关闭在右 */}
        <div className="mt-4 flex justify-end gap-2">
          {actions?.map((action) => (
            <UiButton
              key={action.label}
              type="button"
              size="sm"
              variant={action.variant ?? 'muted'}
              onClick={action.onClick}
              className="h-9 px-4"
            >
              {action.label}
            </UiButton>
          ))}
          <UiButton
            type="button"
            size="sm"
            variant="muted"
            onClick={handleClose}
            className="h-9 px-4"
          >
            {t('close')}
          </UiButton>
        </div>
      </UiPanel>
    </div>
  )
}
