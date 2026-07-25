import { useEffect, useState } from 'react'
import { UiButton, UiPanel } from './primitives'
import { useI18n } from '@/hooks/useI18n'

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
}: AlertDialogProps) {
  const { t } = useI18n('common')
  const [opacity, setOpacity] = useState(0)

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setOpacity(1))
    }
  }, [isOpen])

  const handleClose = () => {
    setOpacity(0)
    setTimeout(() => onClose(), 180)
  }

  if (!isOpen) return null

  // 根据类型选择图标和颜色
  const getIconAndColor = () => {
    switch (type) {
      case 'error':
        return {
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ),
          color: 'text-red-500'
        }
      case 'info':
        return {
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          color: 'text-blue-500'
        }
      case 'warning':
      default:
        return {
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
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
    <div className={rootClassName}>
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        style={{ opacity, transition: 'opacity 180ms ease' }}
        onClick={handleClose}
      />

      {/* 弹窗内容 */}
      <UiPanel
        className="relative p-4 w-[400px] shadow-2xl"
        style={{
          opacity,
          transform: `scale(${0.97 + 0.03 * opacity})`,
          transition: 'opacity 180ms ease, transform 180ms ease'
        }}
      >
        {/* 标题 */}
        <div className="flex items-center gap-2">
          <div className={color}>{icon}</div>
          <div className="text-white text-base font-medium">{title}</div>
        </div>

        {/* 消息内容 */}
        <div className="ui-scrollbar max-h-[280px] overflow-y-auto text-zinc-300 text-sm mt-2 whitespace-pre-line break-words">
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
