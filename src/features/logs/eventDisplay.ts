import type { LogEventPushDto } from '@/commands/logging'
import {
  Ban,
  Brain,
  CircleCheck,
  CircleX,
  Download,
  Eraser,
  FileJson,
  FolderTree,
  Hourglass,
  Info,
  LayoutGrid,
  Palette,
  Paperclip,
  Puzzle,
  RefreshCw,
  Rocket,
  Satellite,
  Scissors,
  Search,
  Table,
  TriangleAlert,
  Upload,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

/**
 * 日志窗口展示用的事件形状：在主进程推送的 `LogEventPushDto` 基础上加一个渲染层本地 id
 * （用于列表 key/选中态），不改变字段语义。`logStore.ts` 负责补齐 id。
 */
export interface DisplayLogEvent extends LogEventPushDto {
  id: string
}

export type LogLevel = DisplayLogEvent['level']

/**
 * 事件类型 → 展示图标（lucide）与文案字典，从旧 `UnifiedLogViewer.tsx` 迁移（1.2/1.3 新增的事件已补齐）。
 * 未命中时按 domain/level 走兜底展示（见 `getEventDisplay`）。
 */
const EVENT_DISPLAY_MAP: Record<string, { icon: LucideIcon; title: string }> = {
  'generation.generate.start': { icon: Rocket, title: '开始生成任务' },
  'generation.generate.pending': { icon: Hourglass, title: '任务进入轮询' },
  'generation.generate.completed': { icon: CircleCheck, title: '生成完成' },
  'generation.generate.failed': { icon: CircleX, title: '生成失败' },
  'generation.continue_polling.start': { icon: RefreshCw, title: '开始继续轮询' },
  'generation.continue_polling.completed': { icon: CircleCheck, title: '轮询完成' },
  'generation.continue_polling.failed': { icon: CircleX, title: '轮询失败' },
  'generation.cancel.start': { icon: Ban, title: '请求取消任务' },
  'generation.cancel.completed': { icon: Eraser, title: '任务取消完成' },
  'generation.cancel.failed': { icon: CircleX, title: '任务取消失败' },
  'generation.runtime.request_json': { icon: FileJson, title: '生成请求参数(JSON)' },
  'generation.runtime.response_json': { icon: Download, title: '生成 API 原始响应(JSON)' },
  'generation.runtime.trace': { icon: FileJson, title: '运行时 API 追踪' },
  'ai_runtime.generate.start': { icon: Satellite, title: '后端开始生成' },
  'ai_runtime.generate.result': { icon: Satellite, title: '后端生成结果' },
  'ai_runtime.generate.failed': { icon: CircleX, title: '后端生成失败' },
  'ai_runtime.continue_polling.start': { icon: Satellite, title: '后端开始轮询' },
  'ai_runtime.continue_polling.result': { icon: Satellite, title: '后端轮询结果' },
  'ai_runtime.cancel.requested': { icon: Satellite, title: '后端收到取消请求' },
  'ai_runtime.cancel.completed': { icon: Satellite, title: '后端取消已完成' },
  'api.trace': { icon: FileJson, title: '测试模式 API 追踪' },
  'llm_runtime.chat_stream.request_json': { icon: FileJson, title: 'LLM 请求参数(JSON)' },
  'llm_runtime.chat_stream.response_json': { icon: Download, title: 'LLM 响应内容(JSON)' },
  'llm_runtime.chat_stream.failed': { icon: CircleX, title: 'LLM 请求失败' },
  'llm_runtime.chat_stream.invoke_failed': { icon: CircleX, title: 'LLM 请求调用失败' },
  'agent_trace.step.started': { icon: Brain, title: '助手模型追踪开始' },
  'agent_trace.step.completed': { icon: CircleCheck, title: '助手模型追踪完成' },
  'agent_trace.step.failed': { icon: CircleX, title: '助手模型追踪失败' },
  'log.group': { icon: Puzzle, title: '日志分组' },
  'log.group_collapsed': { icon: FolderTree, title: '折叠日志分组' },
  'log.group_end': { icon: Paperclip, title: '日志分组结束' },
  'log.table': { icon: Table, title: '表格日志' },
}

function stringify(value: DynamicValue): string {
  if (value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function matchesKeyword(event: DisplayLogEvent, keyword: string): boolean {
  if (!keyword) {
    return true
  }

  const target = keyword.toLowerCase()
  const fields = [
    event.domain,
    event.event,
    event.message,
    event.requestId || '',
    event.taskId || '',
    event.modelId || '',
    event.providerId || '',
    stringify(event.context),
    stringify(event.error),
  ]

  return fields.some((field) => field.toLowerCase().includes(target))
}

export function compactId(value: string | undefined): string {
  if (!value) {
    return ''
  }

  if (value.length <= 14) {
    return value
  }

  return `${value.slice(0, 8)}...${value.slice(-4)}`
}

function getLevelDisplay(level: LogLevel): { icon: LucideIcon; title: string } {
  if (level === 'error') {
    return { icon: CircleX, title: '错误事件' }
  }
  if (level === 'warn') {
    return { icon: TriangleAlert, title: '警告事件' }
  }
  if (level === 'debug') {
    return { icon: Wrench, title: '调试事件' }
  }
  if (level === 'trace') {
    return { icon: Search, title: '追踪事件' }
  }
  return { icon: Info, title: '信息事件' }
}

export function getDomainHint(domain: string): string {
  if (domain.includes('GenerationService')) return '生成服务'
  if (domain.includes('workspaces.GenerationWorkspace')) return '生成工作区'
  if (domain.includes('ai_runtime') || domain.includes('ai-runtime')) return '后端运行时'
  if (domain.includes('llm-runtime') || domain.includes('llmRuntime')) return 'LLM 运行时'
  if (domain.includes('upload')) return '上传流程'
  if (domain.includes('canvas')) return '画布模块'
  if (domain.includes('settings')) return '设置模块'
  if (domain.includes('testMode')) return '测试模式'
  if (domain.includes('commands')) return '命令桥'
  return domain
}

export function getEventDisplay(event: DisplayLogEvent): { icon: LucideIcon; title: string; summary: string } {
  const preset = EVENT_DISPLAY_MAP[event.event]
  const fallback = getLevelDisplay(event.level)
  const summary = event.message?.trim().length ? event.message : event.event

  if (event.truncatedByLimit) {
    return { icon: Scissors, title: '事件已截断（超出体积限制）', summary }
  }

  if (preset) {
    return {
      icon: preset.icon,
      title: preset.title,
      summary,
    }
  }

  if (event.domain.includes('upload')) {
    return { icon: Upload, title: '上传相关事件', summary }
  }

  if (event.domain.includes('canvas')) {
    return { icon: Palette, title: '画布相关事件', summary }
  }

  if (event.domain.includes('workspaces')) {
    return { icon: LayoutGrid, title: '工作区事件', summary }
  }

  return {
    icon: fallback.icon,
    title: fallback.title,
    summary,
  }
}
