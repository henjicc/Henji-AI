import { isGenerationTerminalStatus } from '@/core/assistant/externalWait'

/** 等待只观察已有任务，不提交、恢复或取消生成。计时和查询留在宿主，不消耗模型轮次。 */
export function waitForGenerationTask(
  read: () => Promise<Record<string, unknown>>,
  signal: AbortSignal,
  timeoutMs = 9 * 60_000,
): Promise<{ task: Record<string, unknown>; waitReason: string }> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let finished = false
    const deadline = Date.now() + timeoutMs
    const cleanup = () => { finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('等待已取消，生成任务继续运行。', 'AbortError')) }
    const check = async () => {
      try {
        const task = await read()
        if (finished) return
        const terminal = isGenerationTerminalStatus(String(task.normalizedStatus ?? task.status))
        const recovery = task.waitingExternal === false && Boolean(task.resumeInput)
        if (terminal || recovery || Date.now() >= deadline) {
          cleanup()
          resolve({ task, waitReason: terminal ? 'terminal' : recovery ? 'recovery_required' : 'still_running' })
        } else timer = setTimeout(() => { void check() }, Math.min(1000, deadline - Date.now()))
      } catch (error) { if (!finished) { cleanup(); reject(error) } }
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else void check()
  })
}
