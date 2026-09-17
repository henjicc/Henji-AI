import type { ApplicationCapabilityDefinition } from './applicationCapabilities'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from './builtinApplicationCapabilityRegistry'

/** 由能力原声明生成可调用集合；没有第二份 MCP 业务名单。未接好执行器由覆盖门禁报错。 */
export function isExternalApplicationTool(definition: ApplicationCapabilityDefinition): boolean {
  return definition.side === 'frontend' && !definition.external
    && definition.dataClasses.every(value => value === 'C0' || value === 'C1')
}

export function projectExternalCapabilities(definitions: readonly ApplicationCapabilityDefinition[]) {
  const tools = definitions.filter(isExternalApplicationTool)
  const recovery = definitions.filter(definition => definition.external?.kind === 'recovery')
  return {
    read: tools.filter(definition => definition.readOnly),
    write: tools.filter(definition => !definition.readOnly),
    recovery,
    all: [...tools, ...recovery],
  }
}

export const EXTERNAL_APPLICATION_CAPABILITIES = projectExternalCapabilities(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list())
