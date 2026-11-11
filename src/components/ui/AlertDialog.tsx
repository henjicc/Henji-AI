import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { useEffect, useId, useRef, useState } from 'react'
import { UiButton, UiPanel } from './primitives'
import { useI18n } from '@/hooks/useI18n'
import { useDialogTransition } from './useDialogTransition'
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DIALOG_TRANSITION_MS, uiTransition } from './motion'
import { useDialogFocusTrap } from './useDialogFocusTrap'
import { UiOverlayLayerProvider, useUiOverlayLayer } from './overlayOwnership'
import { UI_DROP_TARGET_OVERLAY_CLASS, UI_MODAL_SIZE_CLASS, UI_TEXT_SECTION_CLASS } from './styleTokens'
import { useFileDropTarget, type FileDropTargetOptions } from './fileDrop/useFileDropTarget'
import { CircleAlert, Info, TriangleAlert, type LucideIcon } from 'lucide-react'

const ALERT_TYPE_ICON: Record<'info' | 'warning' | 'error', { Icon: LucideIcon; color: string }> = {
  error: { Icon: CircleAlert, color: 'text-danger-text' },
  warning: { Icon: TriangleAlert, color: 'text-warning-text' },
  info: { Icon: Info, color: 'text-accent-text' },
}

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
  /** 弹窗在等用户找一个文件（如重新定位）时：把文件拖到弹窗上，和点选文件同一件事。 */
  fileDrop?: FileDropTargetOptions
}

const NO_FILE_DROP: FileDropTargetOptions = { disabled: true, onDropFiles: () => undefined }

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
  fileDrop,
}: AlertDialogProps): JSX.Element | null {
  const drop = useFileDropTarget(fileDrop ?? NO_FILE_DROP)
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
    besideIndependentRegions: true,
  })

  if (!shouldRender || (closeImmediately && closeRequested)) return null

  // 破坏性确认（有危险动作）一律危险色图标，和底部的危险实底按钮呼应
  const destructive = (actions ?? []).some((action) => action.tone === 'danger')
  const { Icon, color } = destructive ? ALERT_TYPE_ICON.error : ALERT_TYPE_ICON[type]
  const rootClassName = scope === 'container'
    ? 'absolute inset-0 z-modal flex items-center justify-center'
    : `fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-modal flex items-center justify-center`

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
        floating
        className={`relative max-h-[calc(100vh-2rem)] overflow-hidden p-4 ${UI_MODAL_SIZE_CLASS.compact}`}
        style={{
          opacity,
          transform: `scale(${0.97 + 0.03 * opacity})`,
          transition: uiTransition(['opacity', 'transform'], UI_DIALOG_TRANSITION_MS)
        }}
        onTransitionEnd={onTransitionEnd}
        {...drop.dropProps}
      >
        {drop.isDragOver ? <div aria-hidden="true" className={UI_DROP_TARGET_OVERLAY_CLASS} /> : null}
        {/* 图标单独占左列，标题与正文在右侧同一列左对齐：多行正文不会绕到图标下面 */}
        <div className="flex items-start gap-3">
          <Icon aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.lg} mt-0.5 shrink-0 ${color}`} />
          <div className="min-w-0 flex-1">
            <div id={titleId} className={UI_TEXT_SECTION_CLASS}>{title}</div>
            <div id={messageId} className={`mt-1.5 max-h-72 overflow-y-auto whitespace-pre-line break-words text-13 leading-5 text-text2`}>
              {message}
            </div>
          </div>
        </div>

        {/* 动作按钮：与 UiModal 底部同一顺序——关闭/取消在左，其余动作在右，主动作固定在最右 */}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
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
