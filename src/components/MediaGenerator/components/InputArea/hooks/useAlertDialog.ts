import { useState, useCallback } from 'react'

interface AlertState {
  isOpen: boolean
  title: string
  message: string
  type: 'info' | 'warning' | 'error'
}

/**
 * Alert 对话框 Hook
 * 处理提示对话框的状态和显示
 */
export const useAlertDialog = () => {
  const [alertDialog, setAlertDialog] = useState<AlertState>({
    isOpen: false,
    title: '',
    message: '',
    type: 'warning'
  })

  // 显示提示弹窗
  const showAlert = useCallback((
    title: string,
    message: string,
    type: 'info' | 'warning' | 'error' = 'warning'
  ) => {
    setAlertDialog({ isOpen: true, title, message, type })
  }, [])

  // 关闭提示弹窗
  const closeAlert = useCallback(() => {
    setAlertDialog(prev => ({ ...prev, isOpen: false }))
  }, [])

  return {
    alertDialog,
    showAlert,
    closeAlert
  }
}
