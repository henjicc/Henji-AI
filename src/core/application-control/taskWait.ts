export type ApplicationTaskWaitReason = 'terminal' | 'recovery_required' | 'still_running'

/** 只等待已有任务的权威状态，取消观察不调用任务取消或重新提交。 */
export function waitForApplicationTask<T>(read: () => Promise<T>,
  classify: (task: T) => Exclude<ApplicationTaskWaitReason, 'still_running'> | undefined,
  signal: AbortSignal, timeoutMs = 9 * 60_000): Promise<{ task: T; waitReason: ApplicationTaskWaitReason }> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let finished = false
    const deadline = Date.now() + timeoutMs
    const cleanup = () => { finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('等待已取消，原任务继续运行。', 'AbortError')) }
    const check = async () => {
      try {
        const task = await read()
        if (finished) return
        const reason = classify(task)
        if (reason || Date.now() >= deadline) {
          cleanup()
          resolve({ task, waitReason: reason ?? 'still_running' })
        } else timer = setTimeout(() => { void check() }, Math.min(1000, deadline - Date.now()))
      } catch (error) { if (!finished) { cleanup(); reject(error) } }
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else void check()
  })
}
