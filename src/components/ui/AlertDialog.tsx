import { useEffect, useId, useRef, useState } from 'react'
import { UiButton, UiPanel } from './primitives'
import { useI18n } from '@/hooks/useI18n'
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
  variant?: 'primary' | 'secondary'
  /** 破坏性动作：primary → dangerSolid（确认弹窗），secondary → danger（悬停显红）。 */
  tone?: 'default' | 'danger'
}

function resolveAlertActionVariant(action: AlertDialogAction): 'primary' | 'secondary' | 'danger' | 'dangerSolid' {
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
  /** 费用确认取消后立即撤销操作，避免退出动画期间仍能确认。 */
  closeImmediately?: boolean
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
  closeImmediately = false,
}: AlertDialogProps): JSX.Element | null {
  const { t } = useI18n('common')
  const [opacity, setOpacity] = useState(0)
  // 收起中（任务 5.8，同 VE-06）：已关闭、只是在播退出过渡——不可点击、对读屏隐藏，
  // 过渡结束或计时器先到即通知调用方，避免退出动画期间再次点到确认或计时器被后台节流后迟迟不关
  const [closing, setClosing] = useState(false)
  const closeNotifiedRef = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const messageId = useId()
  // 模态层：从浮层里打开的确认弹窗内点击不关闭那个浮层，打开期间父浮层不响应点外（任务 4.3）
  const overlay = useUiOverlayLayer(isOpen, { modal: true })

  useEffect(() => {
    if (isOpen) {
      setClosing(false)
      closeNotifiedRef.current = false
      requestAnimationFrame(() => setOpacity(1))
    }
  }, [isOpen])

  const finishClose = (): void => {
    if (closeNotifiedRef.current) return
    closeNotifiedRef.current = true
    onClose()
  }

  const handleClose = () => {
    if (closing) return
    setOpacity(0)
    if (closeImmediately) {
      finishClose()
      return
    }
    setClosing(true)
    setTimeout(finishClose, UI_DIALOG_TRANSITION_MS)
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
        onTransitionEnd={(event) => {
          if (closing && event.target === event.currentTarget && event.propertyName === 'opacity') finishClose()
        }}
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
          <UiButton
            type="button"
            variant="secondary"
            onClick={handleClose}
          >
            {closeLabel ?? t('close')}
          </UiButton>
          {orderAlertActions(actions ?? []).map((action) => (
            <UiButton
              key={action.label}
              type="button"
              variant={resolveAlertActionVariant(action)}
              onClick={action.onClick}
            >
              {action.label}
            </UiButton>
          ))}
        </div>
      </UiPanel>
      </UiOverlayLayerProvider>
    </div>
  )
}
