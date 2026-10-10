import { isGenerationTerminalStatus, normalizeGenerationTaskStatus } from '@/core/application-control/domains/generation/taskStatus'
import { databaseService } from '@/services/database'
import { generationApplicationService } from './generationApplicationService'
import { subscribeVisibleGenerationTaskChanges } from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'

/** 等生成任务到终态；进度由界面直接订阅生成进度。 */
export async function waitForGenerationCompletion(taskId: string, signal: AbortSignal, recovering = false, onProgress?: (progress: number) => void): Promise<{ ok: true } | { ok: false; error: string }> {
  return await new Promise((resolve, reject) => {
    let checking = false
    let checkAgain = false
    let settled = false
    const finish = (outcome: { ok: true } | { ok: false; error: string }): void => { if (settled) return; settled = true; cleanup(); resolve(outcome) }
    const check = async (): Promise<void> => {
      if (settled) return
      if (checking) { checkAgain = true; return }
      checking = true
      try {
        let task: ReturnType<typeof generationApplicationService.getTask> | undefined
        try { task = generationApplicationService.getTask(taskId) } catch { task = undefined }
        if (task) onProgress?.(task.progress ?? 0)
        // 恢复优先读持久历史，防止生成页尚未刷新时用旧内存状态盖掉关闭期间的结果。
        if (recovering || !task) {
          const record = await databaseService.getHistoryById(taskId)
          if (settled || signal.aborted) return
          if (record && isGenerationTerminalStatus(record.status)) {
            finish(normalizeGenerationTaskStatus(record.status) === 'success'
              ? { ok: true } : { ok: false, error: record.errorMessage || '原生成任务未完成，可重试或换模型重新生成。' })
            return
          }
          if (!task && !record) { finish({ ok: false, error: '找不到原生成任务，请从生成历史核对结果，或重试重新生成。' }); return }
        }
        if (task && isGenerationTerminalStatus(task.status)) {
          const status = normalizeGenerationTaskStatus(task.status)
          if (status === 'success' && task.resultAvailable) {
            // 内存结果先更新，正式历史异步落盘；跨宿主来源必须等持久回执，不能抢读旧 queued 记录。
            const record = await databaseService.getHistoryById(taskId)
            if (settled || signal.aborted) return
            if (!record || !isGenerationTerminalStatus(record.status)) return
            finish(normalizeGenerationTaskStatus(record.status) === 'success'
              ? { ok: true } : { ok: false, error: record.errorMessage || '生成结果保存未完成，请从原任务核对并恢复。' })
            return
          }
          finish(status === 'success' && task.resultAvailable ? { ok: true } : { ok: false, error: task.errorMessage || (status === 'cancelled' ? '生成已取消。' : '生成没有完成。') })
          return
        }
      } catch (error) { if (!settled) { settled = true; cleanup(); reject(error) } }
      finally { checking = false; if (checkAgain) { checkAgain = false; void check() } }
    }
    const onAbort = (): void => { settled = true; cleanup(); reject(signal.reason ?? new DOMException('已取消。', 'AbortError')) }
    const unsubscribe = subscribeVisibleGenerationTaskChanges(() => { void check() })
    // 状态事件之外再兜底轮询（结果写回与事件可能错开）。
    const timer = setInterval(() => { void check() }, 2000)
    function cleanup(): void { unsubscribe(); clearInterval(timer); signal.removeEventListener('abort', onAbort) }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort(); else void check()
  })
}

