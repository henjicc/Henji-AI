const cancelledTasks = new Set<string>()
const abortControllers = new Map<string, AbortController>()

export type TaskNamespace = 'generation' | 'llm' | (string & {})

function taskKey(namespace: TaskNamespace, taskId: string): string {
  return `${namespace}:${taskId}`
}

export function clearCancelFlag(namespace: TaskNamespace, taskId: string): void {
  const key = taskKey(namespace, taskId)
  cancelledTasks.delete(key)
  abortControllers.delete(key)
}

export function registerAbortController(
  namespace: TaskNamespace,
  taskId: string,
  controller: AbortController
): void {
  abortControllers.set(taskKey(namespace, taskId), controller)
}

export function cancelTask(namespace: TaskNamespace, taskId: string): void {
  const normalized = taskId.trim()
  if (!normalized) {
    return
  }
  const key = taskKey(namespace, normalized)
  cancelledTasks.add(key)
  abortControllers.get(key)?.abort()
}

export function isCancelled(namespace: TaskNamespace, taskId: string): boolean {
  return cancelledTasks.has(taskKey(namespace, taskId))
}
