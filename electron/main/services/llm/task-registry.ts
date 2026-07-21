const controllers = new Map<string, AbortController>()
const cancelledTaskIds = new Set<string>()

export function registerLlmTask(taskId: string, controller: AbortController): void {
  cancelledTaskIds.delete(taskId)
  controllers.set(taskId, controller)
}

export function cancelLlmTask(taskId: string): void {
  cancelledTaskIds.add(taskId)
  controllers.get(taskId)?.abort()
}

export function isLlmTaskCancelled(taskId: string): boolean {
  return cancelledTaskIds.has(taskId)
}

export function clearLlmTask(taskId: string): void {
  controllers.delete(taskId)
  cancelledTaskIds.delete(taskId)
}
