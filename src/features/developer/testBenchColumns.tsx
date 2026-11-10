import React, { useMemo, useState } from 'react'
import { Copy, Play, ScrollText, Square, X } from 'lucide-react'
import ParameterPanel from '@/components/MediaGenerator/components/ParameterPanel'
import PriceEstimate from '@/components/ui/PriceEstimate'
import { ProgressBar } from '@/components/ui/ProgressBar'
import {
  UI_TEXT_META_CLASS,
  UI_TEXT_SECONDARY_CLASS,
  UI_TEXT_TIMECODE_CLASS,
  UiButton,
  UiGroup,
  UiIconButton,
  UiInlineStatus,
  UiPanel,
} from '@/components/ui'
import { writeClipboardText } from '@/commands/clipboard'
import { openLogWindow } from '@/commands/logging'
import { registry } from '@/core/ModelRegistry'
import { resolveImageDisplayUrl, toFetchableMediaUrl } from '@/services/imageSource'
import { sdkProviderName, type SdkModelRow } from './sdkModelInventory'
import type { GenerationTestResult, LlmTestResult, TextTestResult } from './modelTestRunner'

type RunStatus = 'idle' | 'running' | 'done' | 'failed' | 'stopped'

export interface GenerationRun {
  status: RunStatus
  progress?: number
  message?: string
  result?: GenerationTestResult
  error?: string
}

