import { create } from 'zustand'

/*
 * 助手正在改哪份文档：人和助手用同一个界面时，助手动手的那份文档要看得出来、并且暂时不让人改，
 * 避免两边的修改交错落进同一个撤销栈、或者人正拖着选区时内容被换掉。
 *
 * - 只认文档：同时只锁助手正在写的那一份，别的文档、别的工作区照常用；
 * - 助手一轮工作是“读 → 想 → 写”的循环，两次写之间留 HOLD 时间仍算在编辑，避免锁一下放一下；
 * - 人随时可以接管：接管只清除编辑提示，下一次提交仍由事务并发控制核对。
 * 只记稳定的文档 ID 与调用者名称，不进持久化，也不进日志以外的任何地方。
 */

export interface AgentEditingCaller {
  kind: 'embedded' | 'external'
  /** 外部连接在设置里起的名字；内置助手没有 */
  name?: string
}

export interface AgentEditingSession {
  documentId: string
  caller: AgentEditingCaller
  activity: symbol
  /** 正在执行的写入数 */
  active: number
  lastWriteAt: number
}

interface AgentEditingState {
  sessions: Record<string, AgentEditingSession>
}

export const AGENT_EDITING_HOLD_MS = 15_000

export const useAgentEditingStore = create<AgentEditingState>(() => ({ sessions: {} }))

const without = <T>(record: Record<string, T>, key: string): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([id]) => id !== key))

let expiryTimer: ReturnType<typeof setTimeout> | undefined
const authored = new WeakSet<object>()

export function isAgentEditingSession(session: AgentEditingSession | undefined, now = Date.now()): session is AgentEditingSession {
  return Boolean(session && (session.active > 0 || now - session.lastWriteAt < AGENT_EDITING_HOLD_MS))
}

function scheduleExpiry(): void {
  if (expiryTimer) clearTimeout(expiryTimer)
  const { sessions } = useAgentEditingStore.getState()
  const idle = Object.values(sessions).filter((session) => session.active === 0)
  if (!idle.length) return
  const next = Math.min(...idle.map((session) => session.lastWriteAt + AGENT_EDITING_HOLD_MS)) - Date.now()
  expiryTimer = setTimeout(() => {
    expiryTimer = undefined
    const now = Date.now()
    useAgentEditingStore.setState((state) => ({
      sessions: Object.fromEntries(Object.entries(state.sessions).filter(([, session]) => isAgentEditingSession(session, now))),
    }))
    scheduleExpiry()
  }, Math.max(0, next) + 20)
}

/**
 * 助手写入开始时调用，返回结束回调。编辑提示不阻止后续助手事务。
 * 文档内对象的稳定 ID 以文档 ID 开头（`文档:对象`），文档引用本身就是文档 ID。
 */
export function beginAgentEdit(documentIds: readonly string[], caller: AgentEditingCaller): () => void {
  const ids = [...new Set(documentIds)]
  if (!ids.length) return () => {}
  const now = Date.now()
  const activities = new Map<string, symbol>()
  useAgentEditingStore.setState((state) => ({
    sessions: { ...state.sessions, ...Object.fromEntries(ids.map((id) => {
      const activity = state.sessions[id]?.activity ?? Symbol()
      activities.set(id, activity)
      return [id, { documentId: id, caller, activity, active: (state.sessions[id]?.active ?? 0) + 1, lastWriteAt: now } satisfies AgentEditingSession]
    })) },
  }))
  let ended = false
  return () => {
    if (ended) return
    ended = true
    const at = Date.now()
    useAgentEditingStore.setState((state) => ({
      // 接管会结束当前提示会话，迟到回调不能修改后续会话的在途计数。
      sessions: { ...state.sessions, ...Object.fromEntries(ids.filter((id) => state.sessions[id]?.activity === activities.get(id)).map((id) => [id, {
        ...state.sessions[id], active: Math.max(0, state.sessions[id].active - 1), lastWriteAt: at,
      }])) },
    }))
    scheduleExpiry()
  }
}

/** 人接管：立即放开这份文档的锁，后续写入仍由事务并发控制核对。 */
export function takeOverAgentDocument(documentId: string): void {
  useAgentEditingStore.setState((state) => ({ sessions: without(state.sessions, documentId) }))
}

/** 助手写入正在执行（不含两次写之间的保持时间）：这期间产生的编辑步骤记为助手的。 */
export function isAgentWritingDocument(documentId: string): boolean {
  return (useAgentEditingStore.getState().sessions[documentId]?.active ?? 0) > 0
}

/** 撤销栈里的步骤快照由助手产生时登记；历史记录据此标出“助手”。弱引用，不影响快照回收与存档。 */
export function markAgentAuthoredStep(snapshot: object): void { authored.add(snapshot) }
export function isAgentAuthoredStep(snapshot: object): boolean { return authored.has(snapshot) }

type TargetRef = { kind: string; id: string }
const isRef = (value: unknown): value is TargetRef => Boolean(value && typeof value === 'object'
  && typeof (value as TargetRef).kind === 'string' && typeof (value as TargetRef).id === 'string')

/** 从一次写入的正式目标与通用实体写入的 target/parent 推出涉及的文档 ID。 */
export function agentEditDocumentIds(
  definition: { resolveOperationWriteTargets?(input: never, operationId: string): TargetRef[]; resolveOperationTargets?(input: never): TargetRef[] },
  input: Record<string, unknown>,
  operationId: string,
): string[] {
  const refs: TargetRef[] = []
  try {
    refs.push(...(definition.resolveOperationWriteTargets?.(input as never, operationId) ?? definition.resolveOperationTargets?.(input as never) ?? []))
  } catch { /* 输入非法时由正式执行报错，这里不登记 */ }
  for (const change of Array.isArray(input.changes) ? input.changes as Array<Record<string, unknown>> : []) {
    if (isRef(change.target)) refs.push(change.target)
    if (isRef(change.parent)) refs.push(change.parent)
    if (Array.isArray(change.targets)) refs.push(...change.targets.filter(isRef))
  }
  return [...new Set(refs.filter((ref) => !ref.kind.startsWith('application.')).map((ref) => ref.id.split(':')[0]).filter(Boolean))]
}
