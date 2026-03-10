import React from 'react'
import { UiButton, UiPanel } from '@/components/ui'

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

const getActionClass = (variant: DialogActionVariant | undefined): string => {
  if (variant === 'danger') {
    return 'bg-red-600 text-white hover:bg-red-500'
  }
  if (variant === 'secondary') {
    return ''
  }
  return ''
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, title, description, actions, onClose }) => {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-dialog="true"
      onClick={(e) => {
        e.stopPropagation()
        onClose?.()
      }}
    >
      <div className="absolute inset-0 bg-black/70" />
      <UiPanel
        className="relative w-[400px] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-white text-base">{title}</div>
        {description ? <div className="text-zinc-300 text-sm mt-2">{description}</div> : null}
        <div className="mt-4 flex gap-2 justify-end">
          {actions.map(action => (
            <UiButton
              key={action.label}
              size="sm"
              variant={action.variant === 'primary' || action.variant === 'danger' ? 'primary' : 'muted'}
              onClick={(e) => { e.stopPropagation(); action.onClick() }}
              className={`h-9 px-3 ${getActionClass(action.variant)}`}
            >
              {action.label}
            </UiButton>
          ))}
        </div>
      </UiPanel>
    </div>
  )
}

export default SettingsDialog
