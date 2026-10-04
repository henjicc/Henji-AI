import { useEffect, useState, type ReactNode } from 'react'
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Copy,
  GitCompare,
  PanelsTopLeft,
  TerminalSquare,
} from 'lucide-react'

import { UiButton, UiEmpty, UiLoading, UiOptionButton, UI_INSET_SURFACE_CLASS, UI_SEGMENTED_TRACK_CLASS } from '@/components/ui'
import type { AgentTraceDetailResult } from '@/core/assistant/trace'
import type { ModelStepMessage } from '@henjicc/ai-sdk'
import { copyTextToClipboard } from '../copyFormats'
import { buildTraceCurl, formatTraceDuration, formatTraceTokens, getTraceStepLabel } from '../assistantTraceUtils'
import { JsonTree } from './JsonTree'

type DetailMode = 'visual' | 'json'
type CopyTarget = 'logical' | 'http' | 'curl' | 'all'

interface AssistantTraceDetailProps {
  result: AgentTraceDetailResult | null
  loading: boolean
  canCompare: boolean
  onCompare: () => void
}

export function AssistantTraceDetail({
  result,
  loading,
  canCompare,
  onCompare,
}: AssistantTraceDetailProps): JSX.Element {
  const [mode, setMode] = useState<DetailMode>('visual')
  const [copied, setCopied] = useState<CopyTarget | null>(null)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(null), 1_500)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (!result) {
    return (
      <div className="h-full rounded-lg bg-panel p-3">
        {loading
          ? <UiLoading className="h-full" size="sm" message="正在加载追踪详情…" />
          : <UiEmpty className="h-full" size="sm" title="请选择左侧的一轮模型请求" />}
      </div>
    )
  }

  const { summary, detail } = result

  async function handleCopy(target: CopyTarget): Promise<void> {
    if (!detail) return
    let text = JSON.stringify(detail, null, 2)
    if (target === 'logical') text = JSON.stringify(detail.logicalRequest, null, 2)
    if (target === 'http') text = JSON.stringify(detail.httpRequest ?? null, null, 2)
    if (target === 'curl') text = buildTraceCurl(detail)
    await copyTextToClipboard(text)
    setCopied(target)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg bg-panel">
      <div className="shrink-0 border-b border-line/40 bg-panel/70 px-3 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-text1">{getTraceStepLabel(summary)}</span>
              <span className="rounded bg-window/40 px-1.5 py-0.5 font-mono text-2xs text-text2">
                {summary.providerId}/{summary.modelId}
              </span>
              <span className={`rounded px-1.5 py-0.5 text-2xs ${statusClass(summary.status)}`}>
                {statusLabel(summary.status)}
              </span>
            </div>
            <div className="mt-1 font-mono text-2xs text-text2">
              {summary.stepId} · {new Date(summary.startedAt).toLocaleString('zh-CN')}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className={UI_SEGMENTED_TRACK_CLASS}>
              <UiOptionButton type="button" variant="segment" active={mode === 'visual'} aria-pressed={mode === 'visual'} onClick={() => setMode('visual')}>
                <PanelsTopLeft className="mr-1 h-3.5 w-3.5" />可视化
              </UiOptionButton>
              <UiOptionButton type="button" variant="segment" active={mode === 'json'} aria-pressed={mode === 'json'} onClick={() => setMode('json')}>
                <Braces className="mr-1 h-3.5 w-3.5" />原始 JSON
              </UiOptionButton>
            </div>
            <UiButton type="button" variant="secondary" disabled={!canCompare} onClick={onCompare}>
              <GitCompare className="mr-1 h-3.5 w-3.5" />对比上轮
            </UiButton>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-8">
          <Metric label="输入" value={`${formatTraceTokens(summary.usage.inputTokens)} tok`} />
          <Metric label="输出" value={`${formatTraceTokens(summary.usage.outputTokens)} tok`} />
          <Metric label="推理" value={`${formatTraceTokens(summary.usage.reasoningTokens)} tok`} />
          <Metric label="缓存读取" value={`${formatTraceTokens(summary.usage.cacheReadTokens)} tok`} />
          <Metric label="总计" value={`${formatTraceTokens(summary.usage.totalTokens)} tok`} />
          <Metric label="耗时" value={formatTraceDuration(summary.elapsedMs)} />
          <Metric label="结束原因" value={summary.finishReason ?? '—'} />
          <Metric label="详情" value={summary.hasDetail ? formatBytes(summary.detailBytes) : '仅摘要'} />
        </div>
        {detail && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <CopyButton label="逻辑请求" copied={copied === 'logical'} onClick={() => handleCopy('logical')} />
            <CopyButton label="HTTP 请求" copied={copied === 'http'} onClick={() => handleCopy('http')} disabled={!detail.httpRequest} />
            <CopyButton label="脱敏 cURL" copied={copied === 'curl'} onClick={() => handleCopy('curl')} disabled={!detail.httpRequest} icon="terminal" />
            <CopyButton label="完整追踪" copied={copied === 'all'} onClick={() => handleCopy('all')} />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!detail ? (
          <div className="rounded-md border border-warning-text/30 bg-warning-tint p-3 text-xs text-warning-text">
            这一轮只保存了摘要。开启“助手详细追踪”后，新请求才会保存完整上下文和 HTTP 请求。
          </div>
        ) : mode === 'json' ? (
          <JsonTree value={detail} />
        ) : (
          <TraceVisualDetail detail={detail} />
        )}
      </div>
    </div>
  )
}

