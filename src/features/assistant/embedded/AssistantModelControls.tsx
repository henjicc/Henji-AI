import { useEffect, useState } from 'react'
import type { LlmConfigState } from '@henjicc/ai-sdk'

import { Dropdown } from '@/components/ui'
import { createLogger } from '@/core/logging'
import { LLM_CONFIG_CHANGED_EVENT } from '@/core/llm/events'
import {
  ASSISTANT_REASONING_MODES,
  assistantModelCandidates,
  assistantProfile,
  readReasoningMode,
  withAssistantPrimaryModel,
  withReasoningMode,
  type AssistantReasoningMode,
} from '@/core/llm/assistantModelChoice'
import { useI18n } from '@/hooks/useI18n'
import { llmConfigService } from '@/services/llm'
import { reportEmbeddedAgentError } from './controller'

const logger = createLogger('features.assistant.model_controls')
const keyOf = (providerId: string, modelId: string): string => `${providerId}\u0000${modelId}`

/**
 * 输入框底栏的模型与思考程度：改的就是设置里的助手主模型与供应商思考档位，下一条消息起生效。
 * 不先改界面再存：发送用的模型来自主进程，存好、对话重新取到模型之前由 onSwitching 挡住发送。
 */
export function AssistantModelControls({ disabled, onSwitching }: { disabled?: boolean; onSwitching?: () => void }): JSX.Element | null {
  const { t } = useI18n('settings')
  const [config, setConfig] = useState<LlmConfigState | null>(null)
  useEffect(() => {
    let disposed = false
    let latest = 0
    // 连续切换时只认最后一次读取，较早返回的旧配置不覆盖
    const load = (): void => {
      const request = ++latest
      void llmConfigService.getConfig().then(next => { if (!disposed && request === latest) setConfig(next) }, reportEmbeddedAgentError)
    }
    load()
    window.addEventListener(LLM_CONFIG_CHANGED_EVENT, load)
    return () => { disposed = true; window.removeEventListener(LLM_CONFIG_CHANGED_EVENT, load) }
  }, [])
  if (!config) return null
  const candidates = assistantModelCandidates(config).map(({ model }) => model)
  const primary = assistantProfile(config)?.primary
  if (!candidates.length) return null
  const providerName = (providerId: string): string => config.providers.find(item => item.providerId === providerId)?.displayName ?? providerId
  const current = primary ? keyOf(primary.providerId, primary.modelId) : ''
  const currentModel = candidates.find(model => keyOf(model.providerId, model.modelId) === current)
  const mode = readReasoningMode(config, primary)
  const save = (next: LlmConfigState, event: string, context: Record<string, unknown>): void => {
    onSwitching?.()
    // 保存成功会广播配置变化，本组件与对话都从磁盘重读；失败也重读，界面始终与已保存的一致
    void llmConfigService.saveConfig(next).then(() => logger.info('助手模型选择已更新', { event, context }), error => {
      reportEmbeddedAgentError(error)
      window.dispatchEvent(new CustomEvent(LLM_CONFIG_CHANGED_EVENT))
    })
  }
  return <>
    <Dropdown<string> size="sm" appearance="text" ariaLabel={t('agentModels.roles.primary')}
      value={current} display={currentModel?.displayName ?? t('agentModels.choose')}
      options={candidates.map(model => ({ value: keyOf(model.providerId, model.modelId), label: `${model.displayName} · ${providerName(model.providerId)}` }))}
      disabled={disabled} className="min-w-0" buttonClassName="w-auto max-w-full" panelWidthStrategy="options"
      onSelect={value => {
        const model = candidates.find(item => keyOf(item.providerId, item.modelId) === value)
        if (model) save(withAssistantPrimaryModel(config, { providerId: model.providerId, modelId: model.modelId }), 'assistant.model_controls.model_selected', { providerId: model.providerId, modelId: model.modelId })
      }} />
    {primary && mode ? <Dropdown<AssistantReasoningMode> size="sm" appearance="text" ariaLabel={t('agentModels.reasoning.label')}
      value={mode} display={t('agentModels.reasoning.short', { mode: t(`agentModels.reasoning.modes.${mode}`) })}
      options={ASSISTANT_REASONING_MODES.map(value => ({ value, label: t(`agentModels.reasoning.modes.${value}`) }))}
      disabled={disabled} className="shrink-0" buttonClassName="w-auto" panelWidthStrategy="options"
      onSelect={value => save(withReasoningMode(config, primary.providerId, value), 'assistant.model_controls.reasoning_selected', { providerId: primary.providerId, mode: value })} /> : null}
  </>
}
