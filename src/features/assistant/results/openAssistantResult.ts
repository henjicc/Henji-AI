import { createLogger } from '@/core/logging'
import {
  focusCanvasNodeFromAgent,
  openCanvasProjectFromAgent,
} from '@/features/canvas/application/agentCanvasActions'
import { switchWorkspace } from '@/stores/navigationStore'
import { getVisibleGenerationTask } from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'

const logger = createLogger('features.assistant.ui')

function waitForTaskElement(taskId: string, attemptsLeft = 12): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const find = (): void => {
      const selector = `[data-generation-task-id="${CSS.escape(taskId)}"]`
      const element = document.querySelector<HTMLElement>(selector)
      if (element || attemptsLeft <= 1) {
        resolve(element)
        return
      }
      requestAnimationFrame(() => {
        void waitForTaskElement(taskId, attemptsLeft - 1).then(resolve)
      })
    }
    find()
  })
}

export async function openAssistantGenerationResult(taskId: string): Promise<boolean> {
  const task = getVisibleGenerationTask(taskId)
  if (!task) return false
  switchWorkspace('generation')
  const element = await waitForTaskElement(taskId)
  if (!element) {
    logger.warn('智能助手结果目标当前不可见', {
      event: 'assistant_ui.result.open.failed',
      taskId,
      context: { reason: 'TASK_ELEMENT_NOT_VISIBLE' },
    })
    return false
  }
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  element.focus({ preventScroll: true })
  logger.info('智能助手结果已定位', {
    event: 'assistant_ui.result.open.completed',
    taskId,
  })
  return true
}

export async function openAssistantCanvasResult(projectId: string, nodeId: string): Promise<boolean> {
  const controller = new AbortController()
  try {
    await openCanvasProjectFromAgent(projectId, controller.signal)
    switchWorkspace('nodes')
    await focusCanvasNodeFromAgent(projectId, nodeId, controller.signal)
    logger.info('智能助手画布结果已定位', {
      event: 'assistant_ui.canvas_result.open.completed',
      context: { projectId, nodeId },
    })
    return true
  } catch (error) {
    logger.warn('智能助手画布结果定位失败', {
      event: 'assistant_ui.canvas_result.open.failed',
      context: {
        projectId,
        nodeId,
        errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      },
    })
    return false
  }
}