function TraceVisualDetail({ detail }: { detail: NonNullable<AgentTraceDetailResult['detail']> }): JSX.Element {
  const context = detail.logicalRequest.context
  const tools = Array.isArray(detail.logicalRequest.tools) ? detail.logicalRequest.tools : []
  const response = detail.response
  return (
    <div className="space-y-2">
      {detail.capture.truncated && (
        <div className="rounded-md border border-warning-text/30 bg-warning-tint p-2 text-2xs text-warning-text">
          该追踪已按体积限制截断：原始 {formatBytes(detail.capture.originalBytes)}，保存 {formatBytes(detail.capture.storedBytes)}；
          受影响区块：{detail.capture.sections.join('、') || '部分长内容'}。
        </div>
      )}
      <TraceSection title="上下文概览" badge={context?.estimatedTokens ? `${formatTraceTokens(context.estimatedTokens)} tok` : undefined} defaultOpen>
        <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="上下文预算" value={formatTraceTokens(context?.contextWindowBudget)} />
          <Metric label="预计上下文" value={formatTraceTokens(context?.estimatedTokens)} />
          <Metric label="最大输出" value={formatTraceTokens(context?.maxOutputTokens)} />
          <Metric label="压缩状态" value={context?.compacted ? '已压缩' : '未压缩'} />
        </div>
        {context?.layerReports && context.layerReports.length > 0 && (
          <div className="mt-2 overflow-hidden rounded border border-line/40">
            {context.layerReports.map((layer) => (
              <div key={layer.id} className="grid grid-cols-[110px_70px_80px_minmax(0,1fr)] gap-2 border-b border-line/30 px-2 py-1.5 text-2xs last:border-b-0">
                <span className="font-mono text-text1">{layer.id}</span>
                <span className={layer.included ? 'text-success-text' : 'text-text2'}>{layer.included ? '已注入' : '未注入'}</span>
                <span className="font-mono text-text2">{formatTraceTokens(layer.estimatedTokens)}</span>
                <span className="truncate text-text2" title={layer.reason}>{layer.reason}</span>
              </div>
            ))}
          </div>
        )}
      </TraceSection>

      <TraceSection title="系统提示词" badge={`${detail.logicalRequest.system?.length ?? 0} 字符`} defaultOpen>
        <TextBlock value={detail.logicalRequest.system || '未设置 system prompt'} />
      </TraceSection>

      <TraceSection title="消息" badge={`${detail.logicalRequest.messages.length} 条`} defaultOpen>
        <div className="space-y-2">
          {detail.logicalRequest.messages.map((message, index) => (
            <MessageCard key={`${message.role}-${index}`} message={message} index={index} />
          ))}
        </div>
      </TraceSection>

      <TraceSection title="工具定义" badge={`${tools.length} 个`}>
        {tools.length === 0 ? <UiEmpty size="xs" title="本轮没有向模型提供工具" /> : <JsonTree value={tools} />}
      </TraceSection>

      <TraceSection title="最终 HTTP 请求" badge={detail.httpRequest ? detail.httpRequest.method : '未捕获'} defaultOpen>
        {detail.httpRequest ? (
          <div className="space-y-2">
            <div className="grid gap-2 text-xs md:grid-cols-[100px_minmax(0,1fr)]">
              <span className="text-text2">请求方法</span><span className="font-mono text-text1">{detail.httpRequest.method}</span>
              <span className="text-text2">最终地址</span><span className="break-all font-mono text-text1">{detail.httpRequest.url}</span>
            </div>
            <JsonTree value={{ headers: detail.httpRequest.headers, body: detail.httpRequest.body }} />
          </div>
        ) : <UiEmpty size="xs" title="没有捕获到最终网络请求" />}
      </TraceSection>

      <TraceSection title="模型响应" badge={response?.finishReason} defaultOpen>
        {!response ? <UiEmpty size="xs" title="该请求没有完整响应" /> : (
          <div className="space-y-2">
            {response.reasoningText && <LabeledBlock label="供应商返回的推理内容"><TextBlock value={response.reasoningText} /></LabeledBlock>}
            <LabeledBlock label="最终文本"><TextBlock value={response.text || '无文本输出'} /></LabeledBlock>
            {response.toolCalls.length > 0 && <LabeledBlock label={`工具调用（${response.toolCalls.length}）`}><JsonTree value={response.toolCalls} /></LabeledBlock>}
            {response.structuredOutput !== null && <LabeledBlock label="结构化输出"><JsonTree value={response.structuredOutput} /></LabeledBlock>}
            {response.warnings.length > 0 && <LabeledBlock label="供应商警告"><JsonTree value={response.warnings} /></LabeledBlock>}
          </div>
        )}
      </TraceSection>

      <TraceSection title="流式过程与响应元数据" badge={detail.stream?.firstChunkMs != null ? `首块 ${detail.stream.firstChunkMs}ms` : undefined}>
        <JsonTree value={{ stream: detail.stream, httpResponse: detail.httpResponse, providerMetadata: response?.providerMetadataSummary }} />
      </TraceSection>

      {detail.error && <TraceSection title="错误" badge={detail.error.code ?? detail.error.name} defaultOpen><JsonTree value={detail.error} /></TraceSection>}
    </div>
  )
}

