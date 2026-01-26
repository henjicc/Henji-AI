/**
 * ExportPanel - 导出面板组件
 *
 * 提供配置导出功能的 UI 界面
 */

import React, { useState } from 'react'
import { exportService } from '@/core/export/ExportService'
import type { ExportData, ExportType, CleanOptions } from '@/core/export/types'
import { useI18n } from '@/hooks/useI18n'

interface ExportPanelProps {
  modelId: string
  params: Record<string, unknown>
  context?: Record<string, unknown>
}

export const ExportPanel: React.FC<ExportPanelProps> = ({ modelId, params, context = {} }) => {
  const { t } = useI18n('ui')
  const [exportType, setExportType] = useState<ExportType>('current-params')
  const [cleanOptions, setCleanOptions] = useState<CleanOptions>({
    removeDefaults: true,
    removeEmpty: true,
    removeSensitive: false,
    removeBase64: true
  })
  const [copySuccess, setCopySuccess] = useState(false)

  // 处理导出类型变化
  const handleExportTypeChange = (type: ExportType) => {
    setExportType(type)
  }

  // 处理清理选项变化
  const handleCleanOptionChange = (option: keyof CleanOptions) => {
    setCleanOptions((prev) => ({
      ...prev,
      [option]: !prev[option]
    }))
  }

  // 获取导出数据
  const getExportData = async (): Promise<ExportData> => {
    const options = { clean: cleanOptions, includeMetadata: true }

    switch (exportType) {
      case 'current-params':
        return exportService.exportCurrentParams(modelId, params, options)
      case 'model-config':
        return exportService.exportModelConfig(modelId, options)
      case 'model-schema':
        return exportService.exportModelSchema(modelId, options)
      case 'api-request':
        return await exportService.exportAPIRequest(modelId, params, context, options)
      case 'preset':
        return exportService.exportAsPreset(modelId, params, t('debug.export.presetName'), options)
      default:
        return exportService.exportCurrentParams(modelId, params, options)
    }
  }

  // 处理下载
  const handleDownload = async (): Promise<void> => {
    const data = await getExportData()
    exportService.downloadAsJSON(data)
  }

  // 处理复制
  const handleCopy = async () => {
    try {
      const data = await getExportData()
      await exportService.copyToClipboard(data)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  return (
    <div className="space-y-4">
      {/* 导出类型选择 */}
      <div>
        <h4 className="text-white text-sm font-medium mb-2">{t('debug.export.title')}</h4>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'current-params', label: t('debug.export.type.currentParams') },
            { value: 'model-config', label: t('debug.export.type.modelConfig') },
            { value: 'model-schema', label: t('debug.export.type.modelSchema') },
            { value: 'api-request', label: t('debug.export.type.apiRequest') },
            { value: 'preset', label: t('debug.export.type.preset') }
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => handleExportTypeChange(option.value as ExportType)}
              className={`px-3 py-2 rounded text-sm transition-colors ${
                exportType === option.value
                  ? 'bg-yellow-500 text-black font-medium'
                  : 'bg-zinc-800/50 text-gray-300 hover:bg-zinc-700/50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* 清理选项 */}
      <div>
        <h4 className="text-white text-sm font-medium mb-2">{t('debug.export.clean.title')}</h4>
        <div className="space-y-2">
          {[
            { key: 'removeDefaults', label: t('debug.export.clean.removeDefaults') },
            { key: 'removeEmpty', label: t('debug.export.clean.removeEmpty') },
            { key: 'removeSensitive', label: t('debug.export.clean.removeSensitive') },
            { key: 'removeBase64', label: t('debug.export.clean.removeBase64') }
          ].map((option) => (
            <label
              key={option.key}
              className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={cleanOptions[option.key as keyof CleanOptions]}
                onChange={() => handleCleanOptionChange(option.key as keyof CleanOptions)}
                className="w-4 h-4 rounded border-gray-600 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-0"
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <button
          onClick={handleDownload}
          className="flex-1 px-4 py-2 bg-yellow-500 text-black rounded font-medium hover:bg-yellow-400 transition-colors"
        >
          {t('debug.export.actions.downloadJson')}
        </button>
        <button
          onClick={handleCopy}
          className="flex-1 px-4 py-2 bg-zinc-700 text-white rounded font-medium hover:bg-zinc-600 transition-colors"
        >
          {copySuccess ? t('debug.export.actions.copied') : t('debug.export.actions.copy')}
        </button>
      </div>
    </div>
  )
}
