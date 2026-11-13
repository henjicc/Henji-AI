import { getDb } from '../db'
import { databaseLocations } from '../db-locations'
import crypto from 'node:crypto'
import type { AudioEditTask } from '../../../../src/core/audioEdit/types'
import { createMainLogger } from '../logging'
import { registerWorkRootBusyProbe } from '../work-root/busy-probes'

const logger = createMainLogger('main.audio_edit.tasks')
const active = new Map<string, { controller: AbortController; projectId: string; progress?: number; readOnly: boolean; owner?: string }>()
// 口播处理会读写作品目录里的口播与“生成结果”，进行中不允许更换作品目录
registerWorkRootBusyProbe('audio_edit_task', { reason: '口播还有处理任务在进行', isBusy: () => active.size > 0 })

/*
 * 口播处理任务（转写、停顿分析、声音处理、导出）的回执表 `audio_edit_tasks`（迁移账本第 16 项）。
 * 任务按口播文档 ID（`document_id`）归属；接口里的 projectId 就是文档 ID。
 */

/** 任务结果里的文件位置整份按位置写法存储（实施方案 2.5）。 */
function encodeTaskResult(result: unknown): string {
  return databaseLocations.use((scope) => JSON.stringify(scope.encodeValue(result)))
}

function decodeTaskResult(text: string): unknown {
  const parsed = JSON.parse(text) as unknown
  return databaseLocations.use((scope) => scope.decodeValue(parsed))
}

export type AudioEditTaskState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export function createAudioEditTask(input: {
  requestId: string
  projectId: string
  kind: string
  inputDigest: string
}): void {
  const now = Date.now()
  getDb().prepare(`
    INSERT INTO audio_edit_tasks(
      request_id,document_id,kind,state,provider_task_id,input_digest,result_json,error_message,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
  `).run(input.requestId, input.projectId, input.kind, 'queued', null, input.inputDigest, null, null, now, now)
}

/*
 * 助手命令行与主应用有意并存、共用同一个数据库：别的进程正在跑的任务只看得到数据库里的记录。
 * 在跑的任务每 HEARTBEAT_MS 刷新一次 updated_at；排队或运行中、心跳超过 STALE_MS 没更新的，就是进程已经不在了。
 *
 * 付费转写还带“执行者令牌”（回执里的 owner）：每次尝试一个新令牌，认领（新建或接管）是一条条件写入，
 * 之后对这一行的每次写入都要令牌对得上。睡眠唤醒、时钟跳变、卡住都可能让两个进程都以为对方不在了，
 * 但同一时刻只有一个令牌写得进去：另一方在发出付费请求前的那次写入落空，就放弃不发。
 * updated_at 每次写入都严格增大，接管时按读到的值比对，读之后有任何写入都比对不上。
 */
const HEARTBEAT_MS = 5_000
const STALE_MS = 60_000
const OWNER = "json_extract(result_json, '$.owner')"
const NEXT_UPDATED_AT = 'MAX(?, updated_at + 1)'
let heartbeat: ReturnType<typeof setInterval> | undefined
function beat(): void {
  if (!active.size) { clearInterval(heartbeat); heartbeat = undefined; return }
  try {
    const db = getDb()
    const plain = db.prepare(`UPDATE audio_edit_tasks SET updated_at = ${NEXT_UPDATED_AT} WHERE request_id = ? AND state IN ('queued', 'running')`)
    const owned = db.prepare(`UPDATE audio_edit_tasks SET updated_at = ${NEXT_UPDATED_AT} WHERE request_id = ? AND ${OWNER} = ?`)
    const now = Date.now()
    for (const [requestId, task] of active) {
      if (!task.owner) { plain.run(now, requestId); continue }
      if (owned.run(now, requestId, task.owner).changes) continue
      // 令牌对不上：这一行已被别的进程接管，停下本进程的这次转写
      logger.warn('口播转写已被另一处接手，停止本次', { event: 'audio_edit.tasks.ownership_lost', requestId })
      task.controller.abort(new Error('这份口播的转写已由另一个窗口或助手命令行接手。'))
    }
  } catch (error) { logger.warn('口播任务心跳写入失败', { event: 'audio_edit.tasks.heartbeat_failed', error }) }
}