export interface LlmRun {
  status: RunStatus
  output: string
  reasoning: string
  result?: LlmTestResult
  error?: string
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} 秒`

const ColumnHeader: React.FC<{
  row: SdkModelRow
  running: boolean
  price?: React.ReactNode
  onRun: () => void
  onStop: () => void
  onRemove: () => void
}> = ({ row, running, price, onRun, onStop, onRemove }) => (
  <div className="flex items-start gap-2 border-b border-line px-4 py-3">
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="truncate font-medium">{row.name}</span>
      <span className={`truncate ${UI_TEXT_META_CLASS}`}>{sdkProviderName(row.providerId)}{price ? <> · {price}</> : null}</span>
    </div>
    {running
      ? <UiIconButton size="sm" tooltip="停止这一列" aria-label="停止" onClick={onStop}><Square /></UiIconButton>
      : <UiIconButton size="sm" tooltip="只运行这一列" aria-label="运行" onClick={onRun} data-test-bench-run={row.key}><Play /></UiIconButton>}
    <UiIconButton size="sm" tooltip="移出测试台" aria-label="移出测试台" onClick={onRemove}><X /></UiIconButton>
  </div>
)

/** 整页里是一列带列头的竖条；嵌在模型详情里时只留内容，由外层负责滚动 */
const BenchColumn: React.FC<{
  embedded?: boolean
  row: SdkModelRow
  status: RunStatus
  header: React.ReactNode
  gap?: 'gap-3' | 'gap-5'
  children: React.ReactNode
}> = ({ embedded, row, status, header, gap = 'gap-3', children }) => embedded
  ? <section className={`flex flex-col ${gap}`} aria-label={row.name} data-test-bench-column={row.key} data-run-status={status}>{children}</section>
  : (
    <section className="flex w-96 shrink-0 flex-col border-r border-line" aria-label={row.name} data-test-bench-column={row.key} data-run-status={status}>
      {header}
      <div className={`flex min-h-0 flex-1 flex-col ${gap} overflow-y-auto p-4`}>{children}</div>
    </section>
  )

const RunFooter: React.FC<{ requestId?: string; summary?: string }> = ({ requestId, summary }) => (
  <div className={`flex items-center gap-1 ${UI_TEXT_META_CLASS}`}>
    <span className={`min-w-0 flex-1 truncate ${UI_TEXT_TIMECODE_CLASS}`}>{summary}</span>
    {requestId ? <>
      <UiIconButton size="xs" tooltip={`复制请求标识 ${requestId}，在日志里按它查整条链路`} aria-label="复制请求标识" onClick={() => void writeClipboardText(requestId)}><Copy /></UiIconButton>
      <UiIconButton size="xs" tooltip="打开日志" aria-label="打开日志" onClick={() => void openLogWindow()}><ScrollText /></UiIconButton>
    </> : null}
  </div>
)

const StatusLine: React.FC<{ status: RunStatus; error?: string; message?: string }> = ({ status, error, message }) => {
  if (status === 'failed') return <UiInlineStatus tone="error">{error}</UiInlineStatus>
  if (status === 'stopped') return <UiInlineStatus tone="warning">已停止</UiInlineStatus>
  if (status === 'running') return <span className={UI_TEXT_META_CLASS}>{message || '运行中…'}</span>
  return null
}

const GenerationOutput: React.FC<{ type: string; result: GenerationTestResult }> = ({ type, result }) => {
  const sources = (result.filePaths.length ? result.filePaths : result.urls).filter(Boolean)
  if (!sources.length) return <span className={UI_TEXT_META_CLASS}>没有返回结果文件</span>
  return (
    <div className="flex flex-col gap-2">
      {sources.map((source) => type === 'video'
        ? <video key={source} src={toFetchableMediaUrl(source)} controls className="w-full rounded-lg bg-media" />
        : type === 'audio'
          ? <audio key={source} src={toFetchableMediaUrl(source)} controls className="w-full" />
          : <img key={source} src={resolveImageDisplayUrl(source)} alt="" className="w-full rounded-lg bg-media object-contain" />)}
    </div>
  )
}

export const GenerationTestColumn: React.FC<{
  embedded?: boolean
  row: SdkModelRow
  params: DynamicValueMap
  run: GenerationRun | undefined
  onParamsChange: (changes: DynamicValueMap) => void
  onRun: () => void
  onStop: () => void
  onRemove: () => void
}> = ({ embedded, row, params, run, onParamsChange, onRun, onStop, onRemove }) => {
  const type = registry.getModel(row.modelId)?.meta.type ?? 'image'
  const status = run?.status ?? 'idle'
  return (
    <BenchColumn embedded={embedded} row={row} status={status} gap="gap-5"
      header={<ColumnHeader row={row} running={status === 'running'} onRun={onRun} onStop={onStop} onRemove={onRemove}
        price={<PriceEstimate variant="badge" providerId={row.providerId} modelId={row.modelId} params={params} />} />}>
        <UiGroup title="参数" titleTone="compact">
          <ParameterPanel
            currentModel={null}
            selectedModel={row.modelId}
            uploadedImages={[]}
            uploadedVideos={[]}
            values={params}
            onChange={(id, value) => onParamsChange({ [id]: value })}
            onChanges={onParamsChange}
          />
        </UiGroup>
        <UiGroup title="结果" titleTone="compact" divided>
          {status === 'running' && run?.progress !== undefined ? <ProgressBar progress={run.progress} appearance="hairline" /> : null}
          <StatusLine status={status} error={run?.error} message={run?.message} />
          {run?.result ? <GenerationOutput type={type} result={run.result} /> : status === 'idle' ? <span className={UI_TEXT_META_CLASS}>还没运行</span> : null}
          {run?.result ? <RunFooter requestId={run.result.requestId} summary={`用时 ${seconds(run.result.elapsedMs)} · ${run.result.filePaths.length || run.result.urls.length} 个结果`} /> : null}
        </UiGroup>
    </BenchColumn>
  )
}

export const LlmTestColumn: React.FC<{
  embedded?: boolean
  row: SdkModelRow
  run: LlmRun | undefined
  runnable: string | null
  onRun: () => void
  onStop: () => void
  onRemove: () => void
}> = ({ embedded, row, run, runnable, onRun, onStop, onRemove }) => {
  const [showReasoning, setShowReasoning] = useState(false)
  const status = run?.status ?? 'idle'
  const metrics = useMemo(() => {
    const result = run?.result
    if (!result) return null
    return [
      result.firstTokenMs === null ? null : `首字 ${seconds(result.firstTokenMs)}`,
      result.outputTokensPerSecond === null ? null : `${result.outputTokensPerSecond.toFixed(1)} token/秒`,
      result.inputTokens === null && result.outputTokens === null ? null : `输入 ${result.inputTokens ?? '—'} / 输出 ${result.outputTokens ?? '—'} token`,
      `总用时 ${seconds(result.elapsedMs)}`,
    ].filter(Boolean).join(' · ')
  }, [run?.result])
  return (
    <BenchColumn embedded={embedded} row={row} status={status}
      header={<ColumnHeader row={row} running={status === 'running'} onRun={onRun} onStop={onStop} onRemove={onRemove} />}>
        {runnable ? <UiInlineStatus tone="warning">{runnable}</UiInlineStatus> : null}
        <StatusLine status={status} error={run?.error} />
        {metrics ? <span className={`${UI_TEXT_SECONDARY_CLASS} ${UI_TEXT_TIMECODE_CLASS}`} data-llm-metrics="">{metrics}</span> : null}
        {run?.reasoning ? (
          <div className="flex flex-col gap-1">
            <UiButton size="sm" onClick={() => setShowReasoning((value) => !value)}>{showReasoning ? '收起思考' : `思考过程 · ${run.reasoning.length} 字`}</UiButton>
            {showReasoning ? <UiPanel variant="inset" className="p-3"><p className={`whitespace-pre-wrap ${UI_TEXT_META_CLASS}`}>{run.reasoning}</p></UiPanel> : null}
          </div>
        ) : null}
        {run?.output ? <p className="whitespace-pre-wrap break-words" data-llm-output="">{run.output}</p> : status === 'idle' ? <span className={UI_TEXT_META_CLASS}>还没运行</span> : null}
        {run?.result ? <RunFooter requestId={run.result.requestId} /> : null}
    </BenchColumn>
  )
}

export interface TextRun {
  status: RunStatus
  result?: TextTestResult
  error?: string
}

/** 语音识别与翻译：结果都是一段文字，并排看差异 */
export const TextTestColumn: React.FC<{
  embedded?: boolean
  row: SdkModelRow
  run: TextRun | undefined
  runnable: string | null
  onRun: () => void
  onStop: () => void
  onRemove: () => void
}> = ({ embedded, row, run, runnable, onRun, onStop, onRemove }) => {
  const status = run?.status ?? 'idle'
  const result = run?.result
  return (
    <BenchColumn embedded={embedded} row={row} status={status}
      header={<ColumnHeader row={row} running={status === 'running'} onRun={onRun} onStop={onStop} onRemove={onRemove} />}>
        {runnable ? <UiInlineStatus tone="warning">{runnable}</UiInlineStatus> : null}
        <StatusLine status={status} error={run?.error} />
        {result ? <p className="whitespace-pre-wrap break-words" data-text-output="">{result.text || '（空）'}</p> : status === 'idle' && !runnable ? <span className={UI_TEXT_META_CLASS}>还没运行</span> : null}
        {result ? <RunFooter requestId={result.requestId} summary={`用时 ${seconds(result.elapsedMs)} · ${result.text.length} 字${result.segments ? ` · ${result.segments} 段` : ''}`} /> : null}
    </BenchColumn>
  )
}
