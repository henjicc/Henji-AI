import { useEffect, useRef } from 'react'
import { resolveResumableServerTaskId as resumableServerTaskId } from '@/features/generation/application/taskServerId'
import type { GenerationTask } from '../types'

export interface UseAutoResumePollingParams {
  tasks: GenerationTask[]
  isTasksLoaded: boolean
  handleContinuePolling: (task: GenerationTask) => Promise<void>
  /** 收敛一条永远续不回来的任务。缺省时只跳过，不改动任何记录。 */
  settleUnresumableTask?: (task: GenerationTask) => void
}

const RUNNING_STATUSES: ReadonlySet<GenerationTask['status']> = new Set(['generating', 'pending', 'queued'])

export function useAutoResumePolling({
  tasks,
  isTasksLoaded,
  handleContinuePolling,
  settleUnresumableTask,
}: UseAutoResumePollingParams): void {
  const inflightTaskIdsRef = useRef<Set<string>>(new Set())
  const didResumeAfterLoadRef = useRef(false)

  useEffect(() => {
    if (!isTasksLoaded || didResumeAfterLoadRef.current) {
      return
    }

    didResumeAfterLoadRef.current = true

    /*
     * 这一遍只在历史加载完成后跑一次，此刻不存在本次会话在途的任务：凡是还挂在运行态的，
     * 都是上一次退出留下来的。有任务号的接着轮询；**一个任务号都找不到的，永远轮询不回来**，
     * 必须就地收敛成失败。原来这类记录会停在"生成中"，跨重启也不变，用户看到的是一个
     * 永远转圈、既没有结果也没有错误的任务——2026-09-18 真机上就留下过一条。
     */
    for (const task of tasks) {
      if (!RUNNING_STATUSES.has(task.status) || task.result) continue
      // 画布任务的供应商任务号和结果归原工程节点；历史列表不拥有其恢复与终态判断。
      if (task.options?.__canvasGeneration) continue
      if (inflightTaskIdsRef.current.has(task.id)) continue
      if (!resumableServerTaskId(task)) {
        settleUnresumableTask?.(task)
        continue
      }
      inflightTaskIdsRef.current.add(task.id)
      void handleContinuePolling(task).finally(() => {
        inflightTaskIdsRef.current.delete(task.id)
      })
    }
  }, [handleContinuePolling, isTasksLoaded, settleUnresumableTask, tasks])
}
