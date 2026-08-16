import { z } from 'zod'

import {
  applicationCapabilityResultSchema,
  hostContextSnapshotSchema,
  type HostContextSnapshot,
} from '../../../../../src/core/assistant/hostContracts'
import type { AgentArtifactToolAccess } from './builtin/artifacts'
import { createBuiltinAgentToolRegistry } from './builtin'
import type { FrontendToolInvoker } from './builtin/frontend-utils'
import { AgentToolRegistry } from './registry'
import type { AgentToolDefinition } from './types'

const mainToolResponseSchema = z.object({
  output: z.unknown(),
  hostContext: hostContextSnapshotSchema.nullable(),
}).strict()

interface UtilityMainToolContext {
  runId: string
  toolCallId: string
  signal: AbortSignal
}

interface UtilityProxyRegistryOptions {
  executeMainTool: (payload: {
    runId: string
    threadId: string
    toolCallId: string
    toolName: string
    input: unknown
  }, signal: AbortSignal) => Promise<unknown>
  resolveThreadId: (runId: string) => string | null
  getHostContext: (runId: string) => HostContextSnapshot | null
  rememberHostContext: (runId: string, context: HostContextSnapshot) => void
  artifactAccess: AgentArtifactToolAccess
}

export interface UtilityProxyRegistries {
  registry: AgentToolRegistry
  catalogRegistry: AgentToolRegistry
}

/**
 * Utility 进程拥有合并后的后端能力目录，但应用实体反射仍以渲染层为真相源。
 * 所以目录工具在 utility 本地执行，目录水合需要的前端读取则经主进程 RPC 返回。
 */
export function createUtilityProxyRegistries(
  options: UtilityProxyRegistryOptions,
): UtilityProxyRegistries {
  const executeMain = async (
    toolName: string,
    input: unknown,
    context: UtilityMainToolContext,
  ): Promise<z.infer<typeof mainToolResponseSchema>> => {
    const threadId = options.resolveThreadId(context.runId)
    if (!threadId) throw new Error(`[run_not_found] 运行缺少线程绑定：${context.runId}`)
    const parsed = mainToolResponseSchema.parse(await options.executeMainTool({
      runId: context.runId,
      threadId,
      toolCallId: context.toolCallId,
      toolName,
      input,
    }, context.signal))
    if (parsed.hostContext) options.rememberHostContext(context.runId, parsed.hostContext)
    return parsed
  }

  const invokeFrontend: FrontendToolInvoker = async (operation, context) => {
    const response = await executeMain(
      operation.capability.id,
      operation.capability.input,
      context,
    )
    const hostContext = response.hostContext ?? options.getHostContext(context.runId)
    if (!hostContext) throw new Error('[renderer_gone] 前端能力执行后缺少宿主上下文')
    return applicationCapabilityResultSchema.parse({
      ok: true,
      data: z.record(z.string(), z.unknown()).parse(response.output),
      resultingRevision: hostContext.revision,
      resultingScopeRevisions: hostContext.scopeRevisions,
    })
  }

  const source = createBuiltinAgentToolRegistry(invokeFrontend, options.artifactAccess)
  const proxy = new AgentToolRegistry()
  const localToolNames = new Set([
    'read_agent_artifact',
    'search_application_capabilities',
    'discover_application_capabilities',
    'read_application_schemas',
  ])
  for (const definition of source.allDefinitions()) {
    const proxied: AgentToolDefinition = {
      ...definition,
      execute: localToolNames.has(definition.name)
        ? definition.execute
        : async (input, context) => (
          await executeMain(definition.name, input, context)
        ).output,
    }
    proxy.register(proxied)
  }
  return { registry: proxy, catalogRegistry: source }
}
