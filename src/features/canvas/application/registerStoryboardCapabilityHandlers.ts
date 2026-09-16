
import { getStoryboardProject, listStoryboardProjects } from '@/features/canvas/application/storyboardProjectService'

import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control/capabilities/handlerTypes'

import { parseCapabilityInput } from '@/features/application-control/capabilities/handlerUtils'

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