function TraceSection({ title, badge, defaultOpen = false, children }: { title: string; badge?: string; defaultOpen?: boolean; children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`overflow-hidden rounded-lg ${UI_INSET_SURFACE_CLASS}`}>
      <UiButton type="button" size="lg" className="w-full justify-between" onClick={() => setOpen(!open)}>
        <span className="flex items-center gap-2 text-xs font-medium text-text1">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {title}
        </span>
        {badge && <span className="rounded bg-window/40 px-1.5 py-0.5 font-mono text-2xs text-text2">{badge}</span>}
      </UiButton>
      {open && <div className="border-t border-line/35 p-3">{children}</div>}
    </section>
  )
}

function MessageCard({ message, index }: { message: ModelStepMessage; index: number }): JSX.Element {
  return (
    <div className={`overflow-hidden rounded-md border ${roleClass(message.role)}`}>
      <div className="flex items-center justify-between border-b border-inherit px-2 py-1 text-2xs font-semibold uppercase tracking-wider">
        <span>{message.role}</span><span className="font-mono">#{index + 1}</span>
      </div>
      <div className="bg-window/40 p-2 text-xs text-text1">
        {typeof message.content === 'string' ? <TextBlock value={message.content} /> : <JsonTree value={message.content} />}
      </div>
    </div>
  )
}

/** 读数格：内嵌下沉面（无描边），任务 5.7 去掉 4.1 遗留的描边。 */
function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className={`rounded-md px-2 py-1.5 ${UI_INSET_SURFACE_CLASS}`}><div className="text-2xs uppercase tracking-wider text-text2">{label}</div><div className="mt-0.5 truncate font-mono text-2xs text-text1" title={value}>{value}</div></div>
}

function CopyButton({ label, copied, disabled, onClick, icon = 'copy' }: { label: string; copied: boolean; disabled?: boolean; onClick: () => void; icon?: 'copy' | 'terminal' }): JSX.Element {
  const Icon = icon === 'terminal' ? TerminalSquare : Copy
  return <UiButton type="button" variant="secondary" disabled={disabled} onClick={onClick}><Icon className="mr-1 h-3.5 w-3.5" />{copied ? '已复制' : label}</UiButton>
}

function LabeledBlock({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return <div><div className="mb-1 text-2xs font-medium uppercase tracking-wider text-text2">{label}</div>{children}</div>
}

function TextBlock({ value }: { value: string }): JSX.Element {
  return <pre className={`max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md p-2 font-mono text-2xs leading-relaxed ${UI_INSET_SURFACE_CLASS}`}>{value}</pre>
}

function roleClass(role: ModelStepMessage['role']): string {
  if (role === 'system') return 'border-warning-text/35 text-warning-text'
  if (role === 'user') return 'border-accent-text/35 text-accent-text'
  if (role === 'assistant') return 'border-success-text/35 text-success-text'
  return 'border-line-strong text-text2'
}

function statusClass(status: AgentTraceDetailResult['summary']['status']): string {
  if (status === 'completed') return 'bg-success-tint text-success-text'
  if (status === 'running') return 'bg-accent-tint text-accent-text'
  if (status === 'failed') return 'bg-danger-tint text-danger-text'
  return 'bg-warning-tint text-warning-text'
}

function statusLabel(status: AgentTraceDetailResult['summary']['status']): string {
  if (status === 'completed') return '已完成'
  if (status === 'running') return '运行中'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  return '已中断'
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MiB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${value} B`
}
