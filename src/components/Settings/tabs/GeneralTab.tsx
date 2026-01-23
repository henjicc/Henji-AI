import React from 'react'
import { useSettings } from '../hooks/useSettings'
import SettingItem from '../components/SettingItem'

const GeneralTab: React.FC = () => {
  const { settings, updateSetting } = useSettings()

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-white mb-2">通用设置</h3>
      <p className="text-sm text-zinc-400 mb-6">
        配置应用的基本设置和行为。
      </p>

      <div className="space-y-4">
        <SettingItem label="历史记录数量" description="保留的最大历史记录数">
          <input
            type="number"
            value={settings.maxHistoryCount}
            onChange={(e) => updateSetting('maxHistoryCount', parseInt(e.target.value, 10))}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            min="1"
            max="1000"
          />
        </SettingItem>

        <SettingItem label="显示价格估算">
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showPriceEstimate}
              onChange={(e) => updateSetting('showPriceEstimate', e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm text-zinc-300">在生成前显示预估价格</span>
          </label>
        </SettingItem>

        <SettingItem label="最大并发任务数" description="同时运行的最大任务数">
          <input
            type="number"
            value={settings.maxConcurrentTasks}
            onChange={(e) => updateSetting('maxConcurrentTasks', parseInt(e.target.value, 10))}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            min="1"
            max="10"
          />
        </SettingItem>
      </div>
    </div>
  )
}

export default GeneralTab
