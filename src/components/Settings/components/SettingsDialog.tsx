import React from 'react'

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

const getActionClass = (variant: DialogActionVariant | undefined) => {
  if (variant === 'danger') {
    return 'bg-red-600/70 hover:bg-red-600'
  }
  if (variant === 'secondary') {
    return 'bg-zinc-700/50 hover:bg-zinc-600/50'
  }
  return 'bg-[#007eff]/70 hover:bg-[#007eff]'
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
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative bg-[#131313]/80 border border-zinc-700/50 rounded-xl p-4 w-[400px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-white text-base">{title}</div>
        {description ? <div className="text-zinc-300 text-sm mt-2">{description}</div> : null}
        <div className="mt-4 flex gap-2 justify-end">
          {actions.map(action => (
            <button
              key={action.label}
              type="button"
              onClick={(e) => { e.stopPropagation(); action.onClick() }}
              className={`h-9 px-3 inline-flex items-center justify-center rounded-md text-white text-sm transition-colors ${getActionClass(action.variant)}`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default SettingsDialog
