import { AgentToolRegistry } from '../registry'
import { createBackendBuiltinTools } from './backend'
import type { AgentArtifactToolAccess } from './artifacts'
import { createFrontendApplicationCapabilityTools } from './frontend-capabilities'
import type { FrontendToolInvoker } from './frontend-utils'

export function createBuiltinAgentToolRegistry(
  invokeFrontend: FrontendToolInvoker,
  artifactAccess: AgentArtifactToolAccess = {
    describe: () => { throw new Error('[ARTIFACT_NOT_FOUND] Artifact 访问器未配置') },
    read: () => { throw new Error('[ARTIFACT_NOT_FOUND] Artifact 访问器未配置') },
  }
): AgentToolRegistry {
  const registry = new AgentToolRegistry()
  for (const tool of createFrontendApplicationCapabilityTools(invokeFrontend)) registry.register(tool)
  for (const tool of createBackendBuiltinTools(registry, artifactAccess, invokeFrontend)) registry.register(tool)
  return registry
}

export type { FrontendToolInvoker } from './frontend-utils'
