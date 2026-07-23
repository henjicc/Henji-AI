import {
  AlertCircle,
  BrainCircuit,
  Check,
  Edit3,
  LoaderCircle,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import {
  clearAgentMemory,
  confirmAgentMemoryCandidate,
  deleteAgentMemory,
  getAgentMemoryState,
  rejectAgentMemoryCandidate,
  updateAgentMemoryRecord,
  updateAgentMemorySettings,
} from '@/commands/assistant'
import { Dropdown, UiButton, UiIconButton, UiSwitch, UiTextArea } from '@/components/ui'
import type { AgentMemoryRecord, AgentMemoryState } from '@/core/assistant/memory'

const ttlOptions = [
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: 180, label: '180 天' },
  { value: 365, label: '365 天' },
]

function scopeLabel(memory: AgentMemoryRecord): string {
  if (memory.scope.type === 'global') return '全局'
  return `${memory.scope.type === 'workspace' ? '工作区' : '项目'} · ${memory.scope.id}`
}

export function AssistantMemoryPanel(): JSX.Element {
  const [state, setState] = useState<AgentMemoryState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [clearArmed, setClearArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setState(await getAgentMemoryState())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取助手记忆失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const act = async (id: string, action: () => Promise<unknown>): Promise<void> => {
    setBusyId(id)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '记忆操作失败')
    } finally {
      setBusyId(null)
    }
  }

  const beginEdit = (memory: AgentMemoryRecord): void => {
    setEditingId(memory.memoryId)
    setDraft(memory.content)
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-app">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-dark px-3">
        <BrainCircuit className="h-3.5 w-3.5 text-accent" />
        <span className="flex-1 text-xs font-medium text-text-dark">助手记忆</span>
        <UiIconButton
          type="button"
          title="刷新助手记忆"
          onClick={() => void refresh()}
          className="!h-7 !w-7 !rounded-md"
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </UiIconButton>
      </div>

      <div className="ui-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-3 [contain:layout_paint_style]">
        {loading && !state ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin" />正在读取
          </div>
        ) : null}

        {state ? (
          <>
            <div className="rounded-lg border border-border-dark bg-panel p-2.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-medium text-text-dark">长期记忆</div>
                  <div className="mt-0.5 text-[10px] leading-4 text-text-muted">默认关闭；只有已确认且与任务相关的少量内容会注入。</div>
                </div>
                <UiSwitch
                  checked={state.settings.enabled}
                  onCheckedChange={(enabled) => void act('settings', async () => {
                    await updateAgentMemorySettings({ enabled })
                  })}
                  disabled={busyId !== null}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-border-dark pt-2">
                <span className="text-[11px] text-text-muted">默认过期时间</span>
                <Dropdown<number>
                  value={state.settings.defaultTtlDays}
                  options={ttlOptions}
                  onSelect={(defaultTtlDays) => void act('settings', async () => {
                    await updateAgentMemorySettings({ defaultTtlDays })
                  })}
                  buttonClassName="!h-7 !rounded-md !px-2 text-[11px]"
                />
              </div>
            </div>

            {state.candidates.map((candidate) => (
              <article key={candidate.candidateId} className="rounded-lg border border-accent/30 bg-accent/5 p-2.5">
                <div className="text-[10px] font-medium text-accent">待确认记忆</div>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-text-dark">{candidate.content}</p>
                <div className="mt-2 flex justify-end gap-1.5">
                  <UiButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void act(candidate.candidateId, async () => {
                      await rejectAgentMemoryCandidate(candidate.candidateId)
                    })}
                    disabled={busyId !== null}
                    className="h-7 px-2"
                  >
                    <X className="mr-1 h-3.5 w-3.5" />拒绝
                  </UiButton>
                  <UiButton
                    type="button"
                    size="sm"
                    variant="primary"
                    onClick={() => void act(candidate.candidateId, async () => {
                      await confirmAgentMemoryCandidate(candidate.candidateId)
                    })}
                    disabled={busyId !== null}
                    className="h-7 px-2"
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />保存
                  </UiButton>
                </div>
              </article>
            ))}

            {state.memories.map((memory) => (
              <article
                key={memory.memoryId}
                className="rounded-lg border border-border-dark bg-panel p-2.5 [content-visibility:auto] [contain-intrinsic-size:auto_92px]"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] text-text-muted">
                      {scopeLabel(memory)} · {memory.kind} · {new Date(memory.createdAt).toLocaleDateString('zh-CN')}
                    </div>
                    {editingId === memory.memoryId ? (
                      <UiTextArea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        maxLength={1_000}
                        rows={3}
                        className="mt-1.5 text-xs"
                      />
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-text-dark">{memory.content}</p>
                    )}
                    <div className="mt-1 text-[10px] text-text-muted">来源：{memory.sourceLabel}</div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {editingId === memory.memoryId ? (
                      <UiIconButton
                        type="button"
                        title="保存修改"
                        className="!h-7 !w-7 !rounded-md"
                        onClick={() => void act(memory.memoryId, async () => {
                          await updateAgentMemoryRecord({ memoryId: memory.memoryId, content: draft })
                          setEditingId(null)
                        })}
                        disabled={!draft.trim() || busyId !== null}
                      >
                        <Save className="h-3.5 w-3.5" />
                      </UiIconButton>
                    ) : (
                      <UiIconButton
                        type="button"
                        title="编辑记忆"
                        className="!h-7 !w-7 !rounded-md"
                        onClick={() => beginEdit(memory)}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </UiIconButton>
                    )}
                    <UiIconButton
                      type="button"
                      title="删除记忆"
                      hoverVariant="danger"
                      className="!h-7 !w-7 !rounded-md"
                      onClick={() => void act(memory.memoryId, async () => {
                        await deleteAgentMemory(memory.memoryId)
                      })}
                      disabled={busyId !== null}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </UiIconButton>
                  </div>
                </div>
              </article>
            ))}

            {state.memories.length === 0 && state.candidates.length === 0 ? (
              <div className="py-8 text-center text-xs leading-5 text-text-muted">
                暂无记忆。启用后，只有你明确要求“长期记住”并确认的内容才会保存。
              </div>
            ) : null}

            {state.memories.length > 0 ? (
              <UiButton
                type="button"
                size="sm"
                variant={clearArmed ? 'muted' : 'ghost'}
                onClick={() => {
                  if (!clearArmed) {
                    setClearArmed(true)
                    return
                  }
                  setClearArmed(false)
                  void act('clear', async () => { await clearAgentMemory() })
                }}
                className={`w-full ${clearArmed ? 'text-danger' : ''}`}
                disabled={busyId !== null}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {clearArmed ? '再次点击确认清空全部记忆' : '清空全部记忆'}
              </UiButton>
            ) : null}
          </>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="leading-5">{error}</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
