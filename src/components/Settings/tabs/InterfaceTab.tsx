import React from 'react'
import SettingItem from '../components/SettingItem'

const InterfaceTab: React.FC = () => {
  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-white mb-2">界面设置</h3>
      <p className="text-sm text-zinc-400 mb-6">
        自定义应用的外观和交互行为。
      </p>

      <div className="space-y-4">
        <SettingItem label="界面主题">
          <p className="text-sm text-zinc-500">主题设置功能开发中...</p>
        </SettingItem>
      </div>
    </div>
  )
}

export default InterfaceTab
