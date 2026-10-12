/** 每次执行独占一个控制器；取消/替换后旧回调失效，不能提交新终态。 */
const executions = new Map<string, AbortController>()

export function beginGenerationTaskExecution(taskId: string): {
  signal: AbortSignal
  isCurrent: () => boolean
  finish: () => void
} {
  executions.get(taskId)?.abort()
  const controller = new AbortController()
  executions.set(taskId, controller)
  return {
    signal: controller.signal,
    isCurrent: () => executions.get(taskId) === controller && !controller.signal.aborted,
    finish: () => { if (executions.get(taskId) === controller) executions.delete(taskId) },
  }
}

export function cancelGenerationTaskExecution(taskId: string): void {
  executions.get(taskId)?.abort()
}
