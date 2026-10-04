import { SHARED_MEMORY_ID } from '@/core/assistant/memory'
import { getPlatform } from '@/platform/runtime'
import {
  Check,
  Edit3,
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
import {
  Dropdown,
  UiButton,
  UiEmpty,
  UiError,
  UiFormRow,
  UiGroup,
  UiIconButton,
  UiLoading,
  UiSwitch,
  UiTextArea,
  UI_INSET_SURFACE_CLASS,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
} from '@/components/ui'
import type { AgentMemoryRecord, AgentMemoryState } from '@/core/assistant/memory'

const ttlOptions = [
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: 180, label: '180 天' },
  { value: 365, label: '365 天' },
]

/** 作用域只说类型：工作区、项目的内部 ID 对用户没有意义，不进入正式界面（信息准入）。 */
function scopeLabel(memory: AgentMemoryRecord): string {
  if (memory.scope.type === 'global') return '全局'
  return memory.scope.type === 'workspace' ? '工作区' : '项目'
}

const memoryItemClass = `rounded-lg ${UI_INSET_SURFACE_CLASS} p-2.5`

export function AssistantMemoryPanel(): JSX.Element {
  const [state, setState] = useState<AgentMemoryState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sharedRevision, setSharedRevision] = useState(0)
  const [clearArmed, setClearArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setSharedRevision((await getPlatform().assistant.getSharedMemory()).revision)
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

  const refreshButton = (
    <UiIconButton
      type="button"
      title="刷新助手记忆"
      aria-label="刷新助手记忆"
      onClick={() => void refresh()}
      disabled={loading}
    >
      <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'motion-safe:animate-spin' : ''}`} />
    </UiIconButton>
  )

  // 标题由侧栏命令带给出（“助手记忆”），这里不再长第二条头带；刷新放进第一个分组的动作位。
  return (
    <section
      aria-label="助手记忆"
      className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2 [contain:layout_paint_style]"
    >
      {loading && !state ? (
        <UiLoading size="sm" message="正在读取" />
      ) : null}

      {state ? (
        <div className="space-y-5">
          <UiGroup title="长期记忆" titleTone="compact" actions={refreshButton}>
            <UiFormRow
              inline
              density="compact"
              label="自动使用与更新"
              hint="共享摘要会用于后续对话；关闭后停止自动使用和更新。"
            >
              <UiSwitch
                aria-label="自动使用与更新长期记忆"
                checked={state.settings.enabled}
                onCheckedChange={(enabled) => void act('settings', async () => {
                  await updateAgentMemorySettings({ enabled })
                })}
                disabled={busyId !== null}
              />
            </UiFormRow>
            <UiFormRow inline density="compact" label="历史条目默认保留时间">
              <Dropdown<number>
                value={state.settings.defaultTtlDays}
                options={ttlOptions}
                onSelect={(defaultTtlDays) => void act('settings', async () => {
                  await updateAgentMemorySettings({ defaultTtlDays })
                })}
                ariaLabel="历史条目默认保留时间"
                size="sm"
                buttonClassName="w-auto"
                panelWidthStrategy="options"
              />
            </UiFormRow>
          </UiGroup>

          {state.candidates.length > 0 ? (
            <UiGroup title="待确认" titleTone="compact" gap="none">
              <div className="space-y-2">
                {state.candidates.map((candidate) => (
                  <article key={candidate.candidateId} className={memoryItemClass}>
                    <p className={`whitespace-pre-wrap break-words leading-5 ${UI_TEXT_BODY_CLASS}`}>{candidate.content}</p>
                    {/* 每条候选都有一对动作：同组同档，保存用次级，不给列表里每一条都配一个强调色实底 */}
                    <div className="mt-2 flex justify-end gap-1.5">
                      <UiButton
                        type="button"
                        size="sm"
                        onClick={() => void act(candidate.candidateId, async () => {
                          await rejectAgentMemoryCandidate(candidate.candidateId)
                        })}
                        disabled={busyId !== null}
                      >
                        <X className="mr-1 h-3.5 w-3.5" />拒绝
                      </UiButton>
                      <UiButton
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => void act(candidate.candidateId, async () => {
                          await confirmAgentMemoryCandidate(candidate.candidateId)
                        })}
                        disabled={busyId !== null}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" />保存
                      </UiButton>
                    </div>
                  </article>
                ))}
              </div>
            </UiGroup>
          ) : null}

          {state.memories.length > 0 ? (
            <UiGroup title="已保存" titleTone="compact" gap="none">
              <div className="space-y-2">
                {state.memories.map((memory) => (
                  <article
                    key={memory.memoryId}
                    className={`${memoryItemClass} [content-visibility:auto] [contain-intrinsic-size:auto_92px]`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className={UI_TEXT_META_CLASS}>
                          {scopeLabel(memory)} · {{ preference: '偏好', fact: '经验', workflow: '工作习惯' }[memory.kind]} · {new Date(memory.createdAt).toLocaleDateString('zh-CN')}
                        </div>
                        {editingId === memory.memoryId ? (
                          <UiTextArea
                            aria-label="编辑记忆内容"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            maxLength={memory.memoryId === SHARED_MEMORY_ID ? 800 : 1_000}
                            rows={3}
                            className="mt-1.5"
                          />
                        ) : (
                          <p className={`mt-1 whitespace-pre-wrap break-words leading-5 ${UI_TEXT_BODY_CLASS}`}>{memory.content}</p>
                        )}
                        <div className={`mt-1 ${UI_TEXT_META_CLASS}`}>来源：{memory.sourceLabel}</div>
                      </div>
                      <div className="flex shrink-0 gap-0.5">
                        {editingId === memory.memoryId ? (
                          <UiIconButton
                            type="button"
                            title="保存修改"
                            aria-label="保存修改"
                            onClick={() => void act(memory.memoryId, async () => {
                              if (memory.memoryId === SHARED_MEMORY_ID) await getPlatform().assistant.updateSharedMemory({ content: draft, expectedRevision: sharedRevision })
                              else await updateAgentMemoryRecord({ memoryId: memory.memoryId, content: draft })
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
                            aria-label="编辑记忆"
                            onClick={() => beginEdit(memory)}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </UiIconButton>
                        )}
                        <UiIconButton tone="danger"
                          type="button"
                          title="删除记忆"
                          aria-label="删除记忆"
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
                {/* 两次点击确认：危险实底只给确认弹窗，这里保持 danger 档，靠第二次的确认文案提示 */}
                <UiButton
                  type="button"
                  variant="danger"
                  onClick={() => {
                    if (!clearArmed) {
                      setClearArmed(true)
                      return
                    }
                    setClearArmed(false)
                    void act('clear', async () => { await clearAgentMemory() })
                  }}
                  className="w-full"
                  disabled={busyId !== null}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {clearArmed ? '再次点击确认清空全部记忆' : '清空全部记忆'}
                </UiButton>
              </div>
            </UiGroup>
          ) : null}

          {state.memories.length === 0 && state.candidates.length === 0 ? (
            <UiEmpty
              size="sm"
              title="暂无记忆"
              description="启用后，只有你明确要求“长期记住”并确认的内容才会保存。"
            />
          ) : null}
        </div>
      ) : null}

      {error ? (
        <UiError size="xs" align="start" title="记忆操作未完成" message={error} />
      ) : null}
    </section>
  )
}
