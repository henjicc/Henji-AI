import {
  assertApplicationCapabilityAllowed,
  assertApplicationCallerGrant,
  type ApplicationCallerGrant,
} from '@/core/application-control/callerContext'
import {
  applicationCapabilityInvocationSchema,
  type ApplicationCapabilityDefinition,
} from '@/core/application-control/applicationCapabilities'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry'
import { executeApplicationCapabilityResult, listRendererApplicationCapabilityIds } from '@/features/application-control/capabilities/registry'
import { isExternalApplicationTool } from '@/core/application-control/externalCapabilityPolicy'

/** 复用唯一注册源；助手内部后端工具不进入应用调用目录。 */
export function listApplicationCapabilities(): ApplicationCapabilityDefinition[] {
  const registered = new Set(listRendererApplicationCapabilityIds())
  return BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().filter((definition) => (
    (isExternalApplicationTool(definition) || definition.external?.kind === 'recovery')
    && registered.has(definition.id)
    && definition.dataClasses.every((value) => value === 'C0' || value === 'C1')
  ))
}

/** 授权来自宿主，调用参数不含任何权限、审批或助手运行字段。 */
export function createApplicationCapabilitySession(grant: ApplicationCallerGrant): {
  list: () => ApplicationCapabilityDefinition[]
  execute: (input: unknown, request: { requestId: string; signal: AbortSignal }) => ReturnType<typeof executeApplicationCapabilityResult>
} {
  assertApplicationCallerGrant(grant)
  return {
    list: () => {
      assertApplicationCallerGrant(grant)
      return listApplicationCapabilities().filter((definition) => {
        try { assertApplicationCapabilityAllowed(grant, definition); return true } catch { return false }
      })
    },
    execute: async (input, request) => {
      assertApplicationCallerGrant(grant)
      const invocation = applicationCapabilityInvocationSchema.parse(input)
      const definition = listApplicationCapabilities().find((value) => value.id === invocation.id)
      if (!definition) throw new Error('NOT_FOUND:此能力未向外部连接开放，请重新读取应用能力目录。')
      assertApplicationCapabilityAllowed(grant, definition)
      if (!request.requestId.trim()) throw new Error('INVALID_INPUT:宿主必须提供操作请求标识。')
      return executeApplicationCapabilityResult(invocation, { ...request, callerGrant: grant })
    },
  }
}
