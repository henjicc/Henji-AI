/**
 * ExportPanel - 导出面板组件
 *
 * 提供配置导出功能的 UI 界面
 */

import React, { useState } from 'react'
import { exportService } from '@/core/export/ExportService'
import type { ExportData, ExportType, CleanOptions } from '@/core/export/types'
import { useI18n } from '@/hooks/useI18n'
import { UiButton, UiCheckbox, UiOptionButton } from '@/components/ui'

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
            <UiOptionButton
              active={exportType === option.value}
              key={option.value}
              onClick={() => handleExportTypeChange(option.value as ExportType)}
              className={`px-3 py-2 rounded text-sm transition-colors ${
                exportType === option.value
                  ? 'bg-yellow-500 text-black font-medium'
                  : 'bg-zinc-800/50 text-gray-300 hover:bg-zinc-700/50'
              }`}
            >
              {option.label}
            </UiOptionButton>
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
              <UiCheckbox
                checked={Boolean(cleanOptions[option.key as keyof CleanOptions])}
                onCheckedChange={() => handleCleanOptionChange(option.key as keyof CleanOptions)}
                className="h-4 w-4"
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <UiButton
          variant="primary"
          size="sm"
          onClick={handleDownload}
          className="flex-1 bg-yellow-500 text-black hover:bg-yellow-400"
        >
          {t('debug.export.actions.downloadJson')}
        </UiButton>
        <UiButton
          variant="muted"
          size="sm"
          onClick={handleCopy}
          className="flex-1"
        >
          {copySuccess ? t('debug.export.actions.copied') : t('debug.export.actions.copy')}
        </UiButton>
      </div>
    </div>
  )
}
