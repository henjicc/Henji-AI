
import { getStoryboardProject, listStoryboardProjects } from '@/features/canvas/application/storyboardProjectService'

import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control/capabilities/handlerTypes'

import { parseCapabilityInput as parseApplicationCapabilityInput } from '@/features/application-control/capabilities/handlerUtils'
import { normalizeCanvasNodeIds } from './canvasNodeIdNormalization'

/**
 * 画布能力统一从这里取参：调用方拿到的 `canvas.node` 稳定引用是 `<工程>:<节点>`，原样回传时
 * 在这里把本工程的前缀剥掉，各处理器不必各写一遍，也不会漏掉新增的能力。
 */
function parseCapabilityInput<TInput>(id: string, input: unknown): TInput {
  return normalizeCanvasNodeIds(parseApplicationCapabilityInput<TInput>(id, input))
}


interface ProjectInput {
  projectId: string
}

export function registerStoryboardCapabilityHandlers(registrar: ApplicationCapabilityHandlerRegistrar): void {
  registrar.registerHandler('list_storyboard_projects', async () => ({
    projects: await listStoryboardProjects(),
  }))

  registrar.registerHandler('get_storyboard_project', async (input) => {
    const parsed = parseCapabilityInput<ProjectInput>('get_storyboard_project', input)
    return { project: await getStoryboardProject(parsed.projectId) }
  })
}
