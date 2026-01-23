import React from 'react'
import ModelSettingsPanel from '../../ModelSettingsPanel'

const ModelsTab: React.FC = () => {
  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-white mb-2">模型设置</h3>
      <p className="text-sm text-zinc-400 mb-6">
        管理模型的可见性和显示设置。
      </p>

      <ModelSettingsPanel />
    </div>
  )
}

export default ModelsTab
