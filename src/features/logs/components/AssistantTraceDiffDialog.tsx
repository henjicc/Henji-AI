import type { ReactNode } from 'react'
import { UiEmpty, UiLoading, UiModal } from '@/components/ui'
import type { AgentTraceDiff } from '../assistantTraceUtils'
import { formatTraceTokens } from '../assistantTraceUtils'
import { JsonTree } from './JsonTree'

interface AssistantTraceDiffDialogProps {
  isOpen: boolean
  onClose: () => void
  title: string
  diff: AgentTraceDiff | null
  loading: boolean
}

export function AssistantTraceDiffDialog({
  isOpen,
  onClose,
  title,
  diff,
  loading,
}: AssistantTraceDiffDialogProps): JSX.Element {
  return (
    <UiModal isOpen={isOpen} onClose={onClose} title={title} widthClassName="w-[min(1120px,94vw)]" contentClassName="max-h-[78vh] overflow-y-auto">
      {loading ? (
        <UiLoading size="sm" message="正在计算相邻轮次差异…" />
      ) : !diff ? (
        <UiEmpty size="sm" title="无法对比" description="上一轮或当前轮次没有保存详细追踪。" />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <DeltaMetric label="输入 Token" value={diff.tokenDelta.input} />
            <DeltaMetric label="输出 Token" value={diff.tokenDelta.output} />
            <DeltaMetric label="推理 Token" value={diff.tokenDelta.reasoning} />
            <DeltaMetric label="总 Token" value={diff.tokenDelta.total} />
          </div>

          <DiffBlock
            title="消息变化"
            badge={`${diff.messages.unchangedPrefix} 条前缀、${diff.messages.unchangedSuffix} 条后缀未变化`}
          >
            <div className="grid gap-2 md:grid-cols-3">
              <ChangeList title="新增" values={diff.messages.added.map((message) => `${message.role}: ${messageSummary(message.content)}`)} tone="added" />
              <ChangeList title="删除" values={diff.messages.removed.map((message) => `${message.role}: ${messageSummary(message.content)}`)} tone="removed" />
              <ChangeList title="修改" values={diff.messages.changed.map((item) => `消息 #${item.index + 1}`)} tone="changed" />
            </div>
            {diff.messages.changed.length > 0 && (
              <div className="mt-2 space-y-2">
                {diff.messages.changed.map((item) => (
                  <div key={item.index} className="grid gap-2 rounded border border-border-dark/40 p-2 md:grid-cols-2">
                    <div><div className="mb-1 text-3xs text-red-300">上一轮 #{item.index + 1}</div><JsonTree value={item.previous} /></div>
                    <div><div className="mb-1 text-3xs text-emerald-300">当前轮 #{item.index + 1}</div><JsonTree value={item.current} /></div>
                  </div>
                ))}
              </div>
            )}
          </DiffBlock>

          <DiffBlock title="系统提示词" badge={diff.systemChanged ? '有变化' : '无变化'}>
            {diff.systemChanged ? (
              <div className="grid gap-2 md:grid-cols-2">
                <TextCompare label="上一轮" value={diff.previousSystem} tone="removed" />
                <TextCompare label="当前轮" value={diff.currentSystem} tone="added" />
              </div>
            ) : <div className="text-xs text-text-muted">系统提示词保持不变，共 {diff.currentSystem.length} 个字符。</div>}
          </DiffBlock>

          <DiffBlock title="工具变化">
            <div className="grid gap-2 md:grid-cols-4">
              <ChangeList title="新增" values={diff.tools.added} tone="added" />
              <ChangeList title="删除" values={diff.tools.removed} tone="removed" />
              <ChangeList title="修改" values={diff.tools.changed} tone="changed" />
              <ChangeList title="未变化" values={diff.tools.unchanged} tone="neutral" />
            </div>
          </DiffBlock>

          <DiffBlock title="配置与上下文变化">
            <div className="grid gap-2 md:grid-cols-3">
              <ChangeList title="模型设置" values={diff.settingChanges} tone="changed" />
              <ChangeList title="供应商选项" values={diff.providerOptionChanges} tone="changed" />
              <ChangeList title="上下文报告" values={diff.contextChanges} tone="changed" />
            </div>
          </DiffBlock>
        </div>
      )}
    </UiModal>
  )
}

function DiffBlock({ title, badge, children }: { title: string; badge?: string; children: ReactNode }): JSX.Element {
  return <section className="rounded-lg border border-border-dark/45 bg-black/15"><div className="flex items-center justify-between border-b border-border-dark/35 px-3 py-2"><span className="text-xs font-medium text-text-dark">{title}</span>{badge && <span className="rounded bg-white/5 px-1.5 py-0.5 text-3xs text-text-muted">{badge}</span>}</div><div className="p-3">{children}</div></section>
}

function DeltaMetric({ label, value }: { label: string; value: number }): JSX.Element {
  const tone = value > 0 ? 'text-amber-300' : value < 0 ? 'text-emerald-300' : 'text-text-muted'
  return <div className="rounded border border-border-dark/40 bg-black/20 p-2"><div className="text-3xs text-text-muted">{label}</div><div className={`mt-1 font-mono text-sm ${tone}`}>{value > 0 ? '+' : ''}{formatTraceTokens(value)}</div></div>
}

function ChangeList({ title, values, tone }: { title: string; values: string[]; tone: 'added' | 'removed' | 'changed' | 'neutral' }): JSX.Element {
  return <div className={`rounded border p-2 ${toneClass(tone)}`}><div className="mb-1 text-3xs font-medium uppercase tracking-wider">{title} · {values.length}</div>{values.length === 0 ? <div className="text-2xs opacity-60">无</div> : <div className="space-y-1">{values.map((value, index) => <div key={`${value}-${index}`} className="break-all rounded bg-black/15 px-1.5 py-1 font-mono text-3xs">{value}</div>)}</div>}</div>
}

function TextCompare({ label, value, tone }: { label: string; value: string; tone: 'added' | 'removed' }): JSX.Element {
  return <div className={`rounded border p-2 ${toneClass(tone)}`}><div className="mb-1 text-3xs font-medium">{label}</div><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words bg-black/15 p-2 font-mono text-3xs leading-relaxed">{value}</pre></div>
}

function toneClass(tone: 'added' | 'removed' | 'changed' | 'neutral'): string {
  if (tone === 'added') return 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
  if (tone === 'removed') return 'border-red-500/30 bg-red-500/5 text-red-200'
  if (tone === 'changed') return 'border-amber-500/30 bg-amber-500/5 text-amber-200'
  return 'border-border-dark/40 bg-white/5 text-text-muted'
}

function messageSummary(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  return text.length > 120 ? `${text.slice(0, 117)}…` : text
}
