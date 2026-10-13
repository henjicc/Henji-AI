import { useEffect, useId, useRef, useState } from 'react'
import { UiButton, UiPanel } from './primitives'
import { useI18n } from '@/hooks/useI18n'
import { useDialogTransition } from './useDialogTransition'
import { UI_DIALOG_TRANSITION_MS, uiTransition } from './motion'
import { useDialogFocusTrap } from './useDialogFocusTrap'
import { UiOverlayLayerProvider, useUiOverlayLayer } from './overlayOwnership'
import { UI_MODAL_SIZE_CLASS, UI_TEXT_BODY_CLASS, UI_TEXT_TITLE_CLASS } from './styleTokens'
import { CircleAlert, Info, TriangleAlert } from 'lucide-react'

/** 弹窗底部的一个动作按钮 */
export interface AlertDialogAction {
  label: string
  onClick: () => void
  /** 主动作用 primary（一个弹窗最多一个），其余用 secondary（默认）。 */
  variant?: 'primary' | 'secondary' | 'quiet'
  /** 破坏性动作：primary → dangerSolid（确认弹窗），secondary → danger（悬停显红）。 */
  tone?: 'default' | 'danger'
}

function resolveAlertActionVariant(action: AlertDialogAction): 'primary' | 'secondary' | 'quiet' | 'danger' | 'dangerSolid' {
  const variant = action.variant ?? 'secondary'
  if (action.tone !== 'danger') return variant
  return variant === 'primary' ? 'dangerSolid' : 'danger'
}

/** 主动作排到最后（最右），其余保持调用方顺序。 */
function orderAlertActions(actions: readonly AlertDialogAction[]): AlertDialogAction[] {
  return [...actions.filter((action) => action.variant !== 'primary'), ...actions.filter((action) => action.variant === 'primary')]
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
  closeLabel?: string
  closeVariant?: 'secondary' | 'quiet'
  /** 费用确认取消后立即撤销操作，避免退出动画期间仍能确认。 */
  closeImmediately?: boolean
  /** 核对面板保留两个结果按钮顺序，“稍后处理”在最后。 */
  actionLayout?: 'standard' | 'review'
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
  closeLabel,
  closeVariant = 'secondary',
  closeImmediately = false,
  actionLayout = 'standard',
}: AlertDialogProps): JSX.Element | null {
  const { t } = useI18n('common')
  const [closeRequested, setCloseRequested] = useState(false)
  const closeNotifiedRef = useRef(false)
  const finishClose = (): void => {
    if (closeNotifiedRef.current) return
    closeNotifiedRef.current = true
    onClose()
  }
  const { shouldRender, isVisible, closing, onTransitionEnd } = useDialogTransition(
    isOpen && !closeRequested, UI_DIALOG_TRANSITION_MS, true,
    { onExited: () => { if (closeRequested) finishClose() } },
  )
  const opacity = isVisible ? 1 : 0
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const messageId = useId()
  // 模态层：从浮层里打开的确认弹窗内点击不关闭那个浮层，打开期间父浮层不响应点外（任务 4.3）
  const overlay = useUiOverlayLayer(isOpen, { modal: true })

  useEffect(() => {
    if (!isOpen) return
    setCloseRequested(false)
    closeNotifiedRef.current = false
  }, [isOpen])
  const handleClose = () => {
    if (closeRequested) return
    setCloseRequested(true)
    if (closeImmediately) finishClose()
  }
  useDialogFocusTrap({
    active: isOpen && !closeRequested,
    dialogRef,
    onClose: handleClose,
  })

  if (!shouldRender || (closeImmediately && closeRequested)) return null

  // 根据类型选择图标和颜色
  const getIconAndColor = () => {
    switch (type) {
      case 'error':
        return {
          icon: (
            <CircleAlert className="h-5 w-5" />
          ),
          color: 'text-danger-text'
        }
      case 'info':
        return {
          icon: (
            <Info className="h-5 w-5" />
          ),
          color: 'text-accent-text'
        }
      case 'warning':
      default:
        return {
          icon: (
            <TriangleAlert className="h-5 w-5" />
          ),
          color: 'text-warning-text'
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
      data-dialog={closing ? undefined : 'true'}
      role="alertdialog"
      aria-modal={closing ? undefined : 'true'}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      tabIndex={-1}
      className={`${rootClassName} outline-none`}
      aria-hidden={closing || undefined}
      {...(closing ? { inert: '' } : {})}
      {...overlay.layerProps}
    >
      <UiOverlayLayerProvider id={overlay.id}>
      {/* 背景遮罩 */}
      <div
        className="ui-glass-scrim absolute inset-0"
        style={{ opacity, transition: uiTransition(['opacity'], UI_DIALOG_TRANSITION_MS) }}
        onClick={handleClose}
      />

      {/* 弹窗内容 */}
      <UiPanel
        className={`relative max-h-[calc(100vh-2rem)] overflow-hidden p-4 ${UI_MODAL_SIZE_CLASS.compact}`}
        style={{
          opacity,
          transform: `scale(${0.97 + 0.03 * opacity})`,
          transition: uiTransition(['opacity', 'transform'], UI_DIALOG_TRANSITION_MS)
        }}
        onTransitionEnd={onTransitionEnd}
      >
        {/* 标题 */}
        <div className="flex items-center gap-2">
          <div className={color}>{icon}</div>
          <div id={titleId} className={UI_TEXT_TITLE_CLASS}>{title}</div>
        </div>

        {/* 消息内容 */}
        <div id={messageId} className={`mt-2 max-h-72 overflow-y-auto whitespace-pre-line break-words ${UI_TEXT_BODY_CLASS}`}>
          {message}
        </div>

        {/* 动作按钮：与 UiModal 底部同一顺序——关闭/取消在左，其余动作在右，主动作固定在最右（任务 5.7） */}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {actionLayout === 'standard' && <UiButton
            type="button"
            variant={closeVariant}
            onClick={handleClose}
          >
            {closeLabel ?? t('close')}
          </UiButton>}
          {(actionLayout === 'review' ? actions ?? [] : orderAlertActions(actions ?? [])).map((action) => (
            <UiButton
              key={action.label}
              type="button"
              variant={resolveAlertActionVariant(action)}
              onClick={action.onClick}
            >
              {action.label}
            </UiButton>
          ))}
          {actionLayout === 'review' && <UiButton type="button" variant={closeVariant} onClick={handleClose}>{closeLabel ?? t('close')}</UiButton>}
        </div>
      </UiPanel>
      </UiOverlayLayerProvider>
    </div>
  )
}
