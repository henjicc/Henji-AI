/**
 * 测试模式面板
 * 用于配置测试选项和查看请求参数
 */

import React, { useState, useEffect } from 'react'
import {
  getTestModeState,
  updateTestOptions,
  toggleTestMode,
  type TestModeState
} from '@/utils/testMode'
import { ParamFlowViewer } from './debug/ParamFlowViewer'
import { ExportPanel } from './debug/ExportPanel'
import type { ParamFlowRecord } from '@/core/debug/types'
import { useI18n } from '@/hooks/useI18n'

interface TestModePanelProps {
  isOpen: boolean
  onClose: () => void
  flowRecords?: ParamFlowRecord[]
  onExportFlowRecord?: (record: ParamFlowRecord) => void
  modelId?: string
  params?: Record<string, any>
  context?: Record<string, any>
}

const TestModePanel: React.FC<TestModePanelProps> = ({
  isOpen,
  onClose,
  flowRecords = [],
  onExportFlowRecord,
  modelId,
  params,
  context
}) => {
  const { t } = useI18n('ui')
  const [state, setState] = useState<TestModeState>(getTestModeState())
  const [opacity, setOpacity] = useState(0)
  const [showFlowTracking, setShowFlowTracking] = useState(false)
  const [activeTab, setActiveTab] = useState<'options' | 'export'>('options')

  useEffect(() => {
    if (isOpen) {
      setOpacity(1)
    } else {
      setOpacity(0)
    }
  }, [isOpen])

  useEffect(() => {
    const handleTestModeChange = (event: CustomEvent) => {
      setState(event.detail)
    }

    window.addEventListener('test-mode-changed', handleTestModeChange as EventListener)

    return () => {
      window.removeEventListener('test-mode-changed', handleTestModeChange as EventListener)
    }
  }, [])

  const handleToggleTestMode = () => {
    toggleTestMode()
    setState(getTestModeState())
  }

  const handleToggleOption = (option: keyof typeof state.options) => {
    updateTestOptions({ [option]: !state.options[option] })
    setState(getTestModeState())
  }

  const handleClose = () => {
    setOpacity(0)
    setTimeout(() => onClose(), 180)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        style={{ opacity, transition: 'opacity 180ms ease' }}
        onClick={handleClose}
      />

      {/* 面板内容 */}
      <div
        className="relative bg-[#1a1a1a] border border-yellow-500/50 rounded-xl p-6 w-[600px] max-h-[80vh] overflow-y-auto shadow-2xl"
        style={{
          opacity,
          transform: `scale(${0.97 + 0.03 * opacity})`,
          transition: 'opacity 180ms ease, transform 180ms ease'
        }}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse" />
            <h2 className="text-xl font-bold text-yellow-500">{t('testMode.title')}</h2>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 快捷键提示 */}
        <div className="mb-6 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="text-sm text-yellow-500/80">
            {t('testMode.shortcutLabel')} <kbd className="px-2 py-1 bg-black/30 rounded">Ctrl</kbd> +{' '}
            <kbd className="px-2 py-1 bg-black/30 rounded">Alt</kbd> +{' '}
            <kbd className="px-2 py-1 bg-black/30 rounded">Shift</kbd> +{' '}
            <kbd className="px-2 py-1 bg-black/30 rounded">T</kbd>
          </div>
        </div>

        {/* 测试模式开关 */}
        <div className="mb-6">
          <div className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
            <div>
              <div className="text-white font-medium">{t('testMode.enable.title')}</div>
              <div className="text-sm text-gray-400 mt-1">
                {t('testMode.enable.description')}
              </div>
            </div>
            <button
              onClick={handleToggleTestMode}
              className={`relative w-14 h-7 rounded-full transition-colors ${
                state.enabled ? 'bg-yellow-500' : 'bg-zinc-600'
              }`}
            >
              <div
                className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                  state.enabled ? 'translate-x-8' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* 标签页切换 */}
        {state.enabled && (
          <div className="mb-6">
            <div className="flex gap-2 border-b border-zinc-700/50">
              <button
                onClick={() => setActiveTab('options')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'options'
                    ? 'text-yellow-500 border-b-2 border-yellow-500'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                {t('testMode.tabs.options')}
              </button>
              <button
                onClick={() => setActiveTab('export')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'export'
                    ? 'text-yellow-500 border-b-2 border-yellow-500'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                {t('testMode.tabs.export')}
              </button>
            </div>
          </div>
        )}

        {/* 测试选项 */}
        {state.enabled && activeTab === 'options' && (
          <div className="mb-6">
            <h3 className="text-white font-medium mb-3">{t('testMode.options.title')}</h3>
            <div className="space-y-3">
              {/* 跳过请求 */}
              <label className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/30 cursor-pointer hover:bg-zinc-800/50 transition-colors">
                <div>
                  <div className="text-white text-sm">{t('testMode.options.skipRequest.title')}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {t('testMode.options.skipRequest.description')}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={state.options.skipRequest}
                  onChange={() => handleToggleOption('skipRequest')}
                  className="w-5 h-5 rounded border-gray-600 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-0"
                />
              </label>

              {/* 输出参数 */}
              <label className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/30 cursor-pointer hover:bg-zinc-800/50 transition-colors">
                <div>
                  <div className="text-white text-sm">{t('testMode.options.logParams.title')}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {t('testMode.options.logParams.description')}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={state.options.logParams}
                  onChange={() => handleToggleOption('logParams')}
                  className="w-5 h-5 rounded border-gray-600 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-0"
                />
              </label>

              {/* 开发者工具 */}
              <label className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/30 cursor-pointer hover:bg-zinc-800/50 transition-colors">
                <div>
                  <div className="text-white text-sm">{t('testMode.options.enableDevTools.title')}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {t('testMode.options.enableDevTools.description')}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={state.options.enableDevTools}
                  onChange={() => handleToggleOption('enableDevTools')}
                  className="w-5 h-5 rounded border-gray-600 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-0"
                />
              </label>

              {/* 参数流转追踪 */}
              <label className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/30 cursor-pointer hover:bg-zinc-800/50 transition-colors">
                <div>
                  <div className="text-white text-sm">{t('testMode.options.flowTracking.title')}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {t('testMode.options.flowTracking.description')}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={showFlowTracking}
                  onChange={(e) => setShowFlowTracking(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-600 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-0"
                />
              </label>
            </div>
          </div>
        )}

        {/* 参数流转追踪可视化 */}
        {state.enabled && activeTab === 'options' && showFlowTracking && flowRecords.length > 0 && (
          <div className="mb-6">
            <h3 className="text-white font-medium mb-3">{t('testMode.flowTracking.title')}</h3>
            {flowRecords.map((record, index) => (
              <ParamFlowViewer
                key={index}
                record={record}
                onExport={onExportFlowRecord ? () => onExportFlowRecord(record) : undefined}
              />
            ))}
          </div>
        )}

        {/* 配置导出面板 */}
        {state.enabled && activeTab === 'export' && modelId && params && (
          <div className="mb-6">
            <ExportPanel modelId={modelId} params={params} context={context} />
          </div>
        )}

        {/* 最后的请求参数 */}
        {state.enabled && activeTab === 'options' && state.lastParams && (
          <div>
            <h3 className="text-white font-medium mb-3">{t('testMode.lastParams.title')}</h3>
            <div className="bg-black/50 rounded-lg p-4 border border-zinc-700/50 max-h-[300px] overflow-y-auto">
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-gray-400">{t('testMode.lastParams.labels.model')}</span>{' '}
                  <span className="text-yellow-500">{state.lastParams.model}</span>
                </div>
                <div>
                  <span className="text-gray-400">{t('testMode.lastParams.labels.type')}</span>{' '}
                  <span className="text-yellow-500">{state.lastParams.type}</span>
                </div>
                <div>
                  <span className="text-gray-400">{t('testMode.lastParams.labels.prompt')}</span>{' '}
                  <span className="text-white">{state.lastParams.input}</span>
                </div>
                <div className="pt-2 border-t border-zinc-700/50">
                  <div className="text-gray-400 mb-2">{t('testMode.lastParams.labels.fullParams')}</div>
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap break-all">
                    {JSON.stringify(state.lastParams, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 提示信息 */}
        {state.enabled && !state.lastParams && (
          <div className="text-center text-gray-400 text-sm py-8">
            {t('testMode.emptyHint')}
          </div>
        )}
      </div>
    </div>
  )
}

export default TestModePanel