/** owner：这次付费转写的执行者令牌（认领成功之后才登记），心跳只在令牌对得上时刷新。 */
export function registerAudioEditTaskController(requestId: string, projectId: string, controller: AbortController, readOnly = false, owner?: string): () => void {
  if (active.has(requestId) && active.get(requestId)?.controller !== controller) throw new Error('该任务正在执行，请查询原任务状态。')
  active.set(requestId, { controller, projectId, readOnly, ...(owner ? { owner } : {}) })
  if (!heartbeat) { heartbeat = setInterval(beat, HEARTBEAT_MS); heartbeat.unref?.() }
  return () => { if (active.get(requestId)?.controller === controller) active.delete(requestId) }
}

type TaskLiveness = { state: AudioEditTaskState; updated_at: number }
/** 别的进程的心跳是否新鲜。时钟往回拨时差值为负，按“刚刚”算，但拨回超过 STALE_MS 的同样当作过期，不让任务永远卡在运行中。 */
const liveElsewhere = (row: TaskLiveness | undefined, now = Date.now()): boolean => {
  if (!row || (row.state !== 'queued' && row.state !== 'running')) return false
  const age = now - row.updated_at
  return age < STALE_MS && age > -STALE_MS
}

/**
 * 认领一份口播的付费转写，整段在一个立即事务里（跨进程串行）：
 * 新建时这份口播还不能有任何转写记录；接管时那一条必须已经结束（失败或取消），且 updated_at 仍是读到时的值。
 * 认领成功返回 true，之后用 updateOwnedAudioEditTask 写；返回 false 说明别人抢先或刚动过这一行，放弃。
 */
