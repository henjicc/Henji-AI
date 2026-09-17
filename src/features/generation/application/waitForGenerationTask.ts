import { isGenerationTerminalStatus } from '@/core/application-control/domains/generation/taskStatus'
import { waitForApplicationTask } from '@/core/application-control/taskWait'

/** 等待只观察已有任务，不提交、恢复或取消生成。计时和查询留在宿主，不消耗模型轮次。 */
export function waitForGenerationTask(
  read: () => Promise<Record<string, unknown>>,
  signal: AbortSignal,
  timeoutMs = 9 * 60_000,
): Promise<{ task: Record<string, unknown>; waitReason: string }> {
  return waitForApplicationTask(read, task => {
    if (isGenerationTerminalStatus(String(task.normalizedStatus ?? task.status))) return 'terminal'
    return task.waitingExternal === false && Boolean(task.resumeInput) ? 'recovery_required' : undefined
  }, signal, timeoutMs)
}
