/**
 * 确认对话框组件
 * 职责：显示确认对话框
 */

import React from 'react'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
  type?: 'info' | 'warning' | 'danger'
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
  onCancel,
  type = 'info'
}) => {
  if (!isOpen) {
    return null
  }

  const getIcon = () => {
    switch (type) {
      case 'info': return 'ℹ️'
      case 'warning': return '⚠️'
      case 'danger': return '🚨'
    }
  }

  return (
    <div className="confirm-dialog-overlay" onClick={onCancel}>
      <div
        className={`confirm-dialog confirm-${type}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <span className="dialog-icon">{getIcon()}</span>
          <h3 className="dialog-title">{title}</h3>
        </div>

        <div className="dialog-content">
          <p className="dialog-message">{message}</p>
        </div>

        <div className="dialog-actions">
          <button
            className="dialog-btn cancel"
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            className={`dialog-btn confirm ${type}`}
            onClick={() => {
              onConfirm()
              onCancel()
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