export function claimAudioEditTask(input: { requestId: string; projectId: string; kind: string; inputDigest: string; owner: string; result: Record<string, unknown>; takeoverUpdatedAt?: number }): boolean {
  const db = getDb()
  const now = Date.now()
  const result = encodeTaskResult({ ...input.result, owner: input.owner })
  db.exec('BEGIN IMMEDIATE')
  try {
    let claimed: boolean
    if (input.takeoverUpdatedAt !== undefined) {
      claimed = db.prepare(`UPDATE audio_edit_tasks SET state = 'running', result_json = ?, error_message = NULL, updated_at = ${NEXT_UPDATED_AT}
        WHERE request_id = ? AND document_id = ? AND kind = ? AND updated_at = ? AND state IN ('failed', 'cancelled')`)
        .run(result, now, input.requestId, input.projectId, input.kind, input.takeoverUpdatedAt).changes === 1
    } else {
      claimed = !db.prepare('SELECT 1 FROM audio_edit_tasks WHERE document_id = ? AND kind = ? LIMIT 1').get(input.projectId, input.kind)
      if (claimed) db.prepare(`INSERT INTO audio_edit_tasks(request_id,document_id,kind,state,provider_task_id,input_digest,result_json,error_message,created_at,updated_at)
        VALUES(?,?,?,'running',NULL,?,?,NULL,?,?)`).run(input.requestId, input.projectId, input.kind, input.inputDigest, result, now, now)
    }
    db.exec('COMMIT')
    return claimed
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** 带令牌写入：只有当前执行者写得进去，返回是否写入；令牌对不上（已被接管）时一个字也不改。 */
export function updateOwnedAudioEditTask(requestId: string, owner: string, update: { state: AudioEditTaskState; providerTaskId?: string; result?: Record<string, unknown>; errorMessage?: string }): boolean {
  return getDb().prepare(`
    UPDATE audio_edit_tasks SET state = ?, provider_task_id = COALESCE(?, provider_task_id), result_json = COALESCE(?, result_json),
      error_message = ?, updated_at = ${NEXT_UPDATED_AT}
    WHERE request_id = ? AND ${OWNER} = ?
  `).run(update.state, update.providerTaskId ?? null, update.result ? encodeTaskResult({ ...update.result, owner }) : null, update.errorMessage ?? null, Date.now(), requestId, owner).changes === 1
}

export function assertAudioEditProjectIdle(projectId: string): void {
  if ([...active.values()].some((task) => task.projectId === projectId && !task.readOnly)) throw new Error('口播还有处理任务，请先取消或等待完成。')
}

/** 这份口播是否还有任何处理任务在进行（含只读任务）。 */
export function hasActiveAudioEditTask(projectId: string): boolean {
  return [...active.values()].some((task) => task.projectId === projectId)
}

/** 删除一份口播的全部任务回执（文档离开作品时调用，回执可重建）。 */
export function deleteAudioEditTasks(projectId: string): number {
  return getDb().prepare('DELETE FROM audio_edit_tasks WHERE document_id = ?').run(projectId).changes
}

export function cancelAudioEditTask(requestId: string): void { active.get(requestId)?.controller.abort() }

const INTERRUPTED_MESSAGE = '上次处理在软件退出时中断。'

/**
 * 带窗口的主应用启动时调用（只此一个实例）：上次进程留下的“排队/运行中”已经没有执行者，记为失败。
 * 有助手命令行在跑时只标心跳早已停了的；命令行进程自己不调用。回执原样保留。
 */
export function markInterruptedAudioEditTasks(commandLineRunning: boolean): void {
  const now = Date.now()
  const changes = getDb().prepare(`UPDATE audio_edit_tasks SET state = 'failed', error_message = ?, updated_at = ${NEXT_UPDATED_AT} WHERE state IN ('queued', 'running')${commandLineRunning ? ' AND (updated_at < ? OR updated_at > ?)' : ''}`)
    .run(INTERRUPTED_MESSAGE, now, ...(commandLineRunning ? [now - STALE_MS, now + STALE_MS] : [])).changes
  if (changes) logger.info('上次中断的口播任务已标记', { event: 'audio_edit.tasks.interrupted_marked', context: { count: changes, commandLineRunning } })
}

/**
 * 运行中却已没有进程在跑（心跳停了）的那条任务记为中断，之后才能按回执判断能否重新提交。
 * 本进程或别的进程还在跑时不动。只改状态不改令牌：原执行者其实还活着时，它之后的写入照样算数，接管方的条件写入就会落空。
 */
export function settleStaleAudioEditTask(requestId: string): void {
  if (active.has(requestId)) return
  const now = Date.now()
  const changes = getDb().prepare(`UPDATE audio_edit_tasks SET state = 'failed', error_message = ?, updated_at = ${NEXT_UPDATED_AT} WHERE request_id = ? AND state IN ('queued', 'running') AND (updated_at < ? OR updated_at > ?)`)
    .run(INTERRUPTED_MESSAGE, now, requestId, now - STALE_MS, now + STALE_MS).changes
  if (changes) logger.info('中断的口播任务已标记', { event: 'audio_edit.tasks.interrupted_marked', requestId, context: { count: changes } })
}

export function listAudioEditTasks(projectId: string): AudioEditTask[] {
  const rows = getDb().prepare('SELECT request_id,document_id,kind,state,error_message,updated_at FROM audio_edit_tasks WHERE document_id = ? ORDER BY updated_at DESC LIMIT 30').all(projectId) as Array<{ request_id: string; document_id: string; kind: string; state: AudioEditTaskState; error_message?: string; updated_at: number }>
  const now = Date.now()
  return rows.map((row) => {
    const running = active.get(row.request_id)
    const interrupted = !running && (row.state === 'running' || row.state === 'queued') && !liveElsewhere(row, now)
    return { requestId: row.request_id, projectId: row.document_id, kind: row.kind, state: interrupted ? 'failed' : row.state,
      progress: running?.progress, errorMessage: interrupted ? '上次处理已中断。' : row.error_message }
  })
}

export async function runAudioEditTask<T>(projectId: string, kind: string, operation: (signal: AbortSignal, progress: (value: number) => void) => Promise<T>, requestId: string = crypto.randomUUID(), input: string = '', readOnly = false, controller = new AbortController()): Promise<T> {
  controller.signal.throwIfAborted()
  const inputDigest = crypto.createHash('sha256').update(input).digest('hex')
  const existing = getDb().prepare('SELECT document_id,kind,state,result_json,input_digest FROM audio_edit_tasks WHERE request_id = ?').get(requestId) as { document_id: string; kind: string; state: string; result_json: string | null; input_digest: string } | undefined
  if (existing) {
    if (existing.document_id !== projectId || existing.kind !== kind || existing.input_digest !== inputDigest) throw new Error('任务引用与当前口播不匹配。')
    if (existing.state === 'completed' && existing.result_json) return decodeTaskResult(existing.result_json) as T
    throw new Error('该任务已提交，请查询原任务状态。')
  }
  if (!readOnly) assertAudioEditProjectIdle(projectId)
  const release = registerAudioEditTaskController(requestId, projectId, controller, readOnly)
  try {
    createAudioEditTask({ requestId, projectId, kind, inputDigest })
    updateAudioEditTask(requestId, { state: 'running' })
  } catch (error) { release(); throw error }
  logger.info('口播处理开始', { event: `audio_edit.${kind}.start`, requestId, context: { projectId } })
  try {
    const result = await operation(controller.signal, (progress) => {
      const task = active.get(requestId)
      if (task) task.progress = Math.max(0, Math.min(1, progress))
    })
    controller.signal.throwIfAborted()
    updateAudioEditTask(requestId, { state: 'completed', result: result ?? null })
    logger.info('口播处理完成', { event: `audio_edit.${kind}.completed`, requestId, context: { projectId } })
    return result
  } catch (error) {
    updateAudioEditTask(requestId, { state: controller.signal.aborted ? 'cancelled' : 'failed', errorMessage: error instanceof Error ? error.message : String(error) })
    if (controller.signal.aborted) logger.info('口播处理已取消', { event: `audio_edit.${kind}.cancelled`, requestId, context: { projectId } })
    else logger.error('口播处理失败', { event: `audio_edit.${kind}.failed`, requestId, context: { projectId }, error })
    throw error
  } finally { release() }
}

export function updateAudioEditTask(requestId: string, update: {
  state: AudioEditTaskState
  providerTaskId?: string
  result?: unknown
  errorMessage?: string
}): void {
  getDb().prepare(`
    UPDATE audio_edit_tasks SET
      state = ?,
      provider_task_id = COALESCE(?, provider_task_id),
      result_json = COALESCE(?, result_json),
      error_message = ?,
      updated_at = ?
    WHERE request_id = ?
  `).run(
    update.state,
    update.providerTaskId ?? null,
    update.result === undefined ? null : encodeTaskResult(update.result),
    update.errorMessage ?? null,
    Date.now(),
    requestId,
  )
}

export interface AudioEditStoredTask { request_id: string; state: AudioEditTaskState; provider_task_id: string | null; input_digest: string; result_json: string | null; error_message?: string | null; updated_at: number }
export function getAudioEditStoredTask(requestId: string): (AudioEditStoredTask & { document_id: string }) | undefined {
  const row = getDb().prepare('SELECT request_id,document_id,state,provider_task_id,input_digest,result_json,updated_at FROM audio_edit_tasks WHERE request_id = ?').get(requestId) as (AudioEditStoredTask & { document_id: string }) | undefined
  return row?.result_json ? { ...row, result_json: JSON.stringify(decodeTaskResult(row.result_json)) } : row
}
export function findAudioEditTranscription(projectId: string): AudioEditStoredTask | undefined {
  const row = getDb().prepare("SELECT request_id,state,provider_task_id,input_digest,result_json,error_message,updated_at FROM audio_edit_tasks WHERE document_id = ? AND kind = 'transcription' ORDER BY created_at DESC LIMIT 1").get(projectId) as AudioEditStoredTask | undefined
  return row?.result_json ? { ...row, result_json: JSON.stringify(decodeTaskResult(row.result_json)) } : row
}
/** 任务正由本进程执行。 */
export function isAudioEditTaskRunningHere(requestId: string): boolean { return active.has(requestId) }
/** 任务此刻有没有进程在跑：本进程看登记表，别的进程（助手命令行与主应用共用数据库）看心跳。 */
export function isAudioEditTaskActive(requestId: string): boolean {
  if (active.has(requestId)) return true
  return liveElsewhere(getDb().prepare('SELECT state, updated_at FROM audio_edit_tasks WHERE request_id = ?').get(requestId) as TaskLiveness | undefined)
}
