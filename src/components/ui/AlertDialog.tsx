import { useEffect, useState } from 'react'

interface AlertDialogProps {
  isOpen: boolean
  title: string
  message: string
  onClose: () => void
  type?: 'info' | 'warning' | 'error'
}

/**
 * 统一的提示弹窗组件
 * 样式与清除历史弹窗保持一致
 */
export default function AlertDialog({
  isOpen,
  title,
  message,
  onClose,
  type = 'warning'
}: AlertDialogProps) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        style={{ opacity, transition: 'opacity 180ms ease' }}
        onClick={handleClose}
      />

      {/* 弹窗内容 */}
      <div
        className="relative bg-[#131313]/80 border border-zinc-700/50 rounded-xl p-4 w-[400px] shadow-2xl"
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
        <div className="text-zinc-300 text-sm mt-2">{message}</div>

        {/* 确定按钮 */}
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleClose}
            className="h-9 px-4 inline-flex items-center justify-center rounded-md bg-zinc-700/70 hover:bg-zinc-700 text-white text-sm transition-colors"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
