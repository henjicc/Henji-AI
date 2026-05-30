import { useEffect, useMemo, useState } from 'react'
import { clearLogEvents, getLogEvents, subscribeLogEvents, type LogEvent, type LogLevel } from '@/core/logging'
import { UiButton, UiInput, UiSelect } from '@/components/ui'

const LEVEL_OPTIONS: Array<{ value: 'all' | LogLevel; label: string }> = [
  { value: 'all', label: '全部级别' },
  { value: 'trace', label: 'TRACE' },
  { value: 'debug', label: 'DEBUG' },
  { value: 'info', label: 'INFO' },
  { value: 'warn', label: 'WARN' },
  { value: 'error', label: 'ERROR' },
]

const EVENT_DISPLAY_MAP: Record<string, { emoji: string; title: string }> = {
  'generation.generate.start': { emoji: '🚀', title: '开始生成任务' },
  'generation.generate.pending': { emoji: '⏳', title: '任务进入轮询' },
  'generation.generate.completed': { emoji: '✅', title: '生成完成' },
  'generation.generate.failed': { emoji: '❌', title: '生成失败' },
  'generation.continue_polling.start': { emoji: '🔄', title: '开始继续轮询' },
  'generation.continue_polling.completed': { emoji: '✅', title: '轮询完成' },
  'generation.continue_polling.failed': { emoji: '❌', title: '轮询失败' },
  'generation.cancel.start': { emoji: '🛑', title: '请求取消任务' },
  'generation.cancel.completed': { emoji: '🧹', title: '任务取消完成' },
  'generation.cancel.failed': { emoji: '❌', title: '任务取消失败' },
  'generation.runtime.trace': { emoji: '🧾', title: '运行时 API 追踪' },
  'ai_runtime.generate.start': { emoji: '🛰️', title: '后端开始生成' },
  'ai_runtime.generate.result': { emoji: '🛰️', title: '后端生成结果' },
  'ai_runtime.continue_polling.start': { emoji: '🛰️', title: '后端开始轮询' },
  'ai_runtime.continue_polling.result': { emoji: '🛰️', title: '后端轮询结果' },
  'ai_runtime.cancel.requested': { emoji: '🛰️', title: '后端收到取消请求' },
  'ai_runtime.cancel.completed': { emoji: '🛰️', title: '后端取消已完成' },
  'api.trace': { emoji: '🧾', title: '测试模式 API 追踪' },
  'llm_runtime.chat_stream.request_json': { emoji: '🧾', title: 'LLM 请求参数(JSON)' },
  'llm_runtime.chat_stream.failed': { emoji: '❌', title: 'LLM 请求失败' },
  'llm_runtime.chat_stream.invoke_failed': { emoji: '❌', title: 'LLM 请求调用失败' },
  'log.group': { emoji: '🧩', title: '日志分组' },
  'log.group_collapsed': { emoji: '🗂️', title: '折叠日志分组' },
  'log.group_end': { emoji: '📎', title: '日志分组结束' },
  'log.table': { emoji: '📋', title: '表格日志' },
}

