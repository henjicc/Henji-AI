import { ExternalLink, RefreshCw, RotateCcw, Save } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  getAssistantModelPreferences,
  openAssistantModelPreferencesFile,
  resetAssistantModelPreferences,
  updateAssistantModelPreferences,
} from '@/commands/assistant'
import { UiButton, UiInput, UiOptionButton, UiTextArea } from '@/components/ui'
import {
  createDefaultAssistantModelPreferences,
  type AssistantModelPreferences,
  type AssistantModelSelectionStrategy,
} from '@/core/assistant/modelPreferences'
import { createLogger } from '@/core/logging'

import SectionCard from '../components/SectionCard'

const logger = createLogger('components.Settings.AgentModelPreferencesSection')

const strategyOptions: Array<{
  value: AssistantModelSelectionStrategy
  label: string
  description: string
}> = [
  { value: 'balanced', label: '均衡', description: '综合质量、速度与费用' },
  { value: 'quality', label: '质量优先', description: '兼容时优先更高质量' },
  { value: 'speed', label: '速度优先', description: '兼容时优先更快模型' },
  { value: 'cost', label: '成本优先', description: '兼容时优先更低成本' },
]

function toList(value: string): string[] {
  return [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))]
}

function toText(value: string[]): string {
  return value.join(', ')
}

interface ModelListFieldsProps {
  title: string
  value: AssistantModelPreferences['preferredModels']
  onChange: (mediaType: 'image' | 'video' | 'audio', value: string[]) => void
}

function ModelListFields({ title, value, onChange }: ModelListFieldsProps): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-text-dark">{title}</div>
      {([
        ['image', '图片模型'],
        ['video', '视频模型'],
        ['audio', '音频模型'],
      ] as const).map(([mediaType, label]) => (
        <label key={mediaType} className="grid grid-cols-[76px_1fr] items-center gap-3 text-sm text-text-muted">
          <span>{label}</span>
          <UiInput
            key={`${mediaType}-${toText(value[mediaType])}`}
            defaultValue={toText(value[mediaType])}
            onBlur={(event) => onChange(mediaType, toList(event.target.value))}
            placeholder="填写通用模型标识，多个用逗号分隔"
          />
        </label>
      ))}
    </div>
  )
}

