import React from 'react'

interface SettingItemProps {
  label: string
  description?: string
  children: React.ReactNode
}

const SettingItem: React.FC<SettingItemProps> = ({ label, description, children }) => {
  return (
    <div className="mb-6">
      <label className="block text-sm font-medium text-text-soft mb-2">{label}</label>
      {description && (
        <p className="text-xs text-text-faint mb-2">{description}</p>
      )}
      {children}
    </div>
  )
}

export default SettingItem
