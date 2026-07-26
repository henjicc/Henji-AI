import React from 'react'
import { UI_FIELD_LABEL_CLASS, UI_TEXT_META_CLASS } from '@/components/ui'

interface SettingItemProps {
  label: string
  description?: string
  children: React.ReactNode
}

const SettingItem: React.FC<SettingItemProps> = ({ label, description, children }) => {
  return (
    <div className="mb-6">
      <label className={UI_FIELD_LABEL_CLASS}>{label}</label>
      {description && (
        <p className={`${UI_TEXT_META_CLASS} mb-2`}>{description}</p>
      )}
      {children}
    </div>
  )
}

export default SettingItem
