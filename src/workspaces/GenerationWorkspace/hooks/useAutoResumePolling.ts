import { useEffect, useRef } from 'react'
import type { GenerationTask } from '../types'

export interface UseAutoResumePollingParams {
  tasks: GenerationTask[]
  isTasksLoaded: boolean
  handleContinuePolling: (task: GenerationTask) => Promise<void>
}

function shouldResumeTask(task: GenerationTask): boolean {
  if (!task.serverTaskId || task.serverTaskId.trim().length === 0) {
    return false
  }

  if (task.result) {
    return false
  }

  return task.status === 'generating' || task.status === 'pending' || task.status === 'queued'
}

export function useAutoResumePolling({
  tasks,
  isTasksLoaded,
  handleContinuePolling,
}: UseAutoResumePollingParams): void {
  const inflightTaskIdsRef = useRef<Set<string>>(new Set())
  const didResumeAfterLoadRef = useRef(false)

  useEffect(() => {
    if (!isTasksLoaded || didResumeAfterLoadRef.current) {
      return
    }

    didResumeAfterLoadRef.current = true

    const resumeCandidates = tasks.filter((task) => (
      shouldResumeTask(task) && !inflightTaskIdsRef.current.has(task.id)
    ))

    for (const task of resumeCandidates) {
      inflightTaskIdsRef.current.add(task.id)
      void handleContinuePolling(task).finally(() => {
        inflightTaskIdsRef.current.delete(task.id)
      })
    }
  }, [handleContinuePolling, isTasksLoaded, tasks])
}
