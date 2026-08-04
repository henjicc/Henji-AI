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
import { openLogWindow } from '@/commands/logging'
import {
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_SECTION_CLASS,
  UI_TEXT_TITLE_CLASS,
  UiButton,
  UiCheckbox,
  UiChipButton,
  UiIconButton,
  UiModal,
} from '@/components/ui'
import Toggle from '@/components/ui/Toggle'
import { X } from 'lucide-react'

interface TestModePanelProps {
  isOpen: boolean
  onClose: () => void
  flowRecords?: ParamFlowRecord[]
  onExportFlowRecord?: (record: ParamFlowRecord) => void
  modelId?: string
  params?: DynamicValueMap
  context?: DynamicValueMap
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
  const [showFlowTracking, setShowFlowTracking] = useState(false)
  const [activeTab, setActiveTab] = useState<'options' | 'export'>('options')

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

  // 关闭动画由 UiModal 的 useDialogTransition 负责，这里直接回调
  const handleClose = () => {
    onClose()
  }

  return (
    <UiModal
      isOpen={isOpen}
      title={t('testMode.title')}
      onClose={handleClose}
      hideHeader
      widthClassName="w-[600px] max-h-[80vh] overflow-y-auto border-yellow-500/50"
      contentClassName="p-6"
    >
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse" />
            <h2 className={UI_TEXT_TITLE_CLASS}>{t('testMode.title')}</h2>
          </div>
          <UiIconButton
            type="button"
            onClick={handleClose}
            appearance="hover-only"
            className="h-8 w-8 text-text-muted hover:text-white hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </UiIconButton>
        </div>

        {/* 快捷键提示 */}
        <div className="mb-6 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className={UI_TEXT_BODY_CLASS}>
            {t('testMode.shortcutLabel')} <kbd className="px-2 py-1 bg-black/30 rounded">Ctrl</kbd> +{' '}
            <kbd className="px-2 py-1 bg-black/30 rounded">Alt</kbd> +{' '}
            <kbd className="px-2 py-1 bg-black/30 rounded">Shift</kbd> +{' '}
            <kbd className="px-2 py-1 bg-black/30 rounded">T</kbd>
          </div>
        </div>

        {/* 测试模式开关 */}
        <div className="mb-6">
          <div className="flex items-center justify-between p-4 rounded-lg bg-app/40">
            <div>
              <div className={UI_TEXT_SECTION_CLASS}>{t('testMode.enable.title')}</div>
              <div className={`mt-1 ${UI_TEXT_META_CLASS}`}>
                {t('testMode.enable.description')}
              </div>
            </div>
            <Toggle
              checked={state.enabled}
              onChange={handleToggleTestMode}
              onText={t('testMode.enable.title')}
              offText={t('testMode.enable.title')}
              ariaLabel={t('testMode.enable.title')}
            />
          </div>
        </div>

        {/* 标签页切换 */}
        {state.enabled && (
          <div className="mb-6">
            <div className="flex gap-2 border-b border-border-dark/50">
              <UiChipButton
                type="button"
                active={activeTab === 'options'}
                selectionRole="navigation"
                onClick={() => setActiveTab('options')}
                className="px-4 py-2"
              >
                {t('testMode.tabs.options')}
              </UiChipButton>
              <UiChipButton
                type="button"
                active={activeTab === 'export'}
                selectionRole="navigation"
                onClick={() => setActiveTab('export')}
                className="px-4 py-2"
              >
                {t('testMode.tabs.export')}
              </UiChipButton>
            </div>
          </div>
        )}

        {/* 测试选项 */}
        {state.enabled && activeTab === 'options' && (
          <div className="mb-6">
            <h3 className={`mb-3 ${UI_TEXT_SECTION_CLASS}`}>{t('testMode.options.title')}</h3>
            <div className="space-y-3">
              {/* 跳过请求 */}
              <div
                className="flex items-center justify-between p-3 rounded-lg bg-app/40 cursor-pointer hover:bg-app/60 transition-colors"
                onClick={() => handleToggleOption('skipRequest')}
              >
                <div>
                  <div className={UI_TEXT_BODY_CLASS}>{t('testMode.options.skipRequest.title')}</div>
                  <div className={`mt-1 ${UI_TEXT_META_CLASS}`}>
                    {t('testMode.options.skipRequest.description')}
                  </div>
                </div>
                <UiCheckbox
                  checked={state.options.skipRequest}
                  onCheckedChange={() => handleToggleOption('skipRequest')}
                  onClick={(event) => event.stopPropagation()}
                />
              </div>

              {/* 输出参数 */}
              <div
                className="flex items-center justify-between p-3 rounded-lg bg-app/40 cursor-pointer hover:bg-app/60 transition-colors"
                onClick={() => handleToggleOption('logParams')}
              >
                <div>
                  <div className={UI_TEXT_BODY_CLASS}>{t('testMode.options.logParams.title')}</div>
                  <div className={`mt-1 ${UI_TEXT_META_CLASS}`}>
                    {t('testMode.options.logParams.description')}
                  </div>
                </div>
                <UiCheckbox
                  checked={state.options.logParams}
                  onCheckedChange={() => handleToggleOption('logParams')}
                  onClick={(event) => event.stopPropagation()}
                />
              </div>

              {/* 开发者工具 */}
              <div
                className="flex items-center justify-between p-3 rounded-lg bg-app/40 cursor-pointer hover:bg-app/60 transition-colors"
                onClick={() => handleToggleOption('enableDevTools')}
              >
                <div>
                  <div className={UI_TEXT_BODY_CLASS}>{t('testMode.options.enableDevTools.title')}</div>
                  <div className={`mt-1 ${UI_TEXT_META_CLASS}`}>
                    {t('testMode.options.enableDevTools.description')}
                  </div>
                </div>
                <UiCheckbox
                  checked={state.options.enableDevTools}
                  onCheckedChange={() => handleToggleOption('enableDevTools')}
                  onClick={(event) => event.stopPropagation()}
                />
              </div>

              {/* 参数流转追踪 */}
              <div
                className="flex items-center justify-between p-3 rounded-lg bg-app/40 cursor-pointer hover:bg-app/60 transition-colors"
                onClick={() => setShowFlowTracking(prev => !prev)}
              >
                <div>
                  <div className={UI_TEXT_BODY_CLASS}>{t('testMode.options.flowTracking.title')}</div>
                  <div className={`mt-1 ${UI_TEXT_META_CLASS}`}>
                    {t('testMode.options.flowTracking.description')}
                  </div>
                </div>
                <UiCheckbox
                  checked={showFlowTracking}
                  onCheckedChange={setShowFlowTracking}
                  onClick={(event) => event.stopPropagation()}
                />
              </div>
            </div>
          </div>
        )}

        {/* 参数流转追踪可视化 */}
        {state.enabled && activeTab === 'options' && showFlowTracking && flowRecords.length > 0 && (
          <div className="mb-6">
            <h3 className={`mb-3 ${UI_TEXT_SECTION_CLASS}`}>{t('testMode.flowTracking.title')}</h3>
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

        {/* 独立日志窗口入口：日志完整捕获开关已移至日志窗口工具栏（见 2.1 decisions.md） */}
        {state.enabled && activeTab === 'options' && (
          <div>
            <h3 className={`mb-3 ${UI_TEXT_SECTION_CLASS}`}>{t('testMode.logsWindow.title')}</h3>
            <div className="flex items-center justify-between p-3 rounded-lg bg-app/40">
              <div className={UI_TEXT_META_CLASS}>{t('testMode.logsWindow.description')}</div>
              <UiButton type="button" size="sm" onClick={() => void openLogWindow()}>
                {t('testMode.logsWindow.openButton')}
              </UiButton>
            </div>
          </div>
        )}
    </UiModal>
  )
}

export default TestModePanel