export default function AgentModelPreferencesSection(): JSX.Element {
  const [preferences, setPreferences] = useState<AssistantModelPreferences>(
    createDefaultAssistantModelPreferences()
  )
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('正在读取偏好…')

  const load = async (): Promise<void> => {
    setBusy(true)
    logger.info('读取智能助手模型偏好开始', {
      event: 'settings.agent_model_preferences.read.start',
    })
    try {
      setPreferences(await getAssistantModelPreferences())
      setStatus('偏好已加载；助手会在每次新任务开始时重新读取。')
      logger.info('读取智能助手模型偏好完成', {
        event: 'settings.agent_model_preferences.read.completed',
      })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '读取偏好失败')
      logger.error('读取智能助手模型偏好失败', error, {
        event: 'settings.agent_model_preferences.read.failed',
      })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const updateModelList = (
    field: 'preferredModels' | 'avoidedModels',
    mediaType: 'image' | 'video' | 'audio',
    values: string[]
  ): void => {
    setPreferences((current) => ({
      ...current,
      [field]: { ...current[field], [mediaType]: values },
    }))
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setStatus('正在保存…')
    logger.info('保存智能助手模型偏好开始', {
      event: 'settings.agent_model_preferences.save.start',
    })
    try {
      const saved = await updateAssistantModelPreferences({
        strategy: preferences.strategy,
        preferredProviders: preferences.preferredProviders,
        avoidedProviders: preferences.avoidedProviders,
        preferredModels: preferences.preferredModels,
        avoidedModels: preferences.avoidedModels,
        notes: preferences.notes,
      })
      setPreferences(saved)
      setStatus('已保存。新偏好会从下一次助手任务开始生效。')
      logger.info('保存智能助手模型偏好完成', {
        event: 'settings.agent_model_preferences.save.completed',
      })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存偏好失败')
      logger.error('保存智能助手模型偏好失败', error, {
        event: 'settings.agent_model_preferences.save.failed',
      })
    } finally {
      setBusy(false)
    }
  }

  const reset = async (): Promise<void> => {
    setBusy(true)
    try {
      setPreferences(await resetAssistantModelPreferences())
      setStatus('已恢复默认偏好。')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '重置偏好失败')
    } finally {
      setBusy(false)
    }
  }

  const openFile = async (): Promise<void> => {
    try {
      const filePath = await openAssistantModelPreferencesFile()
      setStatus(`已打开偏好文件：${filePath}。编辑保存后请点击“重新读取”。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '打开偏好文件失败')
    }
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="模型选择策略"
        description="当前明确要求始终优先；这些偏好只用于多个兼容模型之间的排序。"
        titleClassName="text-sm normal-case tracking-normal text-text-dark"
      >
        <div className="grid grid-cols-2 gap-2">
          {strategyOptions.map((option) => (
            <UiOptionButton
              key={option.value}
              type="button"
              active={preferences.strategy === option.value}
              variant="card"
              disabled={busy}
              className="flex-col items-start"
              onClick={() => setPreferences((current) => ({ ...current, strategy: option.value }))}
            >
              <span className="font-medium">{option.label}</span>
              <span className="mt-1 text-xs opacity-80">{option.description}</span>
            </UiOptionButton>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="供应商与模型"
        description="模型请填写中央描述目录使用的通用模型标识，不填写供应商模型 ID。"
        titleClassName="text-sm normal-case tracking-normal text-text-dark"
      >
        <div className="space-y-4">
          <label className="block space-y-2 text-sm text-text-muted">
            <span>偏好供应商</span>
            <UiInput
              key={`preferred-${toText(preferences.preferredProviders)}`}
              defaultValue={toText(preferences.preferredProviders)}
              onBlur={(event) => setPreferences((current) => ({
                ...current,
                preferredProviders: toList(event.target.value),
              }))}
              placeholder="例如：ppio, fal"
            />
          </label>
          <label className="block space-y-2 text-sm text-text-muted">
            <span>回避供应商</span>
            <UiInput
              key={`avoided-${toText(preferences.avoidedProviders)}`}
              defaultValue={toText(preferences.avoidedProviders)}
              onBlur={(event) => setPreferences((current) => ({
                ...current,
                avoidedProviders: toList(event.target.value),
              }))}
              placeholder="多个用逗号分隔"
            />
          </label>
          <ModelListFields
            title="偏好模型"
            value={preferences.preferredModels}
            onChange={(mediaType, values) => updateModelList('preferredModels', mediaType, values)}
          />
          <ModelListFields
            title="回避模型"
            value={preferences.avoidedModels}
            onChange={(mediaType, values) => updateModelList('avoidedModels', mediaType, values)}
          />
          <label className="block space-y-2 text-sm text-text-muted">
            <span>补充说明</span>
            <UiTextArea
              value={preferences.notes}
              rows={4}
              maxLength={4_000}
              onChange={(event) => setPreferences((current) => ({
                ...current,
                notes: event.target.value,
              }))}
              placeholder="例如：写实人像优先使用某个模型；临时要求请直接在当前对话说明。"
            />
          </label>
        </div>
      </SectionCard>

      <div className="flex flex-wrap items-center gap-2">
        <UiButton type="button" size="sm" variant="primary" disabled={busy} onClick={() => void save()}>
          <Save size={14} className="mr-1.5" />
          保存偏好
        </UiButton>
        <UiButton type="button" size="sm" variant="muted" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={14} className="mr-1.5" />
          重新读取
        </UiButton>
        <UiButton type="button" size="sm" variant="muted" disabled={busy} onClick={() => void openFile()}>
          <ExternalLink size={14} className="mr-1.5" />
          打开偏好文件
        </UiButton>
        <UiButton type="button" size="sm" variant="muted" disabled={busy} onClick={() => void reset()}>
          <RotateCcw size={14} className="mr-1.5" />
          恢复默认
        </UiButton>
      </div>
      <p className="break-all text-xs leading-5 text-text-muted">{status}</p>
    </div>
  )
}
