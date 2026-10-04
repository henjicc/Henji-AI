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
  UI_TEXT_PANEL_TITLE_CLASS,
  UiButton,
  UiCheckbox,
  UiChipButton,
  UiGroup,
  UiModal,
} from '@/components/ui'
import Toggle from '@/components/ui/Toggle'

/** 一个可勾选的测试选项：整行是 label，点哪里都切换，悬停只出中性底（任务 5.7：原为带底色的可点击 div）。 */
function TestOptionRow({ title, description, checked, onChange }: {
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}): JSX.Element {
  return (
    <label className="-mx-2 flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors duration-120 hover:bg-hover">
      <span className="min-w-0">
        <span className={`block ${UI_TEXT_BODY_CLASS}`}>{title}</span>
        <span className={`mt-0.5 block ${UI_TEXT_META_CLASS}`}>{description}</span>
      </span>
      <UiCheckbox checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

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

  const kbdClass = 'rounded-control bg-raised px-1.5 py-0.5 font-mono text-2xs text-text1'
  const options = [
    { key: 'skipRequest' as const, checked: state.options.skipRequest, onChange: () => handleToggleOption('skipRequest') },
    { key: 'logParams' as const, checked: state.options.logParams, onChange: () => handleToggleOption('logParams') },
    { key: 'enableDevTools' as const, checked: state.options.enableDevTools, onChange: () => handleToggleOption('enableDevTools') },
  ]

  return (
    <UiModal
      isOpen={isOpen}
      title={t('testMode.title')}
      onClose={handleClose}
      size="form"
      contentClassName="overflow-y-auto px-4 py-4"
    >
      <div className="space-y-5">
        {/* 开关 + 快捷键 */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className={UI_TEXT_PANEL_TITLE_CLASS}>{t('testMode.enable.title')}</div>
            <div className={`mt-1 ${UI_TEXT_META_CLASS}`}>{t('testMode.enable.description')}</div>
            <div className={`mt-2 flex flex-wrap items-center gap-1 ${UI_TEXT_META_CLASS}`}>
              <span>{t('testMode.shortcutLabel')}</span>
              {['Ctrl', 'Alt', 'Shift', 'T'].map((key) => <kbd key={key} className={kbdClass}>{key}</kbd>)}
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

        {state.enabled && (
          <div className="flex gap-1 border-b border-line">
            <UiChipButton
              type="button"
              active={activeTab === 'options'}
              selectionRole="navigation"
              selectionAppearance="subtle"
              onClick={() => setActiveTab('options')}
            >
              {t('testMode.tabs.options')}
            </UiChipButton>
            <UiChipButton
              type="button"
              active={activeTab === 'export'}
              selectionRole="navigation"
              selectionAppearance="subtle"
              onClick={() => setActiveTab('export')}
            >
              {t('testMode.tabs.export')}
            </UiChipButton>
          </div>
        )}

        {state.enabled && activeTab === 'options' && (
          <UiGroup title={t('testMode.options.title')} titleTone="compact">
            <div>
              {options.map((option) => (
                <TestOptionRow
                  key={option.key}
                  title={t(`testMode.options.${option.key}.title`)}
                  description={t(`testMode.options.${option.key}.description`)}
                  checked={option.checked}
                  onChange={option.onChange}
                />
              ))}
              <TestOptionRow
                title={t('testMode.options.flowTracking.title')}
                description={t('testMode.options.flowTracking.description')}
                checked={showFlowTracking}
                onChange={setShowFlowTracking}
              />
            </div>
          </UiGroup>
        )}

        {state.enabled && activeTab === 'options' && showFlowTracking && flowRecords.length > 0 && (
          <UiGroup title={t('testMode.flowTracking.title')} titleTone="compact">
            {flowRecords.map((record, index) => (
              <ParamFlowViewer
                key={index}
                record={record}
                onExport={onExportFlowRecord ? () => onExportFlowRecord(record) : undefined}
              />
            ))}
          </UiGroup>
        )}

        {state.enabled && activeTab === 'export' && modelId && params && (
          <ExportPanel modelId={modelId} params={params} context={context} />
        )}

        {/* 独立日志窗口入口：日志完整捕获开关已移至日志窗口工具栏（见 2.1 decisions.md） */}
        {state.enabled && activeTab === 'options' && (
          <UiGroup title={t('testMode.logsWindow.title')} titleTone="compact" divided>
            <div className="flex items-center justify-between gap-3">
              <div className={UI_TEXT_META_CLASS}>{t('testMode.logsWindow.description')}</div>
              <UiButton variant="secondary" type="button" className="shrink-0" onClick={() => void openLogWindow()}>
                {t('testMode.logsWindow.openButton')}
              </UiButton>
            </div>
          </UiGroup>
        )}
      </div>
    </UiModal>
  )
}

export default TestModePanel
