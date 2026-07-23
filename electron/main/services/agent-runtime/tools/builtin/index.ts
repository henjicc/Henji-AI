import { AgentToolRegistry } from '../registry'
import { createBackendBuiltinTools } from './backend'
import { createFrontendBuiltinTools, type FrontendToolInvoker } from './frontend'

export function createBuiltinAgentToolRegistry(invokeFrontend: FrontendToolInvoker): AgentToolRegistry {
  const registry = new AgentToolRegistry()
  for (const tool of createFrontendBuiltinTools(invokeFrontend)) registry.register(tool)
  for (const tool of createBackendBuiltinTools(registry)) registry.register(tool)
  return registry
}

export type { FrontendToolInvoker } from './frontend'