function stringify(value: unknown): string {
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

function matchesKeyword(event: LogEvent, keyword: string): boolean {
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

function compactId(value: string | undefined): string {
  if (!value) {
    return ''
  }

  if (value.length <= 14) {
    return value
  }

  return `${value.slice(0, 8)}...${value.slice(-4)}`
}

function getLevelDisplay(level: LogLevel): { emoji: string; title: string } {
  if (level === 'error') {
    return { emoji: '❌', title: '错误事件' }
  }
  if (level === 'warn') {
    return { emoji: '⚠️', title: '警告事件' }
  }
  if (level === 'debug') {
    return { emoji: '🛠️', title: '调试事件' }
  }
  if (level === 'trace') {
    return { emoji: '🔍', title: '追踪事件' }
  }
  return { emoji: 'ℹ️', title: '信息事件' }
}

function getDomainHint(domain: string): string {
  if (domain.includes('GenerationService')) return '生成服务'
  if (domain.includes('workspaces.GenerationWorkspace')) return '生成工作区'
  if (domain.includes('ai_runtime')) return '后端运行时'
  if (domain.includes('upload')) return '上传流程'
  if (domain.includes('canvas')) return '画布模块'
  if (domain.includes('settings')) return '设置模块'
  if (domain.includes('testMode')) return '测试模式'
  if (domain.includes('commands')) return '命令桥'
  return domain
}

function getEventDisplay(event: LogEvent): { emoji: string; title: string; summary: string } {
  const preset = EVENT_DISPLAY_MAP[event.event]
  const fallback = getLevelDisplay(event.level)
  const summary = event.message?.trim().length ? event.message : event.event

  if (preset) {
    return {
      emoji: preset.emoji,
      title: preset.title,
      summary,
    }
  }

  if (event.domain.includes('upload')) {
    return {
      emoji: '📤',
      title: '上传相关事件',
      summary,
    }
  }

  if (event.domain.includes('canvas')) {
    return {
      emoji: '🎨',
      title: '画布相关事件',
      summary,
    }
  }

  if (event.domain.includes('workspaces')) {
    return {
      emoji: '🧱',
      title: '工作区事件',
      summary,
    }
  }

  return {
    emoji: fallback.emoji,
    title: fallback.title,
    summary,
  }
}

export function UnifiedLogViewer(): JSX.Element {
  const [events, setEvents] = useState<LogEvent[]>(() => getLogEvents())
  const [levelFilter, setLevelFilter] = useState<'all' | LogLevel>('all')
  const [domainFilter, setDomainFilter] = useState('all')
  const [requestIdFilter, setRequestIdFilter] = useState('')
  const [taskIdFilter, setTaskIdFilter] = useState('')
  const [modelIdFilter, setModelIdFilter] = useState('')
  const [providerIdFilter, setProviderIdFilter] = useState('')
  const [keyword, setKeyword] = useState('')
  const [selectedId, setSelectedId] = useState<string>('')

  useEffect(() => {
    return subscribeLogEvents((nextEvents) => {
      setEvents(nextEvents)
    })
  }, [])

  const domainOptions = useMemo(() => {
    const unique = Array.from(new Set(events.map((event) => event.domain))).sort()
    return ['all', ...unique]
  }, [events])

  const filteredEvents = useMemo(() => {
    const requestNeedle = requestIdFilter.trim().toLowerCase()
    const taskNeedle = taskIdFilter.trim().toLowerCase()
    const modelNeedle = modelIdFilter.trim().toLowerCase()
    const providerNeedle = providerIdFilter.trim().toLowerCase()

    return events
      .filter((event) => levelFilter === 'all' || event.level === levelFilter)
      .filter((event) => domainFilter === 'all' || event.domain === domainFilter)
      .filter((event) => !requestNeedle || (event.requestId || '').toLowerCase().includes(requestNeedle))
      .filter((event) => !taskNeedle || (event.taskId || '').toLowerCase().includes(taskNeedle))
      .filter((event) => !modelNeedle || (event.modelId || '').toLowerCase().includes(modelNeedle))
      .filter((event) => !providerNeedle || (event.providerId || '').toLowerCase().includes(providerNeedle))
      .filter((event) => matchesKeyword(event, keyword))
      .slice()
      .reverse()
  }, [
    domainFilter,
    events,
    keyword,
    levelFilter,
    modelIdFilter,
    providerIdFilter,
    requestIdFilter,
    taskIdFilter,
  ])

  useEffect(() => {
    if (filteredEvents.length === 0) {
      setSelectedId('')
      return
    }

    if (!selectedId || !filteredEvents.some((event) => event.id === selectedId)) {
      setSelectedId(filteredEvents[0].id)
    }
  }, [filteredEvents, selectedId])

  const selectedEvent = filteredEvents.find((event) => event.id === selectedId) || null

  const handleExport = (): void => {
    const payload = JSON.stringify(filteredEvents, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `henji-logs-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <UiSelect
          value={levelFilter}
          onChange={(event) => setLevelFilter(event.target.value as 'all' | LogLevel)}
          className="w-36"
        >
          {LEVEL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </UiSelect>
        <UiSelect
          value={domainFilter}
          onChange={(event) => setDomainFilter(event.target.value)}
          className="w-48"
        >
          {domainOptions.map((domain) => (
            <option key={domain} value={domain}>
              {domain === 'all' ? '全部域' : domain}
            </option>
          ))}
        </UiSelect>
        <UiInput
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="关键词筛选（message/context/error）"
          className="flex-1"
        />
        <UiButton type="button" size="sm" onClick={handleExport}>导出</UiButton>
        <UiButton type="button" size="sm" variant="ghost" onClick={() => clearLogEvents()}>清空</UiButton>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <UiInput
          value={requestIdFilter}
          onChange={(event) => setRequestIdFilter(event.target.value)}
          placeholder="requestId"
        />
        <UiInput
          value={taskIdFilter}
          onChange={(event) => setTaskIdFilter(event.target.value)}
          placeholder="taskId"
        />
        <UiInput
          value={modelIdFilter}
          onChange={(event) => setModelIdFilter(event.target.value)}
          placeholder="modelId"
        />
        <UiInput
          value={providerIdFilter}
          onChange={(event) => setProviderIdFilter(event.target.value)}
          placeholder="providerId"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="max-h-[340px] overflow-y-auto rounded-lg border border-zinc-700/50 bg-black/35">
          {filteredEvents.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-text-muted">暂无日志</div>
          ) : (
            filteredEvents.map((event) => (
              <button
                key={event.id}
                type="button"
                className={`w-full border-b border-zinc-700/40 px-3 py-2 text-left text-xs transition-colors ${
                  selectedId === event.id ? 'bg-brand-600/30 text-text-dark' : 'hover:bg-zinc-700/30 text-text-muted'
                }`}
                onClick={() => setSelectedId(event.id)}
              >
                {(() => {
                  const display = getEventDisplay(event)
                  return (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-text-dark">
                          {display.emoji} {display.title}
                        </span>
                        <span className="text-[11px] uppercase tracking-wide opacity-70">{event.level}</span>
                      </div>
                      <div className="mt-1 truncate text-[11px] opacity-80">{getDomainHint(event.domain)}</div>
                      <div className="mt-1 truncate text-text-dark">{display.summary}</div>
                    </>
                  )
                })()}
                <div className="flex items-center justify-between gap-2">
                  <span className="mt-1 text-[11px] opacity-70">{new Date(event.timestamp).toLocaleTimeString('zh-CN')}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] opacity-70">
                  <span>类型:{event.event}</span>
                  {event.requestId ? <span>req:{compactId(event.requestId)}</span> : null}
                  {event.taskId ? <span>task:{compactId(event.taskId)}</span> : null}
                  {event.modelId ? <span>model:{event.modelId}</span> : null}
                  {event.providerId ? <span>provider:{event.providerId}</span> : null}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="max-h-[340px] overflow-y-auto rounded-lg border border-zinc-700/50 bg-black/35 p-3 text-xs text-text-dark">
          {selectedEvent ? (
            <>
              <div className="mb-3 rounded-md border border-zinc-700/40 bg-zinc-900/40 p-2">
                <div className="text-sm text-text-dark">
                  {getEventDisplay(selectedEvent).emoji} {getEventDisplay(selectedEvent).title}
                </div>
                <div className="mt-1 text-[11px] text-text-muted">
                  {getDomainHint(selectedEvent.domain)} · {new Date(selectedEvent.timestamp).toLocaleString('zh-CN')}
                </div>
              </div>
              <pre className="whitespace-pre-wrap break-all">{JSON.stringify(selectedEvent, null, 2)}</pre>
            </>
          ) : (
            <div className="text-text-muted">请选择左侧日志查看详情</div>
          )}
        </div>
      </div>
    </div>
  )
}
