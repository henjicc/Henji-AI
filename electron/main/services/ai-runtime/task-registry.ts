const cancelledTasks = new Set<string>()
const abortControllers = new Map<string, AbortController>()

export function clearCancelFlag(taskId: string): void {
  cancelledTasks.delete(taskId)
  abortControllers.delete(taskId)
}

export function registerAbortController(taskId: string, controller: AbortController): void {
  abortControllers.set(taskId, controller)
}

export function cancelTask(taskId: string): void {
  const normalized = taskId.trim()
  if (!normalized) {
    return
  }
  cancelledTasks.add(normalized)
  abortControllers.get(normalized)?.abort()
}

export function isCancelled(taskId: string): boolean {
  return cancelledTasks.has(taskId)
}
